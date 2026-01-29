const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { SubAccount, Message, Customer } = require('../models');
const webhookService = require('./webhook');
const ghlService = require('./ghl');
const emailService = require('./email');
const logger = require('../utils/logger');

// Baileys will be loaded dynamically
let makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion;

// Store active connections
const connections = new Map();
const qrCodes = new Map();

const SESSION_PATH = process.env.SESSION_PATH || './sessions';

// Ensure sessions directory exists
if (!fs.existsSync(SESSION_PATH)) {
  fs.mkdirSync(SESSION_PATH, { recursive: true });
}

// Initialize Baileys (ESM module)
async function initBaileys() {
  if (!makeWASocket) {
    const baileys = await import('@whiskeysockets/baileys');
    // Handle different export structures - direct export takes priority
    makeWASocket = baileys.makeWASocket || baileys.default?.makeWASocket;
    DisconnectReason = baileys.DisconnectReason || baileys.default?.DisconnectReason;
    useMultiFileAuthState = baileys.useMultiFileAuthState || baileys.default?.useMultiFileAuthState;
    fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion || baileys.default?.fetchLatestBaileysVersion;
  }
}

class WhatsAppService {
  // Initialize connection for a sub-account
  async connect(subAccountId) {
    try {
      // Ensure Baileys is loaded
      await initBaileys();

      const subAccount = await SubAccount.findByPk(subAccountId);
      if (!subAccount) {
        throw new Error('Sub-account not found');
      }

      if (!subAccount.isActive) {
        throw new Error('Sub-account is inactive');
      }

      // Check if already connected
      if (connections.has(subAccountId)) {
        const existingSocket = connections.get(subAccountId);
        if (existingSocket.user) {
          return { status: 'already_connected', phoneNumber: existingSocket.user.id };
        }
      }

      const sessionDir = path.join(SESSION_PATH, subAccountId);
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
      const { version } = await fetchLatestBaileysVersion();

      const pino = require('pino');
      const socket = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['GHLWA Connector', 'Chrome', '120.0.0'],
        connectTimeoutMs: 60000,
        qrTimeout: 60000
      });

      // Handle connection updates
      socket.ev.on('connection.update', async (update) => {
        await this.handleConnectionUpdate(subAccountId, socket, update, saveCreds);
      });

      // Handle credentials update
      socket.ev.on('creds.update', saveCreds);

      // Handle incoming messages
      socket.ev.on('messages.upsert', async (m) => {
        await this.handleIncomingMessages(subAccountId, m);
      });

      // Store connection
      connections.set(subAccountId, socket);

      // Update status
      await subAccount.update({ status: 'connecting' });

      return { status: 'connecting', message: 'Initializing connection...' };
    } catch (error) {
      logger.error(`WhatsApp connect error for ${subAccountId}:`, error);
      throw error;
    }
  }

  // Handle connection updates
  async handleConnectionUpdate(subAccountId, socket, update, saveCreds) {
    const { connection, lastDisconnect, qr } = update;

    try {
      const subAccount = await SubAccount.findByPk(subAccountId);
      if (!subAccount) return;

      // Handle QR code
      if (qr) {
        const qrDataUrl = await QRCode.toDataURL(qr);
        qrCodes.set(subAccountId, qrDataUrl);
        await subAccount.update({ status: 'qr_ready' });

        logger.info(`QR code generated for ${subAccountId}`);

        // Trigger webhook
        await webhookService.trigger(subAccountId, 'connection.qr', { qrCode: qrDataUrl });
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error instanceof Boom)
          ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
          : true;

        logger.info(`Connection closed for ${subAccountId}, reconnect: ${shouldReconnect}`);

        // Clear QR code
        qrCodes.delete(subAccountId);

        if (shouldReconnect) {
          await subAccount.update({ status: 'disconnected' });
          // Attempt reconnect after delay
          setTimeout(() => this.connect(subAccountId), 5000);
        } else {
          // Logged out - clear session
          await this.clearSession(subAccountId);
          await subAccount.update({
            status: 'disconnected',
            phoneNumber: null,
            sessionData: null
          });
        }

        // Remove from connections
        connections.delete(subAccountId);

        // Trigger webhook
        await webhookService.trigger(subAccountId, 'connection.status', {
          status: 'disconnected',
          reason: lastDisconnect?.error?.message || 'unknown'
        });

        // Send disconnection email (async)
        try {
          const customer = await Customer.findByPk(subAccount.customerId);
          if (customer) {
            emailService.sendWhatsAppDisconnected(
              customer.email,
              customer.name,
              subAccount.phoneNumber,
              subAccount.name,
              lastDisconnect?.error?.message || 'Connection lost'
            ).catch(err => logger.error('Failed to send WhatsApp disconnected email:', err));
          }
        } catch (emailErr) {
          logger.error('Error sending WhatsApp disconnected email:', emailErr);
        }

      } else if (connection === 'open') {
        const phoneNumber = socket.user?.id?.split(':')[0] || null;

        await subAccount.update({
          status: 'connected',
          phoneNumber,
          lastConnected: new Date()
        });

        // Clear QR code
        qrCodes.delete(subAccountId);

        logger.info(`Connected successfully for ${subAccountId}: ${phoneNumber}`);

        // Trigger webhook
        await webhookService.trigger(subAccountId, 'connection.status', {
          status: 'connected',
          phoneNumber
        });

        // Send email notification (async)
        try {
          const customer = await Customer.findByPk(subAccount.customerId);
          if (customer) {
            emailService.sendWhatsAppConnected(
              customer.email,
              customer.name,
              phoneNumber,
              subAccount.name
            ).catch(err => logger.error('Failed to send WhatsApp connected email:', err));
          }
        } catch (emailErr) {
          logger.error('Error sending WhatsApp connected email:', emailErr);
        }
      }
    } catch (error) {
      logger.error(`Handle connection update error for ${subAccountId}:`, error);
    }
  }

  // Handle incoming messages
  async handleIncomingMessages(subAccountId, { messages, type }) {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        // Skip status messages and own messages
        if (msg.key.remoteJid === 'status@broadcast') continue;
        if (msg.key.fromMe) continue;

        const fromNumber = msg.key.remoteJid.split('@')[0];
        const subAccount = await SubAccount.findByPk(subAccountId);

        if (!subAccount) continue;

        // Determine message type and content
        let messageType = 'text';
        let content = '';
        let mediaUrl = null;

        if (msg.message?.conversation) {
          content = msg.message.conversation;
        } else if (msg.message?.extendedTextMessage?.text) {
          content = msg.message.extendedTextMessage.text;
        } else if (msg.message?.imageMessage) {
          messageType = 'image';
          content = msg.message.imageMessage.caption || '';
        } else if (msg.message?.documentMessage) {
          messageType = 'document';
          content = msg.message.documentMessage.fileName || '';
        } else if (msg.message?.audioMessage) {
          messageType = 'audio';
        } else if (msg.message?.videoMessage) {
          messageType = 'video';
          content = msg.message.videoMessage.caption || '';
        }

        // Store message
        const message = await Message.create({
          subAccountId,
          messageId: msg.key.id,
          direction: 'inbound',
          fromNumber,
          toNumber: subAccount.phoneNumber || '',
          messageType,
          content,
          mediaUrl,
          status: 'delivered',
          metadata: { rawMessage: msg }
        });

        logger.info(`Received message for ${subAccountId} from ${fromNumber}`);

        // Trigger webhook
        await webhookService.trigger(subAccountId, 'message.received', {
          messageId: message.id,
          from: fromNumber,
          type: messageType,
          content,
          timestamp: new Date().toISOString()
        });

        // Sync to GHL (async, don't wait)
        ghlService.syncMessageToGHL(
          subAccount,
          fromNumber,
          subAccount.phoneNumber || '',
          content,
          'inbound'
        ).catch(err => logger.error('GHL sync error:', err));

      } catch (error) {
        logger.error(`Handle incoming message error:`, error);
      }
    }
  }

  // Send message (text or media)
  async sendMessage(subAccountId, toNumber, content, messageType = 'text', mediaUrl = null, fileName = null) {
    let subAccount = null;

    try {
      const socket = connections.get(subAccountId);
      if (!socket) {
        throw new Error('Not connected. Please scan QR code first.');
      }

      subAccount = await SubAccount.findByPk(subAccountId);
      if (!subAccount || subAccount.status !== 'connected') {
        throw new Error('Sub-account is not connected');
      }

      // Format number
      const jid = toNumber.includes('@') ? toNumber : `${toNumber.replace(/\D/g, '')}@s.whatsapp.net`;

      let sentMessage;

      if (messageType === 'text') {
        sentMessage = await socket.sendMessage(jid, { text: content });
      } else if (messageType === 'image') {
        // Send image - content can be URL or base64
        const imageMessage = {
          image: mediaUrl ? { url: mediaUrl } : Buffer.from(content, 'base64'),
          caption: fileName || ''
        };
        sentMessage = await socket.sendMessage(jid, imageMessage);
      } else if (messageType === 'document') {
        // Send document (PDF, etc)
        const documentMessage = {
          document: mediaUrl ? { url: mediaUrl } : Buffer.from(content, 'base64'),
          mimetype: this.getMimeType(fileName || 'document.pdf'),
          fileName: fileName || 'document.pdf'
        };
        sentMessage = await socket.sendMessage(jid, documentMessage);
      } else if (messageType === 'audio') {
        // Send audio
        const audioMessage = {
          audio: mediaUrl ? { url: mediaUrl } : Buffer.from(content, 'base64'),
          mimetype: 'audio/mpeg'
        };
        sentMessage = await socket.sendMessage(jid, audioMessage);
      } else if (messageType === 'video') {
        // Send video
        const videoMessage = {
          video: mediaUrl ? { url: mediaUrl } : Buffer.from(content, 'base64'),
          caption: fileName || ''
        };
        sentMessage = await socket.sendMessage(jid, videoMessage);
      } else {
        throw new Error(`Unsupported message type: ${messageType}`);
      }

      // Store message
      const message = await Message.create({
        subAccountId,
        messageId: sentMessage?.key?.id,
        direction: 'outbound',
        fromNumber: subAccount.phoneNumber || '',
        toNumber: toNumber.replace(/\D/g, ''),
        messageType,
        content,
        status: 'sent'
      });

      logger.info(`Sent message from ${subAccountId} to ${toNumber}`);

      // Trigger webhook
      await webhookService.trigger(subAccountId, 'message.sent', {
        messageId: message.id,
        to: toNumber,
        type: messageType,
        content,
        timestamp: new Date().toISOString()
      });

      // Sync to GHL (async, don't wait)
      ghlService.syncMessageToGHL(
        subAccount,
        subAccount.phoneNumber || '',
        toNumber.replace(/\D/g, ''),
        content,
        'outbound'
      ).catch(err => logger.error('GHL sync error:', err));

      return message;

    } catch (error) {
      logger.error(`Send message error for ${subAccountId}:`, error);

      // Send email notification about failed message delivery
      try {
        if (!subAccount) {
          subAccount = await SubAccount.findByPk(subAccountId);
        }
        if (subAccount) {
          const customer = await Customer.findByPk(subAccount.customerId);
          if (customer) {
            emailService.sendMessageDeliveryFailed(
              customer.email,
              customer.name,
              subAccount.name,
              toNumber,
              error.message,
              messageType === 'text' ? content : null
            ).catch(err => logger.error('Failed to send message delivery failed email:', err));
          }
        }
      } catch (emailErr) {
        logger.error('Error sending message delivery failed email:', emailErr);
      }

      throw error;
    }
  }

  // Get QR code
  getQRCode(subAccountId) {
    return qrCodes.get(subAccountId) || null;
  }

  // Get connection status
  async getStatus(subAccountId) {
    const subAccount = await SubAccount.findByPk(subAccountId);
    if (!subAccount) {
      throw new Error('Sub-account not found');
    }

    const socket = connections.get(subAccountId);
    const qrCode = qrCodes.get(subAccountId);

    return {
      status: subAccount.status,
      phoneNumber: subAccount.phoneNumber,
      isConnected: socket?.user ? true : false,
      hasQR: !!qrCode,
      qrCode: qrCode || null,
      lastConnected: subAccount.lastConnected
    };
  }

  // Disconnect
  async disconnect(subAccountId) {
    try {
      const socket = connections.get(subAccountId);
      if (socket) {
        await socket.logout();
        socket.end();
      }

      connections.delete(subAccountId);
      qrCodes.delete(subAccountId);

      const subAccount = await SubAccount.findByPk(subAccountId);
      if (subAccount) {
        await subAccount.update({ status: 'disconnected' });
      }

      // Clear session files
      await this.clearSession(subAccountId);

      return { status: 'disconnected' };
    } catch (error) {
      logger.error(`Disconnect error for ${subAccountId}:`, error);
      throw error;
    }
  }

  // Clear session files
  async clearSession(subAccountId) {
    const sessionDir = path.join(SESSION_PATH, subAccountId);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  }

  // Restore sessions on server start
  async restoreSessions() {
    try {
      // Ensure Baileys is loaded
      await initBaileys();

      const subAccounts = await SubAccount.findAll({
        where: { status: 'connected' }
      });

      logger.info(`Restoring ${subAccounts.length} sessions...`);

      for (const subAccount of subAccounts) {
        const sessionDir = path.join(SESSION_PATH, subAccount.id);
        if (fs.existsSync(sessionDir)) {
          logger.info(`Restoring session for ${subAccount.id}`);
          await this.connect(subAccount.id);
        }
      }
    } catch (error) {
      logger.error('Restore sessions error:', error);
    }
  }

  // Helper: Get MIME type from filename
  getMimeType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const mimeTypes = {
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'mp3': 'audio/mpeg',
      'mp4': 'video/mp4',
      'txt': 'text/plain',
      'zip': 'application/zip'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}

module.exports = new WhatsAppService();
