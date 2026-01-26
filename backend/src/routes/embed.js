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

    // Build embed URL
    const backendUrl = process.env.API_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
    const embedUrl = `${backendUrl}/api/embed/qr/${token}`;

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
router.get('/qr/:token', async (req, res) => {
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

// API endpoint to get status (for AJAX refresh)
router.get('/status/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const subAccountId = await verifyTokenWithFallback(token);
    if (!subAccountId) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const status = await whatsappService.getStatus(subAccountId);
    res.json(status);
  } catch (error) {
    logger.error('Embed status error:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// Connect WhatsApp (for embed page)
router.post('/connect/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const subAccountId = await verifyTokenWithFallback(token);
    if (!subAccountId) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const subAccount = await SubAccount.findByPk(subAccountId);
    if (!subAccount) {
      return res.status(404).json({ error: 'Sub-account not found' });
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
router.post('/disconnect/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const subAccountId = await verifyTokenWithFallback(token);
    if (!subAccountId) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const result = await whatsappService.disconnect(subAccountId);
    res.json(result);
  } catch (error) {
    logger.error('Embed disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
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

// Export router and helper functions
router.setToken = setToken;
router.generateToken = generateToken;

module.exports = router;
