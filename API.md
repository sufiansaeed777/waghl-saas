# GHLWA Connector - API Documentation

Base URL: `https://yourdomain.com/api`

## Authentication

### JWT Authentication (for Dashboard)

Used for frontend/dashboard access.

```
Authorization: Bearer <jwt_token>
```

### API Key Authentication (for External Integrations)

Used for external API access.

```
X-API-Key: <api_key>
```

API keys are available per-customer and per-sub-account.

---

## Endpoints

### Authentication

#### Register

```http
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword",
  "name": "John Doe",
  "company": "ACME Inc"
}
```

**Response:**
```json
{
  "message": "Registration successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "customer": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe"
  }
}
```

#### Login

```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "customer": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe"
  }
}
```

#### Get Current User

```http
GET /auth/me
Authorization: Bearer <token>
```

---

### Sub-Accounts

#### List Sub-Accounts

```http
GET /sub-accounts
Authorization: Bearer <token>
```

**Response:**
```json
{
  "subAccounts": [
    {
      "id": "uuid",
      "name": "Main WhatsApp",
      "phoneNumber": "1234567890",
      "status": "connected",
      "isActive": true,
      "isPaid": true,
      "apiKey": "abc123..."
    }
  ]
}
```

#### Create Sub-Account

```http
POST /sub-accounts
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "My WhatsApp Number"
}
```

#### Get Sub-Account

```http
GET /sub-accounts/:id
Authorization: Bearer <token>
```

#### Update Sub-Account

```http
PUT /sub-accounts/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Updated Name",
  "isActive": true
}
```

#### Delete Sub-Account

```http
DELETE /sub-accounts/:id
Authorization: Bearer <token>
```

#### Refresh API Key

```http
POST /sub-accounts/:id/refresh-api-key
Authorization: Bearer <token>
```

---

### WhatsApp (JWT Auth)

#### Connect (Get QR Code)

```http
POST /whatsapp/:subAccountId/connect
Authorization: Bearer <token>
```

**Response:**
```json
{
  "status": "connecting",
  "message": "Initializing connection..."
}
```

#### Get QR Code

```http
GET /whatsapp/:subAccountId/qr
Authorization: Bearer <token>
```

**Response:**
```json
{
  "qrCode": "data:image/png;base64,..."
}
```

#### Get Status

```http
GET /whatsapp/:subAccountId/status
Authorization: Bearer <token>
```

**Response:**
```json
{
  "status": "connected",
  "phoneNumber": "1234567890",
  "isConnected": true,
  "hasQR": false,
  "lastConnected": "2024-01-15T10:30:00Z"
}
```

#### Disconnect

```http
POST /whatsapp/:subAccountId/disconnect
Authorization: Bearer <token>
```

#### Send Message

```http
POST /whatsapp/:subAccountId/send
Authorization: Bearer <token>
Content-Type: application/json

{
  "to": "1234567890",
  "message": "Hello!",
  "type": "text"
}
```

**For media:**
```json
{
  "to": "1234567890",
  "message": "Check this document",
  "type": "document",
  "mediaUrl": "https://example.com/file.pdf",
  "fileName": "document.pdf"
}
```

**Message Types:** `text`, `image`, `document`, `audio`, `video`

---

### WhatsApp (API Key Auth)

#### Send Message

```http
POST /whatsapp/send
X-API-Key: <api_key>
Content-Type: application/json

{
  "to": "1234567890",
  "message": "Hello from API!",
  "type": "text"
}
```

If using customer API key (not sub-account key), include:
```json
{
  "subAccountId": "uuid",
  "to": "1234567890",
  "message": "Hello!"
}
```

#### Get Status

```http
GET /whatsapp/status
X-API-Key: <api_key>
```

If using customer API key:
```http
GET /whatsapp/status?subAccountId=uuid
X-API-Key: <api_key>
```

---

### Webhooks

#### Get Webhook Config

```http
GET /webhooks/:subAccountId
Authorization: Bearer <token>
```

**Response:**
```json
{
  "webhook": {
    "id": "uuid",
    "url": "https://yourserver.com/webhook",
    "secret": "webhook_secret_for_signature",
    "events": ["message.received", "message.sent"],
    "isActive": true
  }
}
```

#### Configure Webhook

```http
POST /webhooks/:subAccountId
Authorization: Bearer <token>
Content-Type: application/json

{
  "url": "https://yourserver.com/webhook",
  "events": ["message.received", "message.sent", "connection.status"]
}
```

#### Test Webhook

```http
POST /webhooks/:subAccountId/test
Authorization: Bearer <token>
```

#### Delete Webhook

```http
DELETE /webhooks/:subAccountId
Authorization: Bearer <token>
```

---

### Webhook Payload

When events occur, a POST request is sent to your webhook URL:

```json
{
  "event": "message.received",
  "subAccountId": "uuid",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "messageId": "uuid",
    "from": "1234567890",
    "type": "text",
    "content": "Hello!",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

**Headers:**
```
Content-Type: application/json
X-Webhook-Signature: <hmac_sha256_signature>
X-Webhook-Event: message.received
```

**Verify Signature:**
```javascript
const crypto = require('crypto');
const signature = crypto
  .createHmac('sha256', webhookSecret)
  .update(JSON.stringify(payload))
  .digest('hex');

if (signature === req.headers['x-webhook-signature']) {
  // Valid request
}
```

**Events:**
- `message.received` - Incoming message
- `message.sent` - Outgoing message sent
- `connection.status` - Connected/disconnected
- `connection.qr` - New QR code generated

---

### GHL Integration

#### Get GHL Status

```http
GET /ghl/status
Authorization: Bearer <token>
```

#### Get Authorization URL

```http
GET /ghl/auth-url
Authorization: Bearer <token>
```

#### Disconnect GHL

```http
POST /ghl/disconnect
Authorization: Bearer <token>
```

#### Get GHL Locations

```http
GET /ghl/locations
Authorization: Bearer <token>
```

#### Link Sub-Account to GHL Location

```http
POST /ghl/link-location/:subAccountId
Authorization: Bearer <token>
Content-Type: application/json

{
  "locationId": "ghl_location_id"
}
```

#### Unlink from GHL Location

```http
POST /ghl/unlink-location/:subAccountId
Authorization: Bearer <token>
```

---

### Billing

#### Create Checkout Session

```http
POST /billing/checkout/:subAccountId
Authorization: Bearer <token>
```

**Response:**
```json
{
  "url": "https://checkout.stripe.com/..."
}
```

#### Get Billing Portal

```http
GET /billing/portal
Authorization: Bearer <token>
```

---

### Admin (Admin Only)

#### Get Stats

```http
GET /admin/stats
Authorization: Bearer <admin_token>
```

#### List All Customers

```http
GET /admin/customers?page=1&limit=20&search=query
Authorization: Bearer <admin_token>
```

#### List All Sub-Accounts

```http
GET /admin/sub-accounts?page=1&limit=20&customerId=uuid
Authorization: Bearer <admin_token>
```

#### Toggle Customer Status

```http
PUT /admin/customers/:id/toggle
Authorization: Bearer <admin_token>
```

#### Toggle Sub-Account Status

```http
PUT /admin/sub-accounts/:id/toggle
Authorization: Bearer <admin_token>
```

---

## Error Responses

All errors return JSON:

```json
{
  "error": "Error message here"
}
```

**HTTP Status Codes:**
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Internal Server Error

---

## Rate Limits

- 100 requests per 15 minutes per IP
- Response when exceeded:
```json
{
  "error": "Too many requests, please try again later."
}
```
