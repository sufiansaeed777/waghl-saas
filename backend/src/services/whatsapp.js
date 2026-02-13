const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { SubAccount, Message, Customer, WhatsAppMapping } = require('../models');
const webhookService = require('./webhook');
const ghlService = require('./ghl');
const messageQueue = require('./messageQueue');
const emailService = require('./email');
const logger = require('../utils/logger');

// Baileys will be loaded dynamically
let makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore;

// Store active connections
const connections = new Map();
const qrCodes = new Map();  // Stores { qrCode, timestamp } for each subAccountId

// Message retry counter cache - tracks retry attempts per message
// This is CRITICAL for handling decryption failures (Bad MAC errors)
const msgRetryCounterCache = new Map();

// Track phones with pending sends from our sendMessage function
// Marked BEFORE socket.sendMessage so messages.upsert handler can detect GHL-originated outbound
// Key: "subAccountId:phone" -> timestamp
const pendingSends = new Map();
const PENDING_SEND_TTL_MS = 30000; // 30 seconds

// In-memory message store for getMessage callback
// Stores recent messages so Baileys can retry decryption
const messageStore = new Map();

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
    makeCacheableSignalKeyStore = baileys.makeCacheableSignalKeyStore || baileys.default?.makeCacheableSignalKeyStore;
  }
}

// Helper to store message in memory for getMessage callback
function storeMessage(subAccountId, msg) {
  if (!msg?.key?.id) return;

  const storeKey = `${subAccountId}:${msg.key.remoteJid}:${msg.key.id}`;
  messageStore.set(storeKey, msg);

  // Clean up old messages after 10 minutes to prevent memory leak
  setTimeout(() => {
    messageStore.delete(storeKey);
  }, 10 * 60 * 1000);
}

// Helper to get message from store (for retry mechanism)
function getStoredMessage(subAccountId, key) {
  const storeKey = `${subAccountId}:${key.remoteJid}:${key.id}`;
  const msg = messageStore.get(storeKey);
  return msg?.message || undefined;
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

      // Create socket with message retry support to handle Bad MAC decryption errors
      const socket = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          // Use cacheable signal key store for better key handling
          keys: makeCacheableSignalKeyStore ? makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })) : state.keys
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['GHLWA Connector', 'Chrome', '120.0.0'],
        connectTimeoutMs: 60000,
        qrTimeout: 60000,
        // CRITICAL: Message retry counter cache - enables automatic retry on decryption failure
        msgRetryCounterCache,
        // getMessage callback - called when Baileys needs to retry decrypting a message
        // This is essential for handling "Bad MAC" errors
        getMessage: async (key) => {
          const msg = getStoredMessage(subAccountId, key);
          if (msg) {
            logger.info('getMessage: Found stored message for retry', { id: key.id });
            return msg;
          }
          // If not in memory, try to load from database
          try {
            const dbMessage = await Message.findOne({
              where: { subAccountId, messageId: key.id }
            });
            if (dbMessage?.metadata?.rawMessage?.message) {
              logger.info('getMessage: Found message in database for retry', { id: key.id });
              return dbMessage.metadata.rawMessage.message;
            }
          } catch (err) {
            logger.warn('getMessage: Error loading from database', { error: err.message });
          }
          logger.warn('getMessage: Message not found for retry', { id: key.id });
          return undefined;
        },
        // Retry message requests - when decryption fails, request resend
        retryRequestDelayMs: 250,
        markOnlineOnConnect: true
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

      // Handle message updates (can contain decrypted content after retry)
      socket.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
          if (update.update?.message) {
            // Message was updated with decrypted content (retry succeeded)
            logger.info('Message updated with decrypted content:', {
              messageId: update.key?.id,
              remoteJid: update.key?.remoteJid,
              subAccountId
            });
            // Process as a new message with the decrypted content
            const msg = {
              key: update.key,
              message: update.update.message,
              pushName: update.update.pushName
            };
            await this.handleIncomingMessages(subAccountId, { messages: [msg], type: 'notify' });
          }
        }
      });

      // Handle LID mapping updates (Baileys v6.6.0+/v7.x feature)
      // This event provides LID → phone number mappings when WhatsApp syncs them
      socket.ev.on('lid-mapping.update', async (mapping) => {
        try {
          logger.info('LID mapping update received:', mapping);
          // mapping format: { lid: string, phoneNumber: string }
          if (mapping?.lid && mapping?.phoneNumber) {
            const cleanPhone = mapping.phoneNumber.replace(/\D/g, '');
            const lid = mapping.lid.split('@')[0];
            if (/^[1-9]\d{9,14}$/.test(cleanPhone)) {
              await WhatsAppMapping.upsert({
                subAccountId,
                phoneNumber: cleanPhone,
                whatsappId: lid,
                lastActivityAt: new Date()
              }, { conflictFields: ['subAccountId', 'phoneNumber'] });
              logger.info('Stored LID mapping from WhatsApp sync:', {
                phoneNumber: cleanPhone,
                lid
              });
            }
          }
        } catch (lidErr) {
          logger.warn('Error processing LID mapping update:', lidErr.message);
        }
      });

      // Handle contacts sync - capture phone-to-LID mappings
      socket.ev.on('contacts.upsert', async (contacts) => {
        for (const contact of contacts) {
          try {
            const jid = contact.id;
            if (!jid) continue;

            // Check if this is a phone-based JID (contains phone number)
            const isPhoneJid = jid.includes('@s.whatsapp.net');
            const isLidJid = jid.includes('@lid');

            if (isPhoneJid) {
              const phoneNumber = jid.split('@')[0];
              // Store contact info for potential LID resolution later
              logger.debug('Contact sync (phone-based):', {
                phone: phoneNumber,
                name: contact.name || contact.notify,
                verifiedName: contact.verifiedName
              });
            } else if (isLidJid) {
              // LID-based contact - check if we have any phone info
              const lid = jid.split('@')[0];
              logger.debug('Contact sync (LID-based):', {
                lid,
                name: contact.name || contact.notify,
                verifiedName: contact.verifiedName,
                // Check for any phone fields
                phone: contact.phone || contact.number
              });

              // If contact has a phone field (rare but possible)
              const contactPhone = contact.phone || contact.number;
              if (contactPhone) {
                const cleanPhone = contactPhone.replace(/\D/g, '');
                if (/^[1-9]\d{9,14}$/.test(cleanPhone)) {
                  await WhatsAppMapping.upsert({
                    subAccountId,
                    phoneNumber: cleanPhone,
                    whatsappId: lid,
                    contactName: contact.name || contact.notify || null,
                    lastActivityAt: new Date()
                  }, { conflictFields: ['subAccountId', 'phoneNumber'] });
                  logger.info('Stored LID mapping from contact sync:', {
                    phoneNumber: cleanPhone,
                    lid,
                    name: contact.name || contact.notify
                  });
                }
              }
            }
          } catch (contactErr) {
            logger.warn('Error processing contact sync:', contactErr.message);
          }
        }
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
        qrCodes.set(subAccountId, { qrCode: qrDataUrl, timestamp: Date.now() });
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

        // Only send disconnection email for permanent disconnects (not auto-reconnecting)
        if (!shouldReconnect) {
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
        }

      } else if (connection === 'open') {
        const phoneNumber = socket.user?.id?.split(':')[0] || null;

        // Check if this phone number is already connected to another sub-account
        if (phoneNumber) {
          const existingConnection = await SubAccount.findOne({
            where: {
              phoneNumber,
              id: { [require('sequelize').Op.ne]: subAccountId },
              status: 'connected'
            }
          });

          if (existingConnection) {
            logger.warn(`Phone ${phoneNumber} already connected to sub-account ${existingConnection.id}, rejecting connection for ${subAccountId}`);

            // Disconnect this session
            await this.clearSession(subAccountId);
            await subAccount.update({ status: 'disconnected' });
            connections.delete(subAccountId);
            qrCodes.delete(subAccountId);

            // Trigger webhook with error
            await webhookService.trigger(subAccountId, 'connection.status', {
              status: 'error',
              error: 'phone_already_connected',
              message: `This WhatsApp number (${phoneNumber}) is already connected to another sub-account`
            });
            return;
          }
        }

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

  // Handle incoming messages (and outbound messages sent directly from WhatsApp)
  async handleIncomingMessages(subAccountId, { messages, type }) {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        // Store message for potential retry (getMessage callback)
        storeMessage(subAccountId, msg);

        // Skip status messages
        if (msg.key.remoteJid === 'status@broadcast') continue;

        // Skip group messages - only sync private/direct messages to GHL
        if (msg.key.remoteJid.endsWith('@g.us')) continue;

        // Determine if this is an outbound message (sent from WhatsApp, not from GHL)
        const isFromMe = msg.key.fromMe;

        // Extract phone number from remoteJid
        // For inbound: remoteJid is the sender
        // For outbound (fromMe): remoteJid is the recipient
        const remoteJid = msg.key.remoteJid;
        const isLID = remoteJid.includes('@lid');
        let contactNumber = remoteJid.split('@')[0];

        // Log for debugging
        logger.info('Message received:', {
          remoteJid,
          isLID,
          isFromMe,
          extractedNumber: contactNumber,
          participant: msg.key.participant,
          pushName: msg.pushName,
          verifiedBizName: msg.verifiedBizName
        });

        // If it's a LID, try to get the real phone number
        if (isLID) {
          // Method 1: Check if participant contains real JID (group messages)
          if (msg.key.participant) {
            const participantNumber = msg.key.participant.split('@')[0];
            if (!participantNumber.includes('lid')) {
              contactNumber = participantNumber;
              logger.info('Using participant number instead of LID:', { contactNumber });
            }
          }

          // Method 2: Try Baileys' built-in LID mapping (v6.6.0+)
          if (contactNumber.includes('lid') || !/^[1-9]\d{9,14}$/.test(contactNumber)) {
            const socket = connections.get(subAccountId);
            if (socket && socket.signalRepository && socket.signalRepository.lidMapping) {
              try {
                const lidMapping = socket.signalRepository.lidMapping;
                // Try to get phone number from LID using Baileys internal store
                if (typeof lidMapping.getPNForLID === 'function') {
                  const phoneJid = await lidMapping.getPNForLID(remoteJid);
                  if (phoneJid) {
                    const resolvedNumber = phoneJid.split('@')[0];
                    if (/^[1-9]\d{9,14}$/.test(resolvedNumber)) {
                      contactNumber = resolvedNumber;
                      logger.info('Resolved LID via Baileys lidMapping:', { lid: remoteJid, phoneNumber: contactNumber });
                    }
                  }
                }
              } catch (lidError) {
                logger.warn('Baileys lidMapping lookup failed:', lidError.message);
              }
            }
          }
        }

        // Check if contactNumber is a valid phone number or a WhatsApp internal ID
        // Valid phone numbers are typically 10-15 digits and start with a country code (1-3 digits)
        // WhatsApp internal IDs are often 15+ digits or don't match phone patterns
        // Check if this looks like a valid phone number
        // BUT if isLID flag is set, we know it's a LID regardless of format
        const looksLikePhone = /^[1-9]\d{9,14}$/.test(contactNumber) && contactNumber.length <= 15;
        const isValidPhoneNumber = looksLikePhone && !isLID;
        let resolvedPhoneNumber = contactNumber;
        const pushName = msg.pushName || null;

        // For messages with LID (both inbound and outbound), try to resolve to real phone number
        // Also track contact name from mapping for outbound messages
        // IMPORTANT: For outbound (isFromMe), pushName is the SENDER's name, not the recipient
        // So we should NOT use pushName for outbound - only use mapping's contactName
        let resolvedContactName = isFromMe ? null : pushName;

        if (!isValidPhoneNumber || isLID) {
          logger.info('contactNumber appears to be WhatsApp internal ID, checking mapping:', { contactNumber, pushName, isFromMe });

          // Try to find existing mapping by WhatsApp ID
          let mapping = await WhatsAppMapping.findOne({
            where: { subAccountId, whatsappId: contactNumber }
          });

          if (mapping) {
            resolvedPhoneNumber = mapping.phoneNumber;
            // For outbound, only use mapping's contactName (pushName is sender's name)
            // For inbound, prefer pushName (recipient's actual WhatsApp name)
            resolvedContactName = isFromMe ? mapping.contactName : (pushName || mapping.contactName);
            logger.info('Found existing WhatsApp ID mapping:', {
              whatsappId: contactNumber,
              phoneNumber: resolvedPhoneNumber,
              contactName: resolvedContactName
            });
            // Update last activity - only update contactName for inbound (pushName is the contact's name)
            await mapping.update({
              lastActivityAt: new Date(),
              contactName: isFromMe ? mapping.contactName : (pushName || mapping.contactName)
            });
          } else {
            // No mapping found - try to safely match to a recent outbound
            // SAFETY: Only auto-match if there's EXACTLY ONE unmapped number from recent outbound
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

            // Find all unmapped phone numbers with recent activity
            const unmappedMappings = await WhatsAppMapping.findAll({
              where: {
                subAccountId,
                whatsappId: null,  // Phone number stored but no WhatsApp ID yet
                lastActivityAt: { [require('sequelize').Op.gte]: fiveMinutesAgo }
              }
            });

            if (unmappedMappings.length === 1) {
              // Safe to match - only one recent unmapped number
              const unmappedMapping = unmappedMappings[0];
              // Only update contactName with pushName for inbound (pushName is the contact's name)
              await unmappedMapping.update({
                whatsappId: contactNumber,
                contactName: isFromMe ? unmappedMapping.contactName : (pushName || unmappedMapping.contactName),
                lastActivityAt: new Date()
              });
              resolvedPhoneNumber = unmappedMapping.phoneNumber;
              resolvedContactName = isFromMe ? unmappedMapping.contactName : (pushName || unmappedMapping.contactName);
              logger.info('Created WhatsApp ID mapping (single unmapped):', {
                whatsappId: contactNumber,
                phoneNumber: resolvedPhoneNumber,
                contactName: resolvedContactName
              });
            } else if (unmappedMappings.length > 1) {
              // Multiple unmapped numbers - too risky to auto-match
              logger.warn('Multiple unmapped phone numbers - cannot safely auto-match WhatsApp ID:', {
                contactNumber,
                pushName,
                unmappedCount: unmappedMappings.length
              });
              // Keep using the WhatsApp ID as-is
            } else {
              logger.warn('No recent unmapped phone number found for WhatsApp ID:', { contactNumber, pushName });
            }
          }
        }

        // Use resolvedPhoneNumber for GHL sync
        const phoneForSync = resolvedPhoneNumber;
        logger.info('Phone number for GHL sync:', { original: contactNumber, resolved: phoneForSync, pushName, isFromMe });

        const subAccount = await SubAccount.findByPk(subAccountId);

        if (!subAccount) continue;

        // Check for duplicate messages (avoid re-processing on reconnection or network issues)
        const existingMessage = await Message.findOne({
          where: {
            subAccountId,
            messageId: msg.key.id
          }
        });
        if (existingMessage) {
          logger.info('Skipping duplicate message (already processed):', {
            messageId: msg.key.id,
            direction: isFromMe ? 'outbound' : 'inbound'
          });
          continue;
        }

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
          content = msg.message.imageMessage.caption || '[Image]';
        } else if (msg.message?.documentMessage) {
          messageType = 'document';
          content = msg.message.documentMessage.fileName || '[Document]';
        } else if (msg.message?.audioMessage) {
          messageType = 'audio';
          content = '[Voice message]';
        } else if (msg.message?.videoMessage) {
          messageType = 'video';
          content = msg.message.videoMessage.caption || '[Video]';
        } else if (msg.message?.stickerMessage) {
          messageType = 'text';
          content = '[Sticker]';
        } else if (msg.message?.contactMessage) {
          messageType = 'text';
          content = msg.message.contactMessage.displayName || '[Contact]';
        } else if (msg.message?.locationMessage) {
          messageType = 'text';
          content = '[Location shared]';
        } else if (msg.message?.reactionMessage) {
          // Skip reactions - they don't need to be synced as separate messages
          logger.info('Skipping reaction message');
          continue;
        } else if (msg.message?.protocolMessage || msg.message?.senderKeyDistributionMessage) {
          // Skip protocol/system messages
          continue;
        } else if (!msg.message) {
          // Message decryption failed (Bad MAC error) - msg.message is null/undefined
          // This happens when Signal protocol decryption fails
          // The retry mechanism (msgRetryCounterCache + getMessage) should have already attempted retries
          logger.warn('Message decryption failed - message object is empty:', {
            messageId: msg.key?.id,
            remoteJid: msg.key?.remoteJid,
            isFromMe,
            subAccountId,
            hint: 'This usually indicates Signal session issues. Message retry was attempted.'
          });
          // Skip this message - don't sync "[Message]" placeholder to GHL
          // The message may arrive later if retry succeeds, or may be lost
          continue;
        } else {
          // Log unrecognized message types for debugging
          logger.warn('Unrecognized message type:', {
            messageKeys: Object.keys(msg.message),
            subAccountId
          });
          content = '[Message]';
        }

        // Store message
        const direction = isFromMe ? 'outbound' : 'inbound';
        const message = await Message.create({
          subAccountId,
          messageId: msg.key.id,
          direction,
          fromNumber: isFromMe ? (subAccount.phoneNumber || '') : contactNumber,
          toNumber: isFromMe ? contactNumber : (subAccount.phoneNumber || ''),
          messageType,
          content,
          mediaUrl,
          status: isFromMe ? 'sent' : 'delivered',
          metadata: { rawMessage: msg, source: isFromMe ? 'whatsapp_direct' : 'whatsapp' }
        });

        logger.info(`${isFromMe ? 'Sent' : 'Received'} message for ${subAccountId} ${isFromMe ? 'to' : 'from'} ${contactNumber} (resolved: ${phoneForSync})`);

        // Trigger webhook
        await webhookService.trigger(subAccountId, isFromMe ? 'message.sent' : 'message.received', {
          messageId: message.id,
          [isFromMe ? 'to' : 'from']: phoneForSync,  // Use resolved phone number
          type: messageType,
          content,
          timestamp: new Date().toISOString(),
          source: isFromMe ? 'whatsapp_direct' : 'whatsapp'
        });

        // Sync to GHL using resolved phone number (async, don't wait)
        // Pass pushName and isLID flag for name-based matching when phone number can't be resolved
        if (isFromMe) {
          // Check if this outbound was sent by our sendMessage function
          const cleanPhoneCheck = phoneForSync.replace(/\D/g, '');
          const pendingKey = `${subAccountId}:${cleanPhoneCheck}`;
          if (pendingSends.has(pendingKey)) {
            // Sent by our app (from GHL or API) - GHL already has it, skip sync
            logger.info('Skipping GHL sync for app-originated outbound:', {
              subAccountId, phone: phoneForSync
            });
          } else {
            // Sent from another device (WhatsApp phone/web/desktop) - sync to GHL
            logger.info('Syncing other-device outbound to GHL:', {
              subAccountId, phone: phoneForSync
            });
            ghlService.syncMessageToGHL(
              subAccount,
              subAccount.phoneNumber || '',   // from (our number)
              phoneForSync,                   // to (contact)
              content,
              'outbound'
            ).catch(err => logger.error('GHL sync error:', err));
          }
        } else {
          // Inbound message
          ghlService.syncMessageToGHL(
            subAccount,
            phoneForSync,                   // from (contact)
            subAccount.phoneNumber || '',   // to (our number)
            content,
            'inbound',
            pushName,  // Pass contact name for name-based matching fallback
            isLID      // Flag indicating this is a WhatsApp LID (not a real phone number)
          ).catch(err => logger.error('GHL sync error:', err));
        }

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

      // Clean the phone number
      const cleanPhone = toNumber.replace(/\D/g, '');

      // Query WhatsApp to check if number exists and get the correct JID
      // This is the most reliable way to get the LID mapping before sending
      let jid = toNumber.includes('@') ? toNumber : `${cleanPhone}@s.whatsapp.net`;
      let whatsappId = null;

      try {
        const [result] = await socket.onWhatsApp(cleanPhone);
        if (result?.exists) {
          jid = result.jid;
          // Extract the WhatsApp ID (could be LID or phone)
          whatsappId = result.jid.split('@')[0];
          logger.info('onWhatsApp query result:', {
            phone: cleanPhone,
            exists: result.exists,
            jid: result.jid,
            whatsappId
          });

          // Store the mapping immediately (phone → whatsappId)
          // This ensures we have the mapping BEFORE the message is sent
          if (whatsappId && whatsappId !== cleanPhone) {
            // WhatsApp returned a different ID (likely a LID)
            await WhatsAppMapping.upsert({
              subAccountId,
              phoneNumber: cleanPhone,
              whatsappId: whatsappId,
              lastActivityAt: new Date()
            }, {
              conflictFields: ['subAccountId', 'phoneNumber']
            });
            logger.info('Stored LID mapping from onWhatsApp:', {
              phoneNumber: cleanPhone,
              whatsappId
            });
          }
        } else {
          logger.warn('Phone number not found on WhatsApp:', { phone: cleanPhone });
        }
      } catch (onWhatsAppErr) {
        // onWhatsApp might fail - continue with default JID
        logger.warn('onWhatsApp query failed, using default JID:', {
          phone: cleanPhone,
          error: onWhatsAppErr.message
        });
      }

      // Mark this phone as pending send BEFORE socket.sendMessage
      // so messages.upsert handler knows this is from our app (not another device)
      const pendingKey = `${subAccountId}:${cleanPhone}`;
      pendingSends.set(pendingKey, Date.now());
      setTimeout(() => pendingSends.delete(pendingKey), PENDING_SEND_TTL_MS);

      let sentMessage;

      if (messageType === 'text') {
        if (!content) {
          throw new Error('Text message content is required');
        }
        sentMessage = await socket.sendMessage(jid, { text: content });
      } else if (messageType === 'image') {
        // Send image - prefer URL, fallback to base64
        if (!mediaUrl && !content) {
          throw new Error('Image URL or content is required');
        }
        const imageMessage = {
          image: mediaUrl ? { url: mediaUrl } : Buffer.from(content, 'base64'),
          caption: fileName || ''
        };
        logger.info('Sending image message:', { hasUrl: !!mediaUrl, hasContent: !!content, caption: fileName });
        sentMessage = await socket.sendMessage(jid, imageMessage);
      } else if (messageType === 'document') {
        // Send document (PDF, etc) - prefer URL
        if (!mediaUrl && !content) {
          throw new Error('Document URL or content is required');
        }
        const documentMessage = {
          document: mediaUrl ? { url: mediaUrl } : Buffer.from(content, 'base64'),
          mimetype: this.getMimeType(fileName || 'document.pdf'),
          fileName: fileName || 'document.pdf'
        };
        logger.info('Sending document message:', { hasUrl: !!mediaUrl, hasContent: !!content, fileName });
        sentMessage = await socket.sendMessage(jid, documentMessage);
      } else if (messageType === 'audio') {
        // Send audio - prefer URL
        if (!mediaUrl && !content) {
          throw new Error('Audio URL or content is required');
        }
        const audioMessage = {
          audio: mediaUrl ? { url: mediaUrl } : Buffer.from(content, 'base64'),
          mimetype: 'audio/mpeg'
        };
        logger.info('Sending audio message:', { hasUrl: !!mediaUrl, hasContent: !!content });
        sentMessage = await socket.sendMessage(jid, audioMessage);
      } else if (messageType === 'video') {
        // Send video - prefer URL
        if (!mediaUrl && !content) {
          throw new Error('Video URL or content is required');
        }
        const videoMessage = {
          video: mediaUrl ? { url: mediaUrl } : Buffer.from(content, 'base64'),
          caption: fileName || ''
        };
        logger.info('Sending video message:', { hasUrl: !!mediaUrl, hasContent: !!content, caption: fileName });
        sentMessage = await socket.sendMessage(jid, videoMessage);
      } else {
        throw new Error(`Unsupported message type: ${messageType}`);
      }

      // Store outgoing message for getMessage retry callback
      if (sentMessage) {
        storeMessage(subAccountId, sentMessage);
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

      // If onWhatsApp didn't return a LID (returned phone-based JID or failed),
      // ensure mapping exists for auto-match when LID response comes
      // BUT don't overwrite an existing valid whatsappId mapping!
      if (!whatsappId || whatsappId === cleanPhone) {
        try {
          // First check if a valid mapping already exists
          const existingMapping = await WhatsAppMapping.findOne({
            where: { subAccountId, phoneNumber: cleanPhone }
          });

          if (existingMapping && existingMapping.whatsappId && existingMapping.whatsappId !== cleanPhone) {
            // Valid mapping exists - just update activity, preserve whatsappId
            await existingMapping.update({ lastActivityAt: new Date() });
            logger.info('Preserved existing LID mapping, updated activity:', {
              phoneNumber: cleanPhone,
              whatsappId: existingMapping.whatsappId
            });
          } else {
            // No valid mapping - create/update with null whatsappId for auto-match
            await WhatsAppMapping.upsert({
              subAccountId,
              phoneNumber: cleanPhone,
              whatsappId: null,
              lastActivityAt: new Date()
            }, {
              conflictFields: ['subAccountId', 'phoneNumber']
            });
            logger.info('Created/updated fallback phone mapping (whatsappId cleared for auto-match):', {
              phoneNumber: cleanPhone
            });
          }
        } catch (mappingErr) {
          logger.warn('Failed to create fallback phone mapping:', mappingErr.message);
        }
      }

      // Trigger webhook
      await webhookService.trigger(subAccountId, 'message.sent', {
        messageId: message.id,
        to: toNumber,
        type: messageType,
        content,
        timestamp: new Date().toISOString()
      });

      // Do NOT sync outbound to GHL from sendMessage
      // Messages from GHL: GHL already has them (syncing back creates duplicates)
      // Messages from direct API: not critical for GHL conversation view

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
    const qrData = qrCodes.get(subAccountId);
    return qrData?.qrCode || null;
  }

  // Get connection status
  async getStatus(subAccountId) {
    const subAccount = await SubAccount.findByPk(subAccountId);
    if (!subAccount) {
      throw new Error('Sub-account not found');
    }

    const socket = connections.get(subAccountId);
    const qrData = qrCodes.get(subAccountId);  // Now stores { qrCode, timestamp }

    // Handle stale status after server restart
    // If DB shows qr_ready or connecting but no socket/qr in memory, reset to disconnected
    if ((subAccount.status === 'qr_ready' || subAccount.status === 'connecting') && !socket && !qrData) {
      logger.info(`Resetting stale status for ${subAccountId}: ${subAccount.status} -> disconnected`);
      await subAccount.update({ status: 'disconnected' });
      return {
        status: 'disconnected',
        phoneNumber: subAccount.phoneNumber,
        isConnected: false,
        hasQR: false,
        qrCode: null,
        qrTimestamp: null,
        lastConnected: subAccount.lastConnected
      };
    }

    return {
      status: subAccount.status,
      phoneNumber: subAccount.phoneNumber,
      isConnected: socket?.user ? true : false,
      hasQR: !!qrData,
      qrCode: qrData?.qrCode || null,
      qrTimestamp: qrData?.timestamp || null,  // Used by clients to detect QR changes
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
