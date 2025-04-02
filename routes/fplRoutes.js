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
    try {
      console.log(`Attempting to fetch live data for gameweek ${gameweek}`);
      const response = await axios.get(`https://fantasy.premierleague.com/api/event/${gameweek}/live/`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      
      console.log(`Live data retrieved for gameweek ${gameweek}`, {
        elementsCount: response.data.elements?.length || 0
      });
      
      res.json(response.data);
    } catch (error) {
      console.error(`Detailed error fetching live data for gameweek ${gameweek}:`, {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      
      res.status(500).json({ 
        error: 'Failed to fetch live data', 
        message: error.message,
        details: error.response?.data
      });
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