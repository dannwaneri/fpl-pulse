const axios = require('axios');
const { loadBootstrapData } = require('./bootstrapService');
const FPLAPIProxyService = require('./fplApiProxyService');
const { TopStats, PicksData, PlannerData } = require('../config/db');
const managersData = require('../utils/data/managers.json');

// In-memory cache with longer duration
const memoryCache = {};
const CACHE_DURATION_SHORT = 900000; // 15 minutes for frequently updated data
const CACHE_DURATION_LONG = 43200000; // 6 hours for stable data

// Enhanced utility function for delay with jitter
const delay = (ms) => new Promise(resolve => {
  const jitter = Math.random() * 300;
  setTimeout(resolve, ms + jitter);
});

// Enhanced fetchWithRetry with exponential backoff
const fetchWithRetry = async (url, retries = 3, initialDelayMs = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, { timeout: 15000 });
      return response;
    } catch (err) {
      const isNetworkError = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND';
      const isRateLimited = err.response?.status === 429;
      const isServerError = err.response?.status >= 500 && err.response?.status < 600;

      if ((isNetworkError || isRateLimited || isServerError) && i < retries - 1) {
        const backoffTime = initialDelayMs * Math.pow(2, i);
        console.warn(`Retry ${i + 1}/${retries} for ${url}: ${err.message}. Waiting ${backoffTime}ms before retry.`);
        await delay(backoffTime);
        continue;
      }
      throw err;
    }
  }
};

// Batch fetch utility
const batchFetch = async (urls, batchSize = 10) => {
  const results = [];
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(url => fetchWithRetry(url)));
    results.push(...batchResults);
    if (i + batchSize < urls.length) await delay(1000); // Throttle between batches
  }
  return results;
};

// Cached bootstrap data
let cachedBootstrapData = null;
let bootstrapTimestamp = 0;


const getBootstrapData = async (forceRefresh = false) => {
  try {
    // Check memory cache first
    if (cachedBootstrapData && !forceRefresh && 
      (Date.now() - bootstrapTimestamp) < 43200000) {
    return cachedBootstrapData;
  }

    // Fetch data
    const rawData = await loadBootstrapData(forceRefresh);

    // Validate and normalize data
    cachedBootstrapData = {
      elements: rawData.elements || [],
      events: rawData.events || [],
      teams: rawData.teams || [],
      ...rawData
    };

    // Validate elements
    if (cachedBootstrapData.elements.length === 0) {
      logger.warn('No elements found in bootstrap data');
      cachedBootstrapData.elements = DEFAULT_BOOTSTRAP_DATA.elements;
    }

    bootstrapTimestamp = Date.now();
    
    return cachedBootstrapData;
  } catch (error) {
    logger.error('Failed to get bootstrap data', { 
      message: error.message,
      fallback: 'Using default data'
    });
    
    return DEFAULT_BOOTSTRAP_DATA;
  }
};

const getManagerData = async (id) => {
  const cacheKey = `manager:${id}`;
  if (memoryCache[cacheKey] && (Date.now() - memoryCache[cacheKey].timestamp) < CACHE_DURATION_SHORT) {
    console.log(`Memory cache hit for ${cacheKey}`);
    return memoryCache[cacheKey].data;
  }
  try {
    // Use FPLAPIProxyService for more reliable data fetching
    const { managerData, historyData } = await FPLAPIProxyService.fetchManagerData(id);
    
    const chipsUsed = historyData.chips?.map(chip => chip.name) || [];
    
    console.log('Manager data fetched:', { 
      id, 
      currentGameweek: managerData.current_event,
      leagues: managerData.leagues?.classic?.length || 0
    });
    
    const result = {
      name: `${managerData.player_first_name} ${managerData.player_last_name}`,
      totalPoints: managerData.summary_overall_points,
      rank: managerData.summary_overall_rank,
      currentGameweek: managerData.current_event || 1,
      activeChip: managerData.active_chip,
      chipsUsed,
      assistantManager: managerData.active_chip === 'assistant_manager' ? {
        id: managerData.assistant_manager?.id,
        name: managerData.assistant_manager?.name
      } : null,
      leagues: Array.isArray(managerData.leagues?.classic) ? managerData.leagues.classic : [] // Ensure leagues is an array
    };
    
    console.log('Processed manager data:', { 
      hasLeagues: !!result.leagues, 
      leaguesLength: result.leagues.length || 0,
      currentGameweek: result.currentGameweek
    });
    
    memoryCache[cacheKey] = { data: result, timestamp: Date.now() };
    return result;
  } catch (error) {
    console.error('Error in getManagerData:', { id, error: error.message, status: error.response?.status });
    return {
      name: 'Unknown Manager',
      totalPoints: 0,
      rank: null,
      currentGameweek: 1,
      activeChip: null,
      chipsUsed: [],
      assistantManager: null,
      leagues: [] // Fallback in case of error
    };
  }
};

// Helper function to get current gameweek
const getCurrentGameweek = () => {
  // Try to get from cache first
  if (global.currentGameweek) {
    return global.currentGameweek;
  }
  
  // Use cached bootstrap data if available
  if (cachedBootstrapData && cachedBootstrapData.events) {
    const currentEvent = cachedBootstrapData.events.find(e => e.is_current);
    if (currentEvent) {
      global.currentGameweek = currentEvent.id;
      return currentEvent.id;
    }
  }
  
  // Default to a reasonable gameweek number
  return 30; // Adjust based on the current time of year
};

const estimateLiveRank = async (totalPoints, seasonPoints, managerRank, picks = [], assistantManagerPoints = 0) => {
  try {
    // Ensure numeric inputs with safe defaults
    totalPoints = Number(totalPoints) || 0;
    seasonPoints = Number(seasonPoints) || 0;
    managerRank = Number(managerRank) || 5000000;
    const adjustedTotalPoints = totalPoints + assistantManagerPoints;

    console.log('estimateLiveRank inputs:', { totalPoints, seasonPoints, managerRank, adjustedTotalPoints });

    // Use FPLAPIProxyService to get required data
    const rankData = await FPLAPIProxyService.fetchRankData(
      'estimate', // Use 'estimate' as placeholder for managerId
      getCurrentGameweek(),
      totalPoints,
      seasonPoints,
      managerRank
    );
    
    // If we got a direct result from the worker, return it
    if (rankData.simulatedRank) {
      return rankData.simulatedRank;
    }
    
    // Otherwise, calculate the rank using fetched data
    const bootstrapData = rankData.bootstrapData || await getBootstrapData();
    const top10kStats = rankData.top10kStats || memoryCache[`gw${getCurrentGameweek() - 1}`]?.data || await getTop10kStats(getCurrentGameweek() - 1);
    
    const currentGW = bootstrapData.events.find(e => e.is_current)?.id || 1;
    const pastGW = Math.max(1, currentGW - 1);

    const avgPointsTop10k = Number(top10kStats?.top10k?.averagePoints) || 80;
    const avgPointsOverall = Number(bootstrapData.events.find(e => e.id === pastGW)?.average_entry_score) || 50;
    
    const totalManagers = 10000000;
    const maxPoints = avgPointsTop10k * 1.5;

    // If picks are provided, enhance calculation with EO and bonus points
    if (picks && picks.length > 0) {
      // Use cached top100k EO for rank ~100k
      const nearRankEO = top10kStats?.top100k?.eoBreakdown || {};
      const updatedPicks = picks.map(pick => ({
        ...pick,
        eo: nearRankEO[pick.playerId]?.eo || pick.eo
      }));

      // Calculate bonus points if not already included
      const bonusPoints = updatedPicks.reduce((sum, pick) => {
        return sum + (pick.bonus || 0) * (pick.multiplier || 1);
      }, 0);

      const livePoints = adjustedTotalPoints + bonusPoints;
      const newTotalPoints = seasonPoints + livePoints;

      const calculateRankShift = (points, baseRank, picks) => {
        const avgLiveGain = avgPointsOverall * 0.7 + avgPointsTop10k * 0.3;
        const pointDiff = points - (seasonPoints + avgLiveGain);
        const eoImpact = Math.min(1.5, picks.reduce((sum, pick) => {
          const eo = Number(pick.eo) / 100;
          return sum + (pick.livePoints * (1 - eo));
        }, 0) / picks.length || 1);

        const steepness = 0.02;
        const rankDensityFactor = baseRank < 10000 ? 0.005 : baseRank < 100000 ? 0.03 : 0.07;
        const rankChange = pointDiff >= 0 
          ? -baseRank * eoImpact * Math.tanh(steepness * pointDiff) * rankDensityFactor
          : baseRank * eoImpact * Math.tanh(steepness * -pointDiff) * rankDensityFactor;

        let estimatedRank = baseRank + rankChange;

        if (points > seasonPoints + avgPointsTop10k * 1.2) {
          const top10kPrecision = (points - (seasonPoints + avgLiveGain)) / (avgPointsTop10k * 1.5);
          estimatedRank = Math.min(estimatedRank, Math.round(10000 * (1 - top10kPrecision)));
        }

        return Math.round(Math.max(1, Math.min(totalManagers, estimatedRank)));
      };

      const estimatedRank = calculateRankShift(newTotalPoints, managerRank, updatedPicks);

      console.log('Final estimated live rank:', { 
        totalPoints, 
        seasonPoints, 
        managerRank, 
        bonusPoints, 
        estimatedRank 
      });
      
      return estimatedRank;
    } 
    
    // Original sigmoid-based calculation if no picks provided
    else {
      // Advanced ranking calculation using sigmoid-like function
      const calculateRank = (points) => {
        // Sigmoid-like function for more natural rank distribution
        const steepness = 0.02; // Controls how quickly rank changes with points
        const midpoint = avgPointsOverall;
        
        // Normalized score between 0 and 1
        const normalizedScore = 1 / (1 + Math.exp(-steepness * (points - midpoint)));
        
        // Map normalized score to rank, giving preference to top performers
        const rank = totalManagers * Math.pow(1 - normalizedScore, 1.5);
        
        return Math.max(1, Math.min(totalManagers, Math.round(rank)));
      };

      // Incorporate season performance and live points
      const performanceWeight = 0.3; // Weight of season points
      const livePointsWeight = 1 - performanceWeight;

      const weightedPoints = (
        (seasonPoints * performanceWeight) + 
        (adjustedTotalPoints * livePointsWeight)
      );

      // Apply rank calculation
      let estimatedRank = calculateRank(weightedPoints);

      // Top 10k precision refinement
      if (weightedPoints >= avgPointsTop10k) {
        const top10kPrecision = Math.min(1, (weightedPoints - avgPointsTop10k) / (maxPoints - avgPointsTop10k));
        estimatedRank = Math.round(10000 * (1 - top10kPrecision));
      }

      // Position adjustment based on initial season rank
      const rankAdjustmentFactor = Math.min(1, Math.max(0.5, 1 - (managerRank / totalManagers)));
      estimatedRank = Math.round(estimatedRank * rankAdjustmentFactor);

      // Final safeguards
      estimatedRank = Math.max(1, Math.min(totalManagers, estimatedRank));

      console.log('Estimated live rank:', { 
        totalPoints, 
        seasonPoints, 
        managerRank, 
        weightedPoints, 
        estimatedRank 
      });

      return estimatedRank;
    }
  } catch (err) {
    console.error('Error estimating live rank:', err.message);
    return 10000000; // Fallback to worst rank
  }
};

const simulateRank = async (id, gameweek, additionalPoints) => {
  try {
    const picksData = await getPicksData(id, gameweek);
    const currentPoints = picksData.totalLivePoints || 0;
    const assistantManagerPoints = picksData.assistantManagerPoints || 0;
    
    // Get manager data to pass to estimateLiveRank
    const managerData = await getManagerData(id);
    const seasonPoints = managerData.totalPoints || 0;
    const managerRank = managerData.rank || 5000000;
    
    // Include assistant manager points in the simulation if active
    const simulatedPoints = currentPoints + additionalPoints;
    
    // Pass all required parameters to estimateLiveRank
    const simulatedRank = await estimateLiveRank(
      simulatedPoints, 
      seasonPoints,
      managerRank,
      picksData.picks || [],
      assistantManagerPoints
    );
    
    return { 
      simulatedPoints, 
      simulatedRank,
      currentRank: picksData.liveRank || managerRank,
      additionalPoints 
    };
  } catch (err) {
    console.error(`Error in simulateRank for ID ${id}, GW ${gameweek}:`, err.message);
    throw err;
  }
};

const identifyDifferentials = (picks, top10kStats, managerRank) => {
  const nearRankEOThreshold = managerRank < 10000 ? 5 : 10; // Stricter for top ranks
  const top10kEOThreshold = 5;
  return picks.map(pick => {
    const top10kEO = top10kStats.top10k?.eoBreakdown[pick.playerId]?.eo || 0;
    const nearRankEO = Number(pick.eo); // Your adjusted EO from rankFactor
    const isDifferential = nearRankEO < nearRankEOThreshold || top10kEO < top10kEOThreshold;
    return { ...pick, isDifferential };
  });
}



// Enhanced getPicksData with count in events and robust teamMap
const getPicksData = async (id, gameweek) => {
  const cacheKey = `picks:${id}:${gameweek}`;
  if (memoryCache[cacheKey] && (Date.now() - memoryCache[cacheKey].timestamp) < CACHE_DURATION_SHORT) {
    console.log(`Memory cache hit for ${cacheKey}`);
    return memoryCache[cacheKey].data;
  }

  const cachedDoc = await PicksData.findById(cacheKey).lean();
  if (cachedDoc && (Date.now() - new Date(cachedDoc.timestamp).getTime()) < CACHE_DURATION_LONG) {
    console.log(`Mongoose cache hit for ${cacheKey}`);
    memoryCache[cacheKey] = { data: cachedDoc.data, timestamp: Date.now() };
    return cachedDoc.data;
  }

  try {
    // Use FPLAPIProxyService for more reliable data fetching
    const [picksData, liveData, managerData, transfersData] = await Promise.all([
      FPLAPIProxyService.fetchPicksData(id, gameweek),
      FPLAPIProxyService.fetchLiveData(gameweek),
      FPLAPIProxyService.fetchManagerData(id).then(data => data.managerData),
      FPLAPIProxyService.fetchTransfersData(id).catch(err => {
        console.warn(`Failed to fetch transfers for ID ${id}, GW ${gameweek}:`, err.message);
        return []; // Default to empty array if transfers fetch fails
      })
    ]);
    
    let bootstrapData = await getBootstrapData();
    // Refresh bootstrap if players are missing
    const missingPlayers = picksData.picks.filter(pick => 
      !bootstrapData.elements.some(el => el.id === pick.element)
    );
    if (missingPlayers.length > 0) {
      console.warn(`Missing players for ID ${id}, GW ${gameweek}: ${missingPlayers.map(p => p.element).join(', ')}`);
      bootstrapData = await getBootstrapData(true); // Force refresh
    }

    const liveElements = liveData.elements;
    const managerRank = managerData.summary_overall_rank || 5000000;
    const seasonPoints = managerData.summary_overall_points || 0;
    const totalManagers = 10000000;
    const rankFactor = Math.min(1, Math.max(0.5, 1 - (managerRank / totalManagers)));

    const activeChip = picksData.active_chip; // e.g., "wildcard", "3cap", "bboost", "freehit", "assistant_manager"

    // Enhanced team ID to short_name mapping
    const teamMap = Array.isArray(bootstrapData.teams) && bootstrapData.teams.length > 0
      ? bootstrapData.teams.reduce((acc, team) => {
          acc[team.id] = team.short_name || 'UNK'; // Fallback for missing short_name
          return acc;
        }, {})
      : {};

    const picks = picksData.picks.map(pick => {
      const player = bootstrapData.elements.find(el => el.id === pick.element);
      const liveStats = liveElements.find(el => el.id === pick.element)?.stats || {};
      
      const positionMap = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
      const ownership = player ? parseFloat(player.selected_by_percent) : 0;
      const positionType = player?.element_type ? positionMap[player.element_type] : 'UNK';

      const events = [];
      if (liveStats.goals_scored) events.push({ 
        type: 'Goal', 
        points: liveStats.goals_scored * (pick.multiplier || 1) * (positionType === 'GK' || positionType === 'DEF' ? 6 : positionType === 'MID' ? 5 : 4), 
        count: liveStats.goals_scored 
      });
      
      if (liveStats.assists) events.push({ 
        type: 'Assist', 
        points: liveStats.assists * 3, 
        count: liveStats.assists 
      });
      
      if (liveStats.clean_sheets && pick.multiplier > 0) events.push({ 
        type: 'Clean Sheet', 
        points: positionType === 'GK' || positionType === 'DEF' ? 4 : positionType === 'MID' ? 1 : 0, 
        count: 1 
      });
      
      if (liveStats.saves && positionType === 'GK') events.push({ 
        type: 'Saves', 
        points: Math.floor(liveStats.saves / 3) * 1, 
        count: liveStats.saves 
      });
      
      if (liveStats.bonus) events.push({ 
        type: 'Bonus', 
        points: liveStats.bonus, 
        count: 1 
      });
      
      if (liveStats.yellow_cards) events.push({ 
        type: 'Yellow Card', 
        points: -1, 
        count: liveStats.yellow_cards 
      });
      
      if (liveStats.red_cards) events.push({ 
        type: 'Red Card', 
        points: -3, 
        count: liveStats.red_cards 
      });
      
      if (liveStats.penalties_missed) events.push({ 
        type: 'Penalty Missed', 
        points: -2, 
        count: liveStats.penalties_missed 
      });
      
      if (liveStats.own_goals) events.push({
        type: 'Own Goal',
        points: -2,
        count: liveStats.own_goals
      });
      
      if (liveStats.penalties_saved && positionType === 'GK') events.push({
        type: 'Penalty Saved',
        points: 5,
        count: liveStats.penalties_saved
      });
      
      if (liveStats.goals_conceded && pick.multiplier > 0 && 
         (positionType === 'GK' || positionType === 'DEF')) {
        const pointsDeduction = -Math.floor(liveStats.goals_conceded / 2);
        if (pointsDeduction !== 0) {
          events.push({
            type: 'Goals Conceded',
            points: pointsDeduction,
            count: liveStats.goals_conceded
          });
        }
      }

      return {
        name: player ? (player.web_name || `${player.first_name} ${player.second_name}`) : 'Unknown Player',
        playerId: pick.element,
        position: pick.position,
        positionType: positionType,
        multiplier: pick.multiplier,
        livePoints: liveStats.total_points ? liveStats.total_points * pick.multiplier : 0,
        bonus: liveStats.bonus || 0,
        goals: liveStats.goals_scored || 0,
        assists: liveStats.assists || 0,
        teamId: player ? player.team : 0,
        teamShortName: player ? teamMap[player.team] || 'UNK' : 'UNK',
        eo: (ownership * rankFactor).toFixed(1),
        minutes: liveStats.minutes || 0,
        events: events,
        viceCaptainPoints: pick.is_vice_captain && pick.multiplier === 1 ? liveStats.total_points || 0 : 0,
      };
    });

    console.log('Player positions:', picks.map(p => ({ name: p.name, position: p.positionType })));

    // Auto-substitutions and vice-captain logic
    const starters = picks.filter(p => p.position <= 11);
    const bench = picks.filter(p => p.position > 11).sort((a, b) => a.position - b.position);
    const captain = starters.find(p => p.multiplier > 1);
    const viceCaptain = bench.find(p => p.multiplier > 1) || starters.find(p => p.multiplier > 1 && p !== captain);

    let autosubs = picksData.automatic_subs || [];
    // Validate autosubs against picks
    autosubs.forEach(sub => {
      const inPlayer = picks.some(p => p.playerId === sub.in);
      const outPlayer = picks.some(p => p.playerId === sub.out);
      if (!inPlayer || !outPlayer) {
        console.warn(`Invalid autosub for ID ${id}, GW ${gameweek}: in=${sub.in} (${inPlayer ? 'found' : 'missing'}), out=${sub.out} (${outPlayer ? 'found' : 'missing'})`);
      }
    });
    // Filter out invalid autosubs
    autosubs = autosubs.filter(sub => 
      picks.some(p => p.playerId === sub.in) && picks.some(p => p.playerId === sub.out)
    );

    let adjustedPicks = [...picks];

    // Only apply auto-subs if Bench Boost isn't active and there are valid autosubs
    if (activeChip !== 'bboost' && autosubs.length === 0) {
      const nonPlayingStarters = starters.filter(p => p.minutes === 0);

      if (nonPlayingStarters.length > 0) {
        let benchIndex = 0;
        for (const nonPlayer of nonPlayingStarters) {
          while (benchIndex < bench.length && bench[benchIndex].minutes === 0) {
            benchIndex++;
          }
          if (benchIndex < bench.length) {
            const sub = bench[benchIndex];
            autosubs.push({ out: nonPlayer.playerId, in: sub.playerId });
            adjustedPicks = adjustedPicks.map(p =>
              p.playerId === nonPlayer.playerId ? { ...p, livePoints: sub.livePoints } : p
            );
            benchIndex++;
          }
        }
      }
    }

    let viceCaptainPoints = 0;
    if (captain && captain.minutes === 0 && viceCaptain && viceCaptain.minutes > 0) {
      viceCaptainPoints = viceCaptain.livePoints;
      adjustedPicks = adjustedPicks.map(p =>
        p.playerId === captain.playerId ? { ...p, livePoints: 0, multiplier: 1 } :
        p.playerId === viceCaptain.playerId ? { ...p, multiplier: activeChip === '3cap' ? 3 : 2 } : p
      );
    }

    // Calculate transfer penalty - updated to use transfersData
    let transferPenalty = 0;
    if (activeChip !== 'wildcard' && activeChip !== 'freehit') {
      const transfersForGW = Array.isArray(transfersData) ? 
        transfersData.filter(t => t.event === parseInt(gameweek)).length : 0;
      const freeTransfers = Math.min(2, transfersData.length > 0 ? 
        transfersData[transfersData.length - 1].event_transfers || 1 : 1);
      const extraTransfers = Math.max(0, transfersForGW - freeTransfers);
      transferPenalty = extraTransfers * -4;
    }

    let totalLivePoints = adjustedPicks.reduce((sum, pick) => 
      activeChip === 'bboost' ? sum + pick.livePoints : sum + (pick.multiplier > 0 ? pick.livePoints : 0), 0
    ) + transferPenalty;

    let assistantManagerPoints = 0;
    if (activeChip === 'assistant_manager') {
      try {
        const managerId = picksData.assistant_manager?.id;
        if (managerId) {
          const teamId = bootstrapData.teams.find(t => t.manager_id === managerId)?.id;
          assistantManagerPoints = calculateAssistantPoints(picksData.assistant_manager, liveData, gameweek);
          totalLivePoints += assistantManagerPoints;
        }
      } catch (err) {
        console.error(`Error calculating Assistant Manager points: ${err.message}`);
        assistantManagerPoints = 0;
      }
    }

    const top10kStats = await getTop10kStats(gameweek);
    const updatedPicks = identifyDifferentials(adjustedPicks, top10kStats, managerRank);
    const liveRank = await estimateLiveRank(totalLivePoints, seasonPoints, managerRank, updatedPicks, assistantManagerPoints);

    const result = {
      picks: updatedPicks,
      transferPenalty,
      totalLivePoints,
      autosubs,
      viceCaptainPoints: viceCaptainPoints > 0 ? viceCaptainPoints : null,
      liveRank,
      assistantManagerPoints: activeChip === 'assistant_manager' ? assistantManagerPoints : null,
      activeChip,
      assistantManager: activeChip === 'assistant_manager' ? picksData.assistant_manager : null
    };

    console.log('getPicksData result:', result);

    memoryCache[cacheKey] = { data: result, timestamp: Date.now() };
    await PicksData.findOneAndUpdate(
      { _id: cacheKey },
      { data: result, timestamp: new Date() },
      { upsert: true }
    );

    return result;
  } catch (error) {
    console.error('Error in getPicksData:', { id, gameweek, error: error.message, status: error.response?.status });
    return {
      picks: [],
      transferPenalty: 0,
      totalLivePoints: 0,
      autosubs: [],
      viceCaptainPoints: null,
      liveRank: null,
      assistantManagerPoints: null,
      activeChip: null,
      assistantManager: null
    };
  }
};


// Updated updatePicksFromLiveData function to match getPicksData logic
const updatePicksFromLiveData = (id, gameweek, liveData) => {
  const cacheKey = `picks:${id}:${gameweek}`;
  if (memoryCache[cacheKey]) {
    const cached = memoryCache[cacheKey].data;
    const updatedPicks = cached.picks.map(pick => {
      const liveStats = liveData.find(el => el.id === pick.playerId)?.stats || {};
      
      // Recalculate events with count
      const events = [];
      if (liveStats.goals_scored) events.push({ 
        type: 'Goal', 
        points: liveStats.goals_scored * (pick.multiplier || 1) * (pick.positionType === 'GK' || pick.positionType === 'DEF' ? 6 : pick.positionType === 'MID' ? 5 : 4), 
        count: liveStats.goals_scored 
      });
      
      if (liveStats.assists) events.push({ 
        type: 'Assist', 
        points: liveStats.assists * 3, 
        count: liveStats.assists 
      });
      
      if (liveStats.clean_sheets && pick.multiplier > 0) events.push({ 
        type: 'Clean Sheet', 
        points: pick.positionType === 'GK' || pick.positionType === 'DEF' ? 4 : pick.positionType === 'MID' ? 1 : 0, 
        count: 1 
      });
      
      if (liveStats.saves && pick.positionType === 'GK') events.push({ 
        type: 'Saves', 
        points: Math.floor(liveStats.saves / 3) * 1, 
        count: liveStats.saves 
      });
      
      if (liveStats.bonus) events.push({ 
        type: 'Bonus', 
        points: liveStats.bonus, 
        count: 1 
      });
      
      if (liveStats.yellow_cards) events.push({ 
        type: 'Yellow Card', 
        points: -1, 
        count: liveStats.yellow_cards 
      });
      
      if (liveStats.red_cards) events.push({ 
        type: 'Red Card', 
        points: -3, 
        count: liveStats.red_cards 
      });
      
      if (liveStats.penalties_missed) events.push({ 
        type: 'Penalty Missed', 
        points: -2, 
        count: liveStats.penalties_missed 
      });
      
      if (liveStats.own_goals) events.push({
        type: 'Own Goal',
        points: -2,
        count: liveStats.own_goals
      });
      
      if (liveStats.penalties_saved && pick.positionType === 'GK') events.push({
        type: 'Penalty Saved',
        points: 5,
        count: liveStats.penalties_saved
      });
      
      if (liveStats.goals_conceded && pick.multiplier > 0 && 
         (pick.positionType === 'GK' || pick.positionType === 'DEF')) {
        const pointsDeduction = -Math.floor(liveStats.goals_conceded / 2);
        if (pointsDeduction !== 0) {
          events.push({
            type: 'Goals Conceded',
            points: pointsDeduction,
            count: liveStats.goals_conceded
          });
        }
      }
      
      return {
        ...pick,
        livePoints: liveStats.total_points * pick.multiplier || 0,
        bonus: liveStats.bonus || 0,
        goals: liveStats.goals_scored || 0,
        assists: liveStats.assists || 0,
        minutes: liveStats.minutes || 0,
        events // Update events with counts
      };
    });
    
    // Update assistant manager points if team stats are available and chip is active
    let assistantManagerPoints = cached.assistantManagerPoints || 0;
    if (cached.assistantManager && liveData.team_stats) {
      const teamId = cached.assistantManager.teamId;
      const teamStats = liveData.team_stats[teamId];
      
      // Simple example calculation - actual implementation would depend on your scoring system
      if (teamStats) {
        const goalBonus = (teamStats.goals_scored || 0) * 3;
        const cleanSheetBonus = (teamStats.clean_sheets || 0) * 4;
        assistantManagerPoints = goalBonus + cleanSheetBonus;
      }
    }
    
    const totalLivePoints = updatedPicks.reduce((sum, p) => sum + p.livePoints, 0) + 
                           cached.transferPenalty + 
                           (cached.assistantManager ? assistantManagerPoints : 0);
                           
    const updatedResult = { 
      ...cached, 
      picks: updatedPicks, 
      totalLivePoints,
      assistantManagerPoints: assistantManagerPoints > 0 ? assistantManagerPoints : null
    };

    memoryCache[cacheKey].data = updatedResult;
    PicksData.findOneAndUpdate(
      { _id: cacheKey },
      { data: updatedResult, timestamp: new Date() },
      { upsert: true }
    ).catch(err => console.error(`Failed to update Mongoose cache for ${cacheKey}:`, err.message));
    console.log(`Updated picks for ${cacheKey} from live data`);
  }
};


const getPlannerData = async (id) => {
  const cacheKey = `planner:${id}`;
  if (memoryCache[cacheKey] && (Date.now() - memoryCache[cacheKey].timestamp) < CACHE_DURATION_LONG) {
    console.log(`Memory cache hit for ${cacheKey}`);
    return memoryCache[cacheKey].data;
  }

  const cachedDoc = await PlannerData.findById(cacheKey).lean();
  if (cachedDoc && (Date.now() - new Date(cachedDoc.timestamp).getTime()) < CACHE_DURATION_LONG) {
    console.log(`Mongoose cache hit for ${cacheKey}`);
    memoryCache[cacheKey] = { data: cachedDoc.data, timestamp: Date.now() };
    return cachedDoc.data;
  }

  try {
    console.log(`Fetching planner data for ID ${id}`);
    const managerResponse = await fetchWithRetry(`https://fantasy.premierleague.com/api/entry/${id}/`);
    const currentGameweek = managerResponse.data.current_event || 1;
    const [picksResponse, historyResponse, fixturesResponse, bootstrapResponse] = await Promise.all([
      fetchWithRetry(`https://fantasy.premierleague.com/api/entry/${id}/event/${currentGameweek}/picks/`),
      fetchWithRetry(`https://fantasy.premierleague.com/api/entry/${id}/history/`),
      fetchWithRetry(`https://fantasy.premierleague.com/api/fixtures/`),
      fetchWithRetry('https://fantasy.premierleague.com/api/bootstrap-static/')
    ]);
    const bootstrapData = bootstrapResponse.data;

    // Process player data as before...
    const playerUrls = picksResponse.data?.picks.map(pick => `https://fantasy.premierleague.com/api/element-summary/${pick.element}/`) || [];
    const playerSummaries = await batchFetch(playerUrls);
    const currentPicks = Array.isArray(picksResponse.data?.picks)
      ? picksResponse.data.picks.map((pick, index) => {
          const player = bootstrapData.elements.find(el => el.id === pick.element) || {};
          let detailedStats = { total_points: 0, form: 0, goals_scored: 0, assists: 0 };
          if (playerSummaries[index].status === 'fulfilled' && playerSummaries[index].value?.data) {
            const history = playerSummaries[index].value.data.history;
            const recentHistory = history.slice(-5);
            detailedStats = {
              total_points: history.reduce((sum, h) => sum + h.total_points, 0),
              form: recentHistory.length > 0 ? (recentHistory.reduce((sum, h) => sum + h.total_points, 0) / recentHistory.length).toFixed(1) : 0,
              goals_scored: history.reduce((sum, h) => sum + h.goals_scored, 0),
              assists: history.reduce((sum, h) => sum + h.assists, 0),
            };
          } else {
            console.warn(`Failed to fetch summary for player ${pick.element}`);
          }
          return {
            id: pick.element,
            name: player.first_name ? `${player.first_name} ${player.second_name}` : 'Unknown',
            teamId: player.team || 0,
            positionType: player.element_type ? { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }[player.element_type] : 'UNK',
            cost: player.now_cost ? player.now_cost / 10 : 0,
            position: pick.position,
            multiplier: pick.multiplier,
            ...detailedStats
          };
        })
      : [];

    const allPlayers = bootstrapData.elements.map(player => ({
      id: player.id,
      name: `${player.first_name} ${player.second_name}`,
      teamId: player.team,
      positionType: { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }[player.element_type],
      cost: player.now_cost / 10,
      total_points: player.total_points || 0,
    }));

    // Process fixtures for planning...
    const teams = bootstrapData.teams.reduce((acc, team) => {
      acc[team.id] = team.short_name;
      return acc;
    }, {});

    const fixtures = bootstrapData.events.map(event => ({
      gameweek: event.id,
      deadline: event.deadline_time,
      isCurrent: event.is_current,
      matches: fixturesResponse.data
        .filter(f => f.event === event.id)
        .map(f => ({
          teamH: f.team_h,
          teamA: f.team_a,
          teamHName: teams[f.team_h],
          teamAName: teams[f.team_a],
          difficultyH: f.team_h_difficulty,
          difficultyA: f.team_a_difficulty
        }))
    }));

    // Chip management logic
    const chipsUsed = historyResponse.data.chips?.map(chip => chip.name) || [];
    const wildcardCount = chipsUsed.filter(c => c === 'wildcard').length;
    const chipsAvailable = {
      wildcard1: currentGameweek <= 20 && wildcardCount === 0,
      wildcard2: currentGameweek > 20 && wildcardCount <= 1,
      freehit: !chipsUsed.includes('freehit'),
      bboost: !chipsUsed.includes('bboost'),
      triplecaptain: !chipsUsed.includes('triplecaptain'),
      assistant_manager: !chipsUsed.includes('assistant_manager') && currentGameweek >= 24
    };

    // Budget calculation with assistant manager adjustment
    let budget = typeof managerResponse.data.last_season_bank === 'number' 
      ? managerResponse.data.last_season_bank / 10 
      : 0;
      
    // Adjust budget if assistant manager chip is active
    if (picksResponse.data.active_chip === 'assistant_manager' && picksResponse.data.assistant_manager) {
      // Get manager cost from bootstrap data if available
      const managerCost = bootstrapData.managers?.find(m => m.id === picksResponse.data.assistant_manager.id)?.cost / 10 || 1.0;
      budget -= managerCost; // Deduct cost (e.g., £1.5m for Arteta)
    }

    // List of available assistant managers from managers.json
    const availableManagers = bootstrapData.managers || managersData;

    const result = { 
      currentPicks, 
      allPlayers, 
      fixtures, 
      budget, 
      chipsUsed, 
      chipsAvailable,
      currentGameweek,
      activeChip: picksResponse.data.active_chip || null,
      assistantManager: picksResponse.data.active_chip === 'assistant_manager' ? 
        picksResponse.data.assistant_manager : null,
      availableManagers
    };
    
    memoryCache[cacheKey] = { data: result, timestamp: Date.now() };
    await PlannerData.findOneAndUpdate(
      { _id: cacheKey },
      { data: result, timestamp: new Date() },
      { upsert: true }
    );
    console.log(`Planner data fetched for ID ${id}:`, { picksCount: currentPicks.length });
    return result;
  } catch (err) {
    console.error(`Error in getPlannerData for ID ${id}:`, err.message);
    throw err;
  }
};

const getTop10kStats = async (gameweek, forceRefresh = false) => {
  const cacheKey = `gw${gameweek}`;
  const CACHE_DURATION_LONG = 24 * 60 * 60 * 1000; // 24 hours for GW stats

  // Check memory cache first
  if (memoryCache[cacheKey] && (Date.now() - memoryCache[cacheKey].timestamp) < CACHE_DURATION_LONG && !forceRefresh) {
    console.log(`Memory cache hit for ${cacheKey}`);
    return memoryCache[cacheKey].data;
  }

  // Check MongoDB cache
  const cachedDoc = await TopStats.findById(cacheKey).lean();
  if (cachedDoc && (Date.now() - new Date(cachedDoc.timestamp).getTime()) < CACHE_DURATION_LONG && !forceRefresh) {
    console.log(`Mongoose cache hit for ${cacheKey}`);
    memoryCache[cacheKey] = { data: cachedDoc.stats || cachedDoc.data, timestamp: Date.now() };
    return cachedDoc.stats || cachedDoc.data;
  }

  // Serve stale data if available while updating in background
  if (cachedDoc && !forceRefresh) {
    console.log(`Serving stale cache for ${cacheKey}, updating in background`);
    fetchStats().catch(err => console.error('Background fetch failed:', err));
    memoryCache[cacheKey] = { data: cachedDoc.stats || cachedDoc.data, timestamp: Date.now() };
    return cachedDoc.stats || cachedDoc.data;
  }

  // No cache or forced refresh, fetch synchronously
  return await fetchStats();

  // Unified fetch stats implementation
  async function fetchStats() {
    try {
      // Configurable tiers with both min and target samples
      const tiers = {
        top1k: { maxRank: 1000, minSamples: 20, targetSamples: 50 },
        top10k: { maxRank: 10000, minSamples: 50, targetSamples: 100 },
        top100k: { maxRank: 100000, minSamples: 100, targetSamples: 150 },
        top1m: { maxRank: 1000000, minSamples: 150, targetSamples: 200 }
      };
      const totalManagers = 10000000;
      const sampledIds = new Set();

      // Approach 1: Seed from leagues
      const leagueIds = [313, 314, 315];
      const leagueUrls = leagueIds.map(id => `https://fantasy.premierleague.com/api/leagues-classic/${id}/standings/`);
      const leagueResponses = await batchFetch(leagueUrls);
      leagueResponses.forEach((result, idx) => {
        if (result.status === 'fulfilled' && result.value?.data?.standings?.results) {
          const topIds = result.value.data.standings.results.slice(0, 50).map(r => r.entry);
          console.log(`Seeded ${topIds.length} IDs from league ${leagueIds[idx]}:`, topIds.slice(0, 5));
          topIds.forEach(id => sampledIds.add(id));
        } else {
          console.warn(`Failed to seed from league ${leagueIds[idx]}:`, result.reason?.message);
        }
      });

      // Approach 2: Strategic random sampling for each tier
      if (sampledIds.size < 100) {
        // Add stratified random samples if league seeding didn't provide enough
        for (const [tierName, { maxRank, targetSamples }] of Object.entries(tiers)) {
          const lowerBound = tierName === 'top1k' ? 1 : (tiers[Object.keys(tiers)[Object.keys(tiers).indexOf(tierName) - 1]].maxRank + 1);
          const samplesNeeded = Math.ceil(targetSamples / 3); // Only add a portion from random sampling
          
          for (let i = 0; i < samplesNeeded; i++) {
            const id = Math.floor(Math.random() * (maxRank - lowerBound + 1)) + lowerBound;
            sampledIds.add(id);
          }
        }
      }

      // Approach 3: Additional random sampling with validation
      const maxAttempts = tiers.top1m.targetSamples * 2;
      let attempts = 0;
      while (sampledIds.size < tiers.top100k.targetSamples && attempts < maxAttempts) {
        const id = Math.floor(Math.random() * 100000) + 1; // Seed from top 100k as a reasonable pool
        if (sampledIds.has(id)) continue;
        try {
          const response = await fetchWithRetry(`https://fantasy.premierleague.com/api/entry/${id}/`);
          const rank = response.data.summary_overall_rank;
          if (rank && rank <= tiers.top1m.maxRank) {
            sampledIds.add(id);
            console.log(`Added ID ${id} with rank ${rank}`);
          }
        } catch (err) {
          console.warn(`Skipping ID ${id}: ${err.message}`);
        }
        attempts++;
      }

      // Fetch data in batches
      const sampledIdsArray = Array.from(sampledIds);
      const batchUrls = sampledIdsArray.map(id => [
        `https://fantasy.premierleague.com/api/entry/${id}/`,
        `https://fantasy.premierleague.com/api/entry/${id}/event/${gameweek}/picks/`
      ]).flat();
      const responses = await batchFetch(batchUrls);

      // Process responses
      const sampledManagers = [];
      for (let i = 0; i < responses.length; i += 2) {
        const entryResult = responses[i];
        const picksResult = responses[i + 1];
        if (entryResult.status === 'fulfilled' && entryResult.value?.data) {
          const rank = entryResult.value.data.summary_overall_rank || totalManagers;
          const picks = picksResult.status === 'fulfilled' ? picksResult.value.data.picks || [] : [];
          const id = sampledIdsArray[i / 2];
          const active_chip = picksResult.status === 'fulfilled' ? picksResult.value.data.active_chip : null;
          const assistant_manager = picksResult.status === 'fulfilled' ? picksResult.value.data.assistant_manager : null;
          sampledManagers.push({ id, rank, picks, active_chip, assistant_manager });
          console.log(`Sampled ID ${id}: rank ${rank}, picks ${picks.length}, chip: ${active_chip}`);
        }
      }

      // Organize by tier
      const managersByTier = { top1k: [], top10k: [], top100k: [], top1m: [] };
      sampledManagers.forEach(manager => {
        if (manager.rank <= tiers.top1k.maxRank) managersByTier.top1k.push(manager);
        if (manager.rank <= tiers.top10k.maxRank) managersByTier.top10k.push(manager);
        if (manager.rank <= tiers.top100k.maxRank) managersByTier.top100k.push(manager);
        if (manager.rank <= tiers.top1m.maxRank) managersByTier.top1m.push(manager);
      });

      // Check if we have enough samples and add fallbacks if needed
      for (const [tierName, { maxRank, minSamples }] of Object.entries(tiers)) {
        if (managersByTier[tierName]?.length < minSamples) {
          console.warn(`${tierName} has ${managersByTier[tierName]?.length} samples, below minimum ${minSamples}`);
          const shortfall = minSamples - (managersByTier[tierName]?.length || 0);
          const cachedPicks = await PicksData.find({ 'data.liveRank': { $lte: maxRank } })
            .sort('data.liveRank')
            .limit(shortfall)
            .lean();
          const fallbackManagers = cachedPicks.map(doc => ({
            id: doc._id.split(':')[1],
            rank: doc.data.liveRank || maxRank,
            picks: doc.data.picks || [],
            active_chip: doc.data.activeChip || null,
            assistant_manager: doc.data.assistantManager || null
          }));
          managersByTier[tierName] = [...(managersByTier[tierName] || []), ...fallbackManagers];
          console.log(`Added ${fallbackManagers.length} fallback managers to ${tierName}`);
        }
      }

      // Fetch live data and bootstrap
      const liveData = await fetchWithRetry(`https://fantasy.premierleague.com/api/event/${gameweek}/live/`);
      const bootstrapData = await getBootstrapData();

      // Calculate stats
      const tierStats = {};
      for (const [tierName, managers] of Object.entries(managersByTier)) {
        if (!managers || managers.length === 0) {
          tierStats[tierName] = { 
            averagePoints: 0, 
            wildcardUsage: '0%',
            freehitUsage: '0%',
            benchBoostUsage: '0%',
            tripleCaptainUsage: '0%',
            assistantManagerUsage: '0%',
            topPlayers: [], 
            formations: {},
            eoBreakdown: {},
            managerEO: {}
          };
          console.warn(`No managers for ${tierName} after fallback`);
          continue;
        }

        // Calculate chip usage percentages
        const wildcardActive = managers.filter(m => m.active_chip === 'wildcard').length / managers.length * 100;
        const freehitActive = managers.filter(m => m.active_chip === 'freehit').length / managers.length * 100;
        const benchBoostActive = managers.filter(m => m.active_chip === 'bboost').length / managers.length * 100;
        const tripleCaptainActive = managers.filter(m => m.active_chip === '3cap').length / managers.length * 100;
        const assistantManagerActive = managers.filter(m => m.active_chip === 'assistant_manager').length / managers.length * 100;

        // Calculate live points with chip adjustments
        const livePoints = managers.map(manager => {
          // Basic points calculation for all players
          let points = manager.picks.reduce((sum, pick) => {
            const liveStats = liveData.data.elements.find(el => el.id === pick.element)?.stats || {};
            return sum + (liveStats.total_points || 0) * (pick.multiplier || 0);
          }, 0);

          // Handle special chips
          if (manager.active_chip === 'bboost') {
            // For bench boost, include points from benched players
            points = manager.picks.reduce((sum, pick) => {
              const liveStats = liveData.data.elements.find(el => el.id === pick.element)?.stats || {};
              return sum + (liveStats.total_points || 0) * (pick.multiplier > 0 ? pick.multiplier : 1);
            }, 0);
          } else if (manager.active_chip === 'assistant_manager' && manager.assistant_manager) {
            // Add points for assistant manager chip
            const calculateAssistantPoints = (assistantManager, liveData, gameweek) => {
              try {
                const managerId = assistantManager.id;
                
                // Get team stats if available
                const teamStats = liveData.data.team_stats?.[managerId];
                if (!teamStats) return 5; // Default fallback
                
                // Example calculation based on team performance
                const goalBonus = (teamStats.goals_scored || 0) * 3;
                const cleanSheetBonus = (teamStats.clean_sheets || 0) * 4;
                const winBonus = teamStats.result === 'W' ? 5 : 0;
                
                return goalBonus + cleanSheetBonus + winBonus || 5; // Default to 5 points if calculation is 0
              } catch (err) {
                console.error(`Error calculating assistant points: ${err.message}`);
                return 5; // Default fallback
              }
            };
            
            points += calculateAssistantPoints(manager.assistant_manager, liveData, gameweek);
          }
          
          return points;
        });
        
        const averagePoints = livePoints.reduce((sum, points) => sum + points, 0) / Math.max(managers.length, 1);

        // Calculate player ownership and effective ownership (EO)
        const playerOwnership = bootstrapData.elements.map(player => {
          const owned = managers.filter(m => m.picks.some(p => p.element === player.id && p.multiplier > 0)).length;
          const captained = managers.filter(m => m.picks.some(p => p.element === player.id && p.multiplier === 2)).length;
          const tripleCaptained = managers.filter(m => m.picks.some(p => p.element === player.id && p.multiplier === 3)).length;
          
          // EO calculation now includes triple captain multiplier (counts as 3x)
          const eo = (owned / managers.length * 100) + 
                     (captained / managers.length * 100) + 
                     (tripleCaptained / managers.length * 200); // Triple captain adds 2x more
                     
          return { 
            id: player.id, 
            name: `${player.first_name} ${player.second_name}`, 
            ownership: (owned / managers.length) * 100, 
            eo: eo > 0 ? eo.toFixed(1) : 0 
          };
        }).sort((a, b) => b.eo - a.eo).slice(0, 10);

        // Calculate formations
        const formations = managers.reduce((acc, manager) => {
          const starters = manager.picks.filter(p => p.position <= 11);
          const formation = [
            starters.filter(p => bootstrapData.elements.find(el => el.id === p.element)?.element_type === 1).length,
            starters.filter(p => bootstrapData.elements.find(el => el.id === p.element)?.element_type === 2).length,
            starters.filter(p => bootstrapData.elements.find(el => el.id === p.element)?.element_type === 3).length,
            starters.filter(p => bootstrapData.elements.find(el => el.id === p.element)?.element_type === 4).length
          ].join('-');
          acc[formation] = (acc[formation] || 0) + 1;
          return acc;
        }, {});

        // Calculate detailed EO breakdown for all players
        const eoBreakdown = {};
        bootstrapData.elements.forEach(player => {
          const owned = managers.filter(m => m.picks.some(p => p.element === player.id && p.multiplier > 0)).length;
          const captained = managers.filter(m => m.picks.some(p => p.element === player.id && p.multiplier === 2)).length;
          const tripleCaptained = managers.filter(m => m.picks.some(p => p.element === player.id && p.multiplier === 3)).length;
          
          // Updated EO calculation with triple captain
          const eo = (owned / managers.length * 100) + 
                     (captained / managers.length * 100) + 
                     (tripleCaptained / managers.length * 200);
                     
          if (eo > 0) {
            eoBreakdown[player.id] = { 
              name: `${player.first_name} ${player.second_name}`, 
              owned: owned,
              captained: captained,
              tripleCaptained: tripleCaptained,
              eo: eo.toFixed(1) 
            };
          }
        });

        // Calculate EO for assistant managers if data available
        const managerEO = {};
        if (bootstrapData.managers) {
          bootstrapData.managers.forEach(manager => {
            const used = managers.filter(m => 
              m.active_chip === 'assistant_manager' && 
              m.assistant_manager?.id === manager.id
            ).length;
            
            if (used > 0) {
              managerEO[manager.id] = {
                name: manager.name,
                eo: (used / managers.length * 100).toFixed(1)
              };
            }
          });
        }

        tierStats[tierName] = { 
          averagePoints, 
          wildcardUsage: wildcardActive.toFixed(1) + '%',
          freehitUsage: freehitActive.toFixed(1) + '%',
          benchBoostUsage: benchBoostActive.toFixed(1) + '%',
          tripleCaptainUsage: tripleCaptainActive.toFixed(1) + '%',
          assistantManagerUsage: assistantManagerActive.toFixed(1) + '%',
          topPlayers: playerOwnership, 
          formations, 
          eoBreakdown,
          managerEO
        };
        console.log(`${tierName} stats:`, { 
          managers: managers.length, 
          avgPoints: averagePoints,
          wildcardUsage: wildcardActive.toFixed(1) + '%',
          assistantManagerUsage: assistantManagerActive.toFixed(1) + '%'
        });
      }

      // Save to cache and database
      memoryCache[cacheKey] = { data: tierStats, timestamp: Date.now() };
      await TopStats.findOneAndUpdate(
        { _id: cacheKey },
        { stats: tierStats, timestamp: new Date() },
        { upsert: true }
      );

      console.log(`Computed stats for GW ${gameweek}:`, Object.keys(tierStats));
      return tierStats;
    } catch (error) {
      console.error('Error in getTop10kStats:', { gameweek, error: error.message, status: error.response?.status });
      throw error;
    }
  }
};

// Helper function that would be defined elsewhere
const calculateAssistantPoints = (assistantManager, liveData, gameweek) => {
  try {
    // This is a placeholder for the actual calculation logic
    const managerId = assistantManager.id;
    
    // Get team stats if available (would be implemented elsewhere)
    const teamStats = liveData.team_stats?.[managerId];
    if (!teamStats) return 5; // Default fallback
    
    // Example calculation based on team performance
    const goalBonus = (teamStats.goals_scored || 0) * 3;
    const cleanSheetBonus = (teamStats.clean_sheets || 0) * 4;
    const winBonus = teamStats.result === 'W' ? 5 : 0;
    
    return goalBonus + cleanSheetBonus + winBonus || 5; // Default to 5 points if calculation is 0
  } catch (err) {
    console.error(`Error calculating assistant points: ${err.message}`);
    return 5; // Default fallback
  }
};


const clearCache = async () => {
  await TopStats.deleteMany({});
  await PicksData.deleteMany({});
  await PlannerData.deleteMany({});
  Object.keys(memoryCache).forEach(key => delete memoryCache[key]);
  console.log('All caches cleared');
};

const predictPriceChanges = async () => {
  try {
    const bootstrapData = await getBootstrapData();
    const players = bootstrapData.elements;

    const sampleManagerId = 1;
    const historyResponse = await fetchWithRetry(`https://fantasy.premierleague.com/api/entry/${sampleManagerId}/history/`);
    const pastGameweeks = historyResponse.data.past;

    const transferUrls = players.map(player => `https://fantasy.premierleague.com/api/element-summary/${player.id}/`);
    const transferResponses = await batchFetch(transferUrls);

    const predictions = players.map((player, index) => {
      const currentOwnership = parseFloat(player.selected_by_percent);
      const transfersData = transferResponses[index].status === 'fulfilled' && transferResponses[index].value?.data?.history
        ? transferResponses[index].value.data.history.find(h => h.event === bootstrapData.current_event) || { transfers_in_event: 0, transfers_out_event: 0 }
        : { transfers_in_event: 0, transfers_out_event: 0 };
      const netTransfers = transfersData.transfers_in_event - transfersData.transfers_out_event;

      const ownershipHistory = pastGameweeks.map(gw => {
        const transfersIn = gw.transfers_in || 0;
        const transfersOut = gw.transfers_out || 0;
        return (transfersIn - transfersOut) / 1000000;
      });
      const avgOwnershipChange = ownershipHistory.length > 0 ? ownershipHistory.reduce((sum, val) => sum + val, 0) / ownershipHistory.length : 0;

      const ownershipChangeRate = currentOwnership * 0.01;
      const transferImpact = netTransfers / 10000;
      const predictionScore = (ownershipChangeRate + transferImpact + avgOwnershipChange) * 100;

      let predictedChange = 0;
      if (predictionScore > 50) predictedChange = 0.1;
      else if (predictionScore < -50) predictedChange = -0.1;

      return {
        id: player.id,
        name: `${player.first_name} ${player.second_name}`,
        currentPrice: player.now_cost / 10,
        ownership: currentOwnership,
        netTransfers: netTransfers,
        predictedChange: predictedChange,
        predictionScore: predictionScore.toFixed(1)
      };
    });

    return predictions;
  } catch (error) {
    console.error('Error in predictPriceChanges:', error.message);
    throw error;
  }
};

const getCaptaincySuggestions = async (managerId, gameweek) => {
  try {
    console.log(`Fetching captaincy suggestions for ID ${managerId}, GW ${gameweek}`);
    
    const [picksData, top10kStats, bootstrapData] = await Promise.all([
      getPicksData(managerId, gameweek).catch(err => {
        console.warn(`getPicksData failed: ${err.message}`);
        return { picks: [] }; // Fallback to empty picks
      }),
      getTop10kStats(gameweek),
      getBootstrapData()
    ]);

    if (!picksData.picks || picksData.picks.length === 0) {
      console.warn(`No valid picks data for ID ${managerId}, GW ${gameweek}`);
      return [];
    }

    const managerData = await getManagerData(managerId);
    const managerRank = managerData.rank || 5000000;
    const rankTier = managerRank < 10000 ? 'top10k' : managerRank < 100000 ? 'top100k' : 'top1m';

    const fixturesResponse = await fetchWithRetry(`https://fantasy.premierleague.com/api/fixtures/`).catch(() => ({ data: [] }));
    const fixtures = fixturesResponse.data.filter(f => f.event === parseInt(gameweek));

    const playerIds = picksData.picks.map(pick => pick.playerId);
    const summaryUrls = playerIds.map(id => `https://fantasy.premierleague.com/api/element-summary/${id}/`);
    const summaryResponses = await batchFetch(summaryUrls);

    const playerSummaries = {};
    summaryResponses.forEach((response, index) => {
      if (response.status === 'fulfilled' && response.value?.data) {
        playerSummaries[playerIds[index]] = response.value.data;
      }
    });

    const captaincyCandidates = picksData.picks.map(pick => {
      const player = bootstrapData.elements.find(el => el.id === pick.playerId) || {};

      let form = 0;
      if (playerSummaries[pick.playerId]) {
        const history = playerSummaries[pick.playerId].history.slice(-5);
        form = history.length > 0 ? history.reduce((sum, h) => sum + h.total_points, 0) / history.length : 0;
      } else {
        form = Number(player.form) || 0;
      }

      const fixture = fixtures.find(f => f.team_h === player.team || f.team_a === player.team);
      const difficulty = fixture ? 
        (fixture.team_h === player.team ? fixture.team_h_difficulty : fixture.team_a_difficulty) : 3;

      const tierEO = top10kStats[rankTier]?.eoBreakdown[pick.playerId]?.eo || 0;
      const top10kEO = top10kStats.top10k?.eoBreakdown[pick.playerId]?.eo || 0;
      const eo = Math.max(Number(tierEO), Number(pick.eo), Number(top10kEO));

      const scoreClassic = (form * 0.5) + ((5 - difficulty) * 0.3) + (eo * 0.2);
      const scoreDifferential = (form * (1 - eo / 100) / difficulty);
      const combinedScore = (scoreClassic * 0.7) + (scoreDifferential * 10 * 0.3);

      return {
        id: pick.playerId,
        name: pick.name,
        teamId: player.team || 0,
        form: form.toFixed(1),
        difficulty,
        eo: parseFloat(eo) || 0,
        score: combinedScore.toFixed(1)
      };
    });

    const sortedCandidates = captaincyCandidates.sort((a, b) => b.score - a.score).slice(0, 5);
    console.log(`Captaincy suggestions for ID ${managerId}:`, sortedCandidates);
    return sortedCandidates;

  } catch (error) {
    console.error('Error in getCaptaincySuggestions:', { managerId, gameweek, error: error.message });
    return []; // Return empty array instead of throwing
  }
};


const fetchLiveDataFromFPL = async (gameweek) => {
  try {
    // Use direct Node.js https request to bypass potential Axios restrictions
    return new Promise((resolve, reject) => {
      const https = require('https');
      
      const options = {
        hostname: 'fantasy.premierleague.com',
        path: `/api/event/${gameweek}/live/`,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://fantasy.premierleague.com/',
          'Origin': 'https://fantasy.premierleague.com',
          // If you have cloudflare bypass techniques
          'X-Requested-With': 'XMLHttpRequest'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        
        console.log('FPL API Response Details:', {
          statusCode: res.statusCode,
          headers: res.headers
        });

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const parsedData = JSON.parse(data);
            resolve(parsedData);
          } catch (parseError) {
            reject(new Error(`Failed to parse response: ${parseError.message}`));
          }
        });
      });

      req.on('error', (error) => {
        console.error('Direct FPL API Request Error:', error);
        reject(error);
      });

      req.setTimeout(10000, () => {
        req.abort();
        reject(new Error('Request timed out'));
      });

      req.end();
    });
  } catch (error) {
    console.error('Comprehensive FPL API Fetch Error:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};



module.exports = {
  getManagerData,
  getBootstrapData,
  getPicksData,
  getPlannerData,
  getTop10kStats,
  clearCache,
  simulateRank,
  predictPriceChanges,
  updatePicksFromLiveData,
  getCaptaincySuggestions,
  estimateLiveRank,
  fetchLiveDataFromFPL,
  memoryCache
};