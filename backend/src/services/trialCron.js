const { Customer, SubAccount } = require('../models');
const { Op } = require('sequelize');
const emailService = require('./email');
const logger = require('../utils/logger');

class TrialCronService {
  constructor() {
    this.isRunning = false;
  }

  // Start the cron jobs
  start() {
    if (this.isRunning) {
      logger.warn('Trial cron service already running');
      return;
    }

    this.isRunning = true;
    logger.info('Trial cron service started');

    // Run immediately on startup
    this.checkExpiredTrials();
    this.sendTrialReminders();

    // Check expired trials every hour
    this.expiredTrialsInterval = setInterval(() => {
      this.checkExpiredTrials();
    }, 60 * 60 * 1000); // 1 hour

    // Send trial reminders every 6 hours
    this.remindersInterval = setInterval(() => {
      this.sendTrialReminders();
    }, 6 * 60 * 60 * 1000); // 6 hours
  }

  // Stop the cron jobs
  stop() {
    if (this.expiredTrialsInterval) {
      clearInterval(this.expiredTrialsInterval);
    }
    if (this.remindersInterval) {
      clearInterval(this.remindersInterval);
    }
    this.isRunning = false;
    logger.info('Trial cron service stopped');
  }

  // Check and expire trials that have ended
  async checkExpiredTrials() {
    try {
      logger.info('Checking for expired trials...');

      // Find all customers with expired trials
      const expiredTrials = await Customer.findAll({
        where: {
          subscriptionStatus: 'trialing',
          trialEndsAt: {
            [Op.lt]: new Date()
          }
        }
      });

      logger.info(`Found ${expiredTrials.length} expired trials`);

      for (const customer of expiredTrials) {
        try {
          // Check if customer has any paid sub-accounts (active Stripe subscriptions)
          const paidCount = await SubAccount.count({
            where: { customerId: customer.id, isPaid: true }
          });

          // If they have paid sub-accounts, mark as active; otherwise inactive
          await customer.update({
            subscriptionStatus: paidCount > 0 ? 'active' : 'inactive',
            subscriptionQuantity: paidCount,
            hasUsedTrial: true
          });

          logger.info(`Expired trial for customer ${customer.id} (${customer.email}), ${paidCount} paid sub-accounts remain active`);

          // Send trial expired email
          emailService.sendTrialExpired(customer.email, customer.name)
            .catch(err => logger.error('Failed to send trial expired email:', err));

        } catch (err) {
          logger.error(`Error expiring trial for customer ${customer.id}:`, err);
        }
      }
    } catch (error) {
      logger.error('Check expired trials error:', error);
    }
  }

  // Send reminder emails for trials ending soon
  async sendTrialReminders() {
    try {
      logger.info('Checking for trial reminders...');

      const now = new Date();

      // Reminder 2 days before expiry
      const twoDaysFromNow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(twoDaysFromNow.getTime() - 6 * 60 * 60 * 1000); // 6 hour window

      // Find trials expiring in ~2 days (within 6 hour window to avoid duplicate emails)
      const expiringTrials = await Customer.findAll({
        where: {
          subscriptionStatus: 'trialing',
          trialEndsAt: {
            [Op.between]: [twoDaysAgo, twoDaysFromNow]
          },
          hasUsedTrial: false
        }
      });

      logger.info(`Found ${expiringTrials.length} trials expiring soon`);

      for (const customer of expiringTrials) {
        try {
          const daysRemaining = Math.ceil((new Date(customer.trialEndsAt) - now) / (1000 * 60 * 60 * 24));

          if (daysRemaining > 0 && daysRemaining <= 2) {
            // Send reminder email
            emailService.sendTrialReminder(customer.email, customer.name, daysRemaining)
              .catch(err => logger.error('Failed to send trial reminder email:', err));

            logger.info(`Sent trial reminder to ${customer.email} (${daysRemaining} days remaining)`);
          }
        } catch (err) {
          logger.error(`Error sending reminder for customer ${customer.id}:`, err);
        }
      }
    } catch (error) {
      logger.error('Send trial reminders error:', error);
    }
  }
}

module.exports = new TrialCronService();
