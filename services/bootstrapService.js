const logger = require('../utils/logger');
const { Bootstrap } = require('../config/db');
const FPLAPIProxyService = require('./fplApiProxyService');

// Enhanced default data with more comprehensive dummy values
const DEFAULT_BOOTSTRAP_DATA = {
  events: [{ 
    id: 29, 
    is_current: true, 
    deadline_time: new Date().toISOString() 
  }],
  teams: [{ 
    id: 1, 
    short_name: 'UNK', 
    name: 'Unknown Team' 
  }],
  elements: [
    {
      id: 1,
      first_name: 'Unknown',
      second_name: 'Player',
      web_name: 'Unknown Player',
      team: 1,
      element_type: 1, // 1 = Goalkeeper
      now_cost: 40, // 4.0
      total_points: 0,
      selected_by_percent: '0.0'
    }
  ]
};

const loadBootstrapData = async (forceRefresh = false, retries = 3) => {
  try {
    // Check if we can use cached data (unless forced refresh is requested)
    if (!forceRefresh) {
      try {
        const cachedDoc = await Bootstrap.findOne({ _id: 'bootstrap:latest' }).exec();
        if (cachedDoc && cachedDoc.data && cachedDoc.data.elements?.length > 0) {
          logger.info('Using cached bootstrap data');
          return cachedDoc.data;
        }
      } catch (cacheError) {
        logger.error('Error retrieving cached bootstrap data', { 
          message: cacheError.message 
        });
      }
    }
    
    // Use FPLAPIProxyService for more reliable data fetching
    const rawData = await FPLAPIProxyService.fetchBootstrapData();
    
    // Validate data structure
    if (!rawData.elements || rawData.elements.length === 0) {
      throw new Error('No player elements found in bootstrap data');
    }
    
    // Normalize data to ensure consistent structure
    const bootstrapData = {
      events: rawData.events || [],
      teams: rawData.teams || [],
      elements: rawData.elements.map(player => ({
        id: player.id,
        first_name: player.first_name || 'Unknown',
        second_name: player.second_name || 'Player',
        web_name: player.web_name || `${player.first_name || 'Unknown'} ${player.second_name || 'Player'}`,
        team: player.team || 1,
        element_type: player.element_type || 1,
        now_cost: player.now_cost || 40,
        total_points: player.total_points || 0,
        selected_by_percent: player.selected_by_percent || '0.0'
      }))
    };
    
    // Cache in MongoDB
    await Bootstrap.findOneAndUpdate(
      { _id: 'bootstrap:latest' },
      { 
        data: bootstrapData, 
        timestamp: new Date() 
      },
      { upsert: true }
    );
    
    logger.info('Bootstrap data successfully fetched and cached', {
      elementCount: bootstrapData.elements.length,
      teamCount: bootstrapData.teams.length,
      eventCount: bootstrapData.events.length
    });
    
    return bootstrapData;
  } catch (error) {
    logger.error('Error fetching bootstrap data', { 
      message: error.message,
      stack: error.stack
    });
    
    // Fallback to cached data
    try {
      const cachedDoc = await Bootstrap.findOne({ _id: 'bootstrap:latest' }).exec();
      if (cachedDoc && cachedDoc.data && cachedDoc.data.elements?.length > 0) {
        logger.info('Using cached bootstrap data');
        return cachedDoc.data;
      }
    } catch (cacheError) {
      logger.error('Error retrieving cached bootstrap data', { 
        message: cacheError.message 
      });
    }
    
    // Final fallback to default data
    logger.warn('Using default bootstrap data');
    return DEFAULT_BOOTSTRAP_DATA;
  }
};

module.exports = { 
  loadBootstrapData, 
  DEFAULT_BOOTSTRAP_DATA 
};