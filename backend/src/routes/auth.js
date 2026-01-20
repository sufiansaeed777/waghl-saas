const express = require('express');
const router = express.Router();
const { Customer } = require('../models');
const { generateToken, authenticateJWT } = require('../middleware/auth');
const logger = require('../utils/logger');

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

    // Create customer
    const customer = await Customer.create({
      email,
      password,
      name,
      company
    });

    const token = generateToken(customer);

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
      return res.status(401).json({ error: 'Account is inactive' });
    }

    const token = generateToken(customer);

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
    const newApiKey = require('crypto').randomBytes(32).toString('hex');
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

module.exports = router;
