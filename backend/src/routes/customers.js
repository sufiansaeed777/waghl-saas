const express = require('express');
const router = express.Router();
const { Customer } = require('../models');
const { authenticateJWT } = require('../middleware/auth');
const logger = require('../utils/logger');

// Get current customer profile
router.get('/profile', authenticateJWT, async (req, res) => {
  try {
    res.json({ customer: req.customer.toJSON() });
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Update profile
router.put('/profile', authenticateJWT, async (req, res) => {
  try {
    const { name, company } = req.body;

    if (name) req.customer.name = name;
    if (company !== undefined) req.customer.company = company;

    await req.customer.save();

    res.json({
      message: 'Profile updated',
      customer: req.customer.toJSON()
    });
  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Change password
router.put('/password', authenticateJWT, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }

    const isValid = await req.customer.validatePassword(currentPassword);
    if (!isValid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    req.customer.password = newPassword;
    await req.customer.save();

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Get API key
router.get('/api-key', authenticateJWT, async (req, res) => {
  try {
    res.json({ apiKey: req.customer.apiKey });
  } catch (error) {
    logger.error('Get API key error:', error);
    res.status(500).json({ error: 'Failed to get API key' });
  }
});

module.exports = router;
