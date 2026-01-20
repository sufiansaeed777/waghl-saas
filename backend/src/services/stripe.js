const Stripe = require('stripe');
const { Customer, SubAccount } = require('../models');
const logger = require('../utils/logger');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

class StripeService {
  // Create Stripe customer
  async createStripeCustomer(customer) {
    try {
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

  // Handle webhook events
  async handleWebhook(event) {
    try {
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
