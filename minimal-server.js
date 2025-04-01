const express = require('express');
const axios = require('axios');
const cors = require('cors');

// Create simple express app
const app = express();
const PORT = 5050; // Different port from your main app

// Simple in-memory cache
const cache = {
  data: {},
  timestamps: {},
  ttl: 60000 // 1 minute default TTL
};

// Helper to check if cache is valid
const isCacheValid = (key) => {
  if (!cache.data[key] || !cache.timestamps[key]) return false;
  return (Date.now() - cache.timestamps[key]) < cache.ttl;
};

// Enable CORS for all routes
app.use(cors({
  origin: '*',
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Requested-With']
}));

// Handle preflight requests
app.options('*', (req, res) => {
  res.status(200).end();
});

// Root endpoint
app.get('/', (req, res) => {
  res.send('FPL Minimal Proxy Server is running');
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ status: 'ok', message: 'Server is working' });
});

// Bootstrap static endpoint - no headers approach
app.get('/bootstrap', async (req, res) => {
  try {
    const cacheKey = 'bootstrap';
    if (isCacheValid(cacheKey)) {
      console.log('Serving bootstrap data from cache');
      return res.json(cache.data[cacheKey]);
    }

    console.log('Fetching bootstrap data with no headers');
    const response = await axios.get('https://fantasy.premierleague.com/api/bootstrap-static/', {
      timeout: 15000
      // No headers whatsoever
    });
    
    // Cache the result
    cache.data[cacheKey] = response.data;
    cache.timestamps[cacheKey] = Date.now();
    
    res.json(response.data);
  } catch (error) {
    console.error('Bootstrap fetch error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Live data endpoint - no headers approach
app.get('/live/:gameweek', async (req, res) => {
  try {
    const gameweek = req.params.gameweek;
    const cacheKey = `live:${gameweek}`;
    
    if (isCacheValid(cacheKey)) {
      console.log(`Serving live data for gameweek ${gameweek} from cache`);
      return res.json(cache.data[cacheKey]);
    }
    
    console.log(`Fetching live data for gameweek ${gameweek} with no headers`);
    
    const response = await axios.get(`https://fantasy.premierleague.com/api/event/${gameweek}/live/`, {
      timeout: 15000
      // No headers whatsoever
    });
    
    // Cache the result
    cache.data[cacheKey] = response.data;
    cache.timestamps[cacheKey] = Date.now();
    
    res.json(response.data);
  } catch (error) {
    console.error('Live data fetch error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Player data endpoint
app.get('/player/:id', async (req, res) => {
  try {
    const playerId = req.params.id;
    const cacheKey = `player:${playerId}`;
    
    if (isCacheValid(cacheKey)) {
      console.log(`Serving player data for ID ${playerId} from cache`);
      return res.json(cache.data[cacheKey]);
    }
    
    console.log(`Fetching player data for ID ${playerId} with no headers`);
    
    const response = await axios.get(`https://fantasy.premierleague.com/api/element-summary/${playerId}/`, {
      timeout: 15000
      // No headers whatsoever
    });
    
    // Cache the result
    cache.data[cacheKey] = response.data;
    cache.timestamps[cacheKey] = Date.now();
    
    res.json(response.data);
  } catch (error) {
    console.error('Player data fetch error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Manager endpoint (this one might require auth, but we're testing without it)
app.get('/manager/:id', async (req, res) => {
  try {
    const managerId = req.params.id;
    const cacheKey = `manager:${managerId}`;
    
    if (isCacheValid(cacheKey)) {
      console.log(`Serving manager data for ID ${managerId} from cache`);
      return res.json(cache.data[cacheKey]);
    }
    
    console.log(`Fetching manager data for ID ${managerId} with no headers`);
    
    const response = await axios.get(`https://fantasy.premierleague.com/api/entry/${managerId}/`, {
      timeout: 15000
      // No headers whatsoever
    });
    
    // Cache the result
    cache.data[cacheKey] = response.data;
    cache.timestamps[cacheKey] = Date.now();
    
    res.json(response.data);
  } catch (error) {
    console.error('Manager data fetch error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Manager picks endpoint
app.get('/manager/:id/picks/:gameweek', async (req, res) => {
  try {
    const managerId = req.params.id;
    const gameweek = req.params.gameweek;
    const cacheKey = `manager:${managerId}:picks:${gameweek}`;
    
    if (isCacheValid(cacheKey)) {
      console.log(`Serving picks data for manager ${managerId}, GW ${gameweek} from cache`);
      return res.json(cache.data[cacheKey]);
    }
    
    console.log(`Fetching picks data for manager ${managerId}, GW ${gameweek} with no headers`);
    
    const response = await axios.get(`https://fantasy.premierleague.com/api/entry/${managerId}/event/${gameweek}/picks/`, {
      timeout: 15000
      // No headers whatsoever
    });
    
    // Cache the result
    cache.data[cacheKey] = response.data;
    cache.timestamps[cacheKey] = Date.now();
    
    res.json(response.data);
  } catch (error) {
    console.error('Manager picks fetch error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Fixtures endpoint
app.get('/fixtures', async (req, res) => {
  try {
    const cacheKey = 'fixtures';
    
    if (isCacheValid(cacheKey)) {
      console.log('Serving fixtures data from cache');
      return res.json(cache.data[cacheKey]);
    }
    
    console.log('Fetching fixtures data with no headers');
    
    const response = await axios.get('https://fantasy.premierleague.com/api/fixtures/', {
      timeout: 15000
      // No headers whatsoever
    });
    
    // Cache the result
    cache.data[cacheKey] = response.data;
    cache.timestamps[cacheKey] = Date.now();
    
    res.json(response.data);
  } catch (error) {
    console.error('Fixtures fetch error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// League standings endpoint
app.get('/league/:id', async (req, res) => {
  try {
    const leagueId = req.params.id;
    const cacheKey = `league:${leagueId}`;
    
    if (isCacheValid(cacheKey)) {
      console.log(`Serving league data for ID ${leagueId} from cache`);
      return res.json(cache.data[cacheKey]);
    }
    
    console.log(`Fetching league data for ID ${leagueId} with no headers`);
    
    const response = await axios.get(`https://fantasy.premierleague.com/api/leagues-classic/${leagueId}/standings/`, {
      timeout: 15000
      // No headers whatsoever
    });
    
    // Cache the result
    cache.data[cacheKey] = response.data;
    cache.timestamps[cacheKey] = Date.now();
    
    res.json(response.data);
  } catch (error) {
    console.error('League data fetch error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Clear cache endpoint
app.get('/clear-cache', (req, res) => {
  cache.data = {};
  cache.timestamps = {};
  console.log('Cache cleared');
  res.json({ status: 'ok', message: 'Cache cleared' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`FPL Minimal Proxy Server running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log('  - /test - Test if server is running');
  console.log('  - /bootstrap - Get bootstrap static data');
  console.log('  - /live/:gameweek - Get live data for a gameweek');
  console.log('  - /player/:id - Get player data');
  console.log('  - /manager/:id - Get manager data');
  console.log('  - /manager/:id/picks/:gameweek - Get manager picks for a gameweek');
  console.log('  - /fixtures - Get fixture data');
  console.log('  - /league/:id - Get league standings');
  console.log('  - /clear-cache - Clear the cache');
});