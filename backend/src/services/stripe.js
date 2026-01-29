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

  // Create checkout session for subscription
  async createCheckoutSession(customer, subAccountId) {
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
        success_url: `${process.env.FRONTEND_URL}/sub-accounts/${subAccountId}?payment=success`,
        cancel_url: `${process.env.FRONTEND_URL}/sub-accounts/${subAccountId}?payment=cancelled`,
        metadata: {
          customerId: customer.id,
          subAccountId
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

        // If switching to volume pricing, update the price
        if (isVolumePrice && subscriptionItem.price.id !== priceId) {
          // Update to volume price for ALL items from next billing cycle
          await stripe.subscriptions.update(customer.subscriptionId, {
            items: [{
              id: subscriptionItem.id,
              price: priceId,
              quantity: newQuantity
            }],
            proration_behavior: 'none' // Apply from next billing cycle
          });
        } else {
          // Just increase quantity
          await stripe.subscriptionItems.update(subscriptionItem.id, {
            quantity: newQuantity
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

  // Get subscription info for customer
  async getSubscriptionInfo(customer) {
    try {
      const subAccountCount = await SubAccount.count({ where: { customerId: customer.id } });
      const subscriptionQuantity = customer.subscriptionQuantity || 0;
      const availableSlots = subscriptionQuantity - subAccountCount;

      // Calculate next slot price
      const nextSlotNumber = subscriptionQuantity + 1;
      const nextSlotPrice = nextSlotNumber >= 11 ? 19 : 29;
      const isVolumeEligible = nextSlotNumber >= 11;

      return {
        subscriptionQuantity,
        subAccountCount,
        availableSlots,
        nextSlotPrice,
        isVolumeEligible,
        planType: customer.planType || 'standard'
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

          // Update customer subscription status
          const customer = await Customer.findByPk(customerId);
          if (customer) {
            // Get subscription details to get quantity
            let subscriptionQuantity = customer.subscriptionQuantity || 0;

            if (session.subscription) {
              const subscription = await stripe.subscriptions.retrieve(session.subscription);
              const quantity = subscription.items.data[0]?.quantity || 1;
              subscriptionQuantity = quantity;
            }

            // If this was a slot addition
            if (action === 'add_slot' && newQuantity) {
              subscriptionQuantity = parseInt(newQuantity);
            }

            await customer.update({
              subscriptionStatus: 'active',
              subscriptionId: session.subscription,
              subscriptionQuantity: subscriptionQuantity,
              planType: subscriptionQuantity >= 11 ? 'volume' : 'standard'
            });
          }

          // Activate sub-account (legacy support)
          if (subAccountId) {
            const subAccount = await SubAccount.findByPk(subAccountId);
            if (subAccount) {
              await subAccount.update({ isPaid: true });
            }
          }

          // Send subscription activated email
          if (customer) {
            emailService.sendSubscriptionActivated(customer.email, customer.name, customer.planType || 'Standard')
              .catch(err => logger.error('Failed to send subscription activated email:', err));
          }

          logger.info(`Checkout completed for customer ${customerId}, quantity: ${customer?.subscriptionQuantity}`);
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object;
          const customer = await Customer.findOne({
            where: { stripeCustomerId: subscription.customer }
          });

          if (customer) {
            // Check if subscription is set to cancel at period end
            const isCanceledAtPeriodEnd = subscription.cancel_at_period_end;

            let status;
            if (subscription.status === 'active') {
              status = isCanceledAtPeriodEnd ? 'canceling' : 'active';
            } else if (subscription.status === 'trialing') {
              status = 'trialing';
            } else if (subscription.status === 'past_due') {
              status = 'past_due';
            } else {
              status = 'inactive';
            }

            // Get quantity from subscription
            const quantity = subscription.items.data[0]?.quantity || 0;

            const previousStatus = customer.subscriptionStatus;

            await customer.update({
              subscriptionStatus: status,
              subscriptionQuantity: quantity,
              subscriptionId: subscription.id,
              planType: quantity >= 11 ? 'volume' : 'standard'
            });

            // If subscription was resumed (canceling -> active)
            if (previousStatus === 'canceling' && status === 'active') {
              logger.info(`Subscription resumed for customer ${customer.id}`);
              // Reactivate all sub-accounts
              await SubAccount.update(
                { isPaid: true },
                { where: { customerId: customer.id } }
              );
              // Send email notification
              emailService.sendSubscriptionActivated(customer.email, customer.name, 'Resumed')
                .catch(err => logger.error('Failed to send subscription resumed email:', err));
            }

            // If subscription was scheduled for cancellation
            if (previousStatus === 'active' && status === 'canceling') {
              logger.info(`Subscription scheduled for cancellation for customer ${customer.id}`);
              // Send email about scheduled cancellation
              emailService.sendSubscriptionCancelled(customer.email, customer.name)
                .catch(err => logger.error('Failed to send subscription cancellation scheduled email:', err));
            }

            logger.info(`Subscription updated for customer ${customer.id}: ${status}, quantity: ${quantity}, cancelAtPeriodEnd: ${isCanceledAtPeriodEnd}`);
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object;
          const customer = await Customer.findOne({
            where: { stripeCustomerId: subscription.customer }
          });

          if (customer) {
            await customer.update({
              subscriptionStatus: 'canceled',
              subscriptionId: null,
              subscriptionQuantity: 0,
              planType: null
            });

            // Deactivate all sub-accounts
            await SubAccount.update(
              { isPaid: false },
              { where: { customerId: customer.id } }
            );

            // Send subscription cancelled email (only if not already sent during 'canceling' status)
            if (customer.subscriptionStatus !== 'canceling') {
              emailService.sendSubscriptionCancelled(customer.email, customer.name)
                .catch(err => logger.error('Failed to send subscription cancelled email:', err));
            }

            logger.info(`Subscription deleted for customer ${customer.id}, quantity reset to 0`);
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
