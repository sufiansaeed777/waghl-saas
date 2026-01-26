const express = require('express');
const router = express.Router();
const { SubAccount, Webhook } = require('../models');
const { authenticateJWT, authenticateApiKey } = require('../middleware/auth');
const whatsappService = require('../services/whatsapp');
const logger = require('../utils/logger');

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
router.post('/', authenticateJWT, async (req, res) => {
  try {
    const { name, ghlLocationId } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const subAccount = await SubAccount.create({
      customerId: req.customer.id,
      name,
      ghlLocationId: ghlLocationId || null,
      isPaid: req.customer.subscriptionStatus === 'active'
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

    const { name, isActive } = req.body;

    if (name) subAccount.name = name;
    if (typeof isActive === 'boolean') subAccount.isActive = isActive;

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

    // Build embed URL
    const backendUrl = process.env.API_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
    const embedUrl = `${backendUrl}/api/embed/qr/${token}`;

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
