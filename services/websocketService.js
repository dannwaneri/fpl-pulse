const axios = require('axios');
const { updatePicksFromLiveData, getTop10kStats, memoryCache, estimateLiveRank, getPicksData, getManagerData } = require('./fplService');
const WebSocket = require('ws');

// Initialize global live data cache
global.liveDataCache = global.liveDataCache || {};

const setupWebSocket = (wss) => {
  let currentGameweek = null;
  const subscriptions = new Map();

  const fetchLiveData = async (gameweek) => {
    try {
      const response = await axios.get(`/fpl-proxy/event/${gameweek}/live/`, { 
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
    try {
      // Use your own proxy instead of direct FPL API access
      const bootstrap = await axios.get('/fpl-proxy/bootstrap-static/');
      currentGameweek = bootstrap.data.events.find(e => e.is_current)?.id || 1;
      fetchLiveData(currentGameweek);
      setInterval(() => fetchLiveData(currentGameweek), 60000);
    } catch (err) {
      console.error('Failed to initialize gameweek:', {
        message: err.message,
        status: err.response?.status,
        statusText: err.response?.statusText,
        data: err.response?.data,
        headers: err.response?.headers
      });
      // Notify clients of the error
      subscriptions.forEach((_, client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ 
            type: 'error', 
            message: 'Failed to initialize game data. Please try again later.'
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