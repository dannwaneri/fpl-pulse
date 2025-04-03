const axios = require('axios');
const { updatePicksFromLiveData, getTop10kStats, memoryCache, estimateLiveRank, getPicksData, getManagerData } = require('./fplService');
const WebSocket = require('ws');
const { Bootstrap } = require('../config/db'); 
const { loadBootstrapData } = require('./bootstrapService');
const logger = require('../utils/logger');

// Default live data fallback
const DEFAULT_LIVE_DATA = {
  elements: [
    { id: 1, stats: { total_points: 0, bonus: 0, in_dream_team: false } }
  ]
};

// Initialize global variables
global.liveDataCache = global.liveDataCache || {};
// Define subscriptions at module level so it's accessible to all functions
const subscriptions = new Map();

const delay = (ms) => new Promise(resolve => {
  const jitter = Math.random() * 300;
  setTimeout(resolve, ms + jitter);
});
async function fetchWithRetry(url, retries = 3, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      // Log the fetch attempt
      logger.info(`Fetch attempt ${i + 1}/${retries} for ${url}`, {
        url,
        attempt: i + 1,
        maxRetries: retries
      });

      // Perform the axios get request
      const response = await axios.get(url, {
        timeout: 15000, // 15 seconds timeout
        headers: {
          'User-Agent': 'FPL Pulse/1.0',
          'Accept': 'application/json'
        }
      });

      // Log successful response
      logger.info(`Successful fetch for ${url}`, {
        status: response.status,
        dataKeys: Object.keys(response.data)
      });

      // Validate response structure
      if (!response || !response.data) {
        throw new Error('Invalid response structure');
      }

      return response;
    } catch (err) {
      // Detailed error logging
      logger.error(`Fetch attempt ${i + 1}/${retries} failed for ${url}`, {
        errorMessage: err.message,
        status: err.response?.status,
        errorDetails: err.response?.data
      });

      // Handle specific error scenarios
      if (err.response) {
        switch (err.response.status) {
          case 403: // Forbidden
            logger.warn(`Forbidden access for ${url}`);
            break;
          case 429: // Rate limited
            const retryAfter = err.response.headers['retry-after'] 
              ? Math.max(parseInt(err.response.headers['retry-after'], 10) * 1000, 1000)
              : 60000;
            logger.info(`Rate limited, waiting ${retryAfter}ms`);
            await delay(retryAfter);
            continue;
          case 500: // Server error
          case 502: // Bad Gateway
          case 503: // Service Unavailable
          case 504: // Gateway Timeout
            logger.warn(`Server error for ${url}, status: ${err.response.status}`);
            break;
        }
      }

      // Exponential backoff with jitter
      if (i < retries - 1) {
        const jitteredDelay = delayMs * Math.pow(2, i) + Math.random() * 1000;
        logger.info(`Waiting ${jitteredDelay}ms before retry`);
        await delay(jitteredDelay);
      }

      // Throw on last attempt
      if (i === retries - 1) {
        throw err;
      }
    }
  }

  // Fallback throw if all retries fail
  throw new Error(`Failed to fetch ${url} after ${retries} attempts`);
}



const fetchLiveData = async (gameweek) => {
  const BASE_URL = process.env.NODE_ENV === 'production' 
    ? 'https://fpl-pulse.onrender.com' 
    : 'http://localhost:5000';
    
  logger.info('Fetch Live Data Configuration', {
    gameweek,
    baseUrl: BASE_URL,
    nodeEnv: process.env.NODE_ENV
  });

  try {
    let response;
    
    // First check if we have fresh data in memory cache
    if (global.liveDataCache[gameweek] && 
        global.liveDataCache[`${gameweek}:timestamp`] && 
        Date.now() - global.liveDataCache[`${gameweek}:timestamp`] < 300000) { // 5 minutes
      logger.info(`Using in-memory cache for GW ${gameweek}`);
      return;
    }
    
    // Log all potential URLs
    const possibleUrls = [
      `${BASE_URL}/api/fpl/live/${gameweek}`,
      `https://fpl-pulse.onrender.com/api/fpl/live/${gameweek}`,
      `http://fpl-pulse.onrender.com/api/fpl/live/${gameweek}`
    ];
    
    let lastError = null;
    let fetchSuccess = false;
    
    for (const url of possibleUrls) {
      if (fetchSuccess) break;
      
      try {
        logger.info(`Attempting to fetch from URL: ${url}`);
        
        response = await fetchWithRetry(url, 3, 1000);
        
        if (!response || !response.data || !Array.isArray(response.data.elements)) {
          logger.warn('Invalid response structure from URL', { 
            url,
            dataKeys: response ? Object.keys(response.data || {}) : 'No response data',
            elementsType: response?.data?.elements ? typeof response.data.elements : 'undefined'
          });
          continue;
        }
        
        logger.info('Successful fetch details', {
          url,
          elementsCount: response.data?.elements?.length || 0,
          sampleElement: response.data?.elements?.[0]?.id
        });
        
        fetchSuccess = true;
      } catch (fetchError) {
        logger.error(`Failed to fetch from ${url}`, {
          error: fetchError.message,
          status: fetchError.response?.status,
          stack: fetchError.stack
        });
        lastError = fetchError;
      }
    }
    
    // If all URLs fail, fall back to cached data
    if (!fetchSuccess) {
      logger.warn(`All live data URLs failed for GW ${gameweek}, falling back to cached data`);
      
      try {
        const cachedBootstrap = await Bootstrap.findOne({ _id: 'bootstrap:latest' }).exec();
        const cachedLiveData = cachedBootstrap?.data?.events?.[gameweek - 1]?.live_data;
        
        if (cachedLiveData && Array.isArray(cachedLiveData)) {
          logger.info(`Using cached live data from Bootstrap for GW ${gameweek}`);
          response = { data: { elements: cachedLiveData } };
        } else {
          // Absolute fallback to default data
          logger.warn(`Using default live data fallback for GW ${gameweek}`);
          response = { data: DEFAULT_LIVE_DATA };
        }
      } catch (cacheError) {
        logger.error(`Cache retrieval failed for GW ${gameweek}`, {
          error: cacheError.message
        });
        // Final fallback
        response = { data: DEFAULT_LIVE_DATA };
      }
    }

    // Ensure elements array exists
    const newData = response.data.elements || [];
    
    // Validate data is an array before using it
    if (!Array.isArray(newData)) {
      throw new Error(`Invalid data format: Expected array, got ${typeof newData}`);
    }

    // Check if data has changed before processing
    if (JSON.stringify(newData) !== JSON.stringify(global.liveDataCache[gameweek])) {
      // Update cache with timestamp
      global.liveDataCache[gameweek] = newData;
      global.liveDataCache[`${gameweek}:timestamp`] = Date.now();
      
      const updatedStats = await getTop10kStats(gameweek);

      // Parallel updates for subscribed clients
      const updatePromises = Array.from(subscriptions.entries())
        .filter(([_, { gameweek: subGW }]) => subGW === gameweek)
        .map(async ([client, { fplId }]) => {
          if (client.readyState !== WebSocket.OPEN) return;

          try {
            let picksData = memoryCache[`picks:${fplId}:${gameweek}`]?.data 
              || await getPicksData(fplId, gameweek);
            
            updatePicksFromLiveData(fplId, gameweek, newData);

            const totalLivePoints = picksData.totalLivePoints || 0;
            const assistantManagerPoints = picksData.assistantManagerPoints || 0;
            
            const managerData = await getManagerData(fplId).catch(err => {
              logger.warn(`getManagerData failed for fplId ${fplId}`, { error: err.message });
              return { totalPoints: 0, rank: 5000000 };
            });

            const liveRank = await estimateLiveRank(
              totalLivePoints, 
              managerData.totalPoints, 
              managerData.rank, 
              picksData.picks, 
              assistantManagerPoints
            ).catch(err => {
              logger.warn(`estimateLiveRank failed for fplId ${fplId}`, { error: err.message });
              return null;
            });

            // Only send if client is still connected
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: 'liveUpdate',
                gameweek,
                data: newData,
                fplId,
                totalLivePoints,
                liveRank,
                picks: picksData.picks || [],
                activeChip: picksData.activeChip,
                assistantManagerPoints,
                assistantManager: picksData.assistantManager
              }));

              client.send(JSON.stringify({
                type: 'top10kUpdate',
                gameweek,
                stats: updatedStats
              }));

              logger.info(`Sent live update to fplId ${fplId} for GW ${gameweek}`);
            }
          } catch (updateError) {
            logger.error(`Error processing update for fplId ${fplId}`, { 
              error: updateError.message 
            });
            
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: 'error',
                message: `Failed to process update: ${updateError.message}`
              }));
            }
          }
        });

      await Promise.allSettled(updatePromises);
    } else {
      logger.info(`No data changes for GW ${gameweek}, skipping updates`);
    }
  } catch (error) {
    logger.error(`Comprehensive fallback triggered for GW ${gameweek}`, { 
      error: error.message,
      stack: error.stack
    });

    // Notify all subscribed clients about the failure
    subscriptions.forEach((_, client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'error',
          message: 'Unable to fetch live data. Showing placeholder data.'
        }));
      }
    });

    // Ensure some data exists
    if (!global.liveDataCache[gameweek]) {
      global.liveDataCache[gameweek] = DEFAULT_LIVE_DATA.elements;
      global.liveDataCache[`${gameweek}:timestamp`] = Date.now();
    }
  }
};
const setupWebSocket = (wss) => {
  let currentGameweek = null;
  
  const initializeGameweek = async () => {
    try {
      const bootstrap = await loadBootstrapData();
      const cachedBootstrap = await Bootstrap.findOne({ _id: 'bootstrap:latest' }).exec();
  
      // Dynamic gameweek fallback
      const currentEvent = bootstrap.events.find(e => e.is_current);
      const latestCachedEvent = cachedBootstrap?.data?.events?.slice(-1)[0]?.id || 29;
      currentGameweek = currentEvent?.id || latestCachedEvent;
  
      logger.info('Current event found:', { gameweek: currentGameweek });
      await fetchLiveData(currentGameweek);
      setInterval(() => fetchLiveData(currentGameweek), 60000);
    } catch (error) {
      logger.error('Failed to initialize gameweek', { message: error.message });
      currentGameweek = currentGameweek || 29; // Fallback
      
      // Notify connected clients about using fallback data
      subscriptions.forEach((_, client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ 
            type: 'error', 
            message: 'Using fallback data. Some features may be limited.'
          }));
        }
      });
      
      fetchLiveData(currentGameweek);
      setInterval(() => fetchLiveData(currentGameweek), 60000);
    }
  };
  
  wss.on('connection', (ws) => {
    console.log('Client connected');
    ws.send(JSON.stringify({ 
      type: 'init', 
      gameweek: currentGameweek, 
      data: global.liveDataCache[currentGameweek] || DEFAULT_LIVE_DATA.elements 
    }));

    ws.on('message', (message) => {
      let parsedMessage;
      try {
        parsedMessage = JSON.parse(message);
        if (!parsedMessage.type || (parsedMessage.type === 'subscribe' && (!parsedMessage.fplId || !parsedMessage.gameweek))) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid subscription data' }));
          return;
        }
      } catch (err) {
        console.error('Invalid WebSocket message:', err);
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        return;
      }

      const { type } = parsedMessage;
      if (type === 'subscribe') {
        const { fplId, gameweek } = parsedMessage;
        if (fplId && gameweek) {
          subscriptions.set(ws, { fplId, gameweek });
          console.log(`Client subscribed: fplId ${fplId}, GW ${gameweek}`);
          if (!global.liveDataCache[gameweek]) fetchLiveData(gameweek);
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'fplId and gameweek are required' }));
        }
      }
    });

    ws.on('close', () => {
      subscriptions.delete(ws);
      console.log('Client disconnected');
    });
  });

  initializeGameweek();
};

module.exports = { setupWebSocket };