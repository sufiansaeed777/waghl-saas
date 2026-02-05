const express = require('express');
const router = express.Router();
const { SubAccount, Webhook } = require('../models');
const { authenticateJWT, authenticateApiKey } = require('../middleware/auth');
const whatsappService = require('../services/whatsapp');
const logger = require('../utils/logger');

// Initialize Stripe for subscription cancellation
const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

// Get all sub-accounts for current customer
router.get('/', authenticateJWT, async (req, res) => {
  try {
    const subAccounts = await SubAccount.findAll({
      where: { customerId: req.customer.id },
      include: [{ model: Webhook, as: 'webhook' }],
      order: [['createdAt', 'DESC']]
    });

    res.json({ subAccounts });
  } catch (error) {
    logger.error('Get sub-accounts error:', error);
    res.status(500).json({ error: 'Failed to get sub-accounts' });
  }
});

// Create new sub-account
// Users can create unlimited sub-accounts - they work during trial, then need individual payment
router.post('/', authenticateJWT, async (req, res) => {
  try {
    const { name, ghlLocationId } = req.body;

    // GHL Location ID is now required (name will be fetched from GHL)
    if (!ghlLocationId) {
      return res.status(400).json({ error: 'GHL Location ID is required' });
    }

    // Validate GHL Location ID format
    if (!/^[a-zA-Z0-9]{10,50}$/.test(ghlLocationId)) {
      return res.status(400).json({
        error: 'Invalid GHL Location ID format',
        message: 'Location ID should be alphanumeric (found in GHL Settings → Business Info)'
      });
    }

    // Check for duplicates - same location ID shouldn't be used twice
    const existingSubAccount = await SubAccount.findOne({
      where: { ghlLocationId }
    });

    if (existingSubAccount) {
      return res.status(400).json({
        error: 'GHL Location ID already in use',
        message: 'This location is already connected to another sub-account'
      });
    }

    // Check if user is admin/unlimited or on active trial
    const isAdmin = req.customer.role === 'admin' || req.customer.hasUnlimitedAccess;
    const isActiveTrial = req.customer.subscriptionStatus === 'trialing' &&
                          req.customer.trialEndsAt &&
                          new Date(req.customer.trialEndsAt) > new Date();

    // Create sub-account with temporary name (will be updated from GHL)
    // isPaid defaults to false - sub-accounts work during trial, then need individual payment
    // Admin/gifted sub-accounts work without payment
    const subAccount = await SubAccount.create({
      customerId: req.customer.id,
      name: name || `Location ${ghlLocationId.substring(0, 8)}...`,
      ghlLocationId: ghlLocationId,
      isPaid: isAdmin // Only admins get isPaid=true by default
    });

    res.status(201).json({
      message: 'Sub-account created',
      subAccount
    });
  } catch (error) {
    logger.error('Create sub-account error:', error);
    res.status(500).json({ error: 'Failed to create sub-account' });
  }
});

// Get single sub-account
router.get('/:id', authenticateJWT, async (req, res) => {
  try {
    const subAccount = await SubAccount.findOne({
      where: { id: req.params.id, customerId: req.customer.id },
      include: [{ model: Webhook, as: 'webhook' }]
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    res.json({ subAccount });
  } catch (error) {
    logger.error('Get sub-account error:', error);
    res.status(500).json({ error: 'Failed to get sub-account' });
  }
});

// Update sub-account
router.put('/:id', authenticateJWT, async (req, res) => {
  try {
    const subAccount = await SubAccount.findOne({
      where: { id: req.params.id, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const { name, isActive, ghlLocationId } = req.body;

    if (name !== undefined) subAccount.name = name;
    if (typeof isActive === 'boolean') subAccount.isActive = isActive;
    if (ghlLocationId !== undefined) subAccount.ghlLocationId = ghlLocationId;

    await subAccount.save();

    res.json({
      message: 'Sub-account updated',
      subAccount
    });
  } catch (error) {
    logger.error('Update sub-account error:', error);
    res.status(500).json({ error: 'Failed to update sub-account' });
  }
});

// Delete sub-account
router.delete('/:id', authenticateJWT, async (req, res) => {
  try {
    const subAccount = await SubAccount.findOne({
      where: { id: req.params.id, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    // Cancel Stripe subscription if exists
    if (stripe && subAccount.isPaid && req.customer.stripeCustomerId) {
      try {
        // List all subscriptions for this customer
        const subscriptions = await stripe.subscriptions.list({
          customer: req.customer.stripeCustomerId,
          status: 'active',
          limit: 100
        });

        // Find and cancel subscriptions for this sub-account
        for (const subscription of subscriptions.data) {
          if (subscription.metadata?.subAccountId === subAccount.id) {
            await stripe.subscriptions.cancel(subscription.id);
            logger.info(`Cancelled Stripe subscription ${subscription.id} for sub-account ${subAccount.id}`);
          }
        }
      } catch (stripeError) {
        logger.error('Failed to cancel Stripe subscription:', stripeError);
        // Continue with deletion even if Stripe cancellation fails
      }
    }

    // Disconnect WhatsApp if connected
    await whatsappService.disconnect(subAccount.id);

    await subAccount.destroy();

    res.json({ message: 'Sub-account deleted' });
  } catch (error) {
    logger.error('Delete sub-account error:', error);
    res.status(500).json({ error: 'Failed to delete sub-account' });
  }
});

// Refresh sub-account API key
router.post('/:id/refresh-api-key', authenticateJWT, async (req, res) => {
  try {
    const subAccount = await SubAccount.findOne({
      where: { id: req.params.id, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const newApiKey = require('crypto').randomBytes(32).toString('hex');
    subAccount.apiKey = newApiKey;
    await subAccount.save();

    res.json({
      message: 'API key refreshed',
      apiKey: newApiKey
    });
  } catch (error) {
    logger.error('Refresh API key error:', error);
    res.status(500).json({ error: 'Failed to refresh API key' });
  }
});

// Get embed URL for GHL iframe (QR code page)
router.get('/:id/embed-url', authenticateJWT, async (req, res) => {
  try {
    const subAccount = await SubAccount.findOne({
      where: { id: req.params.id, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    // Generate embed token
    const crypto = require('crypto');
    const token = crypto.createHash('sha256')
      .update(subAccount.id + process.env.JWT_SECRET)
      .digest('hex');

    // Build embed URL - use static HTML page with token as query param
    const backendUrl = process.env.API_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
    const embedUrl = `${backendUrl}/whatsapp.html?token=${token}`;

    // Store token mapping (update embed service)
    const embedService = require('./embed');
    if (embedService.setToken) {
      embedService.setToken(subAccount.id, token);
    }

    res.json({
      success: true,
      embedUrl,
      subAccountId: subAccount.id,
      subAccountName: subAccount.name,
      instructions: 'Use this URL as an iframe src or custom button link in GHL'
    });
  } catch (error) {
    logger.error('Get embed URL error:', error);
    res.status(500).json({ error: 'Failed to generate embed URL' });
  }
});

module.exports = router;
