const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/auth');
const { Customer, SubAccount } = require('../models');
const ghlService = require('../services/ghl');
const logger = require('../utils/logger');

// Get GHL connection status
router.get('/status', authenticateJWT, async (req, res) => {
  try {
    const customer = await Customer.findByPk(req.user.id);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json({
      connected: customer.ghlConnected,
      companyId: customer.ghlCompanyId,
      tokenExpiresAt: customer.ghlTokenExpiresAt
    });
  } catch (error) {
    logger.error('GHL status error:', error);
    res.status(500).json({ error: 'Failed to get GHL status' });
  }
});

// Get GHL authorization URL
router.get('/auth-url', authenticateJWT, async (req, res) => {
  try {
    const authUrl = ghlService.getAuthorizationUrl(req.user.id);
    res.json({ authUrl });
  } catch (error) {
    logger.error('GHL auth URL error:', error);
    res.status(500).json({ error: 'Failed to generate authorization URL' });
  }
});

// OAuth callback handler
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?ghl_error=no_code`);
    }

    // Decode state to get customer ID
    let customerId;
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      customerId = stateData.customerId;
    } catch (e) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?ghl_error=invalid_state`);
    }

    // Exchange code for tokens
    const tokenData = await ghlService.exchangeCodeForTokens(code);

    // Update customer with GHL tokens
    const customer = await Customer.findByPk(customerId);
    if (!customer) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?ghl_error=customer_not_found`);
    }

    await customer.update({
      ghlAccessToken: tokenData.access_token,
      ghlRefreshToken: tokenData.refresh_token,
      ghlTokenExpiresAt: new Date(Date.now() + (tokenData.expires_in * 1000)),
      ghlCompanyId: tokenData.companyId || null,
      ghlUserId: tokenData.userId || null,
      ghlConnected: true
    });

    logger.info(`GHL connected for customer ${customerId}`);

    // Redirect back to frontend with success
    res.redirect(`${process.env.FRONTEND_URL}/settings?ghl_connected=true`);
  } catch (error) {
    logger.error('GHL callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/settings?ghl_error=token_exchange_failed`);
  }
});

// Disconnect GHL
router.post('/disconnect', authenticateJWT, async (req, res) => {
  try {
    await ghlService.disconnect(req.user.id);
    res.json({ success: true, message: 'GHL disconnected successfully' });
  } catch (error) {
    logger.error('GHL disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect GHL' });
  }
});

// Get GHL locations
router.get('/locations', authenticateJWT, async (req, res) => {
  try {
    const customer = await Customer.findByPk(req.user.id);
    if (!customer || !customer.ghlConnected) {
      return res.status(400).json({ error: 'GHL not connected' });
    }

    const locations = await ghlService.getLocations(customer);
    res.json({ locations });
  } catch (error) {
    logger.error('GHL locations error:', error);
    res.status(500).json({ error: 'Failed to fetch GHL locations' });
  }
});

// Link sub-account to GHL location
router.post('/link-location/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const { subAccountId } = req.params;
    const { locationId } = req.body;

    if (!locationId) {
      return res.status(400).json({ error: 'Location ID is required' });
    }

    // Verify sub-account belongs to customer
    const subAccount = await SubAccount.findOne({
      where: { id: subAccountId, customerId: req.user.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    // Get customer and verify GHL connection
    const customer = await Customer.findByPk(req.user.id);
    if (!customer || !customer.ghlConnected) {
      return res.status(400).json({ error: 'GHL not connected' });
    }

    // Get location details
    const location = await ghlService.getLocation(customer, locationId);
    if (!location) {
      return res.status(404).json({ error: 'GHL location not found' });
    }

    // Update sub-account with GHL location
    await subAccount.update({
      ghlLocationId: locationId,
      ghlLocationName: location.name || locationId,
      ghlConnected: true
    });

    logger.info(`Sub-account ${subAccountId} linked to GHL location ${locationId}`);

    res.json({
      success: true,
      message: 'Sub-account linked to GHL location',
      subAccount
    });
  } catch (error) {
    logger.error('GHL link location error:', error);
    res.status(500).json({ error: 'Failed to link GHL location' });
  }
});

// Unlink sub-account from GHL location
router.post('/unlink-location/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const { subAccountId } = req.params;

    // Verify sub-account belongs to customer
    const subAccount = await SubAccount.findOne({
      where: { id: subAccountId, customerId: req.user.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    // Update sub-account
    await subAccount.update({
      ghlLocationId: null,
      ghlLocationName: null,
      ghlConnected: false
    });

    res.json({
      success: true,
      message: 'Sub-account unlinked from GHL location'
    });
  } catch (error) {
    logger.error('GHL unlink location error:', error);
    res.status(500).json({ error: 'Failed to unlink GHL location' });
  }
});

// Search contacts in GHL
router.get('/contacts/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const { subAccountId } = req.params;
    const { query } = req.query;

    // Verify sub-account belongs to customer
    const subAccount = await SubAccount.findOne({
      where: { id: subAccountId, customerId: req.user.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    if (!subAccount.ghlLocationId) {
      return res.status(400).json({ error: 'Sub-account not linked to GHL location' });
    }

    const customer = await Customer.findByPk(req.user.id);
    if (!customer || !customer.ghlConnected) {
      return res.status(400).json({ error: 'GHL not connected' });
    }

    const contacts = await ghlService.searchContacts(customer, subAccount.ghlLocationId, query);
    res.json({ contacts });
  } catch (error) {
    logger.error('GHL contacts error:', error);
    res.status(500).json({ error: 'Failed to fetch GHL contacts' });
  }
});

// Manual sync test
router.post('/sync-test/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const { subAccountId } = req.params;
    const { phoneNumber, message } = req.body;

    if (!phoneNumber || !message) {
      return res.status(400).json({ error: 'Phone number and message are required' });
    }

    // Verify sub-account belongs to customer
    const subAccount = await SubAccount.findOne({
      where: { id: subAccountId, customerId: req.user.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    // Sync message to GHL
    const result = await ghlService.syncMessageToGHL(
      subAccount,
      phoneNumber,
      subAccount.phoneNumber || '',
      message,
      'inbound'
    );

    if (result) {
      res.json({
        success: true,
        message: 'Message synced to GHL',
        contact: result.contact,
        conversation: result.conversation
      });
    } else {
      res.status(400).json({ error: 'Failed to sync message to GHL' });
    }
  } catch (error) {
    logger.error('GHL sync test error:', error);
    res.status(500).json({ error: 'Failed to sync message' });
  }
});

module.exports = router;
