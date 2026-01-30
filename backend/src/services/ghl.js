const axios = require('axios');
const { Customer, SubAccount } = require('../models');
const logger = require('../utils/logger');

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_AUTH_URL = 'https://marketplace.gohighlevel.com/oauth/chooselocation';
const GHL_TOKEN_URL = `${GHL_API_BASE}/oauth/token`;

class GHLService {
  constructor() {
    this.clientId = process.env.GHL_CLIENT_ID;
    this.clientSecret = process.env.GHL_CLIENT_SECRET;
    this.redirectUri = process.env.GHL_REDIRECT_URI;
    this.scopes = process.env.GHL_SCOPES || 'contacts.readonly contacts.write conversations.readonly conversations.write conversations/message.readonly conversations/message.write locations.readonly';
  }

  // Generate OAuth authorization URL
  getAuthorizationUrl(customerId, subAccountId = null) {
    // Use URL-safe base64 encoding for state
    const stateData = JSON.stringify({ customerId, subAccountId });
    const state = Buffer.from(stateData).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    // Extract version_id from client_id (base ID without suffix)
    const versionId = this.clientId ? this.clientId.split('-')[0] : '';
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: this.scopes,
      state
    });
    // Add version_id for draft/unpublished apps
    if (versionId) {
      params.append('version_id', versionId);
    }
    return `${GHL_AUTH_URL}?${params.toString()}`;
  }

  // Exchange authorization code for tokens
  async exchangeCodeForTokens(code) {
    logger.info('exchangeCodeForTokens called', { code_received: !!code, code_length: code?.length });
    try {
      const params = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
        user_type: 'Location'
      });

      logger.info('GHL token exchange request', {
        url: GHL_TOKEN_URL,
        client_id: this.clientId,
        redirect_uri: this.redirectUri,
        code_length: code?.length,
        code_preview: code?.substring(0, 20) + '...'
      });

      const response = await axios.post(GHL_TOKEN_URL, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      });

      logger.info('GHL token exchange success', { locationId: response.data?.locationId });
      return response.data;
    } catch (error) {
      logger.error('GHL token exchange error:', {
        message: error.message,
        response_data: error.response?.data,
        response_status: error.response?.status
      });
      throw new Error('Failed to exchange authorization code');
    }
  }

  // Refresh access token (works with both Customer and SubAccount)
  async refreshAccessToken(entity) {
    try {
      if (!entity.ghlRefreshToken) {
        throw new Error('No refresh token available');
      }

      const params = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: entity.ghlRefreshToken,
        redirect_uri: this.redirectUri,
        user_type: 'Location'
      });

      const response = await axios.post(GHL_TOKEN_URL, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      });

      const { access_token, refresh_token, expires_in } = response.data;

      // Update entity with new tokens
      await entity.update({
        ghlAccessToken: access_token,
        ghlRefreshToken: refresh_token || entity.ghlRefreshToken,
        ghlTokenExpiresAt: new Date(Date.now() + (expires_in * 1000))
      });

      return access_token;
    } catch (error) {
      logger.error('GHL token refresh error:', error.response?.data || error.message);
      // Mark GHL as disconnected if refresh fails
      await entity.update({ ghlConnected: false });
      throw new Error('Failed to refresh access token');
    }
  }

  // Get valid access token (refreshes if needed) - works with SubAccount or Customer
  async getValidAccessToken(entity) {
    if (!entity.ghlAccessToken) {
      throw new Error('GHL not connected');
    }

    // Check if token is expired or will expire in next 5 minutes
    const expiresAt = new Date(entity.ghlTokenExpiresAt);
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);

    if (expiresAt <= fiveMinutesFromNow) {
      return await this.refreshAccessToken(entity);
    }

    return entity.ghlAccessToken;
  }

  // Make authenticated API request (works with SubAccount or Customer)
  async apiRequest(entity, method, endpoint, data = null, apiVersion = '2021-07-28') {
    const accessToken = await this.getValidAccessToken(entity);

    // Build request config - only include data and Content-Type for non-GET requests
    const config = {
      method,
      url: `${GHL_API_BASE}${endpoint}`,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Version': apiVersion
      },
      timeout: 30000
    };

    // Only add Content-Type and data for requests that have a body
    if (method.toUpperCase() !== 'GET' && data !== null) {
      config.headers['Content-Type'] = 'application/json';
      config.data = data;
    }

    try {
      const response = await axios(config);
      return response.data;
    } catch (error) {
      logger.error(`GHL API error (${endpoint}):`, {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
      throw error;
    }
  }

  // Get locations for customer
  async getLocations(customer) {
    try {
      const response = await this.apiRequest(customer, 'GET', '/locations/search');
      return response.locations || [];
    } catch (error) {
      logger.error('GHL get locations error:', error);
      throw new Error('Failed to fetch GHL locations');
    }
  }

  // Get single location details
  async getLocation(entity, locationId) {
    // Try different endpoints - GHL API is inconsistent with location-scoped tokens
    const endpoints = [
      { path: `/locations/${locationId}`, desc: 'direct' },
      { path: '/locations/', desc: 'current location' }
    ];

    for (const endpoint of endpoints) {
      try {
        logger.info(`Trying to fetch location via ${endpoint.desc}`, { locationId, path: endpoint.path });
        const response = await this.apiRequest(entity, 'GET', endpoint.path);

        // Check for location wrapper
        if (response && response.location) {
          logger.info('Found location:', { id: response.location.id, name: response.location.name });
          return response.location;
        }

        // Check for locations array (from /locations/ endpoint)
        if (response && response.locations && response.locations.length > 0) {
          const loc = response.locations.find(l => l.id === locationId) || response.locations[0];
          logger.info('Found location in array:', { id: loc.id, name: loc.name });
          return loc;
        }

        // Response might be the location directly
        if (response && response.name && response.id) {
          logger.info('Found location (direct):', { id: response.id, name: response.name });
          return response;
        }

        logger.warn('Location response has no usable data', { locationId, endpoint: endpoint.desc });
      } catch (error) {
        logger.warn(`GHL get location failed via ${endpoint.desc}:`, {
          status: error.response?.status,
          locationId
        });
        continue;
      }
    }

    logger.error('All endpoints failed to fetch location', { locationId });
    return null;
  }

  // Search contacts in a location
  async searchContacts(customer, locationId, query = '') {
    try {
      const params = new URLSearchParams({ locationId });
      if (query) params.append('query', query);

      const response = await this.apiRequest(customer, 'GET', `/contacts/?${params.toString()}`);
      return response.contacts || [];
    } catch (error) {
      logger.error('GHL search contacts error:', error);
      throw new Error('Failed to search GHL contacts');
    }
  }

  // Get contact by phone number
  async getContactByPhone(customer, locationId, phoneNumber) {
    try {
      // Clean phone number
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      const params = new URLSearchParams({
        locationId,
        query: cleanPhone
      });

      const response = await this.apiRequest(customer, 'GET', `/contacts/?${params.toString()}`);
      const contacts = response.contacts || [];

      // Find exact phone match
      return contacts.find(c =>
        c.phone?.replace(/\D/g, '') === cleanPhone ||
        c.phone?.replace(/\D/g, '').endsWith(cleanPhone) ||
        cleanPhone.endsWith(c.phone?.replace(/\D/g, '') || '')
      ) || null;
    } catch (error) {
      logger.error('GHL get contact by phone error:', error);
      return null;
    }
  }

  // Create contact in GHL
  async createContact(customer, locationId, contactData) {
    try {
      const response = await this.apiRequest(customer, 'POST', '/contacts/', {
        locationId,
        ...contactData
      });
      return response.contact;
    } catch (error) {
      logger.error('GHL create contact error:', error);
      throw new Error('Failed to create GHL contact');
    }
  }

  // Update contact in GHL
  async updateContact(customer, contactId, contactData) {
    try {
      const response = await this.apiRequest(customer, 'PUT', `/contacts/${contactId}`, contactData);
      return response.contact;
    } catch (error) {
      logger.error('GHL update contact error:', error);
      throw new Error('Failed to update GHL contact');
    }
  }

  // Get or create contact by phone
  async getOrCreateContact(customer, locationId, phoneNumber, name = null) {
    try {
      // Try to find existing contact
      let contact = await this.getContactByPhone(customer, locationId, phoneNumber);

      if (!contact) {
        // Create new contact
        contact = await this.createContact(customer, locationId, {
          phone: phoneNumber,
          name: name || `WhatsApp ${phoneNumber}`,
          source: 'GHLWA Connector'
        });
        logger.info(`Created new GHL contact for ${phoneNumber}`);
      }

      return contact;
    } catch (error) {
      logger.error('GHL get or create contact error:', error);
      throw error;
    }
  }

  // Get conversations for a contact
  async getConversations(customer, contactId) {
    try {
      const response = await this.apiRequest(customer, 'GET', `/conversations/search?contactId=${contactId}`);
      return response.conversations || [];
    } catch (error) {
      logger.error('GHL get conversations error:', error);
      throw new Error('Failed to fetch GHL conversations');
    }
  }

  // Create conversation
  async createConversation(customer, locationId, contactId) {
    try {
      const response = await this.apiRequest(customer, 'POST', '/conversations/', {
        locationId,
        contactId
      });
      return response.conversation;
    } catch (error) {
      logger.error('GHL create conversation error:', error);
      throw new Error('Failed to create GHL conversation');
    }
  }

  // Send message to GHL conversation (for logging purposes)
  async addMessageToConversation(customer, conversationId, message, direction = 'inbound') {
    try {
      // GHL API inbound message endpoint
      // Docs: https://marketplace.gohighlevel.com/docs/ghl/conversations/add-an-inbound-message
      // Required fields: conversationId OR contactId, type, body
      // Additional fields for proper display: contentType, direction, messageType
      const payload = {
        conversationId,
        type: 'SMS',
        message: message,  // Some GHL versions use 'message' instead of 'body'
        body: message,
        contentType: 'text/plain',
        direction: direction,
        messageType: 'SMS'
      };
      logger.info('Calling GHL inbound message API:', { conversationId, messageLength: message?.length, payload });

      const response = await this.apiRequest(customer, 'POST', `/conversations/messages/inbound`, payload);
      logger.info(`Added ${direction} message to GHL conversation ${conversationId}`, { response });
      return response;
    } catch (error) {
      logger.error('GHL add message error:', {
        error: error.response?.data || error.message,
        status: error.response?.status,
        conversationId,
        payload: { conversationId, type: 'SMS', bodyLength: message?.length }
      });
      // Don't throw - message logging to GHL is not critical
      return null;
    }
  }

  // Sync WhatsApp message to GHL
  async syncMessageToGHL(subAccount, fromNumber, toNumber, content, direction = 'inbound') {
    try {
      logger.info('syncMessageToGHL called', {
        subAccountId: subAccount.id,
        fromNumber,
        toNumber,
        direction,
        contentLength: content?.length,
        ghlConnected: subAccount.ghlConnected,
        hasAccessToken: !!subAccount.ghlAccessToken,
        ghlLocationId: subAccount.ghlLocationId
      });

      // Check if sub-account has GHL connected
      if (!subAccount.ghlConnected || !subAccount.ghlAccessToken) {
        logger.warn('GHL not connected for sub-account, skipping sync', { subAccountId: subAccount.id });
        return null;
      }

      // Check if sub-account has GHL location
      if (!subAccount.ghlLocationId) {
        logger.warn('No GHL location linked to sub-account, skipping sync', { subAccountId: subAccount.id });
        return null;
      }

      // Determine the external phone number (not our WhatsApp number)
      const externalPhone = direction === 'inbound' ? fromNumber : toNumber;
      logger.info('External phone for GHL sync:', { externalPhone, direction });

      // Get or create contact (using subAccount for API calls)
      const contact = await this.getOrCreateContact(
        subAccount,
        subAccount.ghlLocationId,
        externalPhone
      );

      if (!contact) {
        logger.error('Failed to get/create GHL contact', { externalPhone, locationId: subAccount.ghlLocationId });
        return null;
      }
      logger.info('Got/created GHL contact:', { contactId: contact.id, contactName: contact.name });

      // Get or create conversation
      let conversations = await this.getConversations(subAccount, contact.id);
      let conversation = conversations[0];
      logger.info('Got conversations:', { count: conversations.length, hasConversation: !!conversation });

      if (!conversation) {
        logger.info('Creating new conversation for contact:', { contactId: contact.id });
        conversation = await this.createConversation(
          subAccount,
          subAccount.ghlLocationId,
          contact.id
        );
      }

      // Add message to conversation
      if (conversation) {
        logger.info('Adding message to conversation:', { conversationId: conversation.id, direction });
        const result = await this.addMessageToConversation(
          subAccount,
          conversation.id,
          content,
          direction
        );
        logger.info(`Synced ${direction} message to GHL for ${externalPhone}`, { result });
      } else {
        logger.error('No conversation found/created, cannot sync message');
      }

      return { contact, conversation };
    } catch (error) {
      logger.error('GHL sync message error:', {
        error: error.message,
        stack: error.stack,
        subAccountId: subAccount.id
      });
      return null;
    }
  }

  // Disconnect GHL for customer
  async disconnect(customerId) {
    try {
      const customer = await Customer.findByPk(customerId);
      if (customer) {
        await customer.update({
          ghlAccessToken: null,
          ghlRefreshToken: null,
          ghlTokenExpiresAt: null,
          ghlCompanyId: null,
          ghlUserId: null,
          ghlConnected: false
        });

        // Also unlink all sub-accounts from GHL locations
        await SubAccount.update(
          { ghlLocationId: null, ghlLocationName: null, ghlConnected: false },
          { where: { customerId } }
        );
      }
      return true;
    } catch (error) {
      logger.error('GHL disconnect error:', error);
      throw error;
    }
  }

  // Uninstall app from GHL location using Marketplace API
  // API: DELETE /marketplace/app/:appId/installations
  // Docs: https://marketplace.gohighlevel.com/docs/ghl/marketplace/uninstall-application/index.html
  async uninstallFromLocation(subAccount, reason = 'User requested uninstall') {
    try {
      if (!subAccount.ghlAccessToken || !subAccount.ghlLocationId) {
        logger.warn('Cannot uninstall: missing access token or locationId', {
          subAccountId: subAccount.id,
          hasToken: !!subAccount.ghlAccessToken,
          hasLocationId: !!subAccount.ghlLocationId
        });
        return { success: false, error: 'Missing access token or locationId' };
      }

      const accessToken = await this.getValidAccessToken(subAccount);
      const appId = this.clientId.split('-')[0]; // Get base app ID without suffix
      const locationId = subAccount.ghlLocationId;

      // Get companyId from the customer
      let companyId = null;
      if (subAccount.customer && subAccount.customer.ghlCompanyId) {
        companyId = subAccount.customer.ghlCompanyId;
      } else {
        // Fetch customer if not included
        const customer = await Customer.findByPk(subAccount.customerId);
        companyId = customer?.ghlCompanyId;
      }

      logger.info('Calling GHL uninstall API', {
        subAccountId: subAccount.id,
        locationId,
        companyId,
        appId,
        url: `${GHL_API_BASE}/marketplace/app/${appId}/installations`
      });

      // Send full request body as per GHL API docs
      const response = await axios({
        method: 'DELETE',
        url: `${GHL_API_BASE}/marketplace/app/${appId}/installations`,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28'
        },
        data: {
          companyId: companyId || locationId, // Use locationId as fallback if no companyId
          locationId: locationId,
          reason: reason
        }
      });

      logger.info('GHL uninstall API success', {
        subAccountId: subAccount.id,
        locationId,
        companyId,
        response: response.data
      });

      // Clear GHL data from sub-account after successful uninstall
      await subAccount.update({
        ghlAccessToken: null,
        ghlRefreshToken: null,
        ghlTokenExpiresAt: null,
        ghlLocationId: null,
        ghlConnected: false
      });

      return { success: true, data: response.data };
    } catch (error) {
      logger.error('GHL uninstall API error:', {
        subAccountId: subAccount.id,
        error: error.response?.data || error.message,
        status: error.response?.status,
        statusText: error.response?.statusText
      });

      // If the API fails, still return the error but don't clear local data
      // Let the caller decide whether to clear local data
      return {
        success: false,
        error: error.response?.data?.message || error.response?.data || error.message,
        status: error.response?.status
      };
    }
  }
}

module.exports = new GHLService();
