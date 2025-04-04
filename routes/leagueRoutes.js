const express = require('express');
const router = express.Router();
const axios = require('axios');
const { loadBootstrapData } = require('../services/bootstrapService');
const FPLAPIProxyService = require('../services/fplApiProxyService');

// Middleware to validate integer parameters
const validateIntParams = (req, res, next) => {
  // Validate league ID parameter
  if (req.params.leagueId !== undefined) {
    const leagueId = parseInt(req.params.leagueId);
    if (isNaN(leagueId) || leagueId.toString() !== req.params.leagueId) {
      return res.status(400).json({ error: 'Invalid League ID parameter: must be an integer' });
    }
    req.params.leagueId = leagueId;
  }
  
  // Validate gameweek parameter
  if (req.params.gameweek !== undefined) {
    const gameweek = parseInt(req.params.gameweek);
    if (isNaN(gameweek) || gameweek.toString() !== req.params.gameweek || gameweek < 1 || gameweek > 38) {
      return res.status(400).json({ error: 'Invalid gameweek parameter: must be an integer between 1 and 38' });
    }
    req.params.gameweek = gameweek;
  }
  
  next();
};

// Cached data storage
const cache = {
  data: {},
  timestamps: {},
  ttl: {
    fixtures: 3600000,     // 1 hour
    league_live: 300000    // 5 minutes
  }
};

// Error handling wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(error => {
    console.error(`League API Error: ${req.path}`, {
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