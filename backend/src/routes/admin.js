const express = require('express');
const router = express.Router();
const { Customer, SubAccount, Message } = require('../models');
const { authenticateJWT, requireAdmin } = require('../middleware/auth');
const whatsappService = require('../services/whatsapp');
const logger = require('../utils/logger');

// All admin routes require authentication and admin role
router.use(authenticateJWT);
router.use(requireAdmin);

// Get all customers
router.get('/customers', async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (search) {
      const { Op } = require('sequelize');
      where[Op.or] = [
        { email: { [Op.iLike]: `%${search}%` } },
        { name: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const { count, rows: customers } = await Customer.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']],
      attributes: { exclude: ['password'] }
    });

    res.json({
      customers,
      pagination: {
        total: count,
        page: parseInt(page),
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    logger.error('Admin get customers error:', error);
    res.status(500).json({ error: 'Failed to get customers' });
  }
});

// Get all sub-accounts
router.get('/sub-accounts', async (req, res) => {
  try {
    const { page = 1, limit = 20, customerId, status } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (customerId) where.customerId = customerId;
    if (status) where.status = status;

    const { count, rows: subAccounts } = await SubAccount.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']],
      include: [{
        model: Customer,
        as: 'customer',
        attributes: ['id', 'email', 'name']
      }]
    });

    res.json({
      subAccounts,
      pagination: {
        total: count,
        page: parseInt(page),
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    logger.error('Admin get sub-accounts error:', error);
    res.status(500).json({ error: 'Failed to get sub-accounts' });
  }
});

// Toggle customer active status
router.put('/customers/:id/toggle', async (req, res) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    customer.isActive = !customer.isActive;
    await customer.save();

    res.json({
      message: `Customer ${customer.isActive ? 'activated' : 'deactivated'}`,
      customer: customer.toJSON()
    });
  } catch (error) {
    logger.error('Admin toggle customer error:', error);
    res.status(500).json({ error: 'Failed to toggle customer' });
  }
});

// Toggle sub-account active status
router.put('/sub-accounts/:id/toggle', async (req, res) => {
  try {
    const subAccount = await SubAccount.findByPk(req.params.id);
    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    subAccount.isActive = !subAccount.isActive;
    await subAccount.save();

    // Disconnect if deactivated
    if (!subAccount.isActive) {
      await whatsappService.disconnect(subAccount.id);
    }

    res.json({
      message: `Sub-account ${subAccount.isActive ? 'activated' : 'deactivated'}`,
      subAccount
    });
  } catch (error) {
    logger.error('Admin toggle sub-account error:', error);
    res.status(500).json({ error: 'Failed to toggle sub-account' });
  }
});

// Grant/revoke unlimited access for a customer
router.put('/customers/:id/access', async (req, res) => {
  try {
    const { hasUnlimitedAccess, planType } = req.body;
    const customer = await Customer.findByPk(req.params.id);

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Update access settings
    if (typeof hasUnlimitedAccess === 'boolean') {
      customer.hasUnlimitedAccess = hasUnlimitedAccess;

      // If granting unlimited access, set plan to free and activate subscription
      if (hasUnlimitedAccess) {
        customer.planType = 'free';
        customer.subscriptionStatus = 'active';
      }
    }

    if (planType && ['free', 'standard', 'volume'].includes(planType)) {
      customer.planType = planType;

      // If setting to free plan, activate subscription
      if (planType === 'free') {
        customer.subscriptionStatus = 'active';
        customer.hasUnlimitedAccess = true;
      }
    }

    await customer.save();

    // Also update all sub-accounts to paid if unlimited access
    if (customer.hasUnlimitedAccess) {
      await SubAccount.update(
        { isPaid: true },
        { where: { customerId: customer.id } }
      );
    }

    logger.info(`Admin updated access for customer ${customer.id}: unlimited=${customer.hasUnlimitedAccess}, plan=${customer.planType}`);

    res.json({
      message: 'Customer access updated',
      customer: customer.toJSON()
    });
  } catch (error) {
    logger.error('Admin update access error:', error);
    res.status(500).json({ error: 'Failed to update customer access' });
  }
});

// Toggle sub-account payment status (isPaid)
router.put('/sub-accounts/:id/payment', async (req, res) => {
  try {
    const { isPaid } = req.body;
    const subAccount = await SubAccount.findByPk(req.params.id, {
      include: [{ model: Customer, as: 'customer', attributes: ['id', 'email', 'name'] }]
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    // If isPaid is provided, set it; otherwise toggle
    subAccount.isPaid = typeof isPaid === 'boolean' ? isPaid : !subAccount.isPaid;
    await subAccount.save();

    logger.info(`Admin set isPaid=${subAccount.isPaid} for sub-account ${subAccount.id}`);

    res.json({
      message: `Sub-account ${subAccount.isPaid ? 'marked as paid' : 'marked as unpaid'}`,
      subAccount
    });
  } catch (error) {
    logger.error('Admin toggle payment error:', error);
    res.status(500).json({ error: 'Failed to toggle payment status' });
  }
});

// Bulk update payment status for multiple sub-accounts
router.put('/sub-accounts/bulk-payment', async (req, res) => {
  try {
    const { subAccountIds, isPaid } = req.body;

    if (!Array.isArray(subAccountIds) || subAccountIds.length === 0) {
      return res.status(400).json({ error: 'subAccountIds array is required' });
    }

    if (typeof isPaid !== 'boolean') {
      return res.status(400).json({ error: 'isPaid boolean is required' });
    }

    const [updatedCount] = await SubAccount.update(
      { isPaid },
      { where: { id: subAccountIds } }
    );

    logger.info(`Admin bulk updated isPaid=${isPaid} for ${updatedCount} sub-accounts`);

    res.json({
      message: `Updated ${updatedCount} sub-accounts`,
      updatedCount,
      isPaid
    });
  } catch (error) {
    logger.error('Admin bulk payment update error:', error);
    res.status(500).json({ error: 'Failed to bulk update payment status' });
  }
});

// Get dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const totalCustomers = await Customer.count();
    const activeCustomers = await Customer.count({ where: { isActive: true } });
    const totalSubAccounts = await SubAccount.count();
    const connectedSubAccounts = await SubAccount.count({ where: { status: 'connected' } });
    const totalMessages = await Message.count();

    res.json({
      customers: {
        total: totalCustomers,
        active: activeCustomers
      },
      subAccounts: {
        total: totalSubAccounts,
        connected: connectedSubAccounts
      },
      messages: {
        total: totalMessages
      }
    });
  } catch (error) {
    logger.error('Admin get stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

const ghlService = require('../services/ghl');

// Bulk uninstall GHL from all sub-accounts (calls GHL API + clears data)
router.post('/ghl/bulk-uninstall', async (req, res) => {
  try {
    const { useApi = true } = req.body; // Set to false to skip GHL API calls

    // Get all sub-accounts with GHL connected
    const subAccounts = await SubAccount.findAll({
      where: { ghlConnected: true }
    });

    const results = {
      total: subAccounts.length,
      apiSuccess: 0,
      apiFailed: 0,
      cleared: 0,
      errors: []
    };

    for (const subAccount of subAccounts) {
      // Try to call GHL uninstall API first
      if (useApi && subAccount.ghlAccessToken && subAccount.ghlLocationId) {
        const apiResult = await ghlService.uninstallFromLocation(subAccount);
        if (apiResult.success) {
          results.apiSuccess++;
          results.cleared++;
          continue; // Data already cleared by API method
        } else {
          results.apiFailed++;
          results.errors.push({
            subAccountId: subAccount.id,
            locationId: subAccount.ghlLocationId,
            error: apiResult.error
          });
        }
      }

      // Clear data even if API failed
      await subAccount.update({
        ghlAccessToken: null,
        ghlRefreshToken: null,
        ghlTokenExpiresAt: null,
        ghlLocationId: null,
        ghlConnected: false
      });
      results.cleared++;
    }

    logger.info('Admin bulk GHL uninstall complete', results);

    res.json({
      success: true,
      message: `Processed ${results.total} sub-accounts`,
      results
    });
  } catch (error) {
    logger.error('Admin bulk GHL uninstall error:', error);
    res.status(500).json({ error: 'Failed to bulk uninstall GHL' });
  }
});

// Uninstall GHL from specific sub-account (calls GHL API + clears data)
router.post('/ghl/uninstall/:subAccountId', async (req, res) => {
  try {
    const { subAccountId } = req.params;
    const { useApi = true } = req.body;

    const subAccount = await SubAccount.findByPk(subAccountId);

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const oldLocationId = subAccount.ghlLocationId;
    let apiResult = null;

    // Try to call GHL uninstall API first
    if (useApi && subAccount.ghlAccessToken && subAccount.ghlLocationId) {
      apiResult = await ghlService.uninstallFromLocation(subAccount);
      if (apiResult.success) {
        logger.info(`Admin GHL uninstall via API for sub-account ${subAccountId}`);
        return res.json({
          success: true,
          message: 'GHL uninstalled via API',
          previousLocationId: oldLocationId,
          apiResult
        });
      }
    }

    // Clear data even if API failed or wasn't called
    await subAccount.update({
      ghlAccessToken: null,
      ghlRefreshToken: null,
      ghlTokenExpiresAt: null,
      ghlLocationId: null,
      ghlConnected: false
    });

    logger.info(`Admin GHL uninstall for sub-account ${subAccountId}, was location: ${oldLocationId}`);

    res.json({
      success: true,
      message: apiResult ? 'GHL API failed but data cleared locally' : 'GHL data cleared locally',
      previousLocationId: oldLocationId,
      apiResult
    });
  } catch (error) {
    logger.error('Admin GHL uninstall error:', error);
    res.status(500).json({ error: 'Failed to uninstall GHL' });
  }
});

module.exports = router;
