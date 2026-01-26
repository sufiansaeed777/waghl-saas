const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { SubAccount, Message } = require('../models');
const { authenticateJWT, authenticateApiKey, requirePaidSubAccount } = require('../middleware/auth');
const whatsappService = require('../services/whatsapp');
const logger = require('../utils/logger');

// Configure multer for file uploads
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 16 * 1024 * 1024 }, // 16MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|mp4|mp3|ogg|webp/;
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    if (allowedTypes.test(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Upload file for media messages
router.post('/upload', authenticateJWT, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { subAccountId } = req.body;

    // Verify sub-account belongs to customer
    if (subAccountId) {
      const subAccount = await SubAccount.findOne({
        where: { id: subAccountId, customerId: req.customer.id }
      });

      if (!subAccount) {
        // Delete uploaded file
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: 'Sub-account not found' });
      }
    }

    // Generate URL for the uploaded file
    const baseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
    const url = `${baseUrl}/uploads/${req.file.filename}`;

    res.json({
      url,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });
  } catch (error) {
    logger.error('File upload error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Connect WhatsApp (get QR code) - REQUIRES PAYMENT
router.post('/:subAccountId/connect', authenticateJWT, requirePaidSubAccount, async (req, res) => {
  try {
    // subAccount is already attached by requirePaidSubAccount middleware
    const subAccount = req.subAccount || await SubAccount.findOne({
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

// Send message (JWT auth) - REQUIRES PAYMENT
router.post('/:subAccountId/send', authenticateJWT, requirePaidSubAccount, async (req, res) => {
  try {
    // subAccount is already attached by requirePaidSubAccount middleware
    const subAccount = req.subAccount || await SubAccount.findOne({
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

// Send message (API key auth - for external integrations) - REQUIRES PAYMENT
router.post('/send', authenticateApiKey, async (req, res) => {
  try {
    let subAccount;

    if (req.authType === 'subAccount') {
      subAccount = req.subAccount;
    } else {
      // Customer API key - must specify sub-account
      const { subAccountId: providedId } = req.body;
      if (!providedId) {
        return res.status(400).json({ error: 'subAccountId is required' });
      }

      subAccount = await SubAccount.findOne({
        where: { id: providedId, customerId: req.customer.id }
      });

      if (!subAccount) {
        return res.status(404).json({ error: 'Sub-account not found' });
      }
    }

    // Check payment status (admin bypass)
    if (req.customer.role !== 'admin' && !subAccount.isPaid) {
      return res.status(402).json({
        error: 'Payment required',
        message: 'This sub-account requires an active subscription'
      });
    }

    const { to, message, type = 'text', mediaUrl, fileName } = req.body;

    if (!to || !message) {
      return res.status(400).json({ error: 'To and message are required' });
    }

    const result = await whatsappService.sendMessage(subAccount.id, to, message, type, mediaUrl, fileName);
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

// Get messages for a sub-account
router.get('/:subAccountId/messages', authenticateJWT, async (req, res) => {
  try {
    const subAccount = await SubAccount.findOne({
      where: { id: req.params.subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const { page = 1, limit = 50, contact } = req.query;
    const offset = (page - 1) * limit;

    const where = { subAccountId: subAccount.id };

    // Filter by contact phone number if provided
    if (contact) {
      const { Op } = require('sequelize');
      where[Op.or] = [
        { fromNumber: contact },
        { toNumber: contact }
      ];
    }

    const { count, rows: messages } = await Message.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      messages,
      pagination: {
        total: count,
        page: parseInt(page),
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    logger.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Get unique contacts (conversations) for a sub-account
router.get('/:subAccountId/conversations', authenticateJWT, async (req, res) => {
  try {
    const subAccount = await SubAccount.findOne({
      where: { id: req.params.subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const { Op } = require('sequelize');
    const sequelize = require('../models').sequelize;

    // Get unique contacts with their last message
    const conversations = await Message.findAll({
      where: { subAccountId: subAccount.id },
      attributes: [
        [sequelize.fn('DISTINCT', sequelize.col('fromNumber')), 'contactNumber'],
        [sequelize.fn('MAX', sequelize.col('createdAt')), 'lastMessageAt']
      ],
      group: ['fromNumber'],
      order: [[sequelize.fn('MAX', sequelize.col('createdAt')), 'DESC']],
      raw: true
    });

    // Get last message for each conversation
    const conversationsWithLastMessage = await Promise.all(
      conversations.map(async (conv) => {
        const lastMessage = await Message.findOne({
          where: {
            subAccountId: subAccount.id,
            [Op.or]: [
              { fromNumber: conv.contactNumber },
              { toNumber: conv.contactNumber }
            ]
          },
          order: [['createdAt', 'DESC']]
        });

        const messageCount = await Message.count({
          where: {
            subAccountId: subAccount.id,
            [Op.or]: [
              { fromNumber: conv.contactNumber },
              { toNumber: conv.contactNumber }
            ]
          }
        });

        return {
          contactNumber: conv.contactNumber === subAccount.phoneNumber
            ? lastMessage?.toNumber
            : conv.contactNumber,
          lastMessage: lastMessage?.content,
          lastMessageAt: lastMessage?.createdAt,
          messageCount,
          direction: lastMessage?.direction
        };
      })
    );

    // Filter out self and deduplicate
    const uniqueConversations = conversationsWithLastMessage
      .filter(c => c.contactNumber && c.contactNumber !== subAccount.phoneNumber)
      .reduce((acc, curr) => {
        const existing = acc.find(c => c.contactNumber === curr.contactNumber);
        if (!existing || new Date(curr.lastMessageAt) > new Date(existing.lastMessageAt)) {
          return [...acc.filter(c => c.contactNumber !== curr.contactNumber), curr];
        }
        return acc;
      }, [])
      .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));

    res.json({ conversations: uniqueConversations });
  } catch (error) {
    logger.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

module.exports = router;
