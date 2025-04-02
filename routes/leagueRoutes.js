const express = require('express');
const router = express.Router();
const axios = require('axios');
const { loadBootstrapData } = require('../services/bootstrapService');

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

// Fixtures route
router.get('/fixtures/:gameweek', 
  validateIntParams,
  asyncHandler(async (req, res) => {
    const { gameweek } = req.params;
    const [fixturesResponse, liveResponse] = await Promise.all([
      axios.get(`https://fantasy.premierleague.com/api/fixtures/?event=${gameweek}`),
      axios.get(`https://fantasy.premierleague.com/api/event/${gameweek}/live/`)
    ]);
    
    const enrichedFixtures = fixturesResponse.data.map(fixture => ({
      ...fixture,
      homeTeamBonus: liveResponse.data.elements
        .filter(el => el.team === fixture.team_h)
        .reduce((sum, player) => sum + (player.stats.bonus || 0), 0),
      awayTeamBonus: liveResponse.data.elements
        .filter(el => el.team === fixture.team_a)
        .reduce((sum, player) => sum + (player.stats.bonus || 0), 0)
    }));

    res.json(enrichedFixtures);
  })
);

// Live league standings route
router.get('/:leagueId/live/:gameweek', 
  validateIntParams,
  asyncHandler(async (req, res) => {
    const { leagueId, gameweek } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    const [standingsResponse, liveResponse, bootstrapData] = await Promise.all([
      axios.get(`https://fantasy.premierleague.com/api/leagues-classic/${leagueId}/standings/`),
      axios.get(`https://fantasy.premierleague.com/api/event/${gameweek}/live/`),
      loadBootstrapData()
    ]);

    const liveData = liveResponse.data.elements;
    const totalEntries = standingsResponse.data.standings.results.length;
    const paginatedResults = standingsResponse.data.standings.results.slice(offset, offset + limit);
    
    const standings = await Promise.all(
      paginatedResults.map(async (entry) => {
        const [picksResponse, transfersResponse] = await Promise.all([
          axios.get(`https://fantasy.premierleague.com/api/entry/${entry.entry}/event/${gameweek}/picks/`),
          axios.get(`https://fantasy.premierleague.com/api/entry/${entry.entry}/transfers/`)
        ]);

        const picks = picksResponse.data.picks;
        const transfersForGW = transfersResponse.data.filter(t => t.event === parseInt(gameweek)).length;
        const freeTransfers = 1;
        const extraTransfers = Math.max(0, transfersForGW - freeTransfers);
        const transferPenalty = extraTransfers * -4;

        const livePoints = picks.reduce((total, pick) => {
          const liveStats = liveData.find(el => el.id === pick.element);
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
          entryId: entry.entry
        };
      })
    );
    
    res.json({
      leagueName: standingsResponse.data.league.name,
      pagination: {
        total: totalEntries,
        limit: limit,
        offset: offset,
        hasMore: offset + limit < totalEntries
      },
      standings: standings
    });
  })
);

// Cache clearing route
router.post('/cache/clear', 
  asyncHandler(async (req, res) => {
    const { key } = req.query;
    
    if (key) {
      Object.keys(cache.data)
        .filter(cacheKey => cacheKey.includes(key))
        .forEach(cacheKey => {delete cache.data[cacheKey];
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