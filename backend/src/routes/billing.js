const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/auth');
const stripeService = require('../services/stripe');
const { SubAccount } = require('../models');
const logger = require('../utils/logger');

// Create checkout session for sub-account
router.post('/checkout/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const subAccountId = req.params.subAccountId;

    // Validate ownership - ensure sub-account belongs to this customer
    const subAccount = await SubAccount.findOne({
      where: { id: subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const session = await stripeService.createCheckoutSession(
      req.customer,
      subAccountId
    );

    res.json({ url: session.url });
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

// Stripe webhook
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // Validate webhook secret is configured
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    logger.error('Webhook error: STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    logger.error('Webhook error: Missing stripe-signature header');
    return res.status(400).json({ error: 'Missing signature' });
  }

  try {
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    await stripeService.handleWebhook(event);

    res.json({ received: true });
  } catch (error) {
    if (error.type === 'StripeSignatureVerificationError') {
      logger.error('Webhook signature verification failed:', error.message);
      return res.status(400).json({ error: 'Invalid signature' });
    }
    logger.error('Webhook error:', error);
    res.status(400).json({ error: 'Webhook error' });
  }
});

module.exports = router;
