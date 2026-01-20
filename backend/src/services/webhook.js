const crypto = require('crypto');
const { Webhook } = require('../models');
const logger = require('../utils/logger');

class WebhookService {
  // Trigger webhook
  async trigger(subAccountId, event, data) {
    try {
      const webhook = await Webhook.findOne({
        where: { subAccountId, isActive: true }
      });

      if (!webhook) return;

      // Check if this event is subscribed
      if (!webhook.events.includes(event) && !webhook.events.includes('*')) {
        return;
      }

      const payload = {
        event,
        subAccountId,
        timestamp: new Date().toISOString(),
        data
      };

      // Generate signature
      const signature = crypto
        .createHmac('sha256', webhook.secret)
        .update(JSON.stringify(payload))
        .digest('hex');

      // Send webhook
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': event
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      if (response.ok) {
        await webhook.update({
          lastTriggered: new Date(),
          failureCount: 0
        });
        logger.info(`Webhook triggered successfully for ${subAccountId}: ${event}`);
      } else {
        throw new Error(`HTTP ${response.status}`);
      }

    } catch (error) {
      logger.error(`Webhook trigger error for ${subAccountId}:`, error);

      // Update failure count
      const webhook = await Webhook.findOne({ where: { subAccountId } });
      if (webhook) {
        await webhook.increment('failureCount');

        // Disable webhook after 10 consecutive failures
        if (webhook.failureCount >= 10) {
          await webhook.update({ isActive: false });
          logger.warn(`Webhook disabled for ${subAccountId} after 10 failures`);
        }
      }
    }
  }
}

module.exports = new WebhookService();
