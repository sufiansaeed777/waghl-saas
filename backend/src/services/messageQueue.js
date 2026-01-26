const logger = require('../utils/logger');

// Message queue configuration
const DEFAULT_RATE_LIMIT = {
  messagesPerSecond: 1,      // Max messages per second
  burstLimit: 5,             // Allow burst of messages before throttling
  delayBetweenMessages: 1000 // Minimum delay between messages (ms)
};

// Queue storage per sub-account
const queues = new Map();
const processing = new Map();
const rateLimiters = new Map();

class MessageQueueService {
  constructor() {
    this.whatsappService = null; // Lazy loaded to avoid circular dependency
  }

  // Get WhatsApp service (lazy load)
  getWhatsAppService() {
    if (!this.whatsappService) {
      this.whatsappService = require('./whatsapp');
    }
    return this.whatsappService;
  }

  // Add message to queue
  async queueMessage(subAccountId, toNumber, content, messageType = 'text', mediaUrl = null, metadata = {}) {
    const message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      subAccountId,
      toNumber,
      content,
      messageType,
      mediaUrl,
      metadata,
      queuedAt: new Date(),
      attempts: 0,
      maxAttempts: 3
    };

    // Initialize queue for sub-account if not exists
    if (!queues.has(subAccountId)) {
      queues.set(subAccountId, []);
    }

    // Add to queue
    queues.get(subAccountId).push(message);

    logger.info(`Message queued for ${subAccountId} to ${toNumber}`, {
      messageId: message.id,
      queueLength: queues.get(subAccountId).length
    });

    // Start processing if not already running
    this.startProcessing(subAccountId);

    return message.id;
  }

  // Add multiple messages to queue (bulk)
  async queueBulkMessages(subAccountId, messages) {
    const messageIds = [];

    for (const msg of messages) {
      const id = await this.queueMessage(
        subAccountId,
        msg.toNumber,
        msg.content,
        msg.messageType || 'text',
        msg.mediaUrl || null,
        msg.metadata || {}
      );
      messageIds.push(id);
    }

    logger.info(`Bulk queued ${messages.length} messages for ${subAccountId}`);
    return messageIds;
  }

  // Start processing queue for a sub-account
  startProcessing(subAccountId) {
    // Already processing
    if (processing.get(subAccountId)) {
      return;
    }

    processing.set(subAccountId, true);
    this.processQueue(subAccountId);
  }

  // Process queue with rate limiting
  async processQueue(subAccountId) {
    const queue = queues.get(subAccountId);

    if (!queue || queue.length === 0) {
      processing.set(subAccountId, false);
      logger.info(`Queue empty for ${subAccountId}, stopping processor`);
      return;
    }

    // Get rate limiter config for this sub-account
    const rateLimit = rateLimiters.get(subAccountId) || DEFAULT_RATE_LIMIT;

    // Get next message from queue
    const message = queue.shift();

    try {
      // Send message via WhatsApp
      const whatsappService = this.getWhatsAppService();

      await whatsappService.sendMessage(
        message.subAccountId,
        message.toNumber,
        message.content,
        message.messageType,
        message.mediaUrl
      );

      logger.info(`Queue processed message ${message.id} to ${message.toNumber}`, {
        remainingInQueue: queue.length,
        subAccountId
      });

    } catch (error) {
      logger.error(`Queue failed to send message ${message.id}:`, error);

      // Retry logic
      message.attempts++;
      if (message.attempts < message.maxAttempts) {
        // Put back in queue for retry (at the end)
        queue.push(message);
        logger.info(`Message ${message.id} re-queued for retry (attempt ${message.attempts}/${message.maxAttempts})`);
      } else {
        logger.error(`Message ${message.id} failed after ${message.maxAttempts} attempts, dropping`);
      }
    }

    // Schedule next message with delay (drip mode)
    if (queue.length > 0) {
      setTimeout(() => {
        this.processQueue(subAccountId);
      }, rateLimit.delayBetweenMessages);
    } else {
      processing.set(subAccountId, false);
      logger.info(`Queue processing complete for ${subAccountId}`);
    }
  }

  // Set rate limit for a sub-account
  setRateLimit(subAccountId, config) {
    const rateLimit = {
      ...DEFAULT_RATE_LIMIT,
      ...config
    };
    rateLimiters.set(subAccountId, rateLimit);
    logger.info(`Rate limit set for ${subAccountId}:`, rateLimit);
  }

  // Get queue status
  getQueueStatus(subAccountId) {
    const queue = queues.get(subAccountId) || [];
    const isProcessing = processing.get(subAccountId) || false;
    const rateLimit = rateLimiters.get(subAccountId) || DEFAULT_RATE_LIMIT;

    return {
      queueLength: queue.length,
      isProcessing,
      rateLimit,
      pendingMessages: queue.map(m => ({
        id: m.id,
        toNumber: m.toNumber,
        queuedAt: m.queuedAt,
        attempts: m.attempts
      }))
    };
  }

  // Clear queue for a sub-account
  clearQueue(subAccountId) {
    const queue = queues.get(subAccountId) || [];
    const cleared = queue.length;
    queues.set(subAccountId, []);
    logger.info(`Cleared ${cleared} messages from queue for ${subAccountId}`);
    return cleared;
  }

  // Pause processing
  pauseProcessing(subAccountId) {
    processing.set(subAccountId, false);
    logger.info(`Paused queue processing for ${subAccountId}`);
  }

  // Resume processing
  resumeProcessing(subAccountId) {
    const queue = queues.get(subAccountId) || [];
    if (queue.length > 0) {
      this.startProcessing(subAccountId);
      logger.info(`Resumed queue processing for ${subAccountId}`);
    }
  }

  // Get all queue stats (for admin)
  getAllQueueStats() {
    const stats = {};
    for (const [subAccountId, queue] of queues.entries()) {
      stats[subAccountId] = {
        queueLength: queue.length,
        isProcessing: processing.get(subAccountId) || false
      };
    }
    return stats;
  }
}

module.exports = new MessageQueueService();
