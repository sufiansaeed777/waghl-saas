const express = require('express');
const router = express.Router();

const authRoutes = require('./auth');
const customerRoutes = require('./customers');
const subAccountRoutes = require('./subAccounts');
const whatsappRoutes = require('./whatsapp');
const webhookRoutes = require('./webhooks');
const adminRoutes = require('./admin');
const billingRoutes = require('./billing');
const ghlRoutes = require('./ghl');

// Public routes
router.use('/auth', authRoutes);

// Protected routes (require authentication)
router.use('/customers', customerRoutes);
router.use('/sub-accounts', subAccountRoutes);
router.use('/whatsapp', whatsappRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/billing', billingRoutes);
router.use('/ghl', ghlRoutes);

// Admin routes
router.use('/admin', adminRoutes);

module.exports = router;
