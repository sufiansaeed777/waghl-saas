# WAGHL SaaS - Setup & Operations Guide

## Table of Contents

1. [Server Setup (Cloudways)](#1-server-setup-cloudways)
2. [Restart Procedures](#2-restart-procedures)
3. [Adding New Customers](#3-adding-new-customers)
4. [Baileys Session Handling](#4-baileys-session-handling)
5. [Troubleshooting](#5-troubleshooting)

---

## 1. Server Setup (Cloudways)

### Prerequisites

- Cloudways account with a server (2GB+ RAM recommended)
- Domain/subdomain pointed to server IP
- SSH access to server

### Step 1: Server Configuration

```bash
# SSH into your Cloudways server
ssh master@your-server-ip

# Navigate to application folder
cd applications/your-app-folder/public_html
```

### Step 2: Install Node.js 18+

```bash
# Install nvm (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc

# Install Node.js 18
nvm install 18
nvm use 18
nvm alias default 18
```

### Step 3: Install PM2 (Process Manager)

```bash
npm install -g pm2
```

### Step 4: Clone Repository

```bash
git clone https://github.com/your-repo/waghl-saas.git .
# Or upload files via SFTP
```

### Step 5: Install Dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
npm run build
```

### Step 6: Configure Environment

```bash
cd backend
cp .env.example .env
nano .env
```

**Required Environment Variables:**

```env
NODE_ENV=production
PORT=3000
API_URL=https://whatsapp.yourdomain.com

# Database (use Cloudways database credentials)
DB_HOST=localhost
DB_PORT=3306
DB_NAME=your_database
DB_USER=your_user
DB_PASSWORD=your_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT (generate secure random string)
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
JWT_EXPIRES_IN=7d

# Stripe
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_ID=price_xxx

# Admin account (created on first run)
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=secure_password_here

# Session storage
SESSION_PATH=./sessions

# Frontend URL
FRONTEND_URL=https://whatsapp.yourdomain.com

# GHL Integration (optional)
GHL_CLIENT_ID=your_ghl_client_id
GHL_CLIENT_SECRET=your_ghl_client_secret
GHL_REDIRECT_URI=https://whatsapp.yourdomain.com/api/ghl/callback
```

### Step 7: Setup Database

```bash
# Create database tables
npm run start
# Wait for "Database synchronized" message, then Ctrl+C
```

### Step 8: Start with PM2

```bash
npm run pm2:start
# Or manually:
pm2 start ecosystem.config.js --env production
```

### Step 9: Configure Nginx (Reverse Proxy)

Add to your Nginx configuration:

```nginx
location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_cache_bypass $http_upgrade;
}
```

### Step 10: Setup PM2 Startup

```bash
pm2 startup
pm2 save
```

---

## 2. Restart Procedures

### Normal Restart

```bash
cd /path/to/backend
npm run pm2:restart
# Or: pm2 restart waghl-saas
```

### Full Restart (Stop and Start)

```bash
pm2 stop waghl-saas
pm2 start waghl-saas
```

### View Logs

```bash
npm run pm2:logs
# Or: pm2 logs waghl-saas
```

### Check Status

```bash
npm run pm2:status
# Or: pm2 status
```

### Server Reboot Recovery

PM2 will auto-start if configured with `pm2 startup`. WhatsApp sessions will auto-reconnect on server start.

### Force Restart (Clear Everything)

```bash
pm2 delete waghl-saas
pm2 start ecosystem.config.js --env production
```

---

## 3. Adding New Customers

### Method 1: Customer Self-Registration

Customers can register at: `https://yourdomain.com/register`

Required information:
- Email address
- Password
- Name
- Company (optional)

### Method 2: Admin Creates Customer

1. Login as admin at `https://yourdomain.com/login`
2. Go to Admin Dashboard
3. Use the database or API to create customers

### Method 3: API Registration

```bash
curl -X POST https://yourdomain.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "customer@example.com",
    "password": "secure_password",
    "name": "Customer Name",
    "company": "Company Name"
  }'
```

### Method 4: Direct Database Insert

```sql
INSERT INTO customers (id, email, password, name, company, role, "isActive", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'customer@example.com',
  '$2a$12$...', -- bcrypt hash of password
  'Customer Name',
  'Company Name',
  'customer',
  true,
  NOW(),
  NOW()
);
```

### Customer Onboarding Flow

1. Customer registers/is created
2. Customer logs in
3. Customer creates a sub-account (WhatsApp number)
4. Customer pays for sub-account (Stripe)
5. Customer scans QR code to connect WhatsApp
6. Customer configures webhook URL
7. Customer starts sending/receiving messages

---

## 4. Baileys Session Handling

### How Sessions Work

- Each sub-account has a dedicated session folder: `backend/sessions/{subAccountId}/`
- Sessions contain WhatsApp authentication credentials
- Sessions persist across server restarts
- Auto-reconnect attempts when disconnected

### Session Storage Structure

```
backend/sessions/
├── sub-account-uuid-1/
│   ├── creds.json         # Authentication credentials
│   ├── app-state-sync-*.json  # Sync state
│   └── pre-key-*.json     # Pre-keys
├── sub-account-uuid-2/
│   └── ...
```

### Auto-Reconnect Behavior

1. **On Disconnect**: System waits 5 seconds, then attempts reconnect
2. **On Server Restart**: All previously connected sessions auto-reconnect
3. **On Logout**: Session files are deleted, user must scan QR again

### Manual Session Management

**Clear a specific session:**
```bash
rm -rf backend/sessions/{subAccountId}
```

**Clear all sessions:**
```bash
rm -rf backend/sessions/*
```

**Backup sessions:**
```bash
cp -r backend/sessions backend/sessions-backup-$(date +%Y%m%d)
```

### Session States

| State | Description |
|-------|-------------|
| `disconnected` | Not connected, no active session |
| `connecting` | Attempting to connect |
| `qr_ready` | QR code available for scanning |
| `connected` | Successfully connected |

### Troubleshooting Sessions

**Session won't reconnect:**
1. Delete the session folder
2. Have user scan QR code again

**"Session expired" errors:**
1. WhatsApp was logged out on phone
2. Delete session folder
3. User must re-scan QR

**Multiple devices warning:**
1. WhatsApp Web only allows one web session
2. Previous session may need to be logged out

### Code Reference

Session restoration on startup (`backend/src/index.js`):
```javascript
// Called after server starts
await whatsappService.restoreSessions();
```

Session auto-reconnect (`backend/src/services/whatsapp.js`):
```javascript
// On disconnect, attempt reconnect after 5 seconds
if (shouldReconnect) {
  setTimeout(() => this.connect(subAccountId), 5000);
}
```

---

## 5. Troubleshooting

### Common Issues

**QR code not appearing:**
- Check if sub-account is active (`isActive: true`)
- Check PM2 logs for errors
- Verify Baileys version compatibility

**Messages not sending:**
- Verify WhatsApp is connected (status: 'connected')
- Check rate limits (WhatsApp has sending limits)
- Review error logs

**Webhooks not triggering:**
- Verify webhook URL is accessible
- Check webhook `isActive` status
- Review failure count (auto-disabled after 10 failures)

**Database connection errors:**
- Verify DB credentials in .env
- Check if PostgreSQL is running
- Verify database exists

### Log Files

```bash
# PM2 logs
pm2 logs waghl-saas

# Application logs
tail -f backend/logs/combined.log
tail -f backend/logs/error.log
```

### Health Check

```bash
curl https://yourdomain.com/health
# Should return: {"status":"ok","timestamp":"..."}
```

### Support

For issues, check:
1. PM2 logs: `pm2 logs waghl-saas`
2. Error log: `backend/logs/error.log`
3. Database connectivity
4. Redis connectivity
