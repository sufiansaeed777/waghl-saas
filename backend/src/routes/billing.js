const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/auth');
const stripeService = require('../services/stripe');
const { SubAccount } = require('../models');
const logger = require('../utils/logger');

// Subscribe/Resume subscription for sub-account
// If customer has saved payment method, creates subscription directly
// Otherwise returns checkout URL
router.post('/checkout/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    // Check if Stripe is configured
    if (!stripeService.isConfigured()) {
      return res.status(503).json({ error: 'Billing is not configured' });
    }

    const subAccountId = req.params.subAccountId;

    // Validate ownership - ensure sub-account belongs to this customer
    const subAccount = await SubAccount.findOne({
      where: { id: subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    // Check if already paid - prevent duplicate subscriptions
    if (subAccount.isPaid) {
      return res.status(400).json({ error: 'This sub-account already has an active subscription' });
    }

    // Check if gifted - no payment needed
    if (subAccount.isGifted) {
      return res.status(400).json({ error: 'This sub-account is gifted and does not require payment' });
    }

    // Check if customer has a saved payment method
    if (req.customer.stripeCustomerId) {
      const Stripe = require('stripe');
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

      try {
        // Get customer's default payment method
        const customer = await stripe.customers.retrieve(req.customer.stripeCustomerId);
        const defaultPaymentMethod = customer.invoice_settings?.default_payment_method;

        if (defaultPaymentMethod) {
          // Customer has saved payment method - create subscription directly
          const paidCount = await SubAccount.count({
            where: { customerId: req.customer.id, isPaid: true, isGifted: false }
          });
          const isVolumePrice = paidCount >= 10;
          const priceId = isVolumePrice
            ? process.env.STRIPE_VOLUME_PRICE_ID
            : process.env.STRIPE_PRICE_ID;

          const subscription = await stripe.subscriptions.create({
            customer: req.customer.stripeCustomerId,
            items: [{ price: priceId }],
            default_payment_method: defaultPaymentMethod,
            metadata: {
              customerId: req.customer.id,
              subAccountId: subAccountId
            }
          });

          // Mark sub-account as paid
          await subAccount.update({ isPaid: true });

          // Check if volume discount threshold crossed (11+ → switch all to €19)
          const newPaidCount = await SubAccount.count({
            where: { customerId: req.customer.id, isPaid: true, isGifted: false }
          });
          if (newPaidCount >= 11 && process.env.STRIPE_VOLUME_PRICE_ID) {
            await stripeService.updateAllSubscriptionPrices(req.customer.stripeCustomerId, process.env.STRIPE_VOLUME_PRICE_ID);
            await req.customer.update({ planType: 'volume' });
            logger.info(`Volume discount applied: ${newPaidCount} paid sub-accounts, all switched to €19`);
          }

          logger.info(`Auto-subscribed sub-account ${subAccountId} using saved payment method`);

          return res.json({
            success: true,
            autoSubscribed: true,
            message: newPaidCount >= 11 ? 'Subscription activated! Volume discount applied to all sub-accounts.' : 'Subscription activated successfully'
          });
        }
      } catch (stripeError) {
        logger.warn('Failed to auto-subscribe, falling back to checkout:', stripeError.message);
        // Fall through to checkout
      }
    }

    // No saved payment method - create checkout session
    const session = await stripeService.createCheckoutSession(
      req.customer,
      subAccountId
    );

    res.json({ url: session.url, autoSubscribed: false });
  } catch (error) {
    logger.error('Checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Create subscription checkout for customer
router.post('/subscribe', authenticateJWT, async (req, res) => {
  try {
    // Check if Stripe is configured
    if (!stripeService.isConfigured()) {
      return res.status(503).json({ error: 'Billing is not configured' });
    }

    const session = await stripeService.createSubscriptionCheckout(req.customer);
    res.json({ url: session.url });
  } catch (error) {
    logger.error('Subscribe error:', error);
    res.status(500).json({ error: 'Failed to create subscription checkout' });
  }
});

// Get subscription info (slots available, pricing, trial info)
router.get('/subscription-info', authenticateJWT, async (req, res) => {
  try {
    // Admin/unlimited users have unlimited slots
    if (req.customer.role === 'admin' || req.customer.hasUnlimitedAccess) {
      return res.json({
        subscriptionQuantity: 999,
        subAccountCount: 0,
        availableSlots: 999,
        nextSlotPrice: 0,
        isVolumeEligible: false,
        planType: 'free',
        hasUnlimitedAccess: true,
        isTrialing: false,
        trialEndsAt: null,
        trialDaysRemaining: null
      });
    }

    const info = await stripeService.getSubscriptionInfo(req.customer);

    // Add trial info
    const isTrialing = req.customer.subscriptionStatus === 'trialing';
    let trialDaysRemaining = null;
    if (isTrialing && req.customer.trialEndsAt) {
      const now = new Date();
      const trialEnd = new Date(req.customer.trialEndsAt);
      trialDaysRemaining = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)));
    }

    res.json({
      ...info,
      isTrialing,
      trialEndsAt: req.customer.trialEndsAt,
      trialDaysRemaining,
      hasUsedTrial: req.customer.hasUsedTrial
    });
  } catch (error) {
    logger.error('Get subscription info error:', error);
    res.status(500).json({ error: 'Failed to get subscription info' });
  }
});

// Add a sub-account slot (buy subscription or increase quantity)
router.post('/add-slot', authenticateJWT, async (req, res) => {
  try {
    // Check if Stripe is configured
    if (!stripeService.isConfigured()) {
      return res.status(503).json({ error: 'Billing is not configured' });
    }

    // Admin/unlimited users don't need to buy slots
    if (req.customer.role === 'admin' || req.customer.hasUnlimitedAccess) {
      return res.json({ success: true, message: 'You have unlimited access' });
    }

    const result = await stripeService.addSubscriptionSlot(req.customer);
    res.json(result);
  } catch (error) {
    logger.error('Add slot error:', error);
    res.status(500).json({ error: 'Failed to add subscription slot' });
  }
});

// Cancel subscription for a specific sub-account
router.post('/cancel/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    if (!stripeService.isConfigured()) {
      return res.status(503).json({ error: 'Billing is not configured' });
    }

    const subAccountId = req.params.subAccountId;

    // Validate ownership
    const subAccount = await SubAccount.findOne({
      where: { id: subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    if (!subAccount.isPaid) {
      return res.status(400).json({ error: 'This sub-account does not have an active subscription' });
    }

    if (!req.customer.stripeCustomerId) {
      return res.status(400).json({ error: 'No Stripe customer found' });
    }

    // Find and cancel the subscription for this sub-account
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const subscriptions = await stripe.subscriptions.list({
      customer: req.customer.stripeCustomerId,
      status: 'active',
      limit: 100
    });

    let cancelled = false;
    for (const subscription of subscriptions.data) {
      if (subscription.metadata?.subAccountId === subAccountId) {
        // Cancel at period end (user keeps access until billing period ends)
        await stripe.subscriptions.update(subscription.id, {
          cancel_at_period_end: true
        });
        cancelled = true;
        logger.info(`Subscription ${subscription.id} scheduled for cancellation for sub-account ${subAccountId}`);
        break;
      }
    }

    if (!cancelled) {
      return res.status(404).json({ error: 'No active subscription found for this sub-account' });
    }

    res.json({ success: true, message: 'Subscription will be cancelled at the end of the billing period' });
  } catch (error) {
    logger.error('Cancel subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Get billing portal
router.get('/portal', authenticateJWT, async (req, res) => {
  try {
    // Check if Stripe is configured
    if (!stripeService.isConfigured()) {
      return res.status(503).json({ error: 'Billing is not configured' });
    }

    // Check if customer has Stripe account and active subscription
    if (!req.customer.stripeCustomerId) {
      return res.status(400).json({ error: 'No subscription found. Please subscribe first.' });
    }

    // Also verify they have an active or canceling subscription
    const validStatuses = ['active', 'trialing', 'canceling', 'past_due'];
    if (!validStatuses.includes(req.customer.subscriptionStatus)) {
      return res.status(400).json({ error: 'No active subscription found. Please subscribe first.' });
    }

    const session = await stripeService.createBillingPortalSession(req.customer);
    res.json({ url: session.url });
  } catch (error) {
    logger.error('Billing portal error:', error);
    res.status(500).json({ error: 'Failed to create billing portal session' });
  }
});

// Stripe webhook is handled in index.js at /api/stripe/webhook (before express.json() middleware)

module.exports = router;
