const axios = require('axios');
const logger = require('../utils/logger');
const { Bootstrap, reconnectWithBackoff } = require('../config/db');

const DEFAULT_BOOTSTRAP_DATA = { events: [], teams: [], elements: [] };

const loadBootstrapData = async (retries = 3, initialDelayMs = 1000) => {
  let bootstrapData; // Store API data outside try-catch for fallback

  try {
    await reconnectWithBackoff();
    logger.info('MongoDB connection established');

    const cachedDoc = await Bootstrap.findOne({ _id: 'bootstrap:latest' })
      .sort({ timestamp: -1 })
      .exec();
    if (cachedDoc && cachedDoc.data && cachedDoc.data.elements?.length > 0) {
      logger.info('Bootstrap data loaded from MongoDB cache', { elementCount: cachedDoc.data.elements.length });
      return cachedDoc.data;
    } else {
      logger.info('No valid cached data found in MongoDB');
    }

    // Fetch from API with retries
    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios.get('https://fantasy.premierleague.com/api/bootstrap-static/', {
          timeout: 30000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Origin': 'https://fantasy.premierleague.com',
            'Referer': 'https://fantasy.premierleague.com/'
          }
        });
        bootstrapData = response.data;
        logger.info('API response received', { status: response.status, elementCount: bootstrapData.elements?.length || 0 });

        if (!bootstrapData || !bootstrapData.elements || !Array.isArray(bootstrapData.elements) || bootstrapData.elements.length === 0) {
          throw new Error(`Invalid bootstrap data: ${JSON.stringify(bootstrapData).slice(0, 100)}`);
        }
        break;
      } catch (fetchError) {
        logger.error(`Fetch attempt ${i + 1}/${retries} failed`, { message: fetchError.message, status: fetchError.response?.status });
        if (i < retries - 1) {
          const backoff = initialDelayMs * Math.pow(2, i) + Math.random() * 300;
          logger.info(`Retrying after ${backoff}ms`);
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
        throw fetchError;
      }
    }

    // Cache with upsert to avoid duplicate key error
    try {
      await Bootstrap.updateOne(
        { _id: 'bootstrap:latest' },
        { $set: { data: bootstrapData, timestamp: Date.now() } },
        { upsert: true }
      );
      logger.info('Bootstrap data cached in MongoDB');
    } catch (cacheError) {
      logger.error('Failed to cache bootstrap data in MongoDB', { message: cacheError.message });
      // Continue with API data even if caching fails
    }

    logger.info('Returning fetched bootstrap data', { elementCount: bootstrapData.elements.length });
    return bootstrapData;

  } catch (error) {
    logger.error('Failed to load bootstrap data', { message: error.message, stack: error.stack });

    // Fallback to cached data if API fetch failed
    if (!bootstrapData) {
      try {
        const fallbackDoc = await Bootstrap.findOne({ _id: 'bootstrap:latest' }).exec();
        if (fallbackDoc && fallbackDoc.data && fallbackDoc.data.elements?.length > 0) {
          logger.info('Using MongoDB cached data as fallback', { elementCount: fallbackDoc.data.elements.length });
          return fallbackDoc.data;
        }
        logger.info('No valid cache available');
      } catch (cacheError) {
        logger.error('Cache fallback failed', { message: cacheError.message });
      }

      logger.warn('Using default data as final fallback');
      return DEFAULT_BOOTSTRAP_DATA;
    }

    // If API succeeded but caching failed, return the fetched data
    logger.info('Returning API data despite caching failure', { elementCount: bootstrapData.elements.length });
    return bootstrapData;
  }
};

module.exports = { loadBootstrapData };