# WAGHL SaaS - WhatsApp Bridge

A self-hosted WhatsApp SaaS platform using Baileys (unofficial WhatsApp Web bridge). Allows multiple customers to connect WhatsApp accounts via QR code and send/receive messages through API.

## Documentation

- **[SETUP.md](./SETUP.md)** - Server setup, restart procedures, customer management, session handling
- **[API.md](./API.md)** - Complete API documentation with all endpoints

## Features

- Multi-tenant architecture (Customers → Sub-accounts)
- QR code WhatsApp login via Baileys
- Session persistence and auto-reconnect
- Send/receive text messages
- REST API with API key authentication
- Webhooks for incoming messages
- Stripe billing integration
- Admin panel for management

## Tech Stack

- **Backend**: Node.js, Express, Sequelize
- **Database**: PostgreSQL
- **Cache**: Redis
- **WhatsApp**: @whiskeysockets/baileys
- **Frontend**: React, Tailwind CSS
- **Payments**: Stripe

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL
- Redis
- Stripe account (for billing)

### Backend Setup

```bash
cd backend
cp .env.example .env
# Edit .env with your configuration
npm install
npm run dev
```

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

### Environment Variables

```env
# Server
NODE_ENV=development
PORT=3000

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=waghl_saas
DB_USER=postgres
DB_PASSWORD=your_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=your_secret_key
JWT_EXPIRES_IN=7d

# Stripe
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_ID=price_xxx

# Admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin123

# Frontend
FRONTEND_URL=http://localhost:5173
```

## API Endpoints

### Authentication

```
POST /api/auth/register - Register new customer
POST /api/auth/login - Login
GET  /api/auth/me - Get current user
```

### Sub-Accounts

```
GET    /api/sub-accounts - List all sub-accounts
POST   /api/sub-accounts - Create sub-account
GET    /api/sub-accounts/:id - Get sub-account
PUT    /api/sub-accounts/:id - Update sub-account
DELETE /api/sub-accounts/:id - Delete sub-account
```

### WhatsApp

```
POST /api/whatsapp/:subAccountId/connect - Start connection (get QR)
GET  /api/whatsapp/:subAccountId/qr - Get QR code
GET  /api/whatsapp/:subAccountId/status - Get connection status
POST /api/whatsapp/:subAccountId/disconnect - Disconnect
POST /api/whatsapp/:subAccountId/send - Send message
```

### External API (API Key Auth)

```
POST /api/whatsapp/send - Send message
GET  /api/whatsapp/status - Get status

Headers:
X-API-Key: your_api_key
```

### Webhooks

```
GET  /api/webhooks/:subAccountId - Get webhook config
POST /api/webhooks/:subAccountId - Set webhook URL
POST /api/webhooks/:subAccountId/test - Test webhook
```

## Webhook Events

- `message.received` - New incoming message
- `message.sent` - Message sent successfully
- `connection.status` - Connection status changed
- `connection.qr` - QR code generated

## Deployment (Cloudways)

1. Create a new application on Cloudways (Custom Node.js)
2. SSH into server
3. Clone repository
4. Install dependencies: `npm install`
5. Set environment variables
6. Setup PostgreSQL and Redis
7. Run with PM2: `pm2 start src/index.js --name waghl`

## PM2 Commands

```bash
pm2 start src/index.js --name waghl
pm2 restart waghl
pm2 logs waghl
pm2 stop waghl
```

## License

Proprietary - All rights reserved
