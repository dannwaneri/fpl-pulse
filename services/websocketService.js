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
async function fetchWithRetry(url, retries, delayMs) {
  for (let i = 0; i < retries; i++) {
    try {
      // No headers approach for internal API calls
      const response = await axios.get(url, {
        timeout: 15000
        // No headers at all for internal calls to our proxy
      });
      
      return response;
    } catch (err) {
      const status = err.response?.status;
      logger.error(`Fetch attempt ${i + 1}/${retries} failed for ${url}`, {
        status,
        message: err.message
      });
      
      if (status === 403 || status === 429) {
        const retryAfter = err.response?.headers['retry-after'] 
          ? Math.max(parseInt(err.response.headers['retry-after'], 10) * 1000, 1000)
          : 60000;
        logger.info(`Rate limited or forbidden, waiting ${retryAfter}ms`);
        await delay(retryAfter);
        continue;
      }
      
      if (i === retries - 1) throw err;
      await delay(delayMs);
    }
  }
}

const fetchLiveData = async (gameweek) => {
  const BASE_URL = process.env.NODE_ENV === 'production' 
    ? 'https://fpl-pulse.onrender.com' 
    : 'http://localhost:5000';

  try {
    let response;
    
    // First check if we have fresh data in memory cache
    if (global.liveDataCache[gameweek] && 
        global.liveDataCache[`${gameweek}:timestamp`] && 
        Date.now() - global.liveDataCache[`${gameweek}:timestamp`] < 300000) { // 5 minutes
      logger.info(`Using in-memory cache for GW ${gameweek}`);
      return;
    }
    
    // Use our new CORS-friendly endpoint
    try {
      logger.info(`Fetching live data for GW ${gameweek} via proxy`);
      response = await fetchWithRetry(`${BASE_URL}/fpl-basic/live/${gameweek}`, 2, 1000);
      
      if (!response || !response.data || !Array.isArray(response.data.elements)) {
        throw new Error('Invalid or empty response received from proxy');
      }
      
      logger.info(`Successfully fetched live data for GW ${gameweek} via proxy`);
    } catch (proxyError) {
      logger.warn(`Proxy fetch failed for GW ${gameweek}`, { 
        error: proxyError.message,
        statusCode: proxyError.response?.status
      });
      
      // Fall back to cached data if proxy fails
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
      error: error.message 
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