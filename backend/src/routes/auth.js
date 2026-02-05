const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { Customer } = require('../models');
const { generateToken, authenticateJWT } = require('../middleware/auth');
const emailService = require('../services/email');
const logger = require('../utils/logger');

// Store password reset tokens (in production, use Redis or database)
const resetTokens = new Map();

// Register new customer
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, company } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    // Check if customer already exists
    const existingCustomer = await Customer.findOne({ where: { email } });
    if (existingCustomer) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Create customer with 7-day free trial
    // During trial, all sub-accounts work for free (unlimited creation)
    const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
    const customer = await Customer.create({
      email,
      password,
      name,
      company,
      subscriptionStatus: 'trialing',
      trialEndsAt
    });

    const token = generateToken(customer);

    // Send welcome email (async, don't wait)
    emailService.sendWelcome(customer.email, customer.name)
      .catch(err => logger.error('Failed to send welcome email:', err));

    res.status(201).json({
      message: 'Registration successful',
      customer: customer.toJSON(),
      token
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const customer = await Customer.findOne({ where: { email } });
    if (!customer) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValidPassword = await customer.validatePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!customer.isActive) {
      return res.status(403).json({ error: 'Your account has been deactivated by an administrator. Please contact support for assistance.' });
    }

    const token = generateToken(customer);

    // Send login notification (async, don't wait)
    const ip = req.ip || req.headers['x-forwarded-for'] || 'Unknown';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    emailService.sendLoginNotification(customer.email, customer.name, ip, userAgent, new Date())
      .catch(err => logger.error('Failed to send login notification:', err));

    res.json({
      message: 'Login successful',
      customer: customer.toJSON(),
      token
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
router.get('/me', authenticateJWT, async (req, res) => {
  try {
    res.json({ customer: req.customer.toJSON() });
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Refresh API key
router.post('/refresh-api-key', authenticateJWT, async (req, res) => {
  try {
    const newApiKey = crypto.randomBytes(32).toString('hex');
    req.customer.apiKey = newApiKey;
    await req.customer.save();

    res.json({
      message: 'API key refreshed',
      apiKey: newApiKey
    });
  } catch (error) {
    logger.error('Refresh API key error:', error);
    res.status(500).json({ error: 'Failed to refresh API key' });
  }
});

// Forgot password - request reset
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const customer = await Customer.findOne({ where: { email } });

    // Always return success to prevent email enumeration
    if (!customer) {
      return res.json({ message: 'If the email exists, a reset link has been sent' });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = Date.now() + 3600000; // 1 hour

    // Store token (in production, use Redis or database)
    resetTokens.set(resetToken, {
      customerId: customer.id,
      email: customer.email,
      expiry: tokenExpiry
    });

    // Clean up expired tokens periodically
    for (const [token, data] of resetTokens.entries()) {
      if (data.expiry < Date.now()) {
        resetTokens.delete(token);
      }
    }

    // Build reset URL
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    // Send reset email
    await emailService.sendPasswordReset(customer.email, customer.name, resetToken, resetUrl);

    res.json({ message: 'If the email exists, a reset link has been sent' });
  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// Reset password - with token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Verify token
    const tokenData = resetTokens.get(token);
    if (!tokenData) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    if (tokenData.expiry < Date.now()) {
      resetTokens.delete(token);
      return res.status(400).json({ error: 'Reset token has expired' });
    }

    // Find customer and update password
    const customer = await Customer.findByPk(tokenData.customerId);
    if (!customer) {
      return res.status(400).json({ error: 'Customer not found' });
    }

    // Update password (model should hash it)
    customer.password = password;
    await customer.save();

    // Delete used token
    resetTokens.delete(token);

    logger.info(`Password reset successful for ${customer.email}`);

    res.json({ message: 'Password reset successful. You can now log in.' });
  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Change password (logged in user)
router.post('/change-password', authenticateJWT, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    // Verify current password
    const isValidPassword = await req.customer.validatePassword(currentPassword);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Update password
    req.customer.password = newPassword;
    await req.customer.save();

    logger.info(`Password changed for ${req.customer.email}`);

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;
