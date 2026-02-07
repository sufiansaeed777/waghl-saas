const Stripe = require('stripe');
const { Customer, SubAccount } = require('../models');
const emailService = require('./email');
const logger = require('../utils/logger');

// Initialize Stripe only if key is provided
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

function checkStripeConfigured() {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY in environment variables.');
  }
}

class StripeService {
  // Check if Stripe is configured
  isConfigured() {
    return !!stripe;
  }

  // Create Stripe customer
  async createStripeCustomer(customer) {
    try {
      checkStripeConfigured();
      const stripeCustomer = await stripe.customers.create({
        email: customer.email,
        name: customer.name,
        metadata: {
          customerId: customer.id
        }
      });

      await customer.update({ stripeCustomerId: stripeCustomer.id });

      return stripeCustomer;
    } catch (error) {
      logger.error('Create Stripe customer error:', error);
      throw error;
    }
  }

  // Create checkout session for a specific sub-account
  // Pricing: €29/month for first 10 paid sub-accounts, €19/month for 11+
  async createCheckoutSession(customer, subAccountId) {
    try {
      checkStripeConfigured();
      if (!customer.stripeCustomerId) {
        await this.createStripeCustomer(customer);
      }

      // Count current paid sub-accounts (not including the one being purchased)
      const paidSubAccountCount = await SubAccount.count({
        where: { customerId: customer.id, isPaid: true, isGifted: false }
      });

      // Determine price based on how many the customer already has
      // If they have 10+, they get volume discount (€19)
      const isVolumePrice = paidSubAccountCount >= 10;
      const priceId = isVolumePrice
        ? process.env.STRIPE_VOLUME_PRICE_ID
        : process.env.STRIPE_PRICE_ID;

      const session = await stripe.checkout.sessions.create({
        customer: customer.stripeCustomerId,
        payment_method_types: ['card'],
        line_items: [{
          price: priceId,
          quantity: 1
        }],
        mode: 'subscription',
        success_url: `${process.env.FRONTEND_URL}/sub-accounts?payment=success&subAccountId=${subAccountId}`,
        cancel_url: `${process.env.FRONTEND_URL}/sub-accounts?payment=cancelled`,
        metadata: {
          customerId: customer.id,
          subAccountId,
          priceType: isVolumePrice ? 'volume' : 'standard'
        },
        subscription_data: {
          metadata: {
            customerId: customer.id,
            subAccountId
          }
        }
      });

      return session;
    } catch (error) {
      logger.error('Create checkout session error:', error);
      throw error;
    }
  }

  // Create subscription checkout for customer (no sub-account required)
  async createSubscriptionCheckout(customer) {
    try {
      checkStripeConfigured();
      if (!customer.stripeCustomerId) {
        await this.createStripeCustomer(customer);
      }

      const session = await stripe.checkout.sessions.create({
        customer: customer.stripeCustomerId,
        payment_method_types: ['card'],
        line_items: [{
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1
        }],
        mode: 'subscription',
        success_url: `${process.env.FRONTEND_URL}/dashboard?subscription=success`,
        cancel_url: `${process.env.FRONTEND_URL}/dashboard?subscription=cancelled`,
        metadata: {
          customerId: customer.id
        }
      });

      return session;
    } catch (error) {
      logger.error('Create subscription checkout error:', error);
      throw error;
    }
  }

  // Add a sub-account slot (increase subscription quantity)
  async addSubscriptionSlot(customer) {
    try {
      checkStripeConfigured();

      const currentQuantity = customer.subscriptionQuantity || 0;
      const newQuantity = currentQuantity + 1;

      // Determine price based on quantity (€29 for 1-10, €19 for 11+)
      const isVolumePrice = newQuantity >= 11;
      const priceId = isVolumePrice
        ? process.env.STRIPE_VOLUME_PRICE_ID
        : process.env.STRIPE_PRICE_ID;

      // If customer doesn't have Stripe account, create one
      if (!customer.stripeCustomerId) {
        await this.createStripeCustomer(customer);
      }

      // If customer has an existing subscription, update quantity
      if (customer.subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(customer.subscriptionId);
        const subscriptionItem = subscription.items.data[0];

        // If switching to volume pricing, update the price for ALL items
        if (isVolumePrice && subscriptionItem.price.id !== priceId) {
          // Update to volume price for ALL items
          // proration_behavior: 'create_prorations' will:
          // - Credit customer for unused portion at old rate (10 × €29)
          // - Charge for remaining portion at new rate (11 × €19)
          // - Net effect: Customer pays €19 prorated for 11th slot, gets credit for price reduction
          // - From next month: All 11 slots at €19 = €209/month
          await stripe.subscriptions.update(customer.subscriptionId, {
            items: [{
              id: subscriptionItem.id,
              price: priceId,
              quantity: newQuantity
            }],
            proration_behavior: 'create_prorations'
          });
        } else {
          // Just increase quantity (charges customer for new slot prorated)
          await stripe.subscriptionItems.update(subscriptionItem.id, {
            quantity: newQuantity,
            proration_behavior: 'create_prorations'
          });
        }

        // Update customer's subscription quantity
        await customer.update({
          subscriptionQuantity: newQuantity,
          planType: isVolumePrice ? 'volume' : 'standard'
        });

        return {
          success: true,
          newQuantity,
          isVolumePrice,
          message: isVolumePrice
            ? 'Volume discount applied! All sub-accounts will be €19/month from next billing cycle.'
            : 'Slot added successfully'
        };
      }

      // Create new subscription checkout
      const session = await stripe.checkout.sessions.create({
        customer: customer.stripeCustomerId,
        payment_method_types: ['card'],
        line_items: [{
          price: priceId,
          quantity: 1
        }],
        mode: 'subscription',
        success_url: `${process.env.FRONTEND_URL}/sub-accounts?subscription=success&slots=1`,
        cancel_url: `${process.env.FRONTEND_URL}/sub-accounts?subscription=cancelled`,
        metadata: {
          customerId: customer.id,
          action: 'add_slot',
          newQuantity: '1'
        }
      });

      return { success: true, checkoutUrl: session.url };
    } catch (error) {
      logger.error('Add subscription slot error:', error);
      throw error;
    }
  }

  // Get subscription info for customer (per-sub-account model)
  async getSubscriptionInfo(customer) {
    try {
      // Count paid and unpaid sub-accounts
      const paidSubAccountCount = await SubAccount.count({
        where: { customerId: customer.id, isPaid: true, isGifted: false }
      });
      const totalSubAccountCount = await SubAccount.count({
        where: { customerId: customer.id, isGifted: false }
      });
      const unpaidSubAccountCount = totalSubAccountCount - paidSubAccountCount;

      // Calculate price for next sub-account (volume discount at 11+)
      const nextPrice = paidSubAccountCount >= 10 ? 19 : 29;
      const isVolumeEligible = paidSubAccountCount >= 10;

      return {
        paidSubAccountCount,
        totalSubAccountCount,
        unpaidSubAccountCount,
        nextPrice,
        isVolumeEligible,
        planType: customer.planType || 'standard',
        subscriptionStatus: customer.subscriptionStatus
      };
    } catch (error) {
      logger.error('Get subscription info error:', error);
      throw error;
    }
  }

  // Handle webhook events
  async handleWebhook(event) {
    try {
      checkStripeConfigured();
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const { customerId, subAccountId, action, newQuantity } = session.metadata;

          // Update customer and activate the specific sub-account
          const customer = await Customer.findByPk(customerId);
          if (customer) {
            // Check if still on active trial
            const isActiveTrial = customer.subscriptionStatus === 'trialing' &&
                                  customer.trialEndsAt &&
                                  new Date(customer.trialEndsAt) > new Date();

            // Store subscription ID but DON'T end trial early
            // Trial expires naturally, paid sub-accounts continue working after
            const updateData = {
              subscriptionId: session.subscription
            };

            // Only change to 'active' if trial has already ended
            if (!isActiveTrial) {
              updateData.subscriptionStatus = 'active';
              updateData.trialEndsAt = null;
              updateData.hasUsedTrial = true;
            }

            await customer.update(updateData);
          }

          // Activate the specific sub-account that was paid for
          if (subAccountId) {
            const subAccount = await SubAccount.findByPk(subAccountId);
            if (subAccount) {
              await subAccount.update({ isPaid: true });
              logger.info(`Sub-account ${subAccountId} marked as paid`);
            }
          }

          // Check if volume discount threshold crossed (11+ paid sub-accounts → all become €19)
          if (customer && customer.stripeCustomerId) {
            const paidCount = await SubAccount.count({
              where: { customerId: customer.id, isPaid: true, isGifted: false }
            });
            if (paidCount >= 11 && process.env.STRIPE_VOLUME_PRICE_ID) {
              await this.updateAllSubscriptionPrices(customer.stripeCustomerId, process.env.STRIPE_VOLUME_PRICE_ID);
              await customer.update({ planType: 'volume' });
              logger.info(`Volume discount applied for customer ${customerId}: ${paidCount} paid sub-accounts, all switched to €19`);
            }
          }

          // Send subscription activated email with sub-account info
          if (customer) {
            const subAccounts = await SubAccount.findAll({
              where: { customerId: customer.id, isPaid: true },
              attributes: ['name', 'ghlLocationId']
            });
            emailService.sendSubscriptionActivated(customer.email, customer.name, customer.planType || 'Standard', subAccounts)
              .catch(err => logger.error('Failed to send subscription activated email:', err));
          }

          logger.info(`Checkout completed for customer ${customerId}, quantity: ${customer?.subscriptionQuantity}`);
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object;
          const { subAccountId } = subscription.metadata || {};

          // Per-sub-account model: each subscription is tied to ONE sub-account
          if (subAccountId) {
            const subAccount = await SubAccount.findByPk(subAccountId, {
              include: [{ model: Customer, as: 'customer' }]
            });

            if (subAccount) {
              const isCanceledAtPeriodEnd = subscription.cancel_at_period_end;

              // Handle subscription status changes for THIS sub-account only
              if (subscription.status === 'past_due') {
                // Payment failed - disable this sub-account
                await subAccount.update({ isPaid: false });
                logger.info(`Subscription past_due for sub-account ${subAccountId}`);
                emailService.sendPaymentFailed(subAccount.customer.email, subAccount.customer.name)
                  .catch(err => logger.error('Failed to send payment failed email:', err));
              } else if (subscription.status === 'active' && !isCanceledAtPeriodEnd) {
                // Active subscription - enable this sub-account
                await subAccount.update({ isPaid: true });
                logger.info(`Subscription active for sub-account ${subAccountId}`);
              } else if (isCanceledAtPeriodEnd) {
                // Scheduled for cancellation - sub-account still works until period end
                logger.info(`Subscription scheduled for cancellation for sub-account ${subAccountId}`);
                emailService.sendSubscriptionCancelled(subAccount.customer.email, subAccount.customer.name)
                  .catch(err => logger.error('Failed to send cancellation email:', err));
              }

              logger.info(`Subscription updated for sub-account ${subAccountId}: ${subscription.status}, cancelAtPeriodEnd: ${isCanceledAtPeriodEnd}`);
            }
          } else {
            // Legacy: subscription without subAccountId (old slot-based model)
            const customer = await Customer.findOne({
              where: { stripeCustomerId: subscription.customer }
            });
            if (customer) {
              logger.info(`Legacy subscription update for customer ${customer.id}: ${subscription.status}`);
            }
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object;
          const { subAccountId } = subscription.metadata || {};

          // Per-sub-account model: only deactivate the specific sub-account
          if (subAccountId) {
            const subAccount = await SubAccount.findByPk(subAccountId, {
              include: [{ model: Customer, as: 'customer' }]
            });

            if (subAccount) {
              await subAccount.update({ isPaid: false });
              logger.info(`Subscription deleted for sub-account ${subAccountId}, marked as unpaid`);

              // Check if dropped below volume discount threshold (< 11 → revert all to €29)
              if (subAccount.customer && subAccount.customer.stripeCustomerId && process.env.STRIPE_PRICE_ID) {
                const remainingPaid = await SubAccount.count({
                  where: { customerId: subAccount.customer.id, isPaid: true, isGifted: false }
                });
                if (remainingPaid < 11 && remainingPaid > 0) {
                  await this.updateAllSubscriptionPrices(subAccount.customer.stripeCustomerId, process.env.STRIPE_PRICE_ID);
                  await subAccount.customer.update({ planType: 'standard' });
                  logger.info(`Volume discount removed for customer ${subAccount.customer.id}: ${remainingPaid} paid sub-accounts, all switched back to €29`);
                }
              }

              // Send cancellation email
              emailService.sendSubscriptionCancelled(subAccount.customer.email, subAccount.customer.name)
                .catch(err => logger.error('Failed to send subscription cancelled email:', err));
            }
          } else {
            // Legacy: subscription without subAccountId
            const customer = await Customer.findOne({
              where: { stripeCustomerId: subscription.customer }
            });

            if (customer) {
              // Legacy behavior: deactivate all sub-accounts
              await SubAccount.update(
                { isPaid: false },
                { where: { customerId: customer.id, isGifted: false } }
              );
              logger.info(`Legacy subscription deleted for customer ${customer.id}`);
            }
          }
          break;
        }

        default:
          logger.info(`Unhandled Stripe event: ${event.type}`);
      }
    } catch (error) {
      logger.error('Handle webhook error:', error);
      throw error;
    }
  }

  // Update all active subscription prices for a customer (volume discount switching)
  async updateAllSubscriptionPrices(stripeCustomerId, targetPriceId) {
    try {
      checkStripeConfigured();
      const subscriptions = await stripe.subscriptions.list({
        customer: stripeCustomerId,
        status: 'active',
        limit: 100
      });

      let updated = 0;
      for (const subscription of subscriptions.data) {
        const item = subscription.items.data[0];
        if (item && item.price.id !== targetPriceId) {
          await stripe.subscriptions.update(subscription.id, {
            items: [{
              id: item.id,
              price: targetPriceId
            }],
            proration_behavior: 'create_prorations'
          });
          updated++;
        }
      }

      logger.info(`Updated ${updated} subscriptions to price ${targetPriceId} for customer ${stripeCustomerId}`);
      return updated;
    } catch (error) {
      logger.error('Update subscription prices error:', error);
    }
  }

  // Get billing portal session
  async createBillingPortalSession(customer) {
    try {
      checkStripeConfigured();
      if (!customer.stripeCustomerId) {
        throw new Error('No Stripe customer found');
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: customer.stripeCustomerId,
        return_url: `${process.env.FRONTEND_URL}/settings`
      });

      return session;
    } catch (error) {
      logger.error('Create billing portal session error:', error);
      throw error;
    }
  }
}

module.exports = new StripeService();
