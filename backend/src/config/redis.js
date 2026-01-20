const { createClient } = require('redis');
const logger = require('../utils/logger');

let redisClient = null;

async function initializeRedis() {
  try {
    redisClient = createClient({
      socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379
      },
      password: process.env.REDIS_PASSWORD || undefined
    });

    redisClient.on('error', (err) => {
      logger.error('Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      logger.info('Redis client connected');
    });

    await redisClient.connect();
    return redisClient;
  } catch (error) {
    logger.error('Failed to initialize Redis:', error);
    // Don't throw - allow app to work without Redis in development
    return null;
  }
}

function getRedisClient() {
  return redisClient;
}

module.exports = { initializeRedis, getRedisClient };
