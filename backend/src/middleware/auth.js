const jwt = require('jsonwebtoken');
const { Customer, SubAccount } = require('../models');
const logger = require('../utils/logger');

// JWT Authentication for customers
const authenticateJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const customer = await Customer.findByPk(decoded.id);
    if (!customer || !customer.isActive) {
      return res.status(401).json({ error: 'Invalid or inactive account' });
    }

    req.customer = customer;
    req.user = customer; // Also set req.user for compatibility
    next();
  } catch (error) {
    logger.error('JWT authentication error:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// API Key Authentication for external API access
const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }

    // Check if it's a customer API key
    let customer = await Customer.findOne({ where: { apiKey } });
    if (customer) {
      if (!customer.isActive) {
        return res.status(401).json({ error: 'Account is inactive' });
      }
      req.customer = customer;
      req.authType = 'customer';
      return next();
    }

    // Check if it's a sub-account API key
    const subAccount = await SubAccount.findOne({
      where: { apiKey },
      include: [{ model: Customer, as: 'customer' }]
    });

    if (subAccount) {
      if (!subAccount.isActive || !subAccount.customer.isActive) {
        return res.status(401).json({ error: 'Account is inactive' });
      }
      req.subAccount = subAccount;
      req.customer = subAccount.customer;
      req.authType = 'subAccount';
      return next();
    }

    return res.status(401).json({ error: 'Invalid API key' });
  } catch (error) {
    logger.error('API key authentication error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

// Admin only middleware
const requireAdmin = (req, res, next) => {
  if (req.customer.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Generate JWT token
const generateToken = (customer) => {
  return jwt.sign(
    { id: customer.id, email: customer.email, role: customer.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

module.exports = {
  authenticateJWT,
  authenticateApiKey,
  requireAdmin,
  generateToken
};
