const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { SubAccount, Customer } = require('../models');
const whatsappService = require('../services/whatsapp');
const logger = require('../utils/logger');

// Store embed tokens (token -> subAccountId mapping)
// Using deterministic tokens based on hash for persistence across restarts
const tokenCache = new Map();

// Generate deterministic embed token for a sub-account
function generateToken(subAccountId) {
  return crypto.createHash('sha256')
    .update(subAccountId + (process.env.JWT_SECRET || 'default-secret'))
    .digest('hex');
}

// Get embed token for a sub-account
function getEmbedToken(subAccountId) {
  const token = generateToken(subAccountId);
  // Cache the reverse mapping
  tokenCache.set(token, subAccountId);
  return token;
}

// Verify embed token and get subAccountId
function verifyEmbedToken(token) {
  // Check cache first
  if (tokenCache.has(token)) {
    return tokenCache.get(token);
  }
  // Token not in cache - need to look up in database
  // For now, return null (caller should handle)
  return null;
}

// Set token mapping (called from other routes)
function setToken(subAccountId, token) {
  tokenCache.set(token, subAccountId);
}

// Get token by GHL location ID (for custom page integration)
// SECURITY: This endpoint strictly returns token ONLY for the requested locationId
router.get('/token-by-location/:locationId', async (req, res) => {
  try {
    const { locationId } = req.params;

    // Reject unresolved template variables
    if (!locationId ||
        locationId.includes('location.id') ||
        locationId.includes('location_id}') ||
        locationId === '{location.id}' ||
        locationId === '{{location.id}}') {
      logger.warn('Received invalid/template locationId:', locationId);
      return res.status(400).json({ error: 'Invalid location ID. GHL template variable was not resolved.' });
    }

    // Find sub-account by GHL location ID - STRICT match only
    const subAccount = await SubAccount.findOne({
      where: { ghlLocationId: locationId, isActive: true },
      include: [{ model: Customer, as: 'customer' }]
    });

    // SECURITY: Do NOT auto-create sub-accounts. User must install via OAuth first.
    if (!subAccount) {
      logger.warn('No SubAccount found for locationId - user must install via GHL OAuth first', { locationId });
      return res.status(404).json({
        error: 'Location not configured',
        message: 'This location has not been set up yet. Please install the app from the GHL Marketplace first.',
        locationId
      });
    }

    // Check if customer account is active
    if (!subAccount.customer || !subAccount.customer.isActive) {
      logger.warn('Customer account is inactive for locationId', { locationId, customerId: subAccount.customerId });
      return res.status(403).json({
        error: 'Account inactive',
        message: 'This account has been deactivated. Please contact support.'
      });
    }

    // Generate token
    const token = generateToken(subAccount.id);
    tokenCache.set(token, subAccount.id);

    res.json({
      success: true,
      token,
      subAccountId: subAccount.id,
      subAccountName: subAccount.name
    });
  } catch (error) {
    logger.error('Get token by location error:', error);
    res.status(500).json({ error: 'Failed to get token' });
  }
});

// GHL SSO - Exchange SSO key for embed token
// GHL Custom Pages can pass ssoKey which contains encrypted location data
router.post('/sso', async (req, res) => {
  try {
    const { ssoKey } = req.body;

    if (!ssoKey) {
      return res.status(400).json({ error: 'SSO key required' });
    }

    const ssoSecret = process.env.GHL_SSO_KEY;
    if (!ssoSecret) {
      logger.error('GHL_SSO_KEY not configured');
      return res.status(500).json({ error: 'SSO not configured' });
    }

    // Decrypt SSO key
    // GHL SSO uses AES-256-CBC encryption with the SSO key as password
    let ssoData;
    try {
      // GHL SSO key format: base64(IV:encrypted_data)
      const decoded = Buffer.from(ssoKey, 'base64').toString('utf8');
      const [ivHex, encryptedHex] = decoded.split(':');

      if (!ivHex || !encryptedHex) {
        // Alternative: Try direct JSON decode (some GHL versions use plain JSON)
        try {
          ssoData = JSON.parse(Buffer.from(ssoKey, 'base64').toString('utf8'));
        } catch (e) {
          throw new Error('Invalid SSO key format');
        }
      } else {
        // AES decryption
        const iv = Buffer.from(ivHex, 'hex');
        const encrypted = Buffer.from(encryptedHex, 'hex');
        const key = crypto.createHash('sha256').update(ssoSecret).digest();

        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encrypted, undefined, 'utf8');
        decrypted += decipher.final('utf8');

        ssoData = JSON.parse(decrypted);
      }
    } catch (decryptError) {
      logger.error('SSO decryption failed:', decryptError.message);
      return res.status(401).json({ error: 'Invalid SSO key' });
    }

    // Extract location ID from SSO data
    const locationId = ssoData.locationId || ssoData.location_id || ssoData.activeLocation;

    if (!locationId) {
      logger.warn('SSO data missing locationId:', ssoData);
      return res.status(400).json({ error: 'Location ID not found in SSO data' });
    }

    // Find sub-account by GHL location ID
    const subAccount = await SubAccount.findOne({
      where: { ghlLocationId: locationId }
    });

    if (!subAccount) {
      return res.status(404).json({
        error: 'Location not found. Please install the app first.',
        locationId
      });
    }

    // Generate token
    const token = generateToken(subAccount.id);
    tokenCache.set(token, subAccount.id);

    res.json({
      success: true,
      token,
      subAccountId: subAccount.id,
      subAccountName: subAccount.name,
      locationId
    });
  } catch (error) {
    logger.error('SSO exchange error:', error);
    res.status(500).json({ error: 'SSO exchange failed' });
  }
});

// Redirect endpoint - always redirects to whatsapp.html (for GHL Custom Pages)
// Use this when query params aren't being passed correctly through proxy
router.get('/go/:locationId', async (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });

  try {
    const { locationId } = req.params;

    if (!locationId || locationId === '{location.id}' || locationId === '{{location.id}}') {
      return res.redirect('/whatsapp.html?error=missing_location');
    }

    const subAccount = await SubAccount.findOne({
      where: { ghlLocationId: locationId }
    });

    if (!subAccount) {
      return res.redirect('/whatsapp.html?error=location_not_found');
    }

    const token = generateToken(subAccount.id);
    tokenCache.set(token, subAccount.id);

    return res.redirect(`/whatsapp.html?token=${token}`);
  } catch (error) {
    logger.error('Go redirect error:', error);
    return res.redirect('/whatsapp.html?error=server_error');
  }
});

// Alternative: GHL can also use a session key via query param
// This endpoint validates a session and returns embed context
// With redirect=true, it redirects to the whatsapp.html page with token
router.get('/session', async (req, res) => {
  // Prevent caching of this endpoint
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });

  try {
    const { locationId, companyId, userId, redirect } = req.query;

    // If locationId is directly provided (from GHL Custom Menu Link)
    if (locationId && locationId !== '{location.id}' && locationId !== '{{location.id}}') {
      const subAccount = await SubAccount.findOne({
        where: { ghlLocationId: locationId }
      });

      if (!subAccount) {
        if (redirect === 'true') {
          return res.redirect('/whatsapp.html?error=location_not_found');
        }
        return res.status(404).json({ error: 'Location not found. Please install the app first.' });
      }

      const token = generateToken(subAccount.id);
      tokenCache.set(token, subAccount.id);

      // If redirect requested, go to whatsapp page with token
      if (redirect === 'true') {
        return res.redirect(`/whatsapp.html?token=${token}`);
      }

      return res.json({
        success: true,
        token,
        subAccountId: subAccount.id,
        subAccountName: subAccount.name
      });
    }

    if (redirect === 'true') {
      return res.redirect('/whatsapp.html?error=missing_location');
    }
    return res.status(400).json({ error: 'Location ID required' });
  } catch (error) {
    logger.error('Session validation error:', error);
    if (req.query.redirect === 'true') {
      return res.redirect('/whatsapp.html?error=server_error');
    }
    res.status(500).json({ error: 'Session validation failed' });
  }
});

// Get embed URL for a sub-account (authenticated endpoint)
router.get('/url/:subAccountId', async (req, res) => {
  try {
    const { subAccountId } = req.params;

    // Verify sub-account exists
    const subAccount = await SubAccount.findByPk(subAccountId);
    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    // Generate embed token
    const token = getEmbedToken(subAccountId);

    // Build embed URL - use static HTML page with token as query param
    const backendUrl = process.env.API_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
    const embedUrl = `${backendUrl}/whatsapp.html?token=${token}`;

    res.json({
      success: true,
      embedUrl,
      token,
      instructions: 'Use this URL as an iframe src in GHL custom button/menu'
    });
  } catch (error) {
    logger.error('Get embed URL error:', error);
    res.status(500).json({ error: 'Failed to generate embed URL' });
  }
});

// QR Code embed page (public, token-authenticated)
// Using .html extension to prevent nginx from overriding Content-Type
router.get('/qr/:token.html', async (req, res) => {
  // Prevent caching - this page has dynamic QR codes
  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });

  try {
    const { token } = req.params;

    // Verify token - first check cache
    let subAccountId = verifyEmbedToken(token);

    // If not in cache, search all sub-accounts to find matching token
    if (!subAccountId) {
      const allSubAccounts = await SubAccount.findAll({ attributes: ['id'] });
      for (const sa of allSubAccounts) {
        if (generateToken(sa.id) === token) {
          subAccountId = sa.id;
          // Cache it for future requests
          tokenCache.set(token, subAccountId);
          break;
        }
      }
    }

    if (!subAccountId) {
      return res.status(401).send(renderErrorPage('Invalid or expired token'));
    }

    // Get sub-account
    const subAccount = await SubAccount.findByPk(subAccountId, {
      include: [{ model: Customer, as: 'customer' }]
    });

    if (!subAccount) {
      return res.status(404).send(renderErrorPage('Sub-account not found'));
    }

    // Get WhatsApp status and QR code
    const status = await whatsappService.getStatus(subAccountId);

    res.send(renderQRPage(subAccount, status, token));
  } catch (error) {
    logger.error('Embed QR page error:', error);
    res.status(500).send(renderErrorPage('Something went wrong'));
  }
});

// Helper: verify token with database fallback
async function verifyTokenWithFallback(token) {
  // Check cache first
  let subAccountId = verifyEmbedToken(token);

  // If not in cache, search sub-accounts
  if (!subAccountId) {
    const allSubAccounts = await SubAccount.findAll({ attributes: ['id'] });
    for (const sa of allSubAccounts) {
      if (generateToken(sa.id) === token) {
        subAccountId = sa.id;
        tokenCache.set(token, subAccountId);
        break;
      }
    }
  }

  return subAccountId;
}

// Serve QR code as actual image (bypasses CSP data: URI restrictions)
router.get('/qr-image/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const subAccountId = await verifyTokenWithFallback(token);
    if (!subAccountId) {
      return res.status(401).send('Invalid token');
    }

    const status = await whatsappService.getStatus(subAccountId);

    if (!status.qrCode) {
      return res.status(404).send('No QR code available');
    }

    // Extract base64 data from data URI
    const base64Data = status.qrCode.replace(/^data:image\/png;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache'
    });
    res.send(imageBuffer);
  } catch (error) {
    logger.error('QR image error:', error);
    res.status(500).send('Error generating QR');
  }
});

// API endpoint to get status (for AJAX refresh)
// Includes locationId validation for GHL embed security
router.get('/status/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { locationId } = req.query; // Optional: verify locationId matches

    const subAccountId = await verifyTokenWithFallback(token);
    if (!subAccountId) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Get sub-account to verify locationId if provided
    if (locationId) {
      const subAccount = await SubAccount.findByPk(subAccountId);
      if (subAccount && subAccount.ghlLocationId !== locationId) {
        logger.warn(`Status: Location ID mismatch for token`);
        return res.status(403).json({ error: 'Location ID mismatch' });
      }
    }

    const status = await whatsappService.getStatus(subAccountId);
    res.json(status);
  } catch (error) {
    logger.error('Embed status error:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// Connect WhatsApp (for embed page)
// SECURITY: Validates that sub-account has a GHL location ID when connecting via embed
router.post('/connect/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { locationId } = req.body; // Optional: verify locationId matches

    const subAccountId = await verifyTokenWithFallback(token);
    if (!subAccountId) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const subAccount = await SubAccount.findByPk(subAccountId);
    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    // SECURITY: Sub-account must have a GHL location ID to connect via embed
    if (!subAccount.ghlLocationId) {
      logger.warn(`Attempted to connect sub-account ${subAccountId} without ghlLocationId`);
      return res.status(403).json({
        error: 'This sub-account is not linked to a GHL location. Please connect via GHL Marketplace first.'
      });
    }

    // SECURITY: If locationId provided, verify it matches the sub-account's locationId
    if (locationId && locationId !== subAccount.ghlLocationId) {
      logger.warn(`Location ID mismatch: requested ${locationId}, sub-account has ${subAccount.ghlLocationId}`);
      return res.status(403).json({ error: 'Location ID mismatch' });
    }

    // Check if paid
    if (!subAccount.isPaid) {
      return res.status(402).json({ error: 'Payment required to connect WhatsApp' });
    }

    const result = await whatsappService.connect(subAccountId);
    res.json(result);
  } catch (error) {
    logger.error('Embed connect error:', error);
    res.status(500).json({ error: error.message || 'Failed to connect' });
  }
});

// Disconnect WhatsApp (for embed page)
// SECURITY: Validates locationId if provided
router.post('/disconnect/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { locationId } = req.body; // Optional: verify locationId matches

    const subAccountId = await verifyTokenWithFallback(token);
    if (!subAccountId) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Verify locationId if provided
    if (locationId) {
      const subAccount = await SubAccount.findByPk(subAccountId);
      if (subAccount && subAccount.ghlLocationId !== locationId) {
        logger.warn(`Disconnect: Location ID mismatch for token`);
        return res.status(403).json({ error: 'Location ID mismatch' });
      }
    }

    const result = await whatsappService.disconnect(subAccountId);
    res.json(result);
  } catch (error) {
    logger.error('Embed disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// Uninstall GHL app (for embed page - calls GHL API to remove app)
// SECURITY: Validates locationId
const ghlService = require('../services/ghl');

router.post('/ghl-uninstall/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { locationId } = req.body;

    const subAccountId = await verifyTokenWithFallback(token);
    if (!subAccountId) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const subAccount = await SubAccount.findByPk(subAccountId);
    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
    }

    // Verify locationId matches
    if (locationId && subAccount.ghlLocationId !== locationId) {
      logger.warn(`GHL Uninstall: Location ID mismatch for token`);
      return res.status(403).json({ error: 'Location ID mismatch' });
    }

    // Check if GHL is connected
    if (!subAccount.ghlConnected || !subAccount.ghlAccessToken) {
      return res.status(400).json({ error: 'GHL is not connected' });
    }

    // Call GHL API to uninstall
    const result = await ghlService.uninstallFromLocation(subAccount);

    if (result.success) {
      // Also disconnect WhatsApp if connected
      await whatsappService.disconnect(subAccountId);

      res.json({
        success: true,
        message: 'App uninstalled from GHL successfully'
      });
    } else {
      // If API failed, still clear local data
      await subAccount.update({
        ghlAccessToken: null,
        ghlRefreshToken: null,
        ghlTokenExpiresAt: null,
        ghlLocationId: null,
        ghlConnected: false
      });

      res.json({
        success: true,
        message: 'GHL API failed but local data cleared',
        apiError: result.error
      });
    }
  } catch (error) {
    logger.error('Embed GHL uninstall error:', error);
    res.status(500).json({ error: 'Failed to uninstall GHL' });
  }
});

// Render QR code page HTML
function renderQRPage(subAccount, status, token) {
  const isConnected = status.status === 'connected';
  const hasQR = status.hasQR && status.qrCode;
  const isConnecting = status.status === 'connecting' || status.status === 'qr_ready';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WhatsApp Connection - ${subAccount.name || 'WAGHL'}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: linear-gradient(135deg, #0f766e 0%, #134e4a 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      padding: 40px;
      max-width: 450px;
      width: 100%;
      text-align: center;
    }
    .logo {
      width: 60px;
      height: 60px;
      background: #0f766e;
      border-radius: 12px;
      margin: 0 auto 20px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .logo svg { width: 36px; height: 36px; fill: white; }
    h1 {
      color: #1f2937;
      font-size: 24px;
      margin-bottom: 8px;
    }
    .subtitle {
      color: #6b7280;
      font-size: 14px;
      margin-bottom: 24px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 24px;
    }
    .status-connected {
      background: #d1fae5;
      color: #065f46;
    }
    .status-disconnected {
      background: #fee2e2;
      color: #991b1b;
    }
    .status-connecting {
      background: #fef3c7;
      color: #92400e;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .status-connected .status-dot { background: #10b981; }
    .status-disconnected .status-dot { background: #ef4444; }
    .status-connecting .status-dot { background: #f59e0b; animation: pulse 1.5s infinite; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .phone-number {
      font-size: 18px;
      font-weight: 600;
      color: #0f766e;
      margin-bottom: 16px;
    }
    .qr-container {
      background: #f9fafb;
      border: 2px dashed #d1d5db;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .qr-code {
      max-width: 256px;
      width: 100%;
      height: auto;
      border-radius: 8px;
    }
    .qr-instructions {
      color: #6b7280;
      font-size: 13px;
      margin-top: 12px;
      line-height: 1.5;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
      width: 100%;
    }
    .btn-primary {
      background: #0f766e;
      color: white;
    }
    .btn-primary:hover { background: #0d655e; }
    .btn-primary:disabled {
      background: #9ca3af;
      cursor: not-allowed;
    }
    .btn-danger {
      background: #fee2e2;
      color: #991b1b;
    }
    .btn-danger:hover { background: #fecaca; }
    .btn-secondary {
      background: #f3f4f6;
      color: #374151;
    }
    .btn-secondary:hover { background: #e5e7eb; }
    .spinner {
      width: 20px;
      height: 20px;
      border: 2px solid transparent;
      border-top-color: currentColor;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .info-box {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 8px;
      padding: 12px;
      margin-top: 16px;
      text-align: left;
    }
    .info-box p {
      color: #1e40af;
      font-size: 12px;
      line-height: 1.5;
    }
    .connected-info {
      background: #f0fdf4;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
    }
    .connected-info svg {
      width: 48px;
      height: 48px;
      fill: #22c55e;
      margin-bottom: 12px;
    }
    .actions {
      display: flex;
      gap: 12px;
      margin-top: 16px;
    }
    .actions .btn { flex: 1; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
      </svg>
    </div>

    <h1>WhatsApp Connection</h1>
    <p class="subtitle">${subAccount.name || 'Sub-Account'}</p>

    <div id="content">
      ${isConnected ? renderConnectedState(status) : ''}
      ${hasQR ? renderQRState(status) : ''}
      ${!isConnected && !hasQR && !isConnecting ? renderDisconnectedState() : ''}
      ${isConnecting && !hasQR ? renderConnectingState() : ''}
    </div>
  </div>

  <script>
    const token = '${token}';
    const apiBase = '${process.env.API_URL || ''}';

    async function connect() {
      const btn = document.getElementById('connectBtn');
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div> Connecting...';

      try {
        const res = await fetch(apiBase + '/api/embed/connect/' + token, { method: 'POST' });
        const data = await res.json();

        if (res.ok) {
          // Start polling for QR code
          pollStatus();
        } else {
          alert(data.error || 'Failed to connect');
          btn.disabled = false;
          btn.innerHTML = 'Connect WhatsApp';
        }
      } catch (err) {
        alert('Connection failed');
        btn.disabled = false;
        btn.innerHTML = 'Connect WhatsApp';
      }
    }

    async function disconnect() {
      if (!confirm('Are you sure you want to disconnect WhatsApp?')) return;

      try {
        const res = await fetch(apiBase + '/api/embed/disconnect/' + token, { method: 'POST' });
        if (res.ok) {
          location.reload();
        } else {
          alert('Failed to disconnect');
        }
      } catch (err) {
        alert('Disconnect failed');
      }
    }

    async function pollStatus() {
      try {
        const res = await fetch(apiBase + '/api/embed/status/' + token);
        const data = await res.json();

        if (data.status === 'connected') {
          location.reload();
        } else if (data.hasQR && data.qrCode) {
          document.getElementById('content').innerHTML = \`
            <div class="qr-container">
              <img src="\${data.qrCode}" alt="QR Code" class="qr-code" />
              <p class="qr-instructions">
                Open WhatsApp on your phone<br>
                Go to Settings > Linked Devices > Link a Device<br>
                Scan this QR code
              </p>
            </div>
            <button class="btn btn-secondary" onclick="location.reload()">
              Refresh
            </button>
          \`;
          // Continue polling
          setTimeout(pollStatus, 3000);
        } else {
          // Continue polling
          setTimeout(pollStatus, 2000);
        }
      } catch (err) {
        setTimeout(pollStatus, 3000);
      }
    }

    // Auto-refresh for QR code page
    ${hasQR ? 'setTimeout(pollStatus, 3000);' : ''}
  </script>
</body>
</html>
  `;
}

function renderConnectedState(status) {
  return `
    <div class="connected-info">
      <svg viewBox="0 0 24 24">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm-1.25 17.292l-4.5-4.364 1.857-1.858 2.643 2.506 5.643-5.784 1.857 1.858-7.5 7.642z"/>
      </svg>
      <span class="status-badge status-connected">
        <span class="status-dot"></span>
        Connected
      </span>
      <p class="phone-number">+${status.phoneNumber || 'Unknown'}</p>
    </div>
    <p style="color: #6b7280; margin-bottom: 16px;">
      Your WhatsApp is connected and ready to send messages.
    </p>
    <button class="btn btn-danger" onclick="disconnect()">
      Disconnect WhatsApp
    </button>
  `;
}

function renderQRState(status) {
  return `
    <span class="status-badge status-connecting">
      <span class="status-dot"></span>
      Waiting for scan
    </span>
    <div class="qr-container">
      <img src="${status.qrCode}" alt="QR Code" class="qr-code" />
      <p class="qr-instructions">
        Open WhatsApp on your phone<br>
        Go to <strong>Settings > Linked Devices > Link a Device</strong><br>
        Scan this QR code
      </p>
    </div>
    <button class="btn btn-secondary" onclick="location.reload()">
      Refresh
    </button>
    <div class="info-box">
      <p><strong>Note:</strong> QR code expires after 60 seconds. Click Refresh if it expires.</p>
    </div>
  `;
}

function renderDisconnectedState() {
  return `
    <span class="status-badge status-disconnected">
      <span class="status-dot"></span>
      Disconnected
    </span>
    <p style="color: #6b7280; margin-bottom: 24px;">
      Connect your WhatsApp to start sending messages through GoHighLevel.
    </p>
    <button id="connectBtn" class="btn btn-primary" onclick="connect()">
      Connect WhatsApp
    </button>
    <div class="info-box">
      <p><strong>How it works:</strong> After clicking connect, a QR code will appear. Scan it with your WhatsApp to link your account.</p>
    </div>
  `;
}

function renderConnectingState() {
  return `
    <span class="status-badge status-connecting">
      <span class="status-dot"></span>
      Connecting...
    </span>
    <div class="qr-container">
      <div class="spinner" style="width: 48px; height: 48px; margin: 40px auto; border-width: 4px; color: #0f766e;"></div>
      <p class="qr-instructions">Generating QR code...</p>
    </div>
  `;
}

function renderErrorPage(message) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error - WAGHL</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #fee2e2;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .error-box {
      background: white;
      border-radius: 12px;
      padding: 40px;
      text-align: center;
      max-width: 400px;
    }
    h1 { color: #991b1b; margin-bottom: 12px; }
    p { color: #6b7280; }
  </style>
</head>
<body>
  <div class="error-box">
    <h1>Error</h1>
    <p>${message}</p>
  </div>
</body>
</html>
  `;
}

// Get GHL locations with app installed (for location picker)
// SECURITY: If locationId query param is provided, only return that specific location
// This ensures users can only access their own location from GHL
router.get('/locations', async (req, res) => {
  try {
    const { locationId } = req.query;

    // Build query - only return sub-accounts with valid ghlLocationId
    const where = {
      ghlLocationId: { [require('sequelize').Op.and]: [
        { [require('sequelize').Op.ne]: null },
        { [require('sequelize').Op.ne]: '' }
      ]},
      isActive: true
    };

    // SECURITY: If locationId provided, filter to only that location
    if (locationId && locationId !== '{{location.id}}' && !locationId.includes('location.id')) {
      where.ghlLocationId = locationId;
    }

    const subAccounts = await SubAccount.findAll({
      where,
      attributes: ['id', 'name', 'ghlLocationId', 'ghlConnected'],
      order: [['name', 'ASC']]
    });

    const locations = subAccounts.map(sa => ({
      id: sa.ghlLocationId,
      name: sa.name || `Location ${sa.ghlLocationId.substring(0, 8)}`,
      subAccountId: sa.id,
      ghlConnected: sa.ghlConnected || false
    }));

    res.json({
      success: true,
      locations,
      count: locations.length,
      filtered: !!locationId
    });
  } catch (error) {
    logger.error('Get locations error:', error);
    res.status(500).json({ error: 'Failed to get locations' });
  }
});

// Decrypt GHL user data (from REQUEST_USER_DATA postMessage)
// Requires GHL_SHARED_SECRET in .env
router.post('/decrypt-ghl', async (req, res) => {
  try {
    const { encryptedData } = req.body;

    if (!encryptedData) {
      return res.status(400).json({ error: 'Encrypted data required' });
    }

    const sharedSecret = process.env.GHL_SHARED_SECRET;
    if (!sharedSecret) {
      logger.warn('GHL_SHARED_SECRET not configured - cannot decrypt user data');
      return res.status(500).json({ error: 'Shared secret not configured' });
    }

    // Decrypt using AES (CryptoJS compatible)
    const CryptoJS = require('crypto-js');
    const decrypted = CryptoJS.AES.decrypt(encryptedData, sharedSecret).toString(CryptoJS.enc.Utf8);

    if (!decrypted) {
      return res.status(400).json({ error: 'Decryption failed - invalid data or secret' });
    }

    const userData = JSON.parse(decrypted);
    logger.info('Decrypted GHL user data:', { userId: userData.userId, activeLocation: userData.activeLocation });

    // Return the decrypted data (including activeLocation which is the locationId)
    res.json({
      success: true,
      userId: userData.userId,
      companyId: userData.companyId,
      activeLocation: userData.activeLocation,
      role: userData.role,
      email: userData.email
    });
  } catch (error) {
    logger.error('GHL decrypt error:', error.message);
    res.status(500).json({ error: 'Decryption failed' });
  }
});

// Export router and helper functions
router.setToken = setToken;
router.generateToken = generateToken;

module.exports = router;
