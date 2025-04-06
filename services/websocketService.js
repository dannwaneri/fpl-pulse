const axios = require('axios');
const { updatePicksFromLiveData, getTop10kStats, memoryCache, estimateLiveRank, getPicksData, getManagerData} = require('./fplService');
const WebSocket = require('ws');
const { Bootstrap } = require('../config/db'); 
const { loadBootstrapData } = require('./bootstrapService');
const FPLAPIProxyService = require('./fplApiProxyService');
const logger = require('../utils/logger');



const CACHE_TTL = {
  LIVE_DATA: 300000,  // 5 minutes (increase from current)
  BOOTSTRAP: 3600000  // 1 hour
};



// Connection and reconnection constants
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 60000; // 1 minute max
const CONNECTION_TIMEOUT = 10000; // 10 seconds
const CLIENT_LIMIT_PER_IP = 2; // Limit connections per IP

// Track connections to avoid duplicates
const connectionTracker = new Map(); // IP -> count
const reconnectTimers = new Map(); // client -> timer

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
    // More aggressive caching - increase cache time and add force-refresh param option
    if (global.liveDataCache[gameweek] && 
        global.liveDataCache[`${gameweek}:timestamp`] && 
        Date.now() - global.liveDataCache[`${gameweek}:timestamp`] < CACHE_TTL.LIVE_DATA) {
      logger.info(`Using in-memory cache for GW ${gameweek}, age: ${(Date.now() - global.liveDataCache[`${gameweek}:timestamp`])/1000}s`);
      return global.liveDataCache[gameweek];
    }

    let liveData;
    let dataSource = 'unknown';
    
    try {
      // Only attempt API calls if cache is stale
      liveData = await FPLAPIProxyService.fetchLiveData(gameweek);
      dataSource = FPLAPIProxyService.getErrorTrackerStatus().usingWorker ? 'worker_proxy' : 'direct_api';
      
      logger.info('Successfully fetched live data', {
        gameweek,
        elementsCount: liveData.elements?.length || 0,
        source: dataSource
      });
    } catch (apiError) {
      logger.warn(`API fetch failed for gameweek ${gameweek}, using cached data`, {
        errorMessage: apiError.message,
        statusCode: apiError.response?.status
      });

      // Use existing cache if available, even if slightly stale
      if (global.liveDataCache[gameweek]) {
        logger.info(`Reusing existing cache despite age for GW ${gameweek} due to fetch failure`);
        return global.liveDataCache[gameweek];
      }

      // Fallback to cached data from database only if memory cache unavailable
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

    // Check if data has changed before processing - avoid unnecessary work
    const existingDataString = JSON.stringify(global.liveDataCache[gameweek] || []);
    const newDataString = JSON.stringify(newData);
    
    if (newDataString !== existingDataString) {
      // Update cache with timestamp and source info
      global.liveDataCache[gameweek] = newData;
      global.liveDataCache[`${gameweek}:timestamp`] = Date.now();
      global.liveDataCache[`${gameweek}:source`] = dataSource;
      
      // Only update top10k stats once to avoid multiple API calls
      let updatedStats;
      try {
        updatedStats = await getTop10kStats(gameweek);
      } catch (statsError) {
        logger.warn(`Failed to get top10k stats: ${statsError.message}`);
        updatedStats = null;
      }

      // Batch update promises to avoid rate limiting
      const clientBatches = [];
      const clientsToUpdate = Array.from(subscriptions.entries())
        .filter(([_, { gameweek: subGW }]) => subGW === gameweek)
        .filter(([client, _]) => client.readyState === WebSocket.OPEN);
      
      // Process clients in batches of 5 to reduce parallel API load
      const BATCH_SIZE = 5;
      for (let i = 0; i < clientsToUpdate.length; i += BATCH_SIZE) {
        const batch = clientsToUpdate.slice(i, i + BATCH_SIZE);
        clientBatches.push(batch);
      }
      
      // Process batches sequentially
      for (const batch of clientBatches) {
        await Promise.allSettled(
          batch.map(async ([client, { fplId }]) => {
            try {
              // Check for cached picks data first
              let picksData = memoryCache[`picks:${fplId}:${gameweek}`]?.data;
              
              // Only fetch from API if cache is unavailable
              if (!picksData) {
                picksData = await getPicksData(fplId, gameweek);
              }
              
              updatePicksFromLiveData(fplId, gameweek, newData);

              const totalLivePoints = picksData.totalLivePoints || 0;
              const assistantManagerPoints = picksData.assistantManagerPoints || 0;
              
              let managerData, liveRank;
              
              // Use cached manager data if available
              if (memoryCache[`manager:${fplId}`]?.data) {
                managerData = memoryCache[`manager:${fplId}`].data;
              } else {
                try {
                  managerData = await getManagerData(fplId);
                } catch (err) {
                  logger.warn(`getManagerData failed for fplId ${fplId}`, { error: err.message });
                  managerData = { totalPoints: 0, rank: 5000000 };
                }
              }
              
              // Use cached rank if available
              if (memoryCache[`rank:${fplId}:${gameweek}:${totalLivePoints}`]?.data) {
                liveRank = memoryCache[`rank:${fplId}:${gameweek}:${totalLivePoints}`].data;
              } else {
                try {
                  liveRank = await estimateLiveRank(
                    totalLivePoints, 
                    managerData.totalPoints, 
                    managerData.rank, 
                    picksData.picks, 
                    assistantManagerPoints
                  );
                  
                  // Cache the rank estimation
                  memoryCache[`rank:${fplId}:${gameweek}:${totalLivePoints}`] = {
                    data: liveRank,
                    timestamp: Date.now()
                  };
                } catch (err) {
                  logger.warn(`estimateLiveRank failed for fplId ${fplId}`, { error: err.message });
                  liveRank = null;
                }
              }

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
                  dataSource,
                  timestamp: Date.now()
                }));

                // Only send top10k update if we have data
                if (updatedStats) {
                  client.send(JSON.stringify({
                    type: 'top10kUpdate',
                    gameweek,
                    stats: updatedStats
                  }));
                }

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
          })
        );
        
        // Small delay between batches to prevent API flooding
        if (clientBatches.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
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

// Client-side reconnection logic (to be exported)
const createReconnectionLogic = (ws) => {
  let reconnectAttempts = 0;
  
  const reconnect = () => {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.log('Max reconnection attempts reached, switching to polling');
      // Call a polling function if implemented
      if (typeof startPolling === 'function') {
        startPolling();
      }
      return;
    }
    
    // Calculate exponential backoff with jitter
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts) + 
      Math.random() * 1000,
      MAX_RECONNECT_DELAY
    );
    
    console.log(`WebSocket reconnect scheduled in ${delay}ms (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
    
    // Store the timer so we can cancel it if needed
    if (reconnectTimers.has(ws)) {
      clearTimeout(reconnectTimers.get(ws));
    }
    
    reconnectTimers.set(
      ws,
      setTimeout(() => {
        reconnectAttempts++;
        // Assuming connectWebSocket is defined in client code
        if (typeof connectWebSocket === 'function') {
          connectWebSocket();
        } else {
          // Generic reconnection
          const newWs = new WebSocket(ws.url);
          // Setup new connection...
        }
        reconnectTimers.delete(ws);
      }, delay)
    );
  };

  return {
    handleClose: (event) => {
      console.log('WebSocket closed:', { code: event.code, reason: event.reason });
      // Only attempt to reconnect for certain close codes
      if (event.code !== 1000 && event.code !== 1001) {
        reconnect();
      } else {
        console.log('Clean close, not reconnecting');
        if (subscriptions.has(ws)) {
          subscriptions.delete(ws);
        }
      }
    },
    handleError: (err) => {
      console.error('WebSocket error occurred:', err);
      // Don't immediately start polling or reconnecting
      // Let the close handler handle reconnection
    },
    reset: () => {
      reconnectAttempts = 0;
      if (reconnectTimers.has(ws)) {
        clearTimeout(reconnectTimers.get(ws));
        reconnectTimers.delete(ws);
      }
    }
  };
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
      
      // Reduced update frequency - was 60 seconds, now 120 seconds
      setInterval(() => fetchLiveData(currentGameweek), 120000);
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
      // Even longer interval for fallback mode (was 120s, now 180s)
      setInterval(() => fetchLiveData(currentGameweek), 180000);
    }
  };
  
  // Set up a ping interval (adjusted from 30s to 45s)
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        logger.info('Terminating inactive connection');
        return ws.terminate();
      }
      
      ws.isAlive = false;
      ws.ping();
    });
  }, 45000);
  
  // Rest of the function remains the same...
  
  // Clean up interval on server shutdown
  wss.on('close', () => {
    clearInterval(pingInterval);
  });
  
  
  wss.on('connection', (ws, req) => {
    // Extract client IP
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // Limit connections per IP
    if (connectionTracker.get(ip) >= CLIENT_LIMIT_PER_IP) {
      logger.warn(`Connection limit reached for IP: ${ip}`);
      ws.close(1013, 'Maximum connections reached');
      return;
    }
    
    // Track this connection
    connectionTracker.set(ip, (connectionTracker.get(ip) || 0) + 1);
    
    // Set up connection health monitoring
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    
    logger.info('Client connected', { ip });
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
        logger.error('Invalid WebSocket message:', err);
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        return;
      }

      const { type } = parsedMessage;
      if (type === 'subscribe') {
        const { fplId, gameweek } = parsedMessage;
        if (fplId && gameweek) {
          subscriptions.set(ws, { fplId, gameweek });
          logger.info(`Client subscribed: fplId ${fplId}, GW ${gameweek}`);
          if (!global.liveDataCache[gameweek]) fetchLiveData(gameweek);
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'fplId and gameweek are required' }));
        }
      }
    });

    ws.on('close', () => {
      // Clean up connection tracking
      connectionTracker.set(ip, connectionTracker.get(ip) - 1);
      if (connectionTracker.get(ip) <= 0) {
        connectionTracker.delete(ip);
      }
      
      subscriptions.delete(ws);
      logger.info('Client disconnected', { ip });
    });
    
    // Handle errors on this connection
    ws.on('error', (err) => {
      logger.error('WebSocket error', { error: err.message, ip });
    });
  });

  initializeGameweek();
};

module.exports = { 
  setupWebSocket,
  createReconnectionLogic  // Export for client-side use
};