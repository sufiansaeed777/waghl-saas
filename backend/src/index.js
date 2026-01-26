require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { sequelize } = require('./models');
const logger = require('./utils/logger');
const routes = require('./routes');
const { initializeRedis } = require('./config/redis');
const whatsappService = require('./services/whatsapp');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (behind nginx/varnish)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

// Rate limiting (exclude webhooks)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => {
    // Skip rate limiting for webhook, callback, and embed endpoints
    return req.path.includes('/webhook') || req.path.includes('/callback') || req.path.includes('/embed');
  }
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api', routes);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Initialize and start server
async function startServer() {
  try {
    // Connect to database
    await sequelize.authenticate();
    logger.info('Database connected successfully');

    // Sync database (creates tables if not exist)
    await sequelize.sync({ alter: process.env.NODE_ENV === 'development' });
    logger.info('Database synchronized');

    // Initialize Redis
    await initializeRedis();
    logger.info('Redis connected successfully');

    // Start server
    app.listen(PORT, async () => {
      logger.info(`Server running on port ${PORT}`);

      // Restore WhatsApp sessions after server starts
      logger.info('Restoring WhatsApp sessions...');
      await whatsappService.restoreSessions();
      logger.info('WhatsApp session restoration complete');
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
