const axios = require('axios');
const logger = require('../utils/logger');
const { Bootstrap, reconnectWithBackoff } = require('../config/db');

// Enhanced default data with dummy values for basic functionality
const DEFAULT_BOOTSTRAP_DATA = {
  events: [{ id: 29, is_current: true, deadline_time: new Date().toISOString() }],
  teams: [{ id: 1, short_name: 'UNK', name: 'Unknown Team' }],
  elements: [
    {
      id: 1,
      first_name: 'Unknown',
      second_name: 'Player',
      team: 1,
      element_type: 1, // 1 = Goalkeeper
      web_name: 'U. Player',
      total_points: 0
    }
  ]
};

const delay = (ms) => new Promise(resolve => {
  const jitter = Math.random() * 300;
  setTimeout(resolve, ms + jitter);
});

const loadBootstrapData = async (retries = 3, initialDelayMs = 1000) => {
  let bootstrapData;

  try {
    await reconnectWithBackoff();
    logger.info('MongoDB connection established');

    const cachedDoc = await Bootstrap.findOne({ _id: 'bootstrap:latest' })
      .sort({ timestamp: -1 })
      .exec();

    // Loosened cache validation: Accept if elements or teams are present
    if (cachedDoc && cachedDoc.data && (cachedDoc.data.elements?.length > 0 || cachedDoc.data.teams?.length > 0)) {
      logger.info('Bootstrap data loaded from MongoDB cache', {
        elementCount: cachedDoc.data.elements?.length || 0,
        teamCount: cachedDoc.data.teams?.length || 0
      });
      return cachedDoc.data;
    }
    logger.info('No valid cached data found in MongoDB');

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
        logger.info('API response received', { elementCount: bootstrapData.elements?.length || 0 });
        break;
      } catch (fetchError) {
        logger.error(`Fetch attempt ${i + 1}/${retries} failed`, {
          message: fetchError.message,
          status: fetchError.response?.status
        });

        if (i < retries - 1) {
          const backoff = initialDelayMs * Math.pow(2, i);
          logger.info(`Retrying after ${backoff}ms`);
          await delay(backoff);
          continue;
        }
        throw fetchError;
      }
    }

    await Bootstrap.updateOne(
      { _id: 'bootstrap:latest' },
      { $set: { data: bootstrapData, timestamp: Date.now() } },
      { upsert: true }
    ).catch(cacheError => {
      logger.error('Failed to cache bootstrap data', { message: cacheError.message });
    });

    logger.info('Returning fetched bootstrap data', { elementCount: bootstrapData.elements.length });
    return bootstrapData;

  } catch (error) {
    logger.error('Failed to load bootstrap data', { message: error.message });

    if (!bootstrapData) {
      const fallbackDoc = await Bootstrap.findOne({ _id: 'bootstrap:latest' }).exec();
      // Loosened validation for fallback as well
      if (fallbackDoc && fallbackDoc.data && (fallbackDoc.data.elements?.length > 0 || fallbackDoc.data.teams?.length > 0)) {
        logger.info('Using MongoDB cached data as fallback', {
          elementCount: fallbackDoc.data.elements?.length || 0,
          teamCount: fallbackDoc.data.teams?.length || 0
        });
        return fallbackDoc.data;
      }
      logger.info('No valid cache available');
      logger.warn('Using default data as final fallback');
      return DEFAULT_BOOTSTRAP_DATA;
    }

    logger.info('Returning API data despite caching failure', { elementCount: bootstrapData.elements.length });
    return bootstrapData;
  }
};

module.exports = { loadBootstrapData, DEFAULT_BOOTSTRAP_DATA };