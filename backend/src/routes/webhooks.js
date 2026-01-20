const express = require('express');
const router = express.Router();
const { Webhook, SubAccount } = require('../models');
const { authenticateJWT } = require('../middleware/auth');
const logger = require('../utils/logger');

// Get webhook for sub-account
router.get('/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const subAccount = await SubAccount.findOne({
      where: { id: req.params.subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const webhook = await Webhook.findOne({
      where: { subAccountId: subAccount.id }
    });

    res.json({ webhook });
  } catch (error) {
    logger.error('Get webhook error:', error);
    res.status(500).json({ error: 'Failed to get webhook' });
  }
});

// Create or update webhook
router.post('/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const subAccount = await SubAccount.findOne({
      where: { id: req.params.subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const { url, events = ['message.received', 'message.sent', 'connection.status'] } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    let webhook = await Webhook.findOne({
      where: { subAccountId: subAccount.id }
    });

    if (webhook) {
      await webhook.update({ url, events, isActive: true, failureCount: 0 });
    } else {
      webhook = await Webhook.create({
        subAccountId: subAccount.id,
        url,
        events
      });
    }

    res.json({
      message: 'Webhook configured',
      webhook
    });
  } catch (error) {
    logger.error('Configure webhook error:', error);
    res.status(500).json({ error: 'Failed to configure webhook' });
  }
});

// Delete webhook
router.delete('/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const subAccount = await SubAccount.findOne({
      where: { id: req.params.subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    await Webhook.destroy({
      where: { subAccountId: subAccount.id }
    });

    res.json({ message: 'Webhook deleted' });
  } catch (error) {
    logger.error('Delete webhook error:', error);
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

// Test webhook
router.post('/:subAccountId/test', authenticateJWT, async (req, res) => {
  try {
    const subAccount = await SubAccount.findOne({
      where: { id: req.params.subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const webhook = await Webhook.findOne({
      where: { subAccountId: subAccount.id }
    });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not configured' });
    }

    // Send test payload
    const crypto = require('crypto');
    const payload = {
      event: 'test',
      subAccountId: subAccount.id,
      timestamp: new Date().toISOString(),
      data: { message: 'This is a test webhook' }
    };

    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': 'test'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    if (response.ok) {
      res.json({ success: true, message: 'Test webhook sent successfully' });
    } else {
      res.status(400).json({ success: false, message: `Webhook returned ${response.status}` });
    }
  } catch (error) {
    logger.error('Test webhook error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
