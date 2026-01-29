const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/auth');
const stripeService = require('../services/stripe');
const logger = require('../utils/logger');

// Create checkout session for sub-account
router.post('/checkout/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const session = await stripeService.createCheckoutSession(
      req.customer,
      req.params.subAccountId
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

// Get subscription info (slots available, pricing)
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
        hasUnlimitedAccess: true
      });
    }

    const info = await stripeService.getSubscriptionInfo(req.customer);
    res.json(info);
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

    // Check if customer has Stripe account
    if (!req.customer.stripeCustomerId) {
      return res.status(400).json({ error: 'No subscription found. Please subscribe first.' });
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
  const sig = req.headers['stripe-signature'];

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
    logger.error('Webhook error:', error);
    res.status(400).json({ error: 'Webhook error' });
  }
});

module.exports = router;
