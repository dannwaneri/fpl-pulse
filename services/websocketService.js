const axios = require('axios');
const { updatePicksFromLiveData, getTop10kStats, memoryCache, estimateLiveRank, getPicksData, getManagerData} = require('./fplService');
const WebSocket = require('ws');
const { Bootstrap } = require('../config/db'); 
const { loadBootstrapData } = require('./bootstrapService');
const FPLAPIProxyService = require('./fplApiProxyService');
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



const fetchLiveData = async (gameweek) => {
  logger.info('Fetch Live Data Request', {
    gameweek,
    timestamp: new Date().toISOString()
  });

  try {
    // Check if we have fresh data in memory cache
    if (global.liveDataCache[gameweek] && 
        global.liveDataCache[`${gameweek}:timestamp`] && 
        Date.now() - global.liveDataCache[`${gameweek}:timestamp`] < 300000) { // 5 minutes
      logger.info(`Using in-memory cache for GW ${gameweek}`);
      return global.liveDataCache[gameweek];
    }

    let liveData;
    let dataSource = 'unknown';
    
    try {
      // Use FPLAPIProxyService which now tries Cloudflare worker first
      liveData = await FPLAPIProxyService.fetchLiveData(gameweek);
      dataSource = FPLAPIProxyService.getErrorTrackerStatus().usingWorker ? 'worker_proxy' : 'direct_api';
      
      logger.info('Successfully fetched live data', {
        gameweek,
        elementsCount: liveData.elements?.length || 0,
        source: dataSource,
        proxyStatus: FPLAPIProxyService.getErrorTrackerStatus?.() || 'not available'
      });
    } catch (apiError) {
      logger.warn(`API fetch failed for gameweek ${gameweek}`, {
        errorMessage: apiError.message,
        statusCode: apiError.response?.status
      });

      // Fallback to cached data
      try {
        const cachedBootstrap = await Bootstrap.findOne({ _id: 'bootstrap:latest' }).exec();
        const cachedLiveData = cachedBootstrap?.data?.events?.[gameweek - 1]?.live_data;
        
        if (cachedLiveData && Array.isArray(cachedLiveData)) {
          logger.info(`Using cached bootstrap data for gameweek ${gameweek}`);
          liveData = { elements: cachedLiveData };
          dataSource = 'bootstrap_cache';
        } else {
          // Final fallback
          logger.warn(`Using default fallback data for gameweek ${gameweek}`);
          liveData = { elements: DEFAULT_LIVE_DATA.elements };
          dataSource = 'default_fallback';
        }
      } catch (cacheError) {
        logger.error('Cache retrieval error', {
          message: cacheError.message,
          stack: cacheError.stack
        });
        
        // Absolute last resort
        liveData = { elements: DEFAULT_LIVE_DATA.elements };
        dataSource = 'absolute_fallback';
      }
    }

    // Ensure elements exist
    const newData = liveData.elements || [];

    // Check if data has changed before processing
    if (JSON.stringify(newData) !== JSON.stringify(global.liveDataCache[gameweek])) {
      // Update cache with timestamp and source info
      global.liveDataCache[gameweek] = newData;
      global.liveDataCache[`${gameweek}:timestamp`] = Date.now();
      global.liveDataCache[`${gameweek}:source`] = dataSource;
      
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
                assistantManager: picksData.assistantManager,
                dataSource
              }));

              client.send(JSON.stringify({
                type: 'top10kUpdate',
                gameweek,
                stats: updatedStats
              }));

              logger.info(`Sent live update to fplId ${fplId} for GW ${gameweek}`, {
                dataSource,
                totalLivePoints
              });
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

    return newData;
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
          message: 'Unable to fetch live data. Showing placeholder data.',
          gameweek
        }));
      }
    });

    // Ensure some data exists
    if (!global.liveDataCache[gameweek]) {
      global.liveDataCache[gameweek] = DEFAULT_LIVE_DATA.elements;
      global.liveDataCache[`${gameweek}:timestamp`] = Date.now();
      global.liveDataCache[`${gameweek}:source`] = 'error_fallback';
    }

    return global.liveDataCache[gameweek] || DEFAULT_LIVE_DATA.elements;
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