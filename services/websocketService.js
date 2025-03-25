const axios = require('axios');
const { updatePicksFromLiveData, getTop10kStats, memoryCache, estimateLiveRank, getPicksData, getManagerData } = require('./fplService');
const WebSocket = require('ws');
const { loadBootstrapData } = require('./bootstrapService');



// Initialize global live data cache
global.liveDataCache = global.liveDataCache || {};

const setupWebSocket = (wss) => {
  let currentGameweek = null;
  const subscriptions = new Map();

  const fetchLiveData = async (gameweek) => {
    // Define BASE_URL
    const BASE_URL = process.env.NODE_ENV === 'production' 
      ? 'https://fpl-pulse.onrender.com' 
      : 'http://localhost:5000';
    try {
      const response = await axios.get(`${BASE_URL}/fpl-proxy/event/${gameweek}/live/`, { 
        timeout: 10000 
      });
      const newData = response.data.elements;

      if (JSON.stringify(newData) !== JSON.stringify(global.liveDataCache[gameweek])) {
        global.liveDataCache[gameweek] = newData;
        const updatedStats = await getTop10kStats(gameweek);

        const updatePromises = Array.from(subscriptions.entries())
          .filter(([_, { fplId, gameweek: subGW }]) => subGW === gameweek)
          .map(async ([client, { fplId }]) => {
            try {
              if (client.readyState !== WebSocket.OPEN) return;
      
              let picksData = memoryCache[`picks:${fplId}:${gameweek}`]?.data;
              if (!picksData) {
                picksData = await getPicksData(fplId, gameweek); // Now returns fallback on error
              }

              const updatedPicks = picksData.picks;
              updatePicksFromLiveData(fplId, gameweek, newData); // Updated to handle user ID
              
              // Calculate total points based on chips
              let totalLivePoints = picksData.totalLivePoints;
              
              // Get assistant manager points if available
              const assistantManagerPoints = picksData.assistantManagerPoints || 0;

              const managerData = await getManagerData(fplId).catch(err => {
                console.warn(`getManagerData failed for fplId ${fplId}: ${err.message}`);
                return { totalPoints: 0, rank: 5000000 }; // Fallback manager data
              });

              const liveRank = await estimateLiveRank(
                totalLivePoints,
                managerData.totalPoints || 0,
                managerData.rank || 5000000,
                updatedPicks,
                assistantManagerPoints
              ).catch(err => {
                console.warn(`estimateLiveRank failed for fplId ${fplId}: ${err.message}`);
                return null; // Fallback rank
              });

              client.send(JSON.stringify({
                type: 'liveUpdate',
                gameweek,
                data: newData,
                fplId,
                totalLivePoints,
                liveRank,
                picks: updatedPicks,
                activeChip: picksData.activeChip,
                assistantManagerPoints: assistantManagerPoints,
                assistantManager: picksData.assistantManager
              }));

              client.send(JSON.stringify({
                type: 'top10kUpdate',
                gameweek,
                stats: updatedStats
              }));

              console.log(`Sent live update to fplId ${fplId} for GW ${gameweek}:`, { 
                totalLivePoints, 
                liveRank,
                activeChip: picksData.activeChip,
                assistantManagerPoints
              });
            } catch (updateError) {
              console.error(`Error processing update for fplId ${fplId}:`, updateError);
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                  type: 'error',
                  message: `Failed to process update: ${updateError.message}`
                }));
              }
            }
          });

        await Promise.allSettled(updatePromises);
      }
    } catch (err) {
      console.error(`Failed to fetch live data for GW ${gameweek}:`, err.message);
      subscriptions.forEach((_, client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'error',
            message: `Failed to fetch live data: ${err.message}`
          }));
        }
      });
    }
  };



  const initializeGameweek = async () => {
    // Define BASE_URL
    const BASE_URL = process.env.NODE_ENV === 'production' 
      ? 'https://fpl-pulse.onrender.com' 
      : 'http://localhost:5000';
  
    try {
      let bootstrap;
      let dataSource = 'api';
      
      try {
        // Try to fetch from API first
        console.log('Trying to fetch bootstrap data from API...');
        const response = await axios.get(`${BASE_URL}/fpl-proxy/bootstrap-static/`, {
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Origin': 'https://fantasy.premierleague.com',
            'Referer': 'https://fantasy.premierleague.com/'
          }
        });
        
        // Check response type and content
        const contentType = response.headers['content-type'] || '';
        console.log('API response content type:', contentType);
        
        // If response is HTML instead of JSON, reject it
        if (contentType.includes('text/html') || 
            (typeof response.data === 'string' && response.data.includes('<!DOCTYPE html>'))) {
          console.warn('Received HTML instead of JSON, rejecting response');
          throw new Error('HTML response received instead of JSON');
        }
        
        bootstrap = response;
        
        // Check if the data has the expected structure
        if (!bootstrap.data || !bootstrap.data.events || !Array.isArray(bootstrap.data.events)) {
          console.warn('API response missing expected structure, falling back to cache');
          throw new Error('Invalid data structure from API');
        }
      } catch (apiError) {
        // Enhanced error logging for API errors
        console.error('API request failed:', {
          message: apiError.message,
          response: apiError.response ? {
            status: apiError.response.status,
            contentType: apiError.response.headers['content-type'],
            dataType: typeof apiError.response.data,
            dataSample: typeof apiError.response.data === 'string' 
              ? apiError.response.data.substring(0, 200) + '...' 
              : JSON.stringify(apiError.response.data).substring(0, 200) + '...'
          } : 'No response received'
        });
        
        // Fall back to cached data
        console.log('Falling back to cached bootstrap data');
        dataSource = 'cache';
        try {
          const cachedBootstrap = await loadBootstrapData();
          bootstrap = { data: cachedBootstrap };
        } catch (cacheError) {
          console.error('Cache retrieval failed:', cacheError.message);
          // Let it proceed to the hardcoded fallback
          dataSource = 'hardcoded';
        }
      }
      
      // Use hardcoded gameweek if needed
      if (dataSource === 'hardcoded' || !bootstrap?.data?.events || !Array.isArray(bootstrap.data.events)) {
        console.warn('Using hardcoded gameweek due to data issues');
        currentGameweek = 29; // Update this to current gameweek
      } else {
        const currentEvent = bootstrap.data.events.find(e => e.is_current);
        console.log('Current event found:', currentEvent ? 
          { id: currentEvent.id, is_current: currentEvent.is_current } : 'None');
        currentGameweek = currentEvent?.id || 29; // Fallback to hardcoded value if not found
      }
      
      console.log(`Using gameweek: ${currentGameweek} (source: ${dataSource})`);
      fetchLiveData(currentGameweek);
      setInterval(() => fetchLiveData(currentGameweek), 60000);
    } catch (err) {
      // Final fallback - enhanced error logging
      console.error('Ultimate fallback triggered:', {
        message: err.message,
        stack: err.stack
      });
      
      // Hard-coded fallback as last resort
      console.log('Using hard-coded fallback gameweek');
      currentGameweek = 29; // Update this to current gameweek
      
      fetchLiveData(currentGameweek);
      setInterval(() => fetchLiveData(currentGameweek), 60000);
      
      // Notify connected clients
      subscriptions.forEach((_, client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ 
            type: 'error', 
            message: 'Using fallback data. Some features may be limited.'
          }));
        }
      });
    }
  };
  
  
  wss.on('connection', (ws) => {
    console.log('Client connected');
    ws.send(JSON.stringify({ 
      type: 'init', 
      gameweek: currentGameweek, 
      data: global.liveDataCache[currentGameweek] || [] 
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
        console.error('Invalid WebSocket message:', err);
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        return;
      }

      const { type } = parsedMessage;
      if (type === 'subscribe') {
        const { fplId, gameweek } = parsedMessage;
        if (fplId && gameweek) {
          subscriptions.set(ws, { fplId, gameweek });
          console.log(`Client subscribed: fplId ${fplId}, GW ${gameweek}`);
          if (!global.liveDataCache[gameweek]) fetchLiveData(gameweek);
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'fplId and gameweek are required' }));
        }
      }
    });

    ws.on('close', () => {
      subscriptions.delete(ws);
      console.log('Client disconnected');
    });
  });

  initializeGameweek();
};

module.exports = { setupWebSocket };