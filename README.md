# GHLWA Connector

WhatsApp integration for GoHighLevel (GHL). Bridges WhatsApp messaging into GHL conversations using the Baileys library (WhatsApp Web API).

## Features

- **WhatsApp <> GHL Bridge** — Send and receive WhatsApp messages directly from GHL conversations
- **Multi-tenant** — Supports multiple sub-accounts, each with their own WhatsApp number and GHL location
- **Conversation Provider** — Registers as a GHL Conversation Provider (SMS type)
- **Message Queue** — Drip-feed outbound messages with configurable delay to avoid rate limits
- **Stripe Billing** — Per sub-account subscriptions with volume pricing
- **7-Day Free Trial** — Automatic trial with daily cron to manage expiry
- **GHL Embed Pages** — WhatsApp management UI embeddable inside GHL via Custom Menu Link
- **Email Notifications** — Mailgun-powered alerts for WhatsApp disconnections
- **Admin Dashboard** — Manage customers, sub-accounts, and GHL connections

## Tech Stack

- **Backend:** Node.js, Express, Sequelize ORM
- **Database:** MySQL
- **WhatsApp:** @whiskeysockets/baileys (linked device protocol)
- **Frontend:** React (Vite), Tailwind CSS
- **Payments:** Stripe (subscriptions, webhooks, volume pricing)
- **Email:** Mailgun
- **Process Manager:** PM2

## Project Structure

```
backend/
├── src/
│   ├── index.js              # Express app entry point
│   ├── models/               # Sequelize models
│   │   ├── Customer.js       # Customer/agency accounts
│   │   ├── SubAccount.js     # Sub-accounts (GHL locations)
│   │   ├── Message.js        # Message history
│   │   ├── WhatsAppMapping.js # Phone-to-contact mapping cache
│   │   └── Webhook.js        # Webhook event log
│   ├── routes/
│   │   ├── auth.js           # Login, register, password reset
│   │   ├── billing.js        # Stripe checkout & subscription management
│   │   ├── ghl.js            # GHL OAuth, webhooks, connect/disconnect
│   │   ├── embed.js          # GHL iframe embed pages
│   │   ├── whatsapp.js       # WhatsApp status, connect, disconnect
│   │   ├── admin.js          # Admin CRUD operations
│   │   ├── subAccounts.js    # Sub-account management
│   │   └── customers.js      # Customer management
│   ├── services/
│   │   ├── whatsapp.js       # Baileys WhatsApp connection manager
│   │   ├── ghl.js            # GHL API client (OAuth, messages, contacts)
│   │   ├── stripe.js         # Stripe webhook handler
│   │   ├── email.js          # Email notification service
│   │   ├── messageQueue.js   # Outbound message queue with delay
│   │   └── trialCron.js      # Daily trial expiry checker
│   └── utils/
│       └── logger.js         # Winston logger
frontend/
├── src/
│   ├── pages/                # React pages
│   └── components/           # Shared components
```

## Setup

### Prerequisites

- Node.js 18+
- MySQL database
- GHL Marketplace app (Conversation Provider type)
- Stripe account
- Mailgun account (optional, for email notifications)

### Installation

```bash
# Clone the repo
git clone https://github.com/GHLWA-Connector/ghlwa-saas.git
cd ghlwa-saas

# Backend setup
cd backend
cp .env.example .env
# Edit .env with your configuration (see Environment Variables below)
npm install
npm start

# Frontend setup (for development)
cd ../frontend
npm install
npm run dev

# Build frontend for production
npm run build
```

### Environment Variables

Copy `backend/.env.example` to `backend/.env` and configure:

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | `development` or `production` |
| `PORT` | Server port (default: 3000) |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | MySQL connection |
| `DB_DIALECT` | `mysql` |
| `JWT_SECRET` | Secret key for JWT tokens |
| `FRONTEND_URL` | Frontend URL for CORS |
| `API_URL` | Backend API URL |
| `GHL_CLIENT_ID` | GHL Marketplace app client ID |
| `GHL_CLIENT_SECRET` | GHL Marketplace app client secret |
| `GHL_REDIRECT_URI` | GHL OAuth callback URL (`https://yourdomain.com/api/oauth/callback`) |
| `GHL_SCOPES` | GHL OAuth scopes |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_PRICE_ID` | Stripe price ID for standard tier |
| `STRIPE_VOLUME_PRICE_ID` | Stripe price ID for volume tier |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `EMAIL_ENABLED` | `true` to enable email notifications |
| `MAILGUN_API_KEY` | Mailgun API key |
| `MAILGUN_DOMAIN` | Mailgun sending domain |
| `DRIP_MODE_ENABLED` | `true` to enable message queue delay |
| `DRIP_DELAY_MS` | Delay between queued messages in ms |
| `SESSION_PATH` | Path for WhatsApp session storage |
| `ADMIN_EMAIL` | Default admin login email |
| `ADMIN_PASSWORD` | Default admin login password |

### Production Deployment

```bash
# Build frontend
cd frontend && npm run build

# Start with PM2
cd ../backend
npx pm2 start src/index.js --name waghl-saas
npx pm2 save

# Deploy updates
cd ~/waghl && git pull && cd backend && npx pm2 restart waghl-saas
```

### Stripe Webhook

Set up a Stripe webhook endpoint pointing to:
```
https://yourdomain.com/api/stripe/webhook
```

Events to listen for:
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

### GHL Marketplace App Setup

1. Create app in [GHL Marketplace](https://marketplace.gohighlevel.com)
2. Set redirect URI to `https://yourdomain.com/api/oauth/callback`
3. Set default webhook URL to `https://yourdomain.com/api/ghl/webhook`
4. Enable webhook events: **OutboundMessage**, **ContactCreate**, **ContactDelete**
5. Create a **Conversation Provider** module (Type: SMS, Delivery URL: your webhook URL)
6. Configure scopes: `contacts.readonly`, `contacts.write`, `conversations.readonly`, `conversations.write`, `conversations/message.readonly`, `conversations/message.write`, `locations.readonly`, `oauth.write`, `oauth.readonly`

## API Endpoints

### Authentication

```
POST /api/auth/register    - Register new customer
POST /api/auth/login       - Login
GET  /api/auth/me          - Get current user
POST /api/auth/forgot-password - Request password reset
POST /api/auth/reset-password  - Reset password
```

### Sub-Accounts

```
GET    /api/sub-accounts     - List all sub-accounts
POST   /api/sub-accounts     - Create sub-account
GET    /api/sub-accounts/:id - Get sub-account
PUT    /api/sub-accounts/:id - Update sub-account
DELETE /api/sub-accounts/:id - Delete sub-account
```

### WhatsApp

```
POST /api/whatsapp/:subAccountId/connect    - Start connection (get QR)
GET  /api/whatsapp/:subAccountId/qr         - Get QR code
GET  /api/whatsapp/:subAccountId/status     - Get connection status
POST /api/whatsapp/:subAccountId/disconnect - Disconnect
POST /api/whatsapp/:subAccountId/send       - Send message
```

### GHL Integration

```
GET  /api/ghl/auth/:subAccountId - Start GHL OAuth flow
GET  /api/ghl/callback           - OAuth callback
GET  /api/ghl/status/:subAccountId - Get GHL connection status
POST /api/ghl/disconnect/:subAccountId - Disconnect GHL
POST /api/ghl/webhook             - GHL webhook receiver
```

### Billing

```
POST /api/billing/create-checkout/:subAccountId - Create Stripe checkout
POST /api/billing/cancel/:subAccountId          - Cancel subscription
POST /api/billing/resubscribe/:subAccountId     - Resubscribe (undo cancel)
```

## How It Works

1. **Customer registers** and gets a 7-day free trial
2. **Connects GHL** via OAuth flow which installs the app on their GHL location
3. **Connects WhatsApp** by scanning QR code to link WhatsApp Web session
4. **GHL sends outbound message** -> webhook received -> message queued -> sent via WhatsApp
5. **WhatsApp receives inbound message** -> Baileys callback -> pushed to GHL conversation via API

## License

Proprietary - All rights reserved
