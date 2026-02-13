const logger = require('../utils/logger');

const DELAY_BETWEEN_MESSAGES = 5000; // 5 seconds between messages
const MAX_ATTEMPTS = 3;

// In-memory queue per sub-account
const queues = new Map();
const processing = new Map();

// Track messages that originated from GHL webhooks to prevent feedback loops
// Key: "subAccountId:phoneNumber" -> timestamp
const ghlOriginMessages = new Map();
const GHL_ORIGIN_TTL_MS = 30000; // 30 seconds

class MessageQueueService {
  constructor() {
    this.whatsappService = null;
  }

  // Lazy load to avoid circular dependency
  getWhatsAppService() {
    if (!this.whatsappService) {
      this.whatsappService = require('./whatsapp');
    }
    return this.whatsappService;
  }

  // Add message to queue
  async queueMessage(subAccountId, toNumber, content, messageType = 'text', mediaUrl = null, fileName = null) {
    const message = {
      subAccountId,
      toNumber,
      content,
      messageType,
      mediaUrl,
      fileName,
      attempts: 0,
      queuedAt: new Date()
    };

    if (!queues.has(subAccountId)) {
      queues.set(subAccountId, []);
    }

    queues.get(subAccountId).push(message);

    logger.info(`Message queued for ${subAccountId} to ${toNumber}`, {
      queueLength: queues.get(subAccountId).length
    });

    // Mark this phone as GHL-originated to prevent feedback loop
    const cleanPhone = toNumber.replace(/\D/g, '');
    this.markGhlOrigin(subAccountId, cleanPhone);

    // Start processing if not already running
    this.startProcessing(subAccountId);
  }

  // Mark a phone number as having a recent GHL-originated message
  markGhlOrigin(subAccountId, phoneNumber) {
    const key = `${subAccountId}:${phoneNumber}`;
    ghlOriginMessages.set(key, Date.now());
    logger.info('markGhlOrigin:', { key, mapSize: ghlOriginMessages.size });
    // Auto-cleanup after TTL
    setTimeout(() => ghlOriginMessages.delete(key), GHL_ORIGIN_TTL_MS);
  }

  // Check if a phone number had a recent GHL-originated message
  isGhlOrigin(subAccountId, phoneNumber) {
    const key = `${subAccountId}:${phoneNumber}`;
    const timestamp = ghlOriginMessages.get(key);
    const result = timestamp && (Date.now() - timestamp <= GHL_ORIGIN_TTL_MS);
    logger.info('isGhlOrigin check:', { key, found: !!timestamp, ageMs: timestamp ? Date.now() - timestamp : null, result: !!result, mapSize: ghlOriginMessages.size });
    if (!timestamp) return false;
    if (Date.now() - timestamp > GHL_ORIGIN_TTL_MS) {
      ghlOriginMessages.delete(key);
      return false;
    }
    return true;
  }

  startProcessing(subAccountId) {
    if (processing.get(subAccountId)) return;
    processing.set(subAccountId, true);
    this.processNext(subAccountId);
  }

  async processNext(subAccountId) {
    const queue = queues.get(subAccountId);

    if (!queue || queue.length === 0) {
      processing.set(subAccountId, false);
      return;
    }

    const message = queue.shift();

    try {
      const whatsappService = this.getWhatsAppService();
      await whatsappService.sendMessage(
        message.subAccountId,
        message.toNumber,
        message.content,
        message.messageType,
        message.mediaUrl,
        message.fileName
      );

      logger.info(`Queue: sent message to ${message.toNumber}`, {
        subAccountId,
        remaining: queue.length
      });
    } catch (error) {
      message.attempts++;
      if (message.attempts < MAX_ATTEMPTS) {
        queue.push(message);
        logger.warn(`Queue: send failed, re-queued (attempt ${message.attempts}/${MAX_ATTEMPTS})`, {
          toNumber: message.toNumber,
          error: error.message
        });
      } else {
        logger.error(`Queue: message to ${message.toNumber} failed after ${MAX_ATTEMPTS} attempts`, {
          error: error.message
        });
      }
    }

    // Schedule next message with 5s delay
    if (queue.length > 0) {
      setTimeout(() => this.processNext(subAccountId), DELAY_BETWEEN_MESSAGES);
    } else {
      processing.set(subAccountId, false);
    }
  }
}

module.exports = new MessageQueueService();
