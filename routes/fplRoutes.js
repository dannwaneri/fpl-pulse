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
  simulateRank,
  fetchLiveDataFromFPL
} = require('../services/fplService');
const { Transfer } = require('../config/db');

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

// Cached data storage
const cache = {
  data: {},
  timestamps: {},
  ttl: {
    bootstrap: 3600000,    // 1 hour
    live: 60000,           // 1 minute
    entry: 300000,         // 5 minutes
    fixtures: 3600000,     // 1 hour
    players: 1800000       // 30 minutes
  }
};


// Error handling wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(error => {
    console.error(`FPL API Error: ${req.path}`, {
      error: error.message,
      stack: error.stack,
      params: req.params,
      query: req.query
    });
    
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: process.env.NODE_ENV === 'production' 
        ? 'An unexpected error occurred' 
        : error.message 
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
      const managerData = await getManagerData(managerId);
      
      // Additional error handling if getManagerData returns an error or empty response
      if (!managerData || !managerData.name) {
        return res.status(404).json({ 
          error: 'Manager not found', 
          message: 'Unable to retrieve manager information' 
        });
      }

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
    
    // Comprehensive logging
    console.log('Live Data Request Received', {
      gameweek,
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
      fullUrl: req.originalUrl
    });
    
    try {
      // Check cache first
      const cacheKey = `live_${gameweek}`;
      if (cache.data[cacheKey] && 
          (Date.now() - cache.timestamps[cacheKey]) < cache.ttl.live) {
        console.log(`Returning cached live data for gameweek ${gameweek}`);
        return res.json(cache.data[cacheKey]);
      }
      
      // Attempt direct FPL API fetch
      const liveData = await fetchLiveDataFromFPL(gameweek);
      
      // Validate response
      if (!liveData || !Array.isArray(liveData.elements)) {
        throw new Error('Invalid live data structure received from API');
      }
      
      // Log successful retrieval
      console.log('Live Data Retrieved Successfully', {
        gameweek,
        elementsCount: liveData.elements.length
      });
      
      // Format response
      const responseData = {
        elements: liveData.elements,
        metadata: {
          retrievedAt: new Date().toISOString(),
          gameweek,
          source: 'api'
        }
      };
      
      // Store in cache
      cache.data[cacheKey] = responseData;
      cache.timestamps[cacheKey] = Date.now();
      
      // Return response
      return res.json(responseData);
    } catch (error) {
      // Comprehensive error logging
      console.error('Live Data Fetch Error', {
        gameweek,
        errorName: error.name,
        errorMessage: error.message,
        stack: error.stack
      });
      
      // Fallback to cached data
      try {
        const cachedBootstrap = await Bootstrap.findOne({ _id: 'bootstrap:latest' }).exec();
        const cachedLiveData = cachedBootstrap?.data?.events?.[gameweek - 1]?.live_data;
        
        if (cachedLiveData && Array.isArray(cachedLiveData)) {
          console.log('Using cached bootstrap data for live update', {
            gameweek,
            elementsCount: cachedLiveData.length
          });
          
          const responseData = {
            elements: cachedLiveData,
            metadata: {
              source: 'cached',
              retrievedAt: new Date().toISOString(),
              gameweek
            }
          };
          
          // Still cache this result to avoid repeated DB lookups
          cache.data[cacheKey] = responseData;
          cache.timestamps[cacheKey] = Date.now();
          
          return res.json(responseData);
        }
      } catch (cacheError) {
        console.error('Cache retrieval error:', {
          message: cacheError.message,
          stack: cacheError.stack
        });
      }
      
      // Final fallback - default data
      try {
        const DEFAULT_LIVE_DATA = {
          elements: [
            { id: 1, stats: { total_points: 0, bonus: 0, in_dreamteam: false } }
          ]
        };
        
        console.warn('Using default fallback data for gameweek', { gameweek });
        
        const responseData = {
          elements: DEFAULT_LIVE_DATA.elements,
          metadata: {
            source: 'default',
            retrievedAt: new Date().toISOString(),
            gameweek,
            notice: 'Using placeholder data due to service unavailability'
          }
        };
        
        return res.json(responseData);
      } catch (fallbackError) {
        // If even the fallback fails, return proper error
        console.error('Complete failure in live data route', {
          originalError: error.message,
          fallbackError: fallbackError.message
        });
        
        return res.status(500).json({
          error: 'Failed to retrieve live data',
          details: {
            message: error.message
          }
        });
      }
    }
  })
);

// Get manager picks for a specific gameweek
router.get('/:id/event/:gameweek/picks', 
  validateIntParams,
  asyncHandler(async (req, res) => {
    const { id, gameweek } = req.params;
    const picksData = await getPicksData(id, gameweek);
    res.json(picksData);
  })
);

// Get planner data
router.get('/:id/planner', 
  validateIntParams,
  asyncHandler(async (req, res) => {
    const data = await getPlannerData(req.params.id);
    res.json(data);
  })
);

// Get top 10k stats
router.get('/top10k/:gameweek', 
  validateIntParams,
  asyncHandler(async (req, res) => {
    const data = await getTop10kStats(req.params.gameweek);
    res.json(data);
  })
);

// Rank simulator
router.get('/:id/rank-simulator/:gameweek', 
  validateIntParams,
  asyncHandler(async (req, res) => {
    const { id, gameweek } = req.params;
    const additionalPoints = parseInt(req.query.points) || 0;
    const data = await simulateRank(id, gameweek, additionalPoints);
    res.json(data);
  })
);

// Captaincy suggestions
router.get('/:id/captaincy/:gameweek', 
  validateIntParams,
  asyncHandler(async (req, res) => {
    const { id, gameweek } = req.params;
    const data = await getCaptaincySuggestions(id, gameweek);
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
    res.status(201).json({ message: 'Transfer saved successfully', transfer });
  })
);

// Cache clearing route
router.post('/cache/clear', 
  asyncHandler(async (req, res) => {
    const { key } = req.query;
    
    if (key) {
      Object.keys(cache.data)
        .filter(cacheKey => cacheKey.includes(key))
        .forEach(cacheKey => {
          delete cache.data[cacheKey];
          delete cache.timestamps[cacheKey];
        });
    } else {
      cache.data = {};
      cache.timestamps = {};
    }

    res.json({ 
      status: 'ok', 
      message: `Cache${key ? ` for pattern "${key}"` : ''} cleared successfully`,
      clearedEntries: Object.keys(cache.data).length
    });
  })
);

module.exports = router;