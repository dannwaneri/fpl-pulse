const axios = require('axios');
const { updatePicksFromLiveData, getTop10kStats, memoryCache, estimateLiveRank, getPicksData, getManagerData } = require('./fplService');
const WebSocket = require('ws');
const { Bootstrap } = require('../config/db'); 
const { loadBootstrapData } = require('./bootstrapService');
const logger = require('../utils/logger');



const delay = (ms) => new Promise(resolve => {
  const jitter = Math.random() * 300;
  setTimeout(resolve, ms + jitter);
});

const fetchWithRetry = async (url, retries = 3, initialDelayMs = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, { timeout: 15000 });
      return response;
    } catch (err) {
      const isNetworkError = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND';
      const isServerError = err.response?.status >= 500 && err.response?.status < 600;

      if ((isNetworkError || isServerError) && i < retries - 1) {
        const backoffTime = initialDelayMs * Math.pow(2, i);
        console.warn(`Retry ${i + 1}/${retries} for ${url}: ${err.message}. Waiting ${backoffTime}ms before retry.`);
        await delay(backoffTime);
        continue;
      }
      throw err;
    }
  }
};


// Initialize global live data cache
global.liveDataCache = global.liveDataCache || {};

const setupWebSocket = (wss) => {
  let currentGameweek = null;
  const subscriptions = new Map();

  const fetchLiveData = async (gameweek) => {
    const BASE_URL = process.env.NODE_ENV === 'production' 
      ? 'https://fpl-pulse.onrender.com' 
      : 'http://localhost:5000';
    try {
      const response = await fetchWithRetry(`${BASE_URL}/fpl-proxy/event/${gameweek}/live/`, 3, 1000);
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
                picksData = await getPicksData(fplId, gameweek);
              }
  
              const updatedPicks = picksData.picks;
              updatePicksFromLiveData(fplId, gameweek, newData);
  
              let totalLivePoints = picksData.totalLivePoints;
              const assistantManagerPoints = picksData.assistantManagerPoints || 0;
  
              const managerData = await getManagerData(fplId).catch(err => {
                console.warn(`getManagerData failed for fplId ${fplId}: ${err.message}`);
                return { totalPoints: 0, rank: 5000000 };
              });
  
              const liveRank = await estimateLiveRank(
                totalLivePoints,
                managerData.totalPoints || 0,
                managerData.rank || 5000000,
                updatedPicks,
                assistantManagerPoints
              ).catch(err => {
                console.warn(`estimateLiveRank failed for fplId ${fplId}: ${err.message}`);
                return null;
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
      console.error(`Failed to fetch live data for GW ${gameweek} after retries:`, {
        message: err.message,
        status: err.response?.status,
        headers: err.response?.headers
      });
      subscriptions.forEach((_, client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'error',
            message: `Failed to fetch live data after retries: ${err.message}`
          }));
        }
      });
      if (!global.liveDataCache[gameweek]) {
        console.warn(`No live data available for GW ${gameweek}, using empty array as fallback`);
        global.liveDataCache[gameweek] = [];
      }
    }
  };
  
  const initializeGameweek = async () => {
    try {
      const bootstrap = await loadBootstrapData();
      const cachedBootstrap = await Bootstrap.findOne({ _id: 'bootstrap:latest' }).exec();
  
      // Dynamic gameweek fallback: Use latest cached event or default to 29
      const currentEvent = bootstrap.events.find(e => e.is_current);
      const latestCachedEvent = cachedBootstrap?.data?.events?.slice(-1)[0]?.id || 29;
      currentGameweek = currentEvent?.id || latestCachedEvent;
  
      logger.info('Current event found:', { gameweek: currentGameweek });
      await fetchLiveData(currentGameweek);
      setInterval(() => fetchLiveData(currentGameweek), 60000);
    } catch (error) {
      logger.error('Failed to initialize gameweek', { message: error.message });
      currentGameweek = currentGameweek || 29; // Fallback to 29 if all else fails
      logger.warn(`Using fallback gameweek ${currentGameweek}`);
      
      // Notify connected clients about using fallback data
      subscriptions.forEach((_, client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ 
            type: 'error', 
            message: 'Using fallback data. Some features may be limited.'
          }));
        }
      });
      
      fetchLiveData(currentGameweek);
      setInterval(() => fetchLiveData(currentGameweek), 60000);
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