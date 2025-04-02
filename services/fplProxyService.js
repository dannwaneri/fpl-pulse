const axios = require('axios');
const logger = require('../utils/logger');
const { 
  getBootstrapData, 
  getPicksData, 
  getManagerData,
  getPlannerData,
  getTop10kStats,
  getCaptaincySuggestions,
  simulateRank,
  clearCache
} = require('./fplService');

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

// Adapter for transforming manager data responses
const formatManagerResponse = (serviceResponse) => {
  if (!serviceResponse) return null;
  
  return {
    name: serviceResponse.name || 'Unknown Manager',
    teamName: serviceResponse.teamName,
    totalPoints: serviceResponse.totalPoints || 0,
    rank: serviceResponse.rank || null,
    currentGameweek: serviceResponse.currentGameweek || 1,
    activeChip: serviceResponse.activeChip || null,
    chipsUsed: serviceResponse.chipsUsed || [],
    leagues: Array.isArray(serviceResponse.leagues) ? serviceResponse.leagues : []
  };
};

// Adapter for transforming picks data responses
const formatPicksResponse = (serviceResponse) => {
  if (!serviceResponse) return { 
    picks: [], 
    transferPenalty: 0,
    totalLivePoints: 0,
    autosubs: [],
    viceCaptainPoints: null,
    liveRank: null,
    activeChip: null,
    assistantManagerPoints: null,
    assistantManager: null
  };
  
  // Validate and map events (goals, assists, etc.)
  const pickWithProcessedEvents = (serviceResponse.picks || []).map(pick => {
    // Ensure events are correctly formatted for frontend display
    const processedEvents = Array.isArray(pick.events) ? pick.events.map(event => ({
      type: event.type,
      points: event.points || 0,
      count: event.count || 1
    })) : [];
    
    return {
      ...pick,
      events: processedEvents,
      // Ensure these fields are always provided
      teamShortName: pick.teamShortName || 'UNK',
      eo: pick.eo || '0.0'
    };
  });
  
  return {
    picks: pickWithProcessedEvents,
    transferPenalty: serviceResponse.transferPenalty || 0,
    totalLivePoints: serviceResponse.totalLivePoints || 0,
    autosubs: serviceResponse.autosubs || [],
    viceCaptainPoints: serviceResponse.viceCaptainPoints || null,
    liveRank: serviceResponse.liveRank || null,
    activeChip: serviceResponse.activeChip || null,
    assistantManagerPoints: serviceResponse.assistantManagerPoints || null,
    assistantManager: serviceResponse.assistantManager || null
  };
};

// Adapter for transforming planner data responses
const formatPlannerResponse = (serviceResponse) => {
  if (!serviceResponse) return null;
  
  // Map and validate fixtures
  const validatedFixtures = (serviceResponse.fixtures || []).map(fixture => ({
    gameweek: fixture.gameweek || 1,
    deadline: fixture.deadline || new Date().toISOString(),
    isCurrent: fixture.isCurrent || false,
    matches: Array.isArray(fixture.matches) ? fixture.matches.map(match => ({
      teamH: match.teamH || 0,
      teamA: match.teamA || 0,
      teamHName: match.teamHName || 'UNK',
      teamAName: match.teamAName || 'UNK',
      difficultyH: match.difficultyH || 3,
      difficultyA: match.difficultyA || 3
    })) : []
  }));
  
  return {
    currentPicks: serviceResponse.currentPicks || [],
    allPlayers: serviceResponse.allPlayers || [],
    fixtures: validatedFixtures,
    budget: serviceResponse.budget || 100,
    chipsUsed: serviceResponse.chipsUsed || [],
    chipsAvailable: serviceResponse.chipsAvailable || {
      wildcard1: true, wildcard2: true, freehit: true, 
      bboost: true, triplecaptain: true, assistant_manager: true
    },
    currentGameweek: serviceResponse.currentGameweek || 1,
    activeChip: serviceResponse.activeChip || null,
    assistantManager: serviceResponse.assistantManager || null,
    availableManagers: serviceResponse.availableManagers || []
  };
};

// Adapter for transforming top10k stats responses
const formatTop10kResponse = (serviceResponse) => {
  if (!serviceResponse) return {};
  
  // Process tier data (top1k, top10k, etc.)
  const processTier = (tierData) => {
    if (!tierData) return null;
    
    return {
      averagePoints: tierData.averagePoints || 0,
      wildcardUsage: tierData.wildcardUsage || '0%',
      freehitUsage: tierData.freehitUsage || '0%',
      benchBoostUsage: tierData.benchBoostUsage || '0%',
      tripleCaptainUsage: tierData.tripleCaptainUsage || '0%',
      assistantManagerUsage: tierData.assistantManagerUsage || '0%',
      topPlayers: Array.isArray(tierData.topPlayers) ? tierData.topPlayers : [],
      formations: tierData.formations || {},
      eoBreakdown: tierData.eoBreakdown || {},
      managerEO: tierData.managerEO || {}
    };
  };
  
  return {
    top1k: processTier(serviceResponse.top1k),
    top10k: processTier(serviceResponse.top10k),
    top100k: processTier(serviceResponse.top100k),
    top1m: processTier(serviceResponse.top1m)
  };
};

// Adapter for transforming captaincy suggestions
const formatCaptaincyResponse = (serviceResponse) => {
  if (!Array.isArray(serviceResponse)) return [];
  
  return serviceResponse.map(suggestion => ({
    id: suggestion.id || 0,
    name: suggestion.name || 'Unknown Player',
    teamId: suggestion.teamId || 0,
    form: suggestion.form || '0.0',
    difficulty: suggestion.difficulty || 3,
    eo: suggestion.eo || 0,
    score: suggestion.score || 0
  }));
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
      const data = await getBootstrapData();
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
      
      // Try to fetch directly from FPL API without database dependency
      const response = await fetch(`https://fantasy.premierleague.com/api/event/${gameweek}/live/`, {
        timeout: 15000
        // No headers to avoid CORS issues
      });
      
      if (!response.ok) {
        throw new Error(`FPL API error: ${response.status}`);
      }
      
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error(`Error fetching live data for gameweek ${req.params.gameweek}:`, error.message);
      res.status(500).json({ 
        error: 'Failed to fetch live data',
        message: error.message
      });
    }
  });

  // Manager information
  app.get('/fpl-basic/entry/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const managerData = await getManagerData(id);
      const formattedResponse = formatManagerResponse(managerData);
      res.json(formattedResponse);
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
      const data = await getPicksData(id, gameweek);
      const formattedResponse = formatPicksResponse(data);
      res.json(formattedResponse);
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

  // Current gameweek status
  app.get('/fpl-basic/current-gameweek', async (req, res) => {
    try {
      const bootstrapData = await getBootstrapData();
      
      const currentEvent = bootstrapData.events?.find(e => e.is_current);
      
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

  // Planner endpoint
  app.get('/fpl-basic/entry/:id/planner', async (req, res) => {
    try {
      const id = req.params.id;
      const data = await getPlannerData(id);
      const formattedResponse = formatPlannerResponse(data);
      res.json(formattedResponse);
    } catch (error) {
      res.status(500).json({ 
        error: `Failed to fetch planner data`,
        details: error.message
      });
    }
  });

  // Top 10k stats - with adapter
  app.get('/api/fpl/top10k/:gameweek', async (req, res) => {
    try {
      const gameweek = req.params.gameweek;
      const forceRefresh = req.query.refresh === 'true';
      const data = await getTop10kStats(gameweek, forceRefresh);
      const formattedResponse = formatTop10kResponse(data);
      res.json(formattedResponse);
    } catch (error) {
      res.status(500).json({ 
        error: `Failed to fetch top 10k stats for gameweek ${req.params.gameweek}`,
        details: error.message
      });
    }
  });

  // Captaincy suggestions - with adapter
  app.get('/api/fpl/:id/captaincy/:gameweek', async (req, res) => {
    try {
      const id = req.params.id;
      const gameweek = req.params.gameweek;
      const chip = req.query.chip;
      const data = await getCaptaincySuggestions(id, gameweek);
      const formattedResponse = formatCaptaincyResponse(data);
      res.json(formattedResponse);
    } catch (error) {
      res.status(500).json({ 
        error: `Failed to fetch captaincy suggestions`,
        details: error.message
      });
    }
  });

  // Rank simulator - with adapter
  app.get('/api/fpl/:id/rank-simulator/:gameweek', async (req, res) => {
    try {
      const id = req.params.id;
      const gameweek = req.params.gameweek;
      const additionalPoints = parseInt(req.query.points) || 0;
      const data = await simulateRank(id, gameweek, additionalPoints);
      res.json({
        simulatedRank: data.simulatedRank || null,
        simulatedPoints: data.simulatedPoints || 0
      });
    } catch (error) {
      res.status(500).json({ 
        error: `Failed to simulate rank`,
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
  app.post('/fpl-basic/cache/clear', async (req, res) => {
    try {
      const keyPattern = req.query.key || '';
      await clearCache(keyPattern);
      res.json({ 
        status: 'ok', 
        message: `Cache cleared successfully`
      });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to clear cache',
        details: error.message
      });
    }
  });

  logger.info('FPL Proxy Service initialized with routes:');
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
  logger.info('- POST /fpl-basic/cache/clear - Clear cache');
  logger.info('- /api/fpl/top10k/:gameweek - Get top 10k stats (with adapter)');
  logger.info('- /api/fpl/:id/captaincy/:gameweek - Get captaincy suggestions (with adapter)');
  logger.info('- /api/fpl/:id/rank-simulator/:gameweek - Simulate rank (with adapter)');
};

module.exports = { setupFplProxy };