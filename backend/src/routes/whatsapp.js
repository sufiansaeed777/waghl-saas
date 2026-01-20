const express = require('express');
const router = express.Router();
const { SubAccount } = require('../models');
const { authenticateJWT, authenticateApiKey } = require('../middleware/auth');
const whatsappService = require('../services/whatsapp');
const logger = require('../utils/logger');

// Connect WhatsApp (get QR code)
router.post('/:subAccountId/connect', authenticateJWT, async (req, res) => {
  try {
    const subAccount = await SubAccount.findOne({
      where: { id: req.params.subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const result = await whatsappService.connect(subAccount.id);
    res.json(result);
  } catch (error) {
    logger.error('Connect WhatsApp error:', error);
    res.status(500).json({ error: error.message || 'Failed to connect' });
  }
});

// Get QR code
router.get('/:subAccountId/qr', authenticateJWT, async (req, res) => {
  try {
    const subAccount = await SubAccount.findOne({
      where: { id: req.params.subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const qrCode = whatsappService.getQRCode(subAccount.id);

    if (!qrCode) {
      return res.status(404).json({
        error: 'QR code not available',
        message: 'Please initiate connection first'
      });
    }

    res.json({ qrCode });
  } catch (error) {
    logger.error('Get QR code error:', error);
    res.status(500).json({ error: 'Failed to get QR code' });
  }
});

// Get connection status
router.get('/:subAccountId/status', authenticateJWT, async (req, res) => {
  try {
    const subAccount = await SubAccount.findOne({
      where: { id: req.params.subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const status = await whatsappService.getStatus(subAccount.id);
    res.json(status);
  } catch (error) {
    logger.error('Get status error:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// Disconnect WhatsApp
router.post('/:subAccountId/disconnect', authenticateJWT, async (req, res) => {
  try {
    const subAccount = await SubAccount.findOne({
      where: { id: req.params.subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const result = await whatsappService.disconnect(subAccount.id);
    res.json(result);
  } catch (error) {
    logger.error('Disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// Send message (JWT auth)
router.post('/:subAccountId/send', authenticateJWT, async (req, res) => {
  try {
    const subAccount = await SubAccount.findOne({
      where: { id: req.params.subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const { to, message, type = 'text', mediaUrl, fileName } = req.body;

    if (!to || !message) {
      return res.status(400).json({ error: 'To and message are required' });
    }

    const result = await whatsappService.sendMessage(subAccount.id, to, message, type, mediaUrl, fileName);
    res.json({ success: true, message: result });
  } catch (error) {
    logger.error('Send message error:', error);
    res.status(500).json({ error: error.message || 'Failed to send message' });
  }
});

// Send message (API key auth - for external integrations)
router.post('/send', authenticateApiKey, async (req, res) => {
  try {
    let subAccountId;

    if (req.authType === 'subAccount') {
      subAccountId = req.subAccount.id;
    } else {
      // Customer API key - must specify sub-account
      const { subAccountId: providedId } = req.body;
      if (!providedId) {
        return res.status(400).json({ error: 'subAccountId is required' });
      }

      const subAccount = await SubAccount.findOne({
        where: { id: providedId, customerId: req.customer.id }
      });

      if (!subAccount) {
        return res.status(404).json({ error: 'Sub-account not found' });
      }

      subAccountId = subAccount.id;
    }

    const { to, message, type = 'text', mediaUrl, fileName } = req.body;

    if (!to || !message) {
      return res.status(400).json({ error: 'To and message are required' });
    }

    const result = await whatsappService.sendMessage(subAccountId, to, message, type, mediaUrl, fileName);
    res.json({ success: true, message: result });
  } catch (error) {
    logger.error('API Send message error:', error);
    res.status(500).json({ error: error.message || 'Failed to send message' });
  }
});

// Get status via API key
router.get('/status', authenticateApiKey, async (req, res) => {
  try {
    let subAccountId;

    if (req.authType === 'subAccount') {
      subAccountId = req.subAccount.id;
    } else {
      const { subAccountId: providedId } = req.query;
      if (!providedId) {
        return res.status(400).json({ error: 'subAccountId is required' });
      }
      subAccountId = providedId;
    }

    const status = await whatsappService.getStatus(subAccountId);
    res.json(status);
  } catch (error) {
    logger.error('API Get status error:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

module.exports = router;
