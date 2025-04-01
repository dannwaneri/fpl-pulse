const axios = require('axios');
const logger = require('../utils/logger');

// Cache mechanism to reduce API calls
const cache = {
  data: {},
  timestamps: {},
  ttl: {
    bootstrap: 3600000, // 1 hour
    live: 60000,        // 1 minute
    entry: 300000,      // 5 minutes
    fixtures: 3600000,  // 1 hour
    players: 1800000    // 30 minutes
  }
};

// Helper to check if cache is valid
const isCacheValid = (key) => {
  if (!cache.data[key] || !cache.timestamps[key]) return false;
  const age = Date.now() - cache.timestamps[key];
  const maxAge = key.includes('bootstrap') ? cache.ttl.bootstrap :
                 key.includes('live') ? cache.ttl.live :
                 key.includes('entry') ? cache.ttl.entry :
                 key.includes('fixtures') ? cache.ttl.fixtures :
                 cache.ttl.players;
  return age < maxAge;
};

// Fetch with error handling and no headers
const fetchFplData = async (url, cacheKey = null, method = 'GET', body = null) => {
  // Check cache only for GET requests
  if (method === 'GET' && cacheKey && isCacheValid(cacheKey)) {
    logger.info(`Cache hit for ${cacheKey}`);
    return cache.data[cacheKey];
  }

  try {
    // Configure request options based on method
    const options = { 
      method,
      timeout: 15000 
      // No headers to avoid CORS issues
    };
    
    // Add body for non-GET requests
    if (method !== 'GET' && body) {
      options.data = body;
    }
    
    // Make the request
    const response = await axios(url, options);

    // Update cache for GET requests
    if (method === 'GET' && cacheKey && response.data) {
      cache.data[cacheKey] = response.data;
      cache.timestamps[cacheKey] = Date.now();
      logger.info(`Updated cache for ${cacheKey}`);
    }

    return response.data;
  } catch (error) {
    logger.error(`FPL API error for ${url}:`, { 
      message: error.message,
      status: error.response?.status
    });
    throw error;
  }
};

// Setup all proxy routes
const setupFplProxy = (app) => {
  // Debug route to check if service is working
  app.get('/fpl-basic/debug', (req, res) => {
    res.json({
      status: 'ok',
      message: 'FPL Proxy Service is running',
      timestamp: new Date().toISOString(),
      cache_stats: {
        keys: Object.keys(cache.data).length,
        size: JSON.stringify(cache.data).length
      }
    });
  });

  // Bootstrap static data
  app.get('/fpl-basic/bootstrap', async (req, res) => {
    try {
      const data = await fetchFplData(
        'https://fantasy.premierleague.com/api/bootstrap-static/',
        'bootstrap'
      );
      res.json(data);
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to fetch bootstrap data',
        details: error.message
      });
    }
  });

  // Live gameweek data
  app.get('/fpl-basic/live/:gameweek', async (req, res) => {
    try {
      const gameweek = req.params.gameweek;
      const data = await fetchFplData(
        `https://fantasy.premierleague.com/api/event/${gameweek}/live/`,
        `live:${gameweek}`
      );
      res.json(data);
    } catch (error) {
      res.status(500).json({ 
        error: `Failed to fetch live data for gameweek ${req.params.gameweek}`,
        details: error.message
      });
    }
  });

  // Manager information
  app.get('/fpl-basic/entry/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const data = await fetchFplData(
        `https://fantasy.premierleague.com/api/entry/${id}/`,
        `entry:${id}`
      );
      res.json(data);
    } catch (error) {
      res.status(500).json({ 
        error: `Failed to fetch manager data for ID ${req.params.id}`,
        details: error.message
      });
    }
  });

  // Manager history
  app.get('/fpl-basic/entry/:id/history', async (req, res) => {
    try {
      const id = req.params.id;
      const data = await fetchFplData(
        `https://fantasy.premierleague.com/api/entry/${id}/history/`,
        `entry:${id}:history`
      );
      res.json(data);
    } catch (error) {
      res.status(500).json({ 
        error: `Failed to fetch manager history for ID ${req.params.id}`,
        details: error.message
      });
    }
  });

  // Manager picks for a gameweek
  app.get('/fpl-basic/entry/:id/event/:gameweek/picks', async (req, res) => {
    try {
      const id = req.params.id;
      const gameweek = req.params.gameweek;
      const data = await fetchFplData(
        `https://fantasy.premierleague.com/api/entry/${id}/event/${gameweek}/picks/`,
        `entry:${id}:picks:${gameweek}`
      );
      res.json(data);
    } catch (error) {
      res.status(500).json({ 
        error: `Failed to fetch picks for ID ${req.params.id}, gameweek ${req.params.gameweek}`,
        details: error.message
      });
    }
  });

  // Player summary
  app.get('/fpl-basic/element-summary/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const data = await fetchFplData(
        `https://fantasy.premierleague.com/api/element-summary/${id}/`,
        `player:${id}`
      );
      res.json(data);
    } catch (error) {
      res.status(500).json({ 
        error: `Failed to fetch player data for ID ${req.params.id}`,
        details: error.message
      });
    }
  });

  // Fixtures
  app.get('/fpl-basic/fixtures', async (req, res) => {
    try {
      const data = await fetchFplData(
        'https://fantasy.premierleague.com/api/fixtures/',
        'fixtures'
      );
      res.json(data);
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to fetch fixtures data',
        details: error.message
      });
    }
  });

  // League standings
  app.get('/fpl-basic/leagues-classic/:id/standings', async (req, res) => {
    try {
      const id = req.params.id;
      const data = await fetchFplData(
        `https://fantasy.premierleague.com/api/leagues-classic/${id}/standings/`,
        `league:${id}`
      );
      res.json(data);
    } catch (error) {
      res.status(500).json({ 
        error: `Failed to fetch league data for ID ${req.params.id}`,
        details: error.message
      });
    }
  });

  // Team transfers
  app.get('/fpl-basic/entry/:id/transfers', async (req, res) => {
    try {
      const id = req.params.id;
      const data = await fetchFplData(
        `https://fantasy.premierleague.com/api/entry/${id}/transfers/`,
        `entry:${id}:transfers`
      );
      res.json(data);
    } catch (error) {
      res.status(500).json({ 
        error: `Failed to fetch transfer data for ID ${req.params.id}`,
        details: error.message
      });
    }
  });

  // Current gameweek status (helper endpoint that returns just current gameweek info)
  app.get('/fpl-basic/current-gameweek', async (req, res) => {
    try {
      const bootstrapData = await fetchFplData(
        'https://fantasy.premierleague.com/api/bootstrap-static/',
        'bootstrap'
      );
      
      const currentEvent = bootstrapData.events.find(e => e.is_current);
      
      if (!currentEvent) {
        return res.status(404).json({ error: 'No current gameweek found' });
      }
      
      res.json({
        current_gameweek: currentEvent.id,
        deadline: currentEvent.deadline_time,
        is_previous: currentEvent.is_previous,
        is_current: currentEvent.is_current,
        is_next: currentEvent.is_next
      });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to determine current gameweek',
        details: error.message
      });
    }
  });


// Planner data - combines multiple API calls into one response
app.get('/fpl-basic/entry/:id/planner', async (req, res) => {
  try {
    const id = req.params.id;
    
    // Make all required API calls in parallel
    const [managerData, bootstrapData, fixturesData] = await Promise.all([
      fetchFplData(
        `https://fantasy.premierleague.com/api/entry/${id}/`,
        `entry:${id}`
      ),
      fetchFplData(
        'https://fantasy.premierleague.com/api/bootstrap-static/',
        'bootstrap'
      ),
      fetchFplData(
        'https://fantasy.premierleague.com/api/fixtures/',
        'fixtures'
      )
    ]);
    
    // Get current gameweek
    const currentGameweek = managerData.current_event || 
                            bootstrapData.events.find(e => e.is_current)?.id || 1;
    
    // Get picks for current gameweek
    const picksData = await fetchFplData(
      `https://fantasy.premierleague.com/api/entry/${id}/event/${currentGameweek}/picks/`,
      `entry:${id}:picks:${currentGameweek}`
    );
    
    // Combine data into planner format
    const plannerData = {
      currentPicks: picksData.picks.map(pick => {
        const player = bootstrapData.elements.find(el => el.id === pick.element) || {};
        return {
          id: pick.element,
          name: player.web_name || `${player.first_name} ${player.second_name}` || 'Unknown',
          teamId: player.team || 0,
          positionType: player.element_type ? { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }[player.element_type] : 'UNK',
          cost: player.now_cost ? player.now_cost / 10 : 0,
          position: pick.position,
          multiplier: pick.multiplier,
          total_points: player.total_points || 0,
          form: player.form || 0
        };
      }),
      allPlayers: bootstrapData.elements.map(player => ({
        id: player.id,
        name: player.web_name || `${player.first_name} ${player.second_name}`,
        teamId: player.team,
        positionType: { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }[player.element_type],
        cost: player.now_cost / 10,
        total_points: player.total_points || 0,
      })),
      fixtures: bootstrapData.events.map(event => ({
        gameweek: event.id,
        deadline: event.deadline_time,
        isCurrent: event.is_current,
        matches: fixturesData
          .filter(f => f.event === event.id)
          .map(f => ({
            teamH: f.team_h,
            teamA: f.team_a,
            teamHName: bootstrapData.teams.find(t => t.id === f.team_h)?.short_name || 'UNK',
            teamAName: bootstrapData.teams.find(t => t.id === f.team_a)?.short_name || 'UNK',
            difficultyH: f.team_h_difficulty,
            difficultyA: f.team_a_difficulty
          }))
      })),
      budget: managerData.last_debt_value / 10 || 100,
      chipsUsed: managerData.chips?.map(c => c.name) || [],
      chipsAvailable: {
        wildcard1: !(managerData.chips?.some(c => c.name === 'wildcard' && c.status.event <= 20) || false),
        wildcard2: !(managerData.chips?.some(c => c.name === 'wildcard' && c.status.event > 20) || false),
        freehit: !(managerData.chips?.some(c => c.name === 'freehit') || false),
        bboost: !(managerData.chips?.some(c => c.name === 'bboost') || false),
        triplecaptain: !(managerData.chips?.some(c => c.name === 'triplecaptain') || false)
      },
      currentGameweek: currentGameweek,
      activeChip: picksData.active_chip || null
    };
    
    res.json(plannerData);
  } catch (error) {
    res.status(500).json({ 
      error: `Failed to fetch planner data`,
      details: error.message
    });
  }
});



  // Health check endpoint
  app.get('/fpl-basic/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      cache_stats: {
        keys: Object.keys(cache.data).length,
        size: JSON.stringify(cache.data).length
      }
    });
  });

  // Cache clear endpoint (admin)
  app.post('/fpl-basic/cache/clear', (req, res) => {
    const keyPattern = req.query.key || '';
    let count = 0;
    
    if (keyPattern) {
      // Clear specific cache entries matching pattern
      Object.keys(cache.data).forEach(key => {
        if (key.includes(keyPattern)) {
          delete cache.data[key];
          delete cache.timestamps[key];
          count++;
        }
      });
    } else {
      // Clear all cache
      count = Object.keys(cache.data).length;
      cache.data = {};
      cache.timestamps = {};
    }
    
    res.json({ 
      status: 'ok', 
      message: `Cleared ${count} cache entries`
    });
  });

  logger.info('FPL Basic Proxy Service initialized with routes:');
  logger.info('- /fpl-basic/debug');
  logger.info('- /fpl-basic/bootstrap');
  logger.info('- /fpl-basic/live/:gameweek');
  logger.info('- /fpl-basic/entry/:id');
  logger.info('- /fpl-basic/entry/:id/history');
  logger.info('- /fpl-basic/entry/:id/event/:gameweek/picks');
  logger.info('- /fpl-basic/element-summary/:id');
  logger.info('- /fpl-basic/fixtures');
  logger.info('- /fpl-basic/leagues-classic/:id/standings');
  logger.info('- /fpl-basic/entry/:id/transfers');
  logger.info('- /fpl-basic/current-gameweek');
  logger.info('- GET /fpl-basic/entry/:id/planner - Get combined planner data');
  logger.info('- /fpl-basic/health');
};

module.exports = { setupFplProxy };