const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/auth');
const { Customer, SubAccount, WhatsAppMapping } = require('../models');
const ghlService = require('../services/ghl');
const whatsappService = require('../services/whatsapp');
const messageQueue = require('../services/messageQueue');
const logger = require('../utils/logger');

// Helper to guess media type from URL
function guessMediaType(url) {
  if (!url) return 'document';
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/)) return 'image';
  if (lowerUrl.match(/\.(mp4|mov|avi|webm|mkv)(\?|$)/)) return 'video';
  if (lowerUrl.match(/\.(mp3|ogg|wav|aac|m4a)(\?|$)/)) return 'audio';
  if (lowerUrl.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv)(\?|$)/)) return 'document';
  // Default to document for unknown types
  return 'document';
}

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
      const foundSubAccount = await SubAccount.findOne({
        where: { id: subAccountId, customerId }
      });
      if (foundSubAccount) {
        logger.info('Found SubAccount by state', { subAccountId, configuredLocationId: foundSubAccount.ghlLocationId, incomingLocationId: locationId });

        // SECURITY: Sub-account MUST have a ghlLocationId pre-configured
        if (!foundSubAccount.ghlLocationId) {
          logger.warn('SubAccount has no ghlLocationId configured - cannot connect to any GHL location', { subAccountId });
          // Don't set subAccount - will trigger error below
        } else if (foundSubAccount.ghlLocationId !== locationId) {
          // LocationId is configured but doesn't match incoming - return specific error
          logger.warn('SubAccount ghlLocationId mismatch', {
            subAccountId,
            configured: foundSubAccount.ghlLocationId,
            incoming: locationId
          });
          const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
          res.set('Content-Type', 'text/html');
          return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <title>Location Mismatch</title>
              <style>
                body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); }
                .box { background: white; padding: 40px; border-radius: 16px; text-align: center; max-width: 450px; }
                .icon { font-size: 48px; margin-bottom: 16px; }
                h2 { color: #d97706; margin: 0 0 12px 0; }
                p { color: #666; margin: 0 0 8px 0; font-size: 14px; }
                .ids { background: #fef3c7; padding: 12px; border-radius: 8px; margin: 16px 0; font-family: monospace; font-size: 12px; }
              </style>
            </head>
            <body>
              <div class="box">
                <div class="icon">⚠️</div>
                <h2>Wrong Location Selected</h2>
                <p>You selected a different GHL location than the one configured for this sub-account.</p>
                <div class="ids">
                  <p><strong>Expected:</strong> ${foundSubAccount.ghlLocationId}</p>
                  <p><strong>Selected:</strong> ${locationId}</p>
                </div>
                <p>Please try again and select the correct location in GHL.</p>
              </div>
              <script>
                const result = {
                  type: 'GHL_OAUTH_RESULT',
                  success: false,
                  error: 'location_mismatch',
                  message: 'Wrong GHL location selected. Please select the location matching ID: ${foundSubAccount.ghlLocationId}',
                  expected: '${foundSubAccount.ghlLocationId}',
                  selected: '${locationId}'
                };
                if (window.opener) {
                  window.opener.postMessage(result, '*');
                  setTimeout(() => { try { window.close(); } catch(e) {} }, 3000);
                } else {
                  setTimeout(() => {
                    window.location.href = '${frontendUrl}/sub-accounts?ghl_error=location_mismatch';
                  }, 3000);
                }
              </script>
            </body>
            </html>
          `);
        } else {
          // LocationId matches - allow connection
          subAccount = foundSubAccount;
        }
      }
    }

    // Strategy 2: Try to find SubAccount by locationId (returning user or already linked)
    // SECURITY: Only allow if the sub-account belongs to the same customer, or if no customer context
    if (!subAccount && locationId) {
      const foundByLocation = await SubAccount.findOne({
        where: { ghlLocationId: locationId }
      });
      if (foundByLocation) {
        // If we have a customer context from state, verify ownership
        if (stateValid && customerId && foundByLocation.customerId !== customerId) {
          logger.warn('Location ID already belongs to another customer', {
            locationId,
            existingCustomerId: foundByLocation.customerId,
            requestingCustomerId: customerId
          });
          res.set('Content-Type', 'text/html');
          return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <title>Connection Failed</title>
              <style>
                body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); }
                .box { background: white; padding: 40px; border-radius: 16px; text-align: center; max-width: 500px; }
              </style>
            </head>
            <body>
              <div class="box">
                <h1 style="color:#ef4444">Location Already In Use</h1>
                <p>This GHL location is already connected to another account.</p>
                <p>Location ID: ${locationId}</p>
                <button onclick="window.close()" style="margin-top:20px;padding:10px 20px;background:#ef4444;color:white;border:none;border-radius:8px;cursor:pointer;">Close Window</button>
              </div>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'GHL_OAUTH_RESULT', success: false, error: 'location_in_use' }, '*');
                }
              </script>
            </body>
            </html>
          `);
        }
        subAccount = foundByLocation;
        logger.info('Found SubAccount by locationId', { locationId, subAccountId: subAccount.id });
      }
    }

    // Strategy 3: DISABLED - No auto-creation allowed
    // Sub-accounts must be pre-created with matching ghlLocationId
    // This ensures only authorized locations can connect
    if (!subAccount && locationId) {
      logger.warn('No SubAccount found for GHL location - auto-creation disabled', { locationId });
      // Don't auto-create - return error instead
    }

    if (!subAccount) {
      logger.error('No SubAccount found for this GHL location', { locationId, stateValid });
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const errorMessage = encodeURIComponent('Location ID mismatch. The GHL location does not match any sub-account.');

      // Send message to opener window and redirect
      res.set('Content-Type', 'text/html');
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Connection Failed</title>
          <style>
            body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); }
            .box { background: white; padding: 40px; border-radius: 16px; text-align: center; max-width: 400px; }
            .icon { font-size: 48px; margin-bottom: 16px; }
            h2 { color: #ef4444; margin: 0 0 12px 0; }
            p { color: #666; margin: 0 0 8px 0; }
          </style>
        </head>
        <body>
          <div class="box">
            <div class="icon">❌</div>
            <h2>Connection Failed</h2>
            <p>Redirecting back to dashboard...</p>
          </div>
          <script>
            const result = {
              type: 'GHL_OAUTH_RESULT',
              success: false,
              error: 'location_not_configured',
              message: 'Location ID mismatch. The GHL location does not match any sub-account.',
              locationId: '${locationId || ''}'
            };

            if (window.opener) {
              window.opener.postMessage(result, '*');
              setTimeout(() => { try { window.close(); } catch(e) {} }, 500);
            } else {
              // No opener - redirect to frontend
              setTimeout(() => {
                window.location.href = '${frontendUrl}/sub-accounts?ghl_error=${errorMessage}';
              }, 1500);
            }
          </script>
        </body>
        </html>
      `);
    }

    // Update sub-account with GHL tokens
    await subAccount.update({
      ghlAccessToken: tokenData.access_token,
      ghlRefreshToken: tokenData.refresh_token,
      ghlTokenExpiresAt: new Date(Date.now() + (tokenData.expires_in * 1000)),
      ghlLocationId: locationId || subAccount.ghlLocationId,
      ghlConnected: true
    });

    // Fetch location details from GHL to get the actual location name
    try {
      // Reload subAccount to get updated tokens
      await subAccount.reload();
      logger.info('Fetching location details from GHL...', { locationId, subAccountId: subAccount.id });
      const locationDetails = await ghlService.getLocation(subAccount, locationId);

      if (locationDetails && locationDetails.name) {
        logger.info(`Fetched location name from GHL: ${locationDetails.name}`);
        await subAccount.update({
          name: locationDetails.name,
          ghlLocationName: locationDetails.name
        });
        // Reload to get updated name
        await subAccount.reload();
        logger.info(`Sub-account name updated to: ${subAccount.name}`);
      } else {
        logger.warn('Location details returned but no name found', { locationDetails });
      }
    } catch (error) {
      logger.error(`Failed to fetch location name from GHL:`, {
        error: error.message,
        stack: error.stack,
        locationId,
        subAccountId: subAccount.id
      });
      // Don't fail the whole connection if we can't fetch the name
    }

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
      secure: true, // Required for SameSite=None and Partitioned
      sameSite: 'None', // Required for cross-site iframe
      partitioned: true // Chrome CHIPS - allows cookie in partitioned storage for iframes
    });

    logger.info('Set ghl_auth cookie for location:', finalLocationId);

    if (isFromGHL) {
      // Show simple success page directly - no redirect
      logger.info('GHL OAuth successful');
      // Redirect to frontend success page
      const frontendUrl = process.env.FRONTEND_URL || 'https://whatsapp.bibotcrm.it';
      return res.redirect(`${frontendUrl}/ghl-success`);
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

// Disconnect GHL from sub-account (keeps locationId for reconnection)
// Also disconnects WhatsApp since GHL is required for embed page access
router.post('/disconnect/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const { subAccountId } = req.params;

    const subAccount = await SubAccount.findOne({
      where: { id: subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    // Disconnect WhatsApp first (since GHL is required for embed access)
    try {
      await whatsappService.disconnect(subAccountId);
      logger.info(`WhatsApp disconnected for sub-account ${subAccountId} due to GHL disconnect`);
    } catch (waError) {
      logger.warn(`Failed to disconnect WhatsApp for sub-account ${subAccountId}:`, waError.message);
      // Continue with GHL disconnect even if WhatsApp disconnect fails
    }

    await subAccount.update({
      ghlAccessToken: null,
      ghlRefreshToken: null,
      ghlTokenExpiresAt: null,
      ghlConnected: false
    });

    res.json({ success: true, message: 'GHL and WhatsApp disconnected' });
  } catch (error) {
    logger.error('GHL disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect GHL' });
  }
});

// Full uninstall - clears ALL GHL data including locationId
// Also disconnects WhatsApp since GHL is required for embed page access
router.post('/uninstall/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const { subAccountId } = req.params;

    const subAccount = await SubAccount.findOne({
      where: { id: subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const oldLocationId = subAccount.ghlLocationId;

    // Disconnect WhatsApp first (since GHL is required for embed access)
    try {
      await whatsappService.disconnect(subAccountId);
      logger.info(`WhatsApp disconnected for sub-account ${subAccountId} due to GHL uninstall`);
    } catch (waError) {
      logger.warn(`Failed to disconnect WhatsApp for sub-account ${subAccountId}:`, waError.message);
      // Continue with GHL uninstall even if WhatsApp disconnect fails
    }

    // Clear ALL GHL data
    await subAccount.update({
      ghlAccessToken: null,
      ghlRefreshToken: null,
      ghlTokenExpiresAt: null,
      ghlLocationId: null,
      ghlConnected: false
    });

    logger.info(`GHL fully uninstalled for sub-account ${subAccountId}, was location: ${oldLocationId}`);

    res.json({
      success: true,
      message: 'GHL and WhatsApp fully uninstalled - locationId cleared',
      previousLocationId: oldLocationId
    });
  } catch (error) {
    logger.error('GHL uninstall error:', error);
    res.status(500).json({ error: 'Failed to uninstall GHL' });
  }
});

// GHL Webhook - receives outbound messages and other events from GHL
// Handles: OutboundMessage, SMS, ContactDelete, ContactUpdate
router.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    logger.info('GHL webhook received:', JSON.stringify(payload));

    // Verify webhook (GHL sends various event types)
    const eventType = payload.type || payload.event;

    // Handle contact deletion - clear WhatsAppMapping when contact is deleted in GHL
    if (eventType === 'ContactDelete' || eventType === 'contact.delete') {
      const { locationId, contactId, phone } = payload;

      logger.info('GHL contact delete event received:', { locationId, contactId, phone });

      if (phone) {
        // Clean phone number (remove + and spaces)
        const cleanPhone = phone.replace(/[^\d]/g, '');

        // Delete mapping for this phone number
        const deleted = await WhatsAppMapping.destroy({
          where: { phoneNumber: cleanPhone }
        });

        logger.info(`Cleared WhatsAppMapping for deleted contact: ${cleanPhone}, deleted ${deleted} entries`);
      }

      return res.status(200).json({ success: true, message: 'Contact delete handled' });
    }

    // Handle contact update - could also clear stale data
    if (eventType === 'ContactUpdate' || eventType === 'contact.update') {
      const { locationId, contactId, phone, oldPhone } = payload;

      logger.info('GHL contact update event received:', { locationId, contactId, phone, oldPhone });

      // If phone number changed, clear old mapping
      if (oldPhone && oldPhone !== phone) {
        const cleanOldPhone = oldPhone.replace(/[^\d]/g, '');
        const deleted = await WhatsAppMapping.destroy({
          where: { phoneNumber: cleanOldPhone }
        });
        logger.info(`Cleared old WhatsAppMapping for updated contact: ${cleanOldPhone}, deleted ${deleted} entries`);
      }

      return res.status(200).json({ success: true, message: 'Contact update handled' });
    }

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

      // Parse attachments - GHL sends as JSON string, e.g. '["https://..."]'
      let parsedAttachments = [];
      if (attachments) {
        if (typeof attachments === 'string') {
          try {
            parsedAttachments = JSON.parse(attachments);
            // If it parsed to an array of strings (URLs), convert to objects
            if (Array.isArray(parsedAttachments) && parsedAttachments.length > 0 && typeof parsedAttachments[0] === 'string') {
              parsedAttachments = parsedAttachments.map(url => ({
                url: url,
                type: guessMediaType(url)
              }));
            }
          } catch (e) {
            logger.warn('Failed to parse attachments JSON:', attachments, e.message);
            parsedAttachments = [];
          }
        } else if (Array.isArray(attachments)) {
          // Already an array - but may be array of URL strings, convert to objects
          parsedAttachments = attachments.map(item => {
            if (typeof item === 'string') {
              return { url: item, type: guessMediaType(item) };
            }
            return item; // Already an object with url/type
          });
        }
      }

      // Log full payload for debugging media issues
      logger.info('GHL webhook payload details:', {
        eventType,
        hasMessage: !!messageContent,
        messageLength: messageContent?.length,
        hasAttachments: !!attachments,
        attachmentsType: typeof attachments,
        parsedAttachmentsCount: parsedAttachments.length,
        parsedAttachments: parsedAttachments.length > 0 ? JSON.stringify(parsedAttachments).substring(0, 500) : null,
        phone: phoneNumber
      });

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

      // Store/update phone number mapping for WhatsApp ID resolution
      // This allows us to map WhatsApp's internal IDs back to real phone numbers
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      try {
        await WhatsAppMapping.upsert({
          subAccountId: subAccount.id,
          phoneNumber: cleanPhone,
          lastActivityAt: new Date()
        }, {
          conflictFields: ['subAccountId', 'phoneNumber']
        });
        logger.info('Stored phone mapping for outbound message:', { subAccountId: subAccount.id, phoneNumber: cleanPhone });
      } catch (mappingError) {
        logger.warn('Failed to store phone mapping:', mappingError.message);
        // Continue anyway - mapping is not critical for sending
      }

      // Send message via WhatsApp (drip mode: 5s between messages)
      try {
        if (parsedAttachments && parsedAttachments.length > 0) {
          for (const attachment of parsedAttachments) {
            await messageQueue.queueMessage(
              subAccount.id,
              phoneNumber,
              attachment.url || messageContent,
              attachment.type || 'document',
              attachment.url
            );
          }
        } else if (messageContent) {
          await messageQueue.queueMessage(
            subAccount.id,
            phoneNumber,
            messageContent,
            'text'
          );
        }

        logger.info(`Queued WhatsApp message to ${phoneNumber} via GHL webhook (drip mode)`);
      } catch (sendError) {
        logger.error('Failed to queue WhatsApp message from GHL webhook:', sendError);
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

// Clear WhatsApp mapping for a phone number (use when contact deleted in GHL)
router.delete('/mapping/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const { subAccountId } = req.params;
    const { phoneNumber } = req.query;

    const subAccount = await SubAccount.findOne({
      where: { id: subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    let deleted = 0;
    if (phoneNumber) {
      // Clear specific phone mapping
      const cleanPhone = phoneNumber.replace(/[^\d]/g, '');
      deleted = await WhatsAppMapping.destroy({
        where: { subAccountId, phoneNumber: cleanPhone }
      });
      logger.info(`Cleared WhatsAppMapping for phone ${cleanPhone} in sub-account ${subAccountId}`);
    } else {
      // Clear all mappings for this sub-account
      deleted = await WhatsAppMapping.destroy({
        where: { subAccountId }
      });
      logger.info(`Cleared all WhatsAppMappings for sub-account ${subAccountId}: ${deleted} entries`);
    }

    res.json({
      success: true,
      message: `Cleared ${deleted} mapping(s)`,
      deleted
    });
  } catch (error) {
    logger.error('Clear mapping error:', error);
    res.status(500).json({ error: 'Failed to clear mapping' });
  }
});

// Get WhatsApp mappings for a sub-account
router.get('/mappings/:subAccountId', authenticateJWT, async (req, res) => {
  try {
    const { subAccountId } = req.params;

    const subAccount = await SubAccount.findOne({
      where: { id: subAccountId, customerId: req.customer.id }
    });

    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    const mappings = await WhatsAppMapping.findAll({
      where: { subAccountId },
      order: [['updatedAt', 'DESC']],
      limit: 100
    });

    res.json({
      success: true,
      count: mappings.length,
      mappings: mappings.map(m => ({
        id: m.id,
        phoneNumber: m.phoneNumber,
        whatsappId: m.whatsappId,
        contactName: m.contactName,
        updatedAt: m.updatedAt
      }))
    });
  } catch (error) {
    logger.error('Get mappings error:', error);
    res.status(500).json({ error: 'Failed to get mappings' });
  }
});

// OAuth success page - serves HTML directly
router.get('/success', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Connection Successful</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#10b981 0%,#059669 100%)}
.card{background:#fff;padding:60px 50px;border-radius:20px;text-align:center;box-shadow:0 25px 80px rgba(0,0,0,0.25);max-width:420px;margin:20px}
.icon{width:100px;height:100px;background:linear-gradient(135deg,#10b981 0%,#059669 100%);border-radius:50%;margin:0 auto 30px;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 40px rgba(16,185,129,0.4)}
.icon svg{width:50px;height:50px}
h1{color:#1f2937;font-size:32px;font-weight:700;margin-bottom:15px}
p{color:#6b7280;font-size:18px;line-height:1.6}
.divider{width:60px;height:4px;background:linear-gradient(135deg,#10b981 0%,#059669 100%);border-radius:2px;margin:25px auto}
.sub{color:#9ca3af;font-size:14px;margin-top:20px}
</style>
</head>
<body>
<div class="card">
<div class="icon"><svg fill="none" stroke="#fff" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg></div>
<h1>Connection Successful!</h1>
<div class="divider"></div>
<p>Your GoHighLevel account has been connected successfully.</p>
<p class="sub">You can close this window now.</p>
</div>
</body>
</html>`);
});

module.exports = router;
