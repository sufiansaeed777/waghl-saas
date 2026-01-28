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

  // Handle webhook events
  async handleWebhook(event) {
    try {
      checkStripeConfigured();
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const { customerId, subAccountId } = session.metadata;

          // Update customer subscription status
          const customer = await Customer.findByPk(customerId);
          if (customer) {
            await customer.update({
              subscriptionStatus: 'active',
              subscriptionId: session.subscription
            });
          }

          // Activate sub-account
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

          logger.info(`Checkout completed for customer ${customerId}`);
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object;
          const customer = await Customer.findOne({
            where: { stripeCustomerId: subscription.customer }
          });

          if (customer) {
            const status = subscription.status === 'active' ? 'active' :
                          subscription.status === 'trialing' ? 'trialing' :
                          subscription.status === 'past_due' ? 'past_due' : 'inactive';

            await customer.update({ subscriptionStatus: status });
            logger.info(`Subscription updated for customer ${customer.id}: ${status}`);
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
              subscriptionId: null
            });

            // Deactivate all sub-accounts
            await SubAccount.update(
              { isPaid: false },
              { where: { customerId: customer.id } }
            );

            // Send subscription cancelled email
            emailService.sendSubscriptionCancelled(customer.email, customer.name)
              .catch(err => logger.error('Failed to send subscription cancelled email:', err));

            logger.info(`Subscription cancelled for customer ${customer.id}`);
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
