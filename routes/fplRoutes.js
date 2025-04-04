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
const { Transfer,Bootstrap } = require('../config/db');
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
    
    // Check cache first if available
    const cacheKey = `live_${gameweek}`;
    if (cache && cache.data && cache.data[cacheKey] && 
        (Date.now() - cache.timestamps[cacheKey]) < cache.ttl.live) {
      console.log(`Returning cached live data for gameweek ${gameweek}`);
      return res.json(cache.data[cacheKey]);
    }
    
    try {
      let liveData;
      
      try {
        // Attempt to fetch from FPL API
        liveData = await FPLAPIProxyService.fetchLiveData(gameweek);
        
        // Add diagnostic headers
        res.set('X-FPL-Proxy-Status', 'success');
        if (FPLAPIProxyService.getErrorTrackerStatus) {
          res.set('X-FPL-Success-Rate', FPLAPIProxyService.getErrorTrackerStatus().successRate);
        }
        
        // Format and store response
        const responseData = {
          elements: liveData.elements,
          metadata: {
            source: 'primary',
            retrievedAt: new Date().toISOString(),
            gameweek
          }
        };
        
        // Update cache if available
        if (cache && cache.data) {
          cache.data[cacheKey] = responseData;
          cache.timestamps[cacheKey] = Date.now();
        }
        
        return res.json(responseData);
      } catch (apiError) {
        console.error(`FPL API fetch failed for gameweek ${gameweek}`, {
          errorMessage: apiError.message,
          statusCode: apiError.response?.status
        });
        
        // Add diagnostic headers for failed request
        res.set('X-FPL-Proxy-Status', 'failed');
        
        // Fallback to cached data
        try {
          const cachedBootstrap = await Bootstrap.findOne({ _id: 'bootstrap:latest' }).exec();
          
          const cachedLiveData = cachedBootstrap?.data?.events?.[gameweek - 1]?.live_data;
          
          if (cachedLiveData && Array.isArray(cachedLiveData)) {
            console.log(`Using cached live data for gameweek ${gameweek}`);
            
            const responseData = {
              elements: cachedLiveData,
              metadata: {
                source: 'cached',
                retrievedAt: new Date().toISOString(),
                gameweek
              }
            };
            
            // Update cache if available
            if (cache && cache.data) {
              cache.data[cacheKey] = responseData;
              cache.timestamps[cacheKey] = Date.now();
            }
            
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
        
        // Update cache if available
        if (cache && cache.data) {
          cache.data[cacheKey] = defaultResponse;
          cache.timestamps[cacheKey] = Date.now();
        }
        
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

// Fixtures route
router.get('/fixtures/:gameweek', 
  validateIntParams,
  asyncHandler(async (req, res) => {
    const { gameweek } = req.params;
    
    try {
      // Check cache first
      const cacheKey = `fixtures_${gameweek}`;
      if (cache && cache.data && cache.data[cacheKey] && 
          (Date.now() - cache.timestamps[cacheKey]) < cache.ttl.fixtures) {
        console.log(`Returning cached fixtures data for gameweek ${gameweek}`);
        return res.json(cache.data[cacheKey]);
      }
      
      // Use FPLAPIProxyService for more reliable data fetching
      const [fixturesData, liveData] = await Promise.all([
        FPLAPIProxyService.fetchFixtures(gameweek),
        FPLAPIProxyService.fetchLiveData(gameweek)
      ]);
      
      // Process fixtures with live data
      const enrichedFixtures = fixturesData.map(fixture => ({
        ...fixture,
        homeTeamBonus: liveData.elements
          .filter(el => el.team === fixture.team_h)
          .reduce((sum, player) => sum + (player.stats.bonus || 0), 0),
        awayTeamBonus: liveData.elements
          .filter(el => el.team === fixture.team_a)
          .reduce((sum, player) => sum + (player.stats.bonus || 0), 0)
      }));
      // Cache the processed data
      if (cache && cache.data) {
        cache.data[cacheKey] = enrichedFixtures;
        cache.timestamps[cacheKey] = Date.now();
      }
      res.json(enrichedFixtures);
    } catch (error) {
      console.error(`Error fetching fixtures for gameweek ${gameweek}:`, {
        error: error.message, 
        stack: error.stack
      });
      
      res.status(500).json({ 
        error: 'Failed to retrieve fixtures data', 
        message: process.env.NODE_ENV === 'production' 
          ? 'An unexpected error occurred' 
          : error.message 
      });
    }
  })
);

// Live league standings route
router.get('/:leagueId/live/:gameweek', 
  validateIntParams,
  asyncHandler(async (req, res) => {
    const { leagueId, gameweek } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    try {
      // Check cache first
      const cacheKey = `league_${leagueId}_gw_${gameweek}_${offset}_${limit}`;
      if (cache && cache.data && cache.data[cacheKey] && 
          (Date.now() - cache.timestamps[cacheKey]) < cache.ttl.league_live) {
        console.log(`Returning cached league data for ${leagueId}, GW ${gameweek}`);
        return res.json(cache.data[cacheKey]);
      }
      
      // Use FPLAPIProxyService for more reliable data fetching
      const [standingsData, liveData, bootstrapData] = await Promise.all([
        FPLAPIProxyService.fetchLeagueStandings(leagueId),
        FPLAPIProxyService.fetchLiveData(gameweek),
        loadBootstrapData()
      ]);

      const liveElements = liveData.elements;
      const totalEntries = standingsData.standings.results.length;
      const paginatedResults = standingsData.standings.results.slice(offset, offset + limit);
      
      // Fetch picks for each manager in the league
      const standings = await Promise.all(
        paginatedResults.map(async (entry) => {
          try {
            // Use FPLAPIProxyService for picks data
            const picksData = await FPLAPIProxyService.fetchPicksData(entry.entry, gameweek)
              .catch(err => {
                console.warn(`Failed to fetch picks for entry ${entry.entry}: ${err.message}`);
                return { picks: [] };
              });
              
            // Use FPLAPIProxyService for transfers data
            const transfersData = await FPLAPIProxyService.fetchTransfersData(entry.entry)
              .catch(err => {
                console.warn(`Failed to fetch transfers for entry ${entry.entry}: ${err.message}`);
                return [];
              });

            const picks = picksData.picks || [];
            const transfersForGW = transfersData.filter(t => t.event === parseInt(gameweek)).length;
            const freeTransfers = 1;
            const extraTransfers = Math.max(0, transfersForGW - freeTransfers);
            const transferPenalty = extraTransfers * -4;

            // Calculate live points
            const livePoints = picks.reduce((total, pick) => {
              const liveStats = liveElements.find(el => el.id === pick.element);
              const points = liveStats ? liveStats.stats.total_points * pick.multiplier : 0;
              return total + points;
            }, 0) + transferPenalty;

            return {
              rank: entry.rank,
              managerName: entry.player_name,
              teamName: entry.entry_name,
              totalPoints: entry.total,
              livePoints: livePoints,
              transferPenalty: transferPenalty,
              entryId: entry.entry,
              activeChip: picksData.active_chip
            };
          } catch (err) {
            console.error(`Error processing entry ${entry.entry}:`, err.message);
            return {
              rank: entry.rank,
              managerName: entry.player_name,
              teamName: entry.entry_name,
              totalPoints: entry.total,
              livePoints: 0,
              transferPenalty: 0,
              entryId: entry.entry,
              error: 'Failed to calculate live points'
            };
          }
        })
      );
      
      const result = {
        leagueName: standingsData.league.name,
        pagination: {
          total: totalEntries,
          limit: limit,
          offset: offset,
          hasMore: offset + limit < totalEntries
        },
        standings: standings
      };
      
      // Cache the result
      if (cache && cache.data) {
        cache.data[cacheKey] = result;
        cache.timestamps[cacheKey] = Date.now();
      }

      res.json(result);
    } catch (error) {
      console.error(`Error in league standings for ${leagueId}, GW ${gameweek}:`, {
        error: error.message, 
        stack: error.stack
      });
      
      res.status(500).json({ 
        error: 'Failed to retrieve league standings', 
        message: process.env.NODE_ENV === 'production' 
          ? 'An unexpected error occurred' 
          : error.message 
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