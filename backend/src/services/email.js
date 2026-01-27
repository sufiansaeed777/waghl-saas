const nodemailer = require('nodemailer');
const axios = require('axios');
const FormData = require('form-data');
const logger = require('../utils/logger');

// Email configuration
const EMAIL_ENABLED = process.env.EMAIL_ENABLED === 'true';
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@example.com';
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'WAGHL SaaS';

// Email provider type
let emailProvider = null; // 'mailgun-api', 'smtp', or 'sendgrid'
let transporter = null;

function initTransporter() {
  if (!EMAIL_ENABLED) {
    logger.info('Email service disabled (EMAIL_ENABLED !== true)');
    return null;
  }

  // Support different email providers
  if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
    // Mailgun SMTP
    emailProvider = 'smtp';
    transporter = nodemailer.createTransport({
      host: 'smtp.mailgun.org',
      port: 587,
      secure: false,
      auth: {
        user: `postmaster@${process.env.MAILGUN_DOMAIN}`,
        pass: process.env.MAILGUN_API_KEY
      }
    });
    logger.info('Email provider: Mailgun SMTP');
  } else if (process.env.SENDGRID_API_KEY) {
    // SendGrid via SMTP
    emailProvider = 'smtp';
    transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY
      }
    });
    logger.info('Email provider: SendGrid SMTP');
  } else if (process.env.SMTP_HOST) {
    // Generic SMTP
    emailProvider = 'smtp';
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    logger.info('Email provider: Generic SMTP');
  } else {
    logger.warn('No email provider configured. Set MAILGUN_API_KEY/MAILGUN_DOMAIN, SENDGRID_API_KEY, or SMTP_HOST');
    return null;
  }

  logger.info('Email transporter initialized');
  return true;
}

// Send via Mailgun API
async function sendViaMailgunAPI(to, subject, html, text) {
  const domain = process.env.MAILGUN_DOMAIN;
  const apiKey = process.env.MAILGUN_API_KEY;

  const form = new FormData();
  form.append('from', `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`);
  form.append('to', to);
  form.append('subject', subject);
  form.append('html', html);
  if (text) form.append('text', text);

  const response = await axios.post(
    `https://api.mailgun.net/v3/${domain}/messages`,
    form,
    {
      auth: {
        username: 'api',
        password: apiKey
      },
      headers: form.getHeaders()
    }
  );

  return { messageId: response.data.id };
}

// Initialize on load
initTransporter();

class EmailService {
  // Check if email is enabled
  isEnabled() {
    return EMAIL_ENABLED && (emailProvider === 'mailgun-api' || transporter !== null);
  }

  // Send email
  async sendEmail(to, subject, html, text = null) {
    if (!this.isEnabled()) {
      logger.info(`Email disabled, skipping: ${subject} to ${to}`);
      return { success: false, reason: 'Email disabled' };
    }

    const textContent = text || html.replace(/<[^>]*>/g, ''); // Strip HTML for text version

    try {
      let result;

      if (emailProvider === 'mailgun-api') {
        // Use Mailgun HTTP API
        result = await sendViaMailgunAPI(to, subject, html, textContent);
      } else {
        // Use nodemailer SMTP
        result = await transporter.sendMail({
          from: `"${EMAIL_FROM_NAME}" <${EMAIL_FROM}>`,
          to,
          subject,
          html,
          text: textContent
        });
      }

      logger.info(`Email sent: ${subject} to ${to}`, { messageId: result.messageId });
      return { success: true, messageId: result.messageId };
    } catch (error) {
      logger.error(`Failed to send email: ${subject} to ${to}`, error);
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // Email Templates
  // ============================================

  // Login notification
  async sendLoginNotification(email, name, ip, userAgent, timestamp) {
    const subject = 'New Login to Your Account';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #0f766e;">New Login Detected</h2>
        <p>Hi ${name || 'there'},</p>
        <p>We detected a new login to your WAGHL account:</p>
        <table style="border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Time</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${new Date(timestamp).toLocaleString()}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">IP Address</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${ip || 'Unknown'}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Device</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${userAgent || 'Unknown'}</td>
          </tr>
        </table>
        <p>If this wasn't you, please reset your password immediately.</p>
        <p style="color: #666; font-size: 12px;">- The WAGHL Team</p>
      </div>
    `;

    return this.sendEmail(email, subject, html);
  }

  // Password reset email
  async sendPasswordReset(email, name, resetToken, resetUrl) {
    const subject = 'Reset Your Password';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #0f766e;">Password Reset Request</h2>
        <p>Hi ${name || 'there'},</p>
        <p>We received a request to reset your password. Click the button below to create a new password:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background-color: #0f766e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Reset Password
          </a>
        </div>
        <p>Or copy this link: <a href="${resetUrl}">${resetUrl}</a></p>
        <p>This link expires in 1 hour.</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
        <p style="color: #666; font-size: 12px;">- The WAGHL Team</p>
      </div>
    `;

    return this.sendEmail(email, subject, html);
  }

  // WhatsApp connected notification
  async sendWhatsAppConnected(email, name, phoneNumber, subAccountName) {
    const subject = 'WhatsApp Connected Successfully';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #22c55e;">WhatsApp Connected!</h2>
        <p>Hi ${name || 'there'},</p>
        <p>Great news! Your WhatsApp number has been successfully connected:</p>
        <div style="background-color: #f0fdf4; border: 1px solid #22c55e; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Phone Number:</strong> ${phoneNumber}</p>
          <p style="margin: 10px 0 0 0;"><strong>Sub-Account:</strong> ${subAccountName || 'N/A'}</p>
        </div>
        <p>Messages sent as SMS in GoHighLevel will now be delivered via WhatsApp.</p>
        <p style="color: #666; font-size: 12px;">- The WAGHL Team</p>
      </div>
    `;

    return this.sendEmail(email, subject, html);
  }

  // WhatsApp disconnected notification
  async sendWhatsAppDisconnected(email, name, phoneNumber, subAccountName, reason = 'Unknown') {
    const subject = 'WhatsApp Disconnected - Action Required';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #ef4444;">WhatsApp Disconnected</h2>
        <p>Hi ${name || 'there'},</p>
        <p>Your WhatsApp connection has been disconnected:</p>
        <div style="background-color: #fef2f2; border: 1px solid #ef4444; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Phone Number:</strong> ${phoneNumber}</p>
          <p style="margin: 10px 0 0 0;"><strong>Sub-Account:</strong> ${subAccountName || 'N/A'}</p>
          <p style="margin: 10px 0 0 0;"><strong>Reason:</strong> ${reason}</p>
        </div>
        <p>Messages will not be delivered via WhatsApp until you reconnect.</p>
        <p>Please log in to your dashboard and scan the QR code to reconnect.</p>
        <p style="color: #666; font-size: 12px;">- The WAGHL Team</p>
      </div>
    `;

    return this.sendEmail(email, subject, html);
  }

  // Welcome email
  async sendWelcome(email, name) {
    const subject = 'Welcome to WAGHL SaaS!';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #0f766e;">Welcome to WAGHL!</h2>
        <p>Hi ${name || 'there'},</p>
        <p>Thank you for signing up! You're now ready to connect your WhatsApp and start sending messages through GoHighLevel.</p>
        <h3>Getting Started:</h3>
        <ol>
          <li>Create a sub-account for your business</li>
          <li>Connect your GoHighLevel location</li>
          <li>Scan the QR code to link your WhatsApp</li>
          <li>Start sending messages!</li>
        </ol>
        <p>If you have any questions, don't hesitate to reach out to our support team.</p>
        <p style="color: #666; font-size: 12px;">- The WAGHL Team</p>
      </div>
    `;

    return this.sendEmail(email, subject, html);
  }

  // Subscription activated
  async sendSubscriptionActivated(email, name, planName) {
    const subject = 'Subscription Activated!';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #22c55e;">Subscription Activated!</h2>
        <p>Hi ${name || 'there'},</p>
        <p>Your subscription has been activated successfully!</p>
        <div style="background-color: #f0fdf4; border: 1px solid #22c55e; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Plan:</strong> ${planName || 'Standard'}</p>
          <p style="margin: 10px 0 0 0;"><strong>Status:</strong> Active</p>
        </div>
        <p>You now have full access to all features. Connect your WhatsApp and start sending messages!</p>
        <p style="color: #666; font-size: 12px;">- The WAGHL Team</p>
      </div>
    `;

    return this.sendEmail(email, subject, html);
  }

  // Subscription cancelled
  async sendSubscriptionCancelled(email, name) {
    const subject = 'Subscription Cancelled';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #ef4444;">Subscription Cancelled</h2>
        <p>Hi ${name || 'there'},</p>
        <p>Your subscription has been cancelled. Your access to premium features will end at the end of your current billing period.</p>
        <p>If this was a mistake or you'd like to resubscribe, you can do so from your dashboard at any time.</p>
        <p>We're sorry to see you go. If you have any feedback, we'd love to hear it.</p>
        <p style="color: #666; font-size: 12px;">- The WAGHL Team</p>
      </div>
    `;

    return this.sendEmail(email, subject, html);
  }
}

module.exports = new EmailService();
