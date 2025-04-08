const axios = require('axios');
const { updatePicksFromLiveData, getTop10kStats, memoryCache, estimateLiveRank, getPicksData, getManagerData} = require('./fplService');
const WebSocket = require('ws');
const { Bootstrap } = require('../config/db'); 
const { loadBootstrapData } = require('./bootstrapService');
const FPLAPIProxyService = require('./fplApiProxyService');
const logger = require('../utils/logger');
const mongooseCache = require('./mongooseCache');
const workerCoordination = require('./workerCoordination');

// Cache TTL constants
const CACHE_TTL = {
  LIVE_DATA: 300000,  // 5 minutes
  BOOTSTRAP: 3600000  // 1 hour
};

// Connection and reconnection constants
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 60000; // 1 minute max
const CONNECTION_TIMEOUT = 10000; // 10 seconds
const CLIENT_LIMIT_PER_IP = 5; // Limit connections per IP
const MAX_TOTAL_CONNECTIONS = 100; // Server-wide connection limit

// Track connections to avoid duplicates
const connectionTracker = new Map(); // IP -> count
const reconnectTimers = new Map(); // client -> timer

// Default live data fallback
const DEFAULT_LIVE_DATA = {
  elements: [
    { id: 1, stats: { total_points: 0, bonus: 0, in_dream_team: false } }
  ]
};

// Rate limiter implementation
const rateLimiter = {
  attempts: new Map(), // IP -> timestamps[]
  isLimited: function(ip) {
    if (!this.attempts.has(ip)) {
      this.attempts.set(ip, []);
      return false;
    }
    
    // Clean up old attempts (older than 60 seconds)
    const now = Date.now();
    const attempts = this.attempts.get(ip).filter(
      timestamp => now - timestamp < 60000
    );
    this.attempts.set(ip, attempts);
    
    // If too many recent attempts, apply rate limiting
    return attempts.length >= 10; // Max 10 connection attempts per minute
  },
  recordAttempt: function(ip) {
    const attempts = this.attempts.get(ip) || [];
    attempts.push(Date.now());
    this.attempts.set(ip, attempts);
  }
};

// Initialize global variables
global.liveDataCache = global.liveDataCache || {};
// Define subscriptions at module level so it's accessible to all functions
const subscriptions = new Map();

// Enhanced fetchLiveData with worker coordination
const fetchLiveData = async (gameweek) => {
  logger.info('Fetch Live Data Request', {
    gameweek,
    timestamp: new Date().toISOString()
  });

  try {
    // Check cache first using mongooseCache
    const cacheKey = `liveData:${gameweek}`;
    
    // Check memory cache first for fastest response
    const memoryCached = memoryCache.get ? memoryCache.get(cacheKey) : null;
    if (memoryCached) {
      logger.info('Using memory cache for live data', {
        gameweek,
        elementsCount: memoryCached.elements?.length || 0
      });
      return memoryCached.elements || [];
    }
    
    const cachedData = await mongooseCache.get(cacheKey);
    
    if (cachedData) {
      logger.info(`Using database cache for GW ${gameweek}`);
      
      // Update memory cache for faster future access
      if (memoryCache.set) {
        memoryCache.set(cacheKey, cachedData, CACHE_TTL.LIVE_DATA);
      }
      
      return cachedData.elements || [];
    }
    
    // No cache, need to fetch
    // Use leader election to prevent all workers from fetching simultaneously
    const taskName = `fetchLive:${gameweek}`;
    const isLeader = await workerCoordination.becomeLeader(taskName, 30);
    
    if (isLeader) {
      // This worker is responsible for fetching the data
      logger.info(`Worker ${workerCoordination.getWorkerId()} became leader for live data fetch`);
      
      try {
        let liveData;
        let dataSource = 'unknown';
        
        try {
          // Try to fetch from FPL API via the proxy service
          liveData = await FPLAPIProxyService.fetchLiveData(gameweek);
          dataSource = FPLAPIProxyService.getErrorTrackerStatus().usingWorker ? 'worker_proxy' : 'direct_api';
          
          logger.info('Successfully fetched live data', {
            gameweek,
            elementsCount: liveData.elements?.length || 0,
            source: dataSource
          });
          
          // Cache the successful response
          await mongooseCache.set(cacheKey, liveData, 300); // 5 minutes cache
          
          // Also cache in memory
          if (memoryCache.set) {
            memoryCache.set(cacheKey, liveData, CACHE_TTL.LIVE_DATA);
          }
          
          // Also cache a stale version for emergency fallbacks
          await mongooseCache.set(`stale:${cacheKey}`, liveData, 3600); // 1 hour stale cache
        } catch (apiError) {
          logger.warn(`API fetch failed for gameweek ${gameweek}, using cached data`, {
            errorMessage: apiError.message,
            statusCode: apiError.response?.status
          });

          // Try to use stale cache
          const staleData = await mongooseCache.get(`stale:${cacheKey}`);
          if (staleData) {
            logger.info(`Using stale cache for GW ${gameweek} due to fetch failure`);
            liveData = staleData;
            dataSource = 'stale_cache';
          } else {
            // Use existing cache if available, even if slightly stale
            if (global.liveDataCache[gameweek]) {
              logger.info(`Reusing existing cache despite age for GW ${gameweek} due to fetch failure`);
              liveData = { elements: global.liveDataCache[gameweek] };
              dataSource = 'memory_cache';
            } else {
              // Try fallback to DB
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
          }
        }

        // Mark task as completed for other workers to know
        await workerCoordination.markTaskCompleted(taskName, 30);
        
        // Now process the data and update clients
        const newData = liveData.elements || [];
        
        // Cache the new data globally for legacy compatibility
        global.liveDataCache[gameweek] = newData;
        global.liveDataCache[`${gameweek}:timestamp`] = Date.now();
        global.liveDataCache[`${gameweek}:source`] = dataSource;
        
        // Check if data has changed before processing
        const existingDataString = JSON.stringify(global.liveDataCache[gameweek] || []);
        const newDataString = JSON.stringify(newData);
        
        if (newDataString !== existingDataString) {
          // Update top10k stats once to avoid multiple API calls
          let updatedStats;
          try {
            updatedStats = await getTop10kStats(gameweek);
            
            // Cache the top10k stats
            await mongooseCache.set(`top10k:${gameweek}`, updatedStats, 600); // 10 minutes cache
          } catch (statsError) {
            logger.warn(`Failed to get top10k stats: ${statsError.message}`);
            
            // Try to get from cache
            updatedStats = await mongooseCache.get(`top10k:${gameweek}`);
          }
          
          // Batch clients for updates
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
                  const picksKey = `picks:${fplId}:${gameweek}`;
                  let picksData;
                  
                  // Try memory cache first
                  if (memoryCache[picksKey]?.data) {
                    picksData = memoryCache[picksKey].data;
                  } else {
                    // Try mongoose cache
                    picksData = await mongooseCache.get(picksKey);
                    
                    // Only fetch from API if cache is unavailable
                    if (!picksData) {
                      picksData = await getPicksData(fplId, gameweek);
                      
                      // Cache the picks data
                      await mongooseCache.set(picksKey, picksData, 300); // 5 minutes cache
                    }
                  }
                  
                  updatePicksFromLiveData(fplId, gameweek, newData);

                  const totalLivePoints = picksData.totalLivePoints || 0;
                  const assistantManagerPoints = picksData.assistantManagerPoints || 0;
                  
                  let managerData, liveRank;
                  
                  // Use cached manager data if available
                  const managerKey = `manager:${fplId}`;
                  
                  // Try memory cache first
                  if (memoryCache[managerKey]?.data) {
                    managerData = memoryCache[managerKey].data;
                  } else {
                    // Try mongoose cache
                    const cachedManager = await mongooseCache.get(managerKey);
                    
                    if (cachedManager) {
                      managerData = cachedManager;
                    } else {
                      try {
                        managerData = await getManagerData(fplId);
                        
                        // Cache the manager data
                        await mongooseCache.set(managerKey, managerData, 3600); // 1 hour cache
                      } catch (err) {
                        logger.warn(`getManagerData failed for fplId ${fplId}`, { error: err.message });
                        managerData = { totalPoints: 0, rank: 5000000 };
                      }
                    }
                  }
                  
                  // Use cached rank if available
                  const rankKey = `rank:${fplId}:${gameweek}:${totalLivePoints}`;
                  
                  // Try memory cache first
                  if (memoryCache[rankKey]?.data) {
                    liveRank = memoryCache[rankKey].data;
                  } else {
                    // Try mongoose cache
                    const cachedRank = await mongooseCache.get(rankKey);
                    
                    if (cachedRank) {
                      liveRank = cachedRank;
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
                        await mongooseCache.set(rankKey, liveRank, 600); // 10 minutes cache
                        
                        // Also cache in memory
                        if (memoryCache[rankKey]) {
                          memoryCache[rankKey] = {
                            data: liveRank,
                            timestamp: Date.now()
                          };
                        }
                      } catch (err) {
                        logger.warn(`estimateLiveRank failed for fplId ${fplId}`, { error: err.message });
                        liveRank = null;
                      }
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
      } finally {
        // Always release leadership when done
        await workerCoordination.releaseLeadership(taskName);
      }
    } else {
      // Another worker is the leader, wait for it to complete
      logger.info(`Waiting for leader to fetch live data for GW ${gameweek}`);
      
      const completed = await workerCoordination.waitForTaskCompletion(taskName, 20000);
      
      if (completed) {
        // Leader has fetched the data, try to get it from cache
        const freshlyCachedData = await mongooseCache.get(cacheKey);
        
        if (freshlyCachedData) {
          logger.info(`Using data fetched by leader for GW ${gameweek}`);
          return freshlyCachedData.elements || [];
        }
      }
      
      // If waiting failed or no data in cache, use global cache as fallback
      if (global.liveDataCache[gameweek]) {
        logger.info(`Using global cache for GW ${gameweek}`);
        return global.liveDataCache[gameweek];
      }
      
      // Last resort - use stale cache
      const staleData = await mongooseCache.get(`stale:${cacheKey}`);
      if (staleData) {
        logger.info(`Using stale cache for GW ${gameweek}`);
        return staleData.elements || [];
      }
      
      // Absolute fallback
      logger.warn(`No data available for GW ${gameweek}, using default data`);
      return DEFAULT_LIVE_DATA.elements;
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
          message: 'Unable to fetch live data. Showing placeholder data.',
          gameweek
        }));
      }
    });

    // Ensure some data exists in global cache
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

// Updated setupWebSocket function with worker coordination
const setupWebSocket = (wss) => {
  let currentGameweek = null;
  
  const initializeGameweek = async () => {
    try {
      // Use worker coordination for bootstrap loading
      const bootstrap = await workerCoordination.initializeBootstrapData(loadBootstrapData);
      const cachedBootstrap = await Bootstrap.findOne({ _id: 'bootstrap:latest' }).exec();
  
      // Dynamic gameweek fallback
      const currentEvent = bootstrap.events.find(e => e.is_current);
      const latestCachedEvent = cachedBootstrap?.data?.events?.slice(-1)[0]?.id || 29;
      currentGameweek = currentEvent?.id || latestCachedEvent;
  
      logger.info('Current event found:', { gameweek: currentGameweek });
      
      // Initial fetch
      await fetchLiveData(currentGameweek);
      
      // Reduced update frequency to 2 minutes
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
  
  // Set up a ping interval with longer timeout (45s)
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
  
  // Clean up interval on server shutdown
  wss.on('close', () => {
    clearInterval(pingInterval);
  });
  
  wss.on('connection', (ws, req) => {
    // Extract client IP
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // Check total connections
    if (wss.clients.size >= MAX_TOTAL_CONNECTIONS) {
      logger.warn(`Global connection limit reached (${wss.clients.size}), rejecting new connection`);
      ws.close(1013, 'Server at capacity, please try again later');
      return;
    }
   
    // Apply rate limiting
    if (rateLimiter.isLimited(ip)) {
      logger.warn(`Rate limit exceeded for IP: ${ip}, rejecting connection`);
      ws.close(1013, 'Too many connection attempts, please wait');
      return;
    }

    // Record this connection attempt
    rateLimiter.recordAttempt(ip);

    // Use distributed connection tracking with mongooseCache
    const connectionKey = `connections:${ip}`;
    
    mongooseCache.getOrSet(connectionKey, async () => {
      return { count: 0 };
    }, 3600).then(async (connectionData) => {
      // Increment connection count
      connectionData.count++;
      await mongooseCache.set(connectionKey, connectionData, 3600);
      
      // Check if limit reached
      if (connectionData.count > CLIENT_LIMIT_PER_IP) {
        logger.warn(`Connection limit reached for IP: ${ip}, count: ${connectionData.count}`);
        ws.close(1013, 'Maximum connections reached');
        return;
      }
      
      // Also track in memory for this worker
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

      ws.on('close', async () => {
        // Update distributed connection tracking
        const connectionData = await mongooseCache.get(connectionKey);
        if (connectionData) {
          connectionData.count = Math.max(0, connectionData.count - 1);
          await mongooseCache.set(connectionKey, connectionData, 3600);
          logger.info(`Connection count for IP ${ip} reduced to ${connectionData.count}`);
        }
        
        // Also clean up local memory tracking
        const currentCount = connectionTracker.get(ip) || 0;
        if (currentCount <= 1) {
          connectionTracker.delete(ip);
        } else {
          connectionTracker.set(ip, currentCount - 1);
        }
          
        subscriptions.delete(ws);
        
        // Clean up reconnect timer if it exists
        if (reconnectTimers.has(ws)) {
          clearTimeout(reconnectTimers.get(ws));
          reconnectTimers.delete(ws);
        }
        
        logger.info('Client disconnected', { ip, remaining: connectionTracker.get(ip) || 0 });
      });

      // Handle errors on this connection
      ws.on('error', (err) => {
        logger.error('WebSocket error', { error: err.message, ip });
      });
    }).catch(err => {
      logger.error('Error managing connection tracking', { error: err.message, ip });
      ws.close(1011, 'Server error');
    });
  });

  initializeGameweek();
};

module.exports = { 
  setupWebSocket,
  createReconnectionLogic,
  fetchLiveData
};