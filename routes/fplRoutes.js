const express = require('express');
const router = express.Router();
const axios = require('axios');
const { 
  getManagerData, 
  getPicksData, 
  getPlannerData, 
  getTop10kStats, 
  predictPriceChanges, 
  getCaptaincySuggestions,
  simulateRank
} = require('../services/fplService');
const { Transfer, Bootstrap } = require('../config/db');
const FPLAPIProxyService = require('../services/fplApiProxyService');

// Middleware to validate integer parameters
const validateIntParams = (req, res, next) => {
  // Only validate specific routes that absolutely require integer validation
  const routesToValidate = [
    '/fpl/:id/event/:gameweek/picks',
    '/fpl/:id/captaincy/:gameweek',
    '/fpl/:id/rank-simulator/:gameweek',
    '/fpl/top10k/:gameweek'
  ];

  const currentRoute = req.route.path;

  if (routesToValidate.some(route => currentRoute.includes(route))) {
    // Validate id parameter if present
    if (req.params.id !== undefined) {
      const id = parseInt(req.params.id);
      if (isNaN(id) || id.toString() !== req.params.id) {
        return res.status(400).json({ error: 'Invalid ID parameter: must be an integer' });
      }
      req.params.id = id;
    }
    
    // Validate gameweek parameter if present
    if (req.params.gameweek !== undefined) {
      const gameweek = parseInt(req.params.gameweek);
      if (isNaN(gameweek) || gameweek.toString() !== req.params.gameweek || gameweek < 1 || gameweek > 38) {
        return res.status(400).json({ error: 'Invalid gameweek parameter: must be an integer between 1 and 38' });
      }
      req.params.gameweek = gameweek;
    }
  }
  
  next();
};

// Enhanced caching strategy with longer TTLs
const cache = {
  data: {},
  timestamps: {},
  ttl: {
    bootstrap: 3600000 * 4,    // 4 hours (was 1 hour)
    live: 180000,              // 3 minutes (was 1 minute)
    entry: 600000,             // 10 minutes (was 5 minutes)
    players: 3600000,          // 1 hour (was 30 minutes)
    fixtures: 1800000,         // 30 minutes
    league: 600000             // 10 minutes
  },
  set: function(key, data) {
    this.data[key] = data;
    this.timestamps[key] = Date.now();
  },
  get: function(key, defaultTtl = this.ttl.live) {
    if (!this.data[key]) return null;
    
    const age = Date.now() - this.timestamps[key];
    const ttl = this.ttl[key.split('_')[0]] || defaultTtl;
    
    if (age < ttl) {
      return this.data[key];
    }
    
    return null;
  },
  clear: function(pattern = null) {
    if (pattern) {
      Object.keys(this.data)
        .filter(key => key.includes(pattern))
        .forEach(key => {
          delete this.data[key];
          delete this.timestamps[key];
        });
    } else {
      this.data = {};
      this.timestamps = {};
    }
  }
};

// Improve error handling wrapper with better logging
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(error => {
    console.error(`FPL API Error: ${req.path}`, {
      error: error.message,
      stack: error.stack,
      params: req.params,
      query: req.query,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });
    
    // Add request count metrics
    const requestKey = `${req.ip}:requests`;
    if (!cache.data[requestKey]) {
      cache.data[requestKey] = 0;
    }
    cache.data[requestKey]++;
    
    // If a client is making too many requests that fail, track it
    if (cache.data[requestKey] > 100) {
      console.warn(`Client ${req.ip} has made ${cache.data[requestKey]} requests`);
    }
    
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: process.env.NODE_ENV === 'production' 
        ? 'An unexpected error occurred' 
        : error.message,
      cacheRefresh: Date.now() // Help client coordinate cache busting
    });
  });
};

// Price predictions route
router.get('/price-predictions', 
  asyncHandler(async (req, res) => {
    const predictions = await predictPriceChanges();
    res.json(predictions);
  })
);

// Manager information route
router.get('/entry/:id', 
  validateIntParams,
  asyncHandler(async (req, res) => {
    try {
      const managerId = req.params.id;
      
      // Check cache first
      const cacheKey = `entry_${managerId}`;
      const cachedData = cache.get(cacheKey);
      
      if (cachedData) {
        console.log(`Returning cached manager data for ID ${managerId}`);
        
        // Add cache age headers
        res.set('X-Cache-Age', (Date.now() - cache.timestamps[cacheKey])/1000);
        res.set('X-Cache-Source', 'memory');
        
        return res.json(cachedData);
      }
      
      const managerData = await getManagerData(managerId);
      
      // Additional error handling if getManagerData returns an error or empty response
      if (!managerData || !managerData.name) {
        return res.status(404).json({ 
          error: 'Manager not found', 
          message: 'Unable to retrieve manager information' 
        });
      }
      
      // Update cache
      cache.set(cacheKey, managerData);
      
      // Log the current gameweek for debugging
      console.log(`Returning manager data for ID ${managerId} with currentGameweek: ${managerData.currentGameweek}`);
      res.json(managerData);
    } catch (error) {
      console.error('Manager Retrieval Error:', {
        managerId: req.params.id,
        errorMessage: error.message
      });

      res.status(500).json({ 
        error: 'Failed to Retrieve Manager Information', 
        message: process.env.NODE_ENV === 'production' 
          ? 'An unexpected error occurred' 
          : error.message 
      });
    }
  })
);

// Manager history route
router.get('/entry/:id/history', 
  validateIntParams,
  asyncHandler(async (req, res) => {
    try {
      const managerId = req.params.id;
      
      // Check cache first
      const cacheKey = `entry_history_${managerId}`;
      const cachedData = cache.get(cacheKey);
      
      if (cachedData) {
        console.log(`Returning cached manager history for ID ${managerId}`);
        
        // Add cache age headers
        res.set('X-Cache-Age', (Date.now() - cache.timestamps[cacheKey])/1000);
        res.set('X-Cache-Source', 'memory');
        
        return res.json(cachedData);
      }
      
      // Directly use axios to fetch history as it's not in getManagerData
      const response = await axios.get(`https://fantasy.premierleague.com/api/entry/${managerId}/history/`);
      
      // Parse and structure history data if needed
      const historyData = response.data;
      
      // Additional validation
      if (!historyData) {
        return res.status(404).json({ 
          error: 'Manager History Not Found', 
          message: 'Unable to retrieve manager\'s historical data' 
        });
      }
      
      // Update cache
      cache.set(cacheKey, historyData);

      res.json(historyData);
    } catch (error) {
      console.error('Manager History Retrieval Error:', {
        managerId: req.params.id,
        errorMessage: error.message
      });

      if (error.response?.status === 404) {
        return res.status(404).json({ 
          error: 'Manager History Not Found', 
          message: 'Unable to retrieve manager\'s historical data' 
        });
      }

      // Check for stale cache as fallback
      const cacheKey = `entry_history_${req.params.id}`;
      if (cache.data[cacheKey]) {
        const cacheAge = Date.now() - cache.timestamps[cacheKey];
        
        // Use stale cache if less than 30 minutes old
        if (cacheAge < 1800000) {
          console.log(`Using stale history cache, age: ${cacheAge/1000}s`);
          
          res.set('X-Cache-Age', cacheAge/1000);
          res.set('X-Cache-Source', 'stale-memory');
          
          return res.json({
            ...cache.data[cacheKey],
            _meta: {
              source: 'stale-cache',
              staleAge: cacheAge/1000
            }
          });
        }
      }

      res.status(500).json({ 
        error: 'Failed to Retrieve Manager History', 
        message: process.env.NODE_ENV === 'production' 
          ? 'An unexpected error occurred' 
          : error.message 
      });
    }
  })
);

router.get('/live/:gameweek', 
  validateIntParams,
  asyncHandler(async (req, res) => {
    const { gameweek } = req.params;
    
    // Add cache-control headers
    res.set('Cache-Control', 'public, max-age=180'); // 3 minutes browser cache
    
    // Check cache first if available
    const cacheKey = `live_${gameweek}`;
    const cachedData = cache.get(cacheKey);
    
    if (cachedData) {
      console.log(`Returning cached live data for gameweek ${gameweek}, age: ${(Date.now() - cache.timestamps[cacheKey])/1000}s`);
      
      // Add cache age headers
      res.set('X-Cache-Age', (Date.now() - cache.timestamps[cacheKey])/1000);
      res.set('X-Cache-Source', 'memory');
      
      return res.json(cachedData);
    }
    
    try {
      let liveData;
      
      try {
        // Attempt to fetch from FPL API
        liveData = await FPLAPIProxyService.fetchLiveData(gameweek);
        
        // Add diagnostic headers
        res.set('X-FPL-Proxy-Status', 'success');
        res.set('X-FPL-Success-Rate', FPLAPIProxyService.getErrorTrackerStatus().successRate);
        
        // Format and store response
        const responseData = {
          elements: liveData.elements,
          metadata: {
            source: 'primary',
            retrievedAt: new Date().toISOString(),
            gameweek
          }
        };
        
        // Update cache
        cache.set(cacheKey, responseData);
        
        return res.json(responseData);
      } catch (apiError) {
        console.error(`FPL API fetch failed for gameweek ${gameweek}`, {
          errorMessage: apiError.message,
          statusCode: apiError.response?.status
        });
        
        // Add diagnostic headers for failed request
        res.set('X-FPL-Proxy-Status', 'failed');
        
        // Check if we have older cache that's still usable in an emergency
        if (cache.data[cacheKey]) {
          const cacheAge = Date.now() - cache.timestamps[cacheKey];
          
          // Use stale cache if it's less than 30 minutes old
          if (cacheAge < 1800000) {
            console.log(`Using stale cache for gameweek ${gameweek}, age: ${cacheAge/1000}s`);
            
            res.set('X-Cache-Age', cacheAge/1000);
            res.set('X-Cache-Source', 'stale-memory');
            
            return res.json({
              ...cache.data[cacheKey],
              metadata: {
                ...cache.data[cacheKey].metadata,
                source: 'stale-cache',
                staleAge: cacheAge/1000
              }
            });
          }
        }
        
        // Fallback to cached data from database
        try {
          const cachedBootstrap = await Bootstrap.findOne({ _id: 'bootstrap:latest' }).exec();
          
          const cachedLiveData = cachedBootstrap?.data?.events?.[gameweek - 1]?.live_data;
          
          if (cachedLiveData && Array.isArray(cachedLiveData)) {
            console.log(`Using cached bootstrap data for gameweek ${gameweek}`);
            
            const responseData = {
              elements: cachedLiveData,
              metadata: {
                source: 'database-cache',
                retrievedAt: new Date().toISOString(),
                gameweek
              }
            };
            
            // Store this in memory cache too
            cache.set(cacheKey, responseData);
            
            return res.json(responseData);
          }
        } catch (cacheError) {
          console.error('Cache retrieval error', {
            message: cacheError.message,
            stack: cacheError.stack
          });
        }
        
        // Final fallback to default data
        console.warn(`Using default fallback data for gameweek ${gameweek}`);
        
        const defaultResponse = {
          elements: DEFAULT_LIVE_DATA.elements,
          metadata: {
            source: 'default',
            retrievedAt: new Date().toISOString(),
            gameweek
          }
        };
        
        // Update cache
        cache.set(cacheKey, defaultResponse);
        
        return res.json(defaultResponse);
      }
    } catch (error) {
      // Catch-all error handler
      console.error('Comprehensive error in live data route', {
        gameweek,
        errorMessage: error.message,
        stack: error.stack
      });
      
      res.status(500).json({
        error: 'Failed to retrieve live data',
        details: {
          message: error.message
        }
      });
    }
  })
);

// Get manager picks for a specific gameweek
router.get('/:id/event/:gameweek/picks', 
  validateIntParams,
  asyncHandler(async (req, res) => {
    const { id, gameweek } = req.params;
    
    // Add cache-control headers
    res.set('Cache-Control', 'public, max-age=120'); // 2 minutes browser cache
    
    // Check cache first
    const cacheKey = `picks_${id}_${gameweek}`;
    const cachedData = cache.get(cacheKey);
    
    if (cachedData) {
      console.log(`Returning cached picks data for ID ${id}, GW ${gameweek}`);
      
      // Add cache age headers
      res.set('X-Cache-Age', (Date.now() - cache.timestamps[cacheKey])/1000);
      res.set('X-Cache-Source', 'memory');
      
      return res.json(cachedData);
    }
    
    try {
      const picksData = await getPicksData(id, gameweek);
      
      // Update cache
      cache.set(cacheKey, picksData);
      
      res.json(picksData);
    } catch (error) {
      console.error(`Error fetching picks for ID ${id}, GW ${gameweek}:`, {
        error: error.message
      });
      
      // Check for stale cache as fallback
      if (cache.data[cacheKey]) {
        const cacheAge = Date.now() - cache.timestamps[cacheKey];
        
        // Use stale cache if less than 30 minutes old
        if (cacheAge < 1800000) {
          console.log(`Using stale picks cache, age: ${cacheAge/1000}s`);
          
          res.set('X-Cache-Age', cacheAge/1000);
          res.set('X-Cache-Source', 'stale-memory');
          
          return res.json({
            ...cache.data[cacheKey],
            _meta: {
              source: 'stale-cache',
              staleAge: cacheAge/1000
            }
          });
        }
      }
      
      // No viable cache, return error
      res.status(500).json({
        error: 'Failed to fetch picks data',
        message: error.message
      });
    }
  })
);

// Get planner data
router.get('/:id/planner', 
  validateIntParams,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    
    // Check cache first
    const cacheKey = `planner_${id}`;
    const cachedData = cache.get(cacheKey);
    
    if (cachedData) {
      console.log(`Returning cached planner data for ID ${id}`);
      
      // Add cache age headers
      res.set('X-Cache-Age', (Date.now() - cache.timestamps[cacheKey])/1000);
      res.set('X-Cache-Source', 'memory');
      
      return res.json(cachedData);
    }
    
    const data = await getPlannerData(id);
    
    // Update cache
    cache.set(cacheKey, data);
    
    res.json(data);
  })
);

// Get top 10k stats
router.get('/top10k/:gameweek', 
  validateIntParams,
  asyncHandler(async (req, res) => {
    const gameweek = req.params.gameweek;
    
    // Check cache first
    const cacheKey = `top10k_${gameweek}`;
    const cachedData = cache.get(cacheKey);
    
    if (cachedData) {
      console.log(`Returning cached top10k data for gameweek ${gameweek}`);
      
      // Add cache age headers
      res.set('X-Cache-Age', (Date.now() - cache.timestamps[cacheKey])/1000);
      res.set('X-Cache-Source', 'memory');
      
      return res.json(cachedData);
    }
    
    const data = await getTop10kStats(gameweek);
    
    // Update cache
    cache.set(cacheKey, data);
    
    res.json(data);
  })
);

// Rank simulator
router.get('/:id/rank-simulator/:gameweek', 
  validateIntParams,
  asyncHandler(async (req, res) => {
    const { id, gameweek } = req.params;
    const additionalPoints = parseInt(req.query.points) || 0;
    
    // Check cache first
    const cacheKey = `rank_sim_${id}_${gameweek}_${additionalPoints}`;
    const cachedData = cache.get(cacheKey);
    
    if (cachedData) {
      console.log(`Returning cached rank simulation for ID ${id}, GW ${gameweek}, Points ${additionalPoints}`);
      
      // Add cache age headers
      res.set('X-Cache-Age', (Date.now() - cache.timestamps[cacheKey])/1000);
      res.set('X-Cache-Source', 'memory');
      
      return res.json(cachedData);
    }
    
    const data = await simulateRank(id, gameweek, additionalPoints);
    
    // Update cache
    cache.set(cacheKey, data);
    
    res.json(data);
  })
);

// Captaincy suggestions
router.get('/:id/captaincy/:gameweek', 
  validateIntParams,
  asyncHandler(async (req, res) => {
    const { id, gameweek } = req.params;
    
    // Check cache first
    const cacheKey = `captaincy_${id}_${gameweek}`;
    const cachedData = cache.get(cacheKey);
    
    if (cachedData) {
      console.log(`Returning cached captaincy suggestions for ID ${id}, GW ${gameweek}`);
      
      // Add cache age headers
      res.set('X-Cache-Age', (Date.now() - cache.timestamps[cacheKey])/1000);
      res.set('X-Cache-Source', 'memory');
      
      return res.json(cachedData);
    }
    
    const data = await getCaptaincySuggestions(id, gameweek);
    
    // Update cache
    cache.set(cacheKey, data || []);
    
    res.json(data || []);
  })
);

// Save transfers
router.post('/:id/transfers', 
  validateIntParams,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { gameweek, out: playerOutId, in: playerInId } = req.body;

    // Validate request body parameters
    if (!gameweek || !playerOutId || !playerInId) {
      return res.status(400).json({ error: 'Missing required fields: gameweek, out, or in' });
    }
    
    // Additional validation for request body integers
    const gwInt = parseInt(gameweek);
    const outInt = parseInt(playerOutId);
    const inInt = parseInt(playerInId);
    
    if (isNaN(gwInt) || gwInt < 1 || gwInt > 38) {
      return res.status(400).json({ error: 'Invalid gameweek: must be an integer between 1 and 38' });
    }
    
    if (isNaN(outInt) || isNaN(inInt)) {
      return res.status(400).json({ error: 'Invalid player IDs: must be integers' });
    }

    // Fetch planner data to validate the transfer
    const plannerData = await getPlannerData(id);
    const playerOut = plannerData.currentPicks.find(p => p.id === outInt);
    const playerIn = plannerData.allPlayers.find(p => p.id === inInt);

    if (!playerOut || !playerIn) {
      return res.status(400).json({ error: 'Invalid player IDs' });
    }

    // Save the transfer to MongoDB
    const transfer = new Transfer({
      fplId: id,
      gameweek: gwInt,
      playerOut: {
        id: playerOut.id,
        name: playerOut.name,
        positionType: playerOut.positionType,
        cost: playerOut.cost
      },
      playerIn: {
        id: playerIn.id,
        name: playerIn.name,
        positionType: playerIn.positionType,
        cost: playerIn.cost
      },
      timestamp: new Date()
    });

    await transfer.save();
    
    // Clear related caches
    cache.clear(`planner_${id}`);
    
    res.status(201).json({ message: 'Transfer saved successfully', transfer });
  })
);

// Cache clearing route
router.post('/cache/clear', 
  asyncHandler(async (req, res) => {
    const { key } = req.query;
    
    if (key) {
      cache.clear(key);
    } else {
      cache.clear();
    }

    res.json({ 
      status: 'ok', 
      message: `Cache${key ? ` for pattern "${key}"` : ''} cleared successfully`,
      clearedEntries: Object.keys(cache.data).length
    });
  })
);

module.exports = router;