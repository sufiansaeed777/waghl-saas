const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/auth');
const { Customer, SubAccount } = require('../models');
const ghlService = require('../services/ghl');
const whatsappService = require('../services/whatsapp');
const messageQueue = require('../services/messageQueue');
const logger = require('../utils/logger');

// Enable drip mode for GHL webhooks (rate limiting)
const DRIP_MODE_ENABLED = process.env.DRIP_MODE_ENABLED !== 'false'; // Default: true
const DRIP_DELAY_MS = parseInt(process.env.DRIP_DELAY_MS) || 1000; // Default: 1 second between messages

// Simple auth initiation for testing (redirects to GHL OAuth)
router.get('/auth', async (req, res) => {
  try {
    // Generate auth URL (customerId is optional, will auto-create on callback)
    const customerId = req.query.customerId || 'marketplace';
    const authUrl = ghlService.getAuthorizationUrl(customerId, null);
    logger.info('Redirecting to GHL OAuth:', authUrl);
    res.redirect(authUrl);
  } catch (error) {
    logger.error('GHL auth redirect error:', error);
    res.status(500).json({ error: 'Failed to start GHL OAuth' });
  }
});

// Get GHL authorization URL for a sub-account
router.get('/auth-url/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const { subAccountId } = req.params;

    // Verify sub-account belongs to customer
    const subAccount = await SubAccount.findOne({
      where: { id: subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const authUrl = ghlService.getAuthorizationUrl(req.customer.id, subAccountId);
    res.json({ authUrl });
  } catch (error) {
    logger.error('GHL auth URL error:', error);
    res.status(500).json({ error: 'Failed to generate authorization URL' });
  }
});

// OAuth callback handler
router.get('/callback', async (req, res) => {
  try {
    // Both code and state can come back as arrays if duplicated in URL - handle both cases
    let code = req.query.code;
    if (Array.isArray(code)) {
      code = code[0];
    }
    let state = req.query.state;
    if (Array.isArray(state)) {
      state = state[0];
    }
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    if (!code) {
      return res.redirect(`${frontendUrl}/sub-accounts?ghl_error=no_code`);
    }

    logger.info('GHL callback received', { code: code ? 'present' : 'missing', state: state || 'missing', stateIsArray: Array.isArray(req.query.state) });

    // Exchange code for tokens FIRST - we need locationId from this
    const tokenData = await ghlService.exchangeCodeForTokens(code);
    const locationId = tokenData.locationId;

    logger.info('GHL token exchange successful', { locationId, hasAccessToken: !!tokenData.access_token });

    // Decode state to get customer and sub-account IDs (URL-safe base64)
    let customerId, subAccountId;
    let stateValid = false;

    if (state) {
      try {
        // Convert URL-safe base64 back to standard base64
        let base64State = state
          .replace(/-/g, '+')
          .replace(/_/g, '/');
        // Add padding if needed
        while (base64State.length % 4) {
          base64State += '=';
        }
        logger.info('Decoding state', { original: state, converted: base64State });
        const decoded = Buffer.from(base64State, 'base64').toString();
        logger.info('Decoded state string', { decoded });
        const stateData = JSON.parse(decoded);
        customerId = stateData.customerId;
        subAccountId = stateData.subAccountId;
        stateValid = true;
        logger.info('State parsed successfully', { customerId, subAccountId });
      } catch (e) {
        logger.warn('Failed to decode state, will try locationId lookup', { error: e.message, state: state });
      }
    }

    let subAccount = null;

    // Strategy 1: Try to find SubAccount by state (dashboard-initiated OAuth)
    if (stateValid && subAccountId) {
      subAccount = await SubAccount.findOne({
        where: { id: subAccountId, customerId }
      });
      if (subAccount) {
        logger.info('Found SubAccount by state', { subAccountId });
      }
    }

    // Strategy 2: Try to find SubAccount by locationId (returning user or already linked)
    if (!subAccount && locationId) {
      subAccount = await SubAccount.findOne({
        where: { ghlLocationId: locationId }
      });
      if (subAccount) {
        logger.info('Found SubAccount by locationId', { locationId, subAccountId: subAccount.id });
      }
    }

    // Strategy 3: Auto-create for GHL Marketplace installs (no existing SubAccount)
    if (!subAccount && locationId) {
      logger.info('No SubAccount found, auto-creating for marketplace install', { locationId });

      // Find or create a customer for this GHL location
      // Use a default/admin customer or create one based on locationId
      let customer = null;

      // First, try to find admin customer
      customer = await Customer.findOne({ where: { role: 'admin' } });

      if (!customer) {
        // Create a marketplace customer if no admin exists
        const crypto = require('crypto');
        customer = await Customer.create({
          email: `ghl-${locationId}@marketplace.local`,
          password: crypto.randomBytes(32).toString('hex'), // Random password (won't be used)
          name: 'GHL Marketplace User',
          company: 'GHL Location ' + locationId,
          apiKey: crypto.randomBytes(32).toString('hex'),
          role: 'customer',
          subscriptionStatus: 'active', // Give them access
          planType: 'standard',
          isActive: true
        });
        logger.info('Created marketplace customer', { customerId: customer.id });
      }

      // Create SubAccount for this location
      const crypto = require('crypto');
      subAccount = await SubAccount.create({
        customerId: customer.id,
        name: `GHL Location ${locationId.substring(0, 8)}`,
        apiKey: crypto.randomBytes(32).toString('hex'),
        status: 'disconnected',
        isActive: true,
        isPaid: true, // Allow them to connect WhatsApp
        ghlLocationId: locationId,
        ghlConnected: true,
        ghlAccessToken: tokenData.access_token,
        ghlRefreshToken: tokenData.refresh_token,
        ghlTokenExpiresAt: new Date(Date.now() + (tokenData.expires_in * 1000))
      });

      logger.info('Created SubAccount for marketplace install', {
        subAccountId: subAccount.id,
        customerId: customer.id,
        locationId
      });
    }

    if (!subAccount) {
      logger.error('Could not find or create SubAccount', { locationId, stateValid });
      return res.redirect(`${frontendUrl}/sub-accounts?ghl_error=subaccount_not_found`);
    }

    // Update sub-account with GHL tokens (in case it already existed)
    await subAccount.update({
      ghlAccessToken: tokenData.access_token,
      ghlRefreshToken: tokenData.refresh_token,
      ghlTokenExpiresAt: new Date(Date.now() + (tokenData.expires_in * 1000)),
      ghlLocationId: locationId || subAccount.ghlLocationId,
      ghlConnected: true
    });

    logger.info(`GHL connected for sub-account ${subAccount.id}, location: ${locationId}`);

    // Generate embed token for WhatsApp page
    const crypto = require('crypto');
    const embedToken = crypto.createHash('sha256')
      .update(subAccount.id + (process.env.JWT_SECRET || 'default-secret'))
      .digest('hex');

    // Check if request came from GHL (marketplace install) or our dashboard
    const referer = req.headers.referer || '';
    const isFromGHL = referer.includes('gohighlevel.com') || referer.includes('leadconnectorhq.com');

    // Get the WhatsApp page URL
    const apiUrl = process.env.API_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
    const finalLocationId = locationId || subAccount.ghlLocationId;
    const whatsappPageUrl = `${apiUrl}/whatsapp.html?token=${embedToken}&locationId=${finalLocationId}&setup=true`;

    // Set a cookie to remember this location's token (works across iframe visits)
    // Cookie stores: locationId:token pairs
    const cookieValue = `${finalLocationId}:${embedToken}`;
    res.cookie('ghl_auth', cookieValue, {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: false, // Allow JavaScript to read it
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'None' // Required for cross-site iframe
    });

    logger.info('Set ghl_auth cookie for location:', finalLocationId);

    if (isFromGHL) {
      // Redirect to WhatsApp connection page for GHL marketplace installs
      logger.info('Redirecting to WhatsApp setup page (from GHL)');
      res.redirect(whatsappPageUrl);
    } else {
      // Redirect back to dashboard for dashboard-initiated connections
      res.redirect(`${frontendUrl}/sub-accounts/${subAccount.id}?ghl_connected=true`);
    }
  } catch (error) {
    logger.error('GHL callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/sub-accounts?ghl_error=token_exchange_failed`);
  }
});

// Get GHL connection status for a sub-account
router.get('/status/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const { subAccountId } = req.params;

    const subAccount = await SubAccount.findOne({
      where: { id: subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    res.json({
      connected: subAccount.ghlConnected || false,
      locationId: subAccount.ghlLocationId,
      tokenExpiresAt: subAccount.ghlTokenExpiresAt
    });
  } catch (error) {
    logger.error('GHL status error:', error);
    res.status(500).json({ error: 'Failed to get GHL status' });
  }
});

// Disconnect GHL from sub-account
router.post('/disconnect/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const { subAccountId } = req.params;

    const subAccount = await SubAccount.findOne({
      where: { id: subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    await subAccount.update({
      ghlAccessToken: null,
      ghlRefreshToken: null,
      ghlTokenExpiresAt: null,
      ghlConnected: false
    });

    res.json({ success: true, message: 'GHL disconnected' });
  } catch (error) {
    logger.error('GHL disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect GHL' });
  }
});

// GHL Webhook - receives outbound messages from GHL
// When user sends "SMS" in GHL, it calls this webhook
router.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    logger.info('GHL webhook received:', JSON.stringify(payload));

    // Verify webhook (GHL sends various event types)
    const eventType = payload.type || payload.event;

    // Handle outbound SMS/message events
    if (eventType === 'OutboundMessage' || eventType === 'SMS' || payload.messageType === 'SMS') {
      const {
        locationId,
        contactId,
        phone,
        to,
        message,
        body,
        messageBody,
        attachments
      } = payload;

      const phoneNumber = phone || to;
      const messageContent = message || body || messageBody;

      if (!locationId || !phoneNumber) {
        logger.warn('GHL webhook missing locationId or phone');
        return res.status(200).json({ success: true }); // Always return 200 to GHL
      }

      // Find sub-account by location ID
      const subAccount = await SubAccount.findOne({
        where: { ghlLocationId: locationId, ghlConnected: true }
      });

      if (!subAccount) {
        logger.warn(`No sub-account found for GHL location ${locationId}`);
        return res.status(200).json({ success: true });
      }

      // Check payment status
      if (!subAccount.isPaid) {
        logger.warn(`Sub-account ${subAccount.id} is not paid, ignoring GHL webhook`);
        return res.status(200).json({ success: true, message: 'Payment required' });
      }

      // Check if WhatsApp is connected
      const waStatus = await whatsappService.getStatus(subAccount.id);
      if (waStatus.status !== 'connected') {
        logger.warn(`WhatsApp not connected for sub-account ${subAccount.id}`);
        return res.status(200).json({ success: true });
      }

      // Send message via WhatsApp (using queue for rate limiting / drip mode)
      try {
        if (DRIP_MODE_ENABLED) {
          // Use message queue for rate-limited sending (drip mode)
          messageQueue.setRateLimit(subAccount.id, { delayBetweenMessages: DRIP_DELAY_MS });

          // Handle media attachments
          if (attachments && attachments.length > 0) {
            for (const attachment of attachments) {
              await messageQueue.queueMessage(
                subAccount.id,
                phoneNumber,
                attachment.url || messageContent,
                attachment.type || 'document',
                attachment.url,
                { source: 'ghl_webhook', contactId }
              );
            }
          } else if (messageContent) {
            // Queue text message
            await messageQueue.queueMessage(
              subAccount.id,
              phoneNumber,
              messageContent,
              'text',
              null,
              { source: 'ghl_webhook', contactId }
            );
          }

          logger.info(`Queued WhatsApp message to ${phoneNumber} via GHL webhook (drip mode)`);
        } else {
          // Direct sending (no queue)
          if (attachments && attachments.length > 0) {
            for (const attachment of attachments) {
              await whatsappService.sendMessage(
                subAccount.id,
                phoneNumber,
                attachment.url || messageContent,
                attachment.type || 'document',
                attachment.url
              );
            }
          } else if (messageContent) {
            await whatsappService.sendMessage(
              subAccount.id,
              phoneNumber,
              messageContent,
              'text'
            );
          }

          logger.info(`Sent WhatsApp message to ${phoneNumber} via GHL webhook`);
        }
      } catch (sendError) {
        logger.error('Failed to send/queue WhatsApp message from GHL webhook:', sendError);
      }
    }

    // Always return 200 to acknowledge webhook
    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('GHL webhook error:', error);
    res.status(200).json({ success: true }); // Always return 200
  }
});

// GHL Webhook verification (some GHL webhooks use GET for verification)
router.get('/webhook', (req, res) => {
  // Return 200 for webhook verification
  res.status(200).send('OK');
});

// ============================================
// Message Queue / Drip Mode API Endpoints
// ============================================

// Get queue status for a sub-account
router.get('/queue/status/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const { subAccountId } = req.params;

    const subAccount = await SubAccount.findOne({
      where: { id: subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const status = messageQueue.getQueueStatus(subAccountId);
    res.json({
      success: true,
      dripModeEnabled: DRIP_MODE_ENABLED,
      delayMs: DRIP_DELAY_MS,
      ...status
    });
  } catch (error) {
    logger.error('Queue status error:', error);
    res.status(500).json({ error: 'Failed to get queue status' });
  }
});

// Set rate limit for a sub-account
router.post('/queue/rate-limit/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const { subAccountId } = req.params;
    const { delayBetweenMessages, messagesPerSecond } = req.body;

    const subAccount = await SubAccount.findOne({
      where: { id: subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const config = {};
    if (delayBetweenMessages) config.delayBetweenMessages = parseInt(delayBetweenMessages);
    if (messagesPerSecond) config.messagesPerSecond = parseFloat(messagesPerSecond);

    messageQueue.setRateLimit(subAccountId, config);

    res.json({
      success: true,
      message: 'Rate limit updated',
      rateLimit: messageQueue.getQueueStatus(subAccountId).rateLimit
    });
  } catch (error) {
    logger.error('Set rate limit error:', error);
    res.status(500).json({ error: 'Failed to set rate limit' });
  }
});

// Clear queue for a sub-account
router.post('/queue/clear/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const { subAccountId } = req.params;

    const subAccount = await SubAccount.findOne({
      where: { id: subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const cleared = messageQueue.clearQueue(subAccountId);
    res.json({
      success: true,
      message: `Cleared ${cleared} messages from queue`
    });
  } catch (error) {
    logger.error('Clear queue error:', error);
    res.status(500).json({ error: 'Failed to clear queue' });
  }
});

// Pause queue processing
router.post('/queue/pause/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const { subAccountId } = req.params;

    const subAccount = await SubAccount.findOne({
      where: { id: subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    messageQueue.pauseProcessing(subAccountId);
    res.json({ success: true, message: 'Queue paused' });
  } catch (error) {
    logger.error('Pause queue error:', error);
    res.status(500).json({ error: 'Failed to pause queue' });
  }
});

// Resume queue processing
router.post('/queue/resume/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const { subAccountId } = req.params;

    const subAccount = await SubAccount.findOne({
      where: { id: subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    messageQueue.resumeProcessing(subAccountId);
    res.json({ success: true, message: 'Queue resumed' });
  } catch (error) {
    logger.error('Resume queue error:', error);
    res.status(500).json({ error: 'Failed to resume queue' });
  }
});

module.exports = router;
