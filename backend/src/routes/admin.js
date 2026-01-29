const express = require('express');
const router = express.Router();
const { Customer, SubAccount, Message } = require('../models');
const { authenticateJWT, requireAdmin } = require('../middleware/auth');
const whatsappService = require('../services/whatsapp');
const ghlService = require('../services/ghl');
const emailService = require('../services/email');
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

    const wasActive = customer.isActive;
    customer.isActive = !customer.isActive;
    await customer.save();

    // If deactivating, disconnect all sub-accounts' GHL and WhatsApp connections
    if (wasActive && !customer.isActive) {
      const subAccounts = await SubAccount.findAll({
        where: { customerId: customer.id }
      });

      for (const subAccount of subAccounts) {
        // Disconnect WhatsApp
        try {
          await whatsappService.disconnect(subAccount.id);
          logger.info(`Disconnected WhatsApp for sub-account ${subAccount.id} due to customer deactivation`);
        } catch (err) {
          logger.warn(`Failed to disconnect WhatsApp for sub-account ${subAccount.id}:`, err.message);
        }

        // Disconnect GHL (call uninstall API if tokens exist)
        if (subAccount.ghlAccessToken && subAccount.ghlLocationId) {
          try {
            await ghlService.uninstallFromLocation(subAccount);
            logger.info(`Disconnected GHL for sub-account ${subAccount.id} due to customer deactivation`);
          } catch (err) {
            logger.warn(`Failed to disconnect GHL for sub-account ${subAccount.id}:`, err.message);
          }
        }

        // Clear GHL tokens
        await subAccount.update({
          ghlAccessToken: null,
          ghlRefreshToken: null,
          ghlConnected: false
        });
      }

      logger.info(`Customer ${customer.id} deactivated - disconnected ${subAccounts.length} sub-accounts`);

      // Send deactivation email
      try {
        await emailService.sendAccountDeactivated(customer.email, customer.name);
        logger.info(`Sent deactivation email to ${customer.email}`);
      } catch (err) {
        logger.warn(`Failed to send deactivation email to ${customer.email}:`, err.message);
      }
    }

    // If reactivating, send reactivation email
    if (!wasActive && customer.isActive) {
      try {
        await emailService.sendAccountReactivated(customer.email, customer.name);
        logger.info(`Sent reactivation email to ${customer.email}`);
      } catch (err) {
        logger.warn(`Failed to send reactivation email to ${customer.email}:`, err.message);
      }
    }

    res.json({
      message: `Customer ${customer.isActive ? 'activated' : 'deactivated'}`,
      customer: customer.toJSON()
    });
  } catch (error) {
    logger.error('Admin toggle customer error:', error);
    res.status(500).json({ error: 'Failed to toggle customer' });
  }
});

// Update sub-account details (name, location ID)
router.put('/sub-accounts/:id', async (req, res) => {
  try {
    const { name, ghlLocationId } = req.body;
    const subAccount = await SubAccount.findByPk(req.params.id, {
      include: [{ model: Customer, as: 'customer', attributes: ['id', 'email', 'name'] }]
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    // Update fields if provided
    if (name !== undefined) {
      subAccount.name = name;
    }
    if (ghlLocationId !== undefined) {
      subAccount.ghlLocationId = ghlLocationId;
    }

    await subAccount.save();

    logger.info(`Admin updated sub-account ${subAccount.id}: name="${subAccount.name}", locationId="${subAccount.ghlLocationId}"`);

    res.json({
      message: 'Sub-account updated',
      subAccount
    });
  } catch (error) {
    logger.error('Admin update sub-account error:', error);
    res.status(500).json({ error: 'Failed to update sub-account' });
  }
});

// Toggle sub-account active status
router.put('/sub-accounts/:id/toggle', async (req, res) => {
  try {
    const subAccount = await SubAccount.findByPk(req.params.id, {
      include: [{ model: Customer, as: 'customer', attributes: ['id', 'email', 'name'] }]
    });
    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const wasActive = subAccount.isActive;
    subAccount.isActive = !subAccount.isActive;
    await subAccount.save();

    // If deactivating, disconnect GHL and WhatsApp
    if (wasActive && !subAccount.isActive) {
      // Disconnect WhatsApp
      try {
        await whatsappService.disconnect(subAccount.id);
        logger.info(`Disconnected WhatsApp for sub-account ${subAccount.id} due to deactivation`);
      } catch (err) {
        logger.warn(`Failed to disconnect WhatsApp for sub-account ${subAccount.id}:`, err.message);
      }

      // Disconnect GHL
      if (subAccount.ghlAccessToken && subAccount.ghlLocationId) {
        try {
          await ghlService.uninstallFromLocation(subAccount);
          logger.info(`Disconnected GHL for sub-account ${subAccount.id} due to deactivation`);
        } catch (err) {
          logger.warn(`Failed to disconnect GHL for sub-account ${subAccount.id}:`, err.message);
        }
      }

      // Clear GHL tokens
      await subAccount.update({
        ghlAccessToken: null,
        ghlRefreshToken: null,
        ghlConnected: false
      });

      // Send deactivation email to customer
      if (subAccount.customer && subAccount.customer.email) {
        try {
          await emailService.sendSubAccountDeactivated(
            subAccount.customer.email,
            subAccount.customer.name,
            subAccount.name,
            subAccount.ghlLocationId
          );
          logger.info(`Sent sub-account deactivation email to ${subAccount.customer.email}`);
        } catch (err) {
          logger.warn(`Failed to send deactivation email:`, err.message);
        }
      }

      logger.info(`Sub-account ${subAccount.id} deactivated`);
    }

    // If reactivating, send reactivation email
    if (!wasActive && subAccount.isActive) {
      if (subAccount.customer && subAccount.customer.email) {
        try {
          await emailService.sendSubAccountReactivated(
            subAccount.customer.email,
            subAccount.customer.name,
            subAccount.name,
            subAccount.ghlLocationId
          );
          logger.info(`Sent sub-account reactivation email to ${subAccount.customer.email}`);
        } catch (err) {
          logger.warn(`Failed to send reactivation email:`, err.message);
        }
      }
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

// Gift/ungift free access to a specific sub-account
router.put('/sub-accounts/:id/gift', async (req, res) => {
  try {
    const subAccount = await SubAccount.findByPk(req.params.id, {
      include: [{ model: Customer, as: 'customer', attributes: ['id', 'email', 'name'] }]
    });
    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    // Toggle gift status
    const wasGifted = subAccount.isGifted;
    subAccount.isGifted = !subAccount.isGifted;

    // If gifting, also set isPaid to true
    if (subAccount.isGifted) {
      subAccount.isPaid = true;
    }

    await subAccount.save();

    logger.info(`Admin ${wasGifted ? 'removed gift from' : 'gifted'} sub-account ${subAccount.id}`);

    res.json({
      message: subAccount.isGifted
        ? 'Free unlimited access granted to this sub-account'
        : 'Free access removed from this sub-account',
      subAccount
    });
  } catch (error) {
    logger.error('Admin gift sub-account error:', error);
    res.status(500).json({ error: 'Failed to update sub-account gift status' });
  }
});

// Delete customer (admin cannot delete itself)
router.delete('/customers/:id', async (req, res) => {
  try {
    const customerId = req.params.id;

    // Prevent admin from deleting itself
    if (customerId === req.customer.id) {
      return res.status(403).json({ error: 'Cannot delete your own account' });
    }

    const customer = await Customer.findByPk(customerId);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Disconnect all WhatsApp sessions for this customer's sub-accounts
    const subAccounts = await SubAccount.findAll({ where: { customerId } });
    for (const subAccount of subAccounts) {
      await whatsappService.disconnect(subAccount.id);
    }

    // Delete all sub-accounts first (due to foreign key)
    await SubAccount.destroy({ where: { customerId } });

    // Delete the customer
    await customer.destroy();

    logger.info(`Admin deleted customer ${customerId} and ${subAccounts.length} sub-accounts`);

    res.json({
      message: 'Customer and all sub-accounts deleted',
      deletedSubAccounts: subAccounts.length
    });
  } catch (error) {
    logger.error('Admin delete customer error:', error);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});

// Delete sub-account
router.delete('/sub-accounts/:id', async (req, res) => {
  try {
    const subAccount = await SubAccount.findByPk(req.params.id);
    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    // Disconnect WhatsApp if connected
    await whatsappService.disconnect(subAccount.id);

    await subAccount.destroy();

    logger.info(`Admin deleted sub-account ${req.params.id}`);

    res.json({ message: 'Sub-account deleted' });
  } catch (error) {
    logger.error('Admin delete sub-account error:', error);
    res.status(500).json({ error: 'Failed to delete sub-account' });
  }
});

// Grant/revoke unlimited access for a customer (admin cannot gift itself)
router.put('/customers/:id/access', async (req, res) => {
  try {
    const { hasUnlimitedAccess, planType } = req.body;
    const customerId = req.params.id;

    // Prevent admin from gifting itself
    if (customerId === req.customer.id) {
      return res.status(403).json({ error: 'Cannot modify your own access' });
    }

    const customer = await Customer.findByPk(customerId);

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
