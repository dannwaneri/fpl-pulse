import { useEffect, useRef, useCallback, useReducer } from 'react';
import { getApiUrl, WS_BASE_URL } from '../utils/apiConfig';

// Action types
const ACTIONS = {
  SET_LOADING: 'SET_LOADING',
  SET_ERROR: 'SET_ERROR',
  SET_FPL_ID: 'SET_FPL_ID',
  RESET_DATA: 'RESET_DATA',
  UPDATE_MANAGER_DATA: 'UPDATE_MANAGER_DATA',
  UPDATE_PICKS_DATA: 'UPDATE_PICKS_DATA',
  UPDATE_PLANNER_DATA: 'UPDATE_PLANNER_DATA',
  UPDATE_LEAGUE_DATA: 'UPDATE_LEAGUE_DATA',
  UPDATE_TOP10K_DATA: 'UPDATE_TOP10K_DATA',
  SET_SELECTED_LEAGUE: 'SET_SELECTED_LEAGUE',
  SET_LAST_UPDATED: 'SET_LAST_UPDATED',
  SET_USING_POLLING: 'SET_USING_POLLING'
};

// Initial state
const initialState = {
  fplId: '',
  data: null,
  picks: [],
  leagueData: null,
  plannerData: null,
  selectedLeague: '',
  error: '',
  lastUpdated: null,
  transferPenalty: 0,
  totalLivePoints: 0,
  autosubs: [],
  viceCaptainPoints: null,
  liveRank: null,
  top10kStats: null,
  isLoading: false,
  usingPolling: false,
  activeChip: null,
  assistantManagerPoints: 0,
  assistantManager: null
};

// Reducer function
function fplDataReducer(state, action) {
  switch (action.type) {
    case ACTIONS.SET_LOADING:
      return { ...state, isLoading: action.payload };
    case ACTIONS.SET_ERROR:
      return { ...state, error: action.payload };
    case ACTIONS.SET_FPL_ID:
      return { ...state, fplId: action.payload };
    case ACTIONS.RESET_DATA:
      return {
        ...state,
        data: null,
        picks: [],
        leagueData: null,
        plannerData: null,
        selectedLeague: '',
        error: '',
        transferPenalty: 0,
        totalLivePoints: 0,
        autosubs: [],
        viceCaptainPoints: null,
        liveRank: null,
        top10kStats: null,
        activeChip: null,
        assistantManagerPoints: 0,
        assistantManager: null
      };
    case ACTIONS.UPDATE_MANAGER_DATA:
      console.log('UPDATE_MANAGER_DATA payload:', {
        hasLeagues: !!action.payload?.leagues,
        leaguesLength: action.payload?.leagues?.length || 0
      });
      return { ...state, data: action.payload };
      case ACTIONS.UPDATE_PICKS_DATA:
        return { 
          ...state, 
          picks: action.payload.picks || state.picks,
          transferPenalty: action.payload.transferPenalty !== undefined ? action.payload.transferPenalty : state.transferPenalty,
          totalLivePoints: action.payload.totalLivePoints !== undefined ? action.payload.totalLivePoints : state.totalLivePoints,
          autosubs: action.payload.autosubs !== undefined ? action.payload.autosubs : state.autosubs,
          viceCaptainPoints: action.payload.viceCaptainPoints !== undefined ? action.payload.viceCaptainPoints : state.viceCaptainPoints,
          liveRank: action.payload.liveRank !== undefined ? action.payload.liveRank : state.liveRank,
          activeChip: action.payload.activeChip !== undefined ? action.payload.activeChip : state.activeChip,
          assistantManagerPoints: action.payload.assistantManagerPoints !== undefined ? action.payload.assistantManagerPoints : state.assistantManagerPoints,
          assistantManager: action.payload.assistantManager !== undefined ? action.payload.assistantManager : state.assistantManager
        };
    case ACTIONS.UPDATE_PLANNER_DATA:
      return { ...state, plannerData: action.payload };
    case ACTIONS.UPDATE_LEAGUE_DATA:
      return { ...state, leagueData: action.payload };
    case ACTIONS.UPDATE_TOP10K_DATA:
      return { ...state, top10kStats: action.payload };
    case ACTIONS.SET_SELECTED_LEAGUE:
      return { ...state, selectedLeague: action.payload };
    case ACTIONS.SET_LAST_UPDATED:
      return { ...state, lastUpdated: action.payload };
    case ACTIONS.SET_USING_POLLING:
      return { ...state, usingPolling: action.payload };
    default:
      return state;
  }
}

const useFplData = () => {
  const [state, dispatch] = useReducer(fplDataReducer, initialState);
  
  const {
    fplId,
    data,
    picks,
    leagueData,
    plannerData,
    selectedLeague,
    error,
    lastUpdated,
    transferPenalty,
    totalLivePoints,
    autosubs,
    viceCaptainPoints,
    liveRank,
    top10kStats,
    isLoading,
    usingPolling,
    activeChip,
    assistantManagerPoints,
    assistantManager
  } = state;

  const ws = useRef(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const updateTimeout = useRef(null);
  const pollingInterval = useRef(null);
  const pollingFrequency = 30000; // Poll every 30 seconds
  const leagueChangeTimeout = useRef(null);

  const fetchLeague = useCallback(async (leagueId, gameweek) => {
    if (!leagueId || !gameweek) {
      dispatch({ type: ACTIONS.SET_ERROR, payload: 'Invalid league ID or gameweek' });
      return;
    }
    
    dispatch({ type: ACTIONS.SET_LOADING, payload: true });
    
    try {
      console.log(`Fetching league for leagueId: ${leagueId}, GW: ${gameweek}`);
      const response = await fetch(getApiUrl(`/api/league/${leagueId}/live/${gameweek}/`));
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || 'Failed to fetch league standings';
        } catch (e) {
          errorMessage = errorText || `Server error: ${response.status}`;
        }
        throw new Error(errorMessage);
      }
      
      const result = await response.json();
      
      if (!result || !result.standings || !Array.isArray(result.standings)) {
        throw new Error('Invalid data format received from server');
      }
      
      dispatch({ type: ACTIONS.UPDATE_LEAGUE_DATA, payload: result });
      dispatch({ type: ACTIONS.SET_ERROR, payload: '' });
      
      console.log(`Successfully fetched league ${leagueId} with ${result.standings.length} standings`);
    } catch (err) {
      console.error(`League fetch error:`, err.message);
      dispatch({ type: ACTIONS.SET_ERROR, payload: err.message || 'Failed to fetch league standings' });
      dispatch({ type: ACTIONS.UPDATE_LEAGUE_DATA, payload: null });
    } finally {
      dispatch({ type: ACTIONS.SET_LOADING, payload: false });
    }
  }, []);

  const updateLiveData = useCallback((liveData) => {
    if (!data || !fplId || !picks.length) return;

    // First, log the original picks to troubleshoot
  console.log('Original picks teamShortName sample:', 
    picks.slice(0, 3).map(p => ({ 
      name: p.name, 
      teamShortName: p.teamShortName,
      playerId: p.playerId 
    }))
  );
  
    const updatedPicks = picks.map(pick => {
      const liveStats = liveData.find(el => el.id === pick.playerId)?.stats || {};
      
      // Preserve all original fields, including teamShortName
      return {
        ...pick,
        livePoints: liveStats.total_points ? liveStats.total_points * pick.multiplier : 0,
        bonus: liveStats.bonus || 0,
        goals: liveStats.goals_scored || 0,
        assists: liveStats.assists || 0,
        minutes: liveStats.minutes || 0,
        // Ensure teamShortName is preserved from original pick object
        teamShortName: pick.teamShortName,
        // Update events if needed
        events: [
          ...(liveStats.goals_scored ? [{ type: 'Goal', points: liveStats.goals_scored * pick.multiplier * (pick.positionType === 'GK' || pick.positionType === 'DEF' ? 6 : pick.positionType === 'MID' ? 5 : 4) }] : []),
          ...(liveStats.assists ? [{ type: 'Assist', points: liveStats.assists * 3 }] : []),
          ...(liveStats.clean_sheets && pick.multiplier > 0 ? [{ type: 'Clean Sheet', points: pick.positionType === 'GK' || pick.positionType === 'DEF' ? 4 : pick.positionType === 'MID' ? 1 : 0 }] : []),
          ...(liveStats.saves && pick.positionType === 'GK' ? [{ type: 'Saves', points: Math.floor(liveStats.saves / 3) * 1 }] : []),
          ...(liveStats.bonus ? [{ type: 'Bonus', points: liveStats.bonus }] : []),
          ...(liveStats.yellow_cards ? [{ type: 'Yellow Card', points: -1 }] : []),
          ...(liveStats.red_cards ? [{ type: 'Red Card', points: -3 }] : []),
          ...(liveStats.penalties_missed ? [{ type: 'Penalty Missed', points: -2 }] : [])
        ]
      };
    });
    
    let calculatedTotalPoints = updatedPicks.reduce((sum, p) => {
      if (activeChip === 'bboost') {
        return sum + p.livePoints;
      }
      return sum + (p.multiplier > 0 ? p.livePoints : 0);
    }, 0) + transferPenalty;
    
    if (activeChip === 'assistant_manager' && assistantManagerPoints) {
      calculatedTotalPoints += assistantManagerPoints;
    }
  
    if (updateTimeout.current) clearTimeout(updateTimeout.current);
    updateTimeout.current = setTimeout(async () => {
      console.log('Applying debounced live update:', { 
        totalPoints: calculatedTotalPoints,
        teamShortNameSample: updatedPicks.slice(0, 2).map(p => p.teamShortName)
      });
      
      dispatch({ 
        type: ACTIONS.UPDATE_PICKS_DATA, 
        payload: {
          picks: updatedPicks,
          totalLivePoints: calculatedTotalPoints
        }
      });
      
      dispatch({ type: ACTIONS.SET_LAST_UPDATED, payload: new Date() });
      
      if (!liveRank || isNaN(liveRank)) {
        const newLiveRank = await fetch(getApiUrl(`/api/fpl/${fplId}/rank-simulator/${data.currentGameweek}?points=0`))
          .then(res => res.json())
          .then(data => data.simulatedRank || 0);
        console.log('Calculated liveRank:', newLiveRank);
        
        dispatch({ 
          type: ACTIONS.UPDATE_PICKS_DATA, 
          payload: { liveRank: newLiveRank }
        });
      }
    }, 1000);
  }, [data, fplId, picks, transferPenalty, liveRank, activeChip, assistantManagerPoints]);

  const refreshLiveData = useCallback(async () => {
    if (!data || !fplId) return;
    dispatch({ type: ACTIONS.SET_LOADING, payload: true });
    dispatch({ type: ACTIONS.SET_ERROR, payload: '' });
    
    try {
      const gameweek = data.currentGameweek;
      console.log(`Refreshing live data for ID ${fplId}, gameweek ${gameweek}`);
      
      const picksResponse = await fetch(getApiUrl(`/api/fpl/${fplId}/picks/${gameweek}`));
      const picksResult = await picksResponse.json();
      
      if (picksResponse.ok) {
        // Log the picks data with teamShortName to verify it's present
        console.log('Picks data received:', picksResult);
        
        // Specific check for teamShortName
        if (picksResult.picks && picksResult.picks.length > 0) {
          console.log('Sample teamShortName values:', 
            picksResult.picks.slice(0, 3).map(p => ({ 
              name: p.name, 
              teamShortName: p.teamShortName 
            }))
          );
          
          // Check for GK position specifically
          const gkPlayers = picksResult.picks.filter(p => p.positionType === 'GK');
          console.log('GK players received:', gkPlayers);
        }
        
        dispatch({ 
          type: ACTIONS.UPDATE_PICKS_DATA, 
          payload: {
            picks: picksResult.picks || [],
            transferPenalty: picksResult.transferPenalty || 0,
            totalLivePoints: picksResult.totalLivePoints || 0,
            autosubs: picksResult.autosubs || [],
            viceCaptainPoints: picksResult.viceCaptainPoints || null,
            liveRank: Number.isFinite(picksResult.liveRank) ? picksResult.liveRank : 0,
            activeChip: picksResult.activeChip || null,
            assistantManagerPoints: picksResult.assistantManagerPoints || 0,
            assistantManager: picksResult.assistantManager || null
          }
        });
        
        // After dispatch, verify what's in the state
        console.log('State updated with picks data, checking for GK players next...');
      } else {
        throw new Error(picksResult.error || 'Failed to fetch picks data');
      }
      
      if (selectedLeague) await fetchLeague(selectedLeague, gameweek);
      dispatch({ type: ACTIONS.SET_LAST_UPDATED, payload: new Date() });
    } catch (err) {
      console.error(`Refresh error:`, err.message);
      dispatch({ type: ACTIONS.SET_ERROR, payload: err.message || 'Refresh failed' });
    } finally {
      dispatch({ type: ACTIONS.SET_LOADING, payload: false });
    }
  }, [data, fplId, selectedLeague, fetchLeague]);
  
  
  
  const fetchLiveData = useCallback(async () => {
    if (!data || !fplId) return;
    try {
      const gameweek = data.currentGameweek;
      console.log(`Polling for live data: fplId=${fplId}, gameweek=${gameweek}`);
      
      const picksResponse = await fetch(getApiUrl(`/api/fpl/${fplId}/picks/${gameweek}`));
      if (!picksResponse.ok) {
        throw new Error('Failed to fetch picks data');
      }
      const picksResult = await picksResponse.json();
      
      updateLiveData(picksResult.picks);
      
      dispatch({
        type: ACTIONS.UPDATE_PICKS_DATA,
        payload: {
          picks: picksResult.picks,
          totalLivePoints: picksResult.totalLivePoints,
          activeChip: picksResult.activeChip,
          assistantManagerPoints: picksResult.assistantManagerPoints,
          assistantManager: picksResult.assistantManager,
          transferPenalty: picksResult.transferPenalty,
          autosubs: picksResult.autosubs,
          viceCaptainPoints: picksResult.viceCaptainPoints,
          liveRank: picksResult.liveRank
        }
      });
      
      if (top10kStats) {
        const top10kResponse = await fetch(getApiUrl(`/api/fpl/top10k/${gameweek}`));
        if (top10kResponse.ok) {
          const top10kResult = await top10kResponse.json();
          dispatch({ type: ACTIONS.UPDATE_TOP10K_DATA, payload: top10kResult });
        }
      }
      
      if (selectedLeague) {
        await fetchLeague(selectedLeague, gameweek);
      }
      
      dispatch({ type: ACTIONS.SET_LAST_UPDATED, payload: new Date() });
    } catch (err) {
      console.error('Polling fetch error:', err.message);
    }
  }, [data, fplId, updateLiveData, top10kStats, selectedLeague, fetchLeague]);

  const fetchData = useCallback(async () => {
    if (!fplId || fplId.trim() === '') {
      dispatch({ type: ACTIONS.SET_ERROR, payload: 'Please enter a valid FPL ID' });
      dispatch({ type: ACTIONS.SET_LOADING, payload: false });
      return;
    }
    
    dispatch({ type: ACTIONS.SET_ERROR, payload: '' });
    dispatch({ type: ACTIONS.SET_LOADING, payload: true });
    dispatch({ type: ACTIONS.RESET_DATA });

    try {
      const managerResponse = await fetch(getApiUrl(`/api/fpl/${fplId}`));
      const managerResult = await managerResponse.json();
      console.log('1. Fetched manager data:', JSON.stringify(managerResult, null, 2));
      
      if (!managerResponse.ok) {
        throw new Error(managerResult.error || 'Failed to fetch manager data');
      }
      
      // Ensure leagues is an array
      if (!Array.isArray(managerResult.leagues)) {
        console.warn('Leagues is not an array:', managerResult.leagues);
        managerResult.leagues = [];
      }
      
      // Fallback for missing currentGameweek
      const gameweek = managerResult.currentGameweek || 1; // Default to GW1
      console.log('2. Gameweek (with fallback):', gameweek);
      
      // Update state with complete data
      const updatedManagerResult = { ...managerResult, currentGameweek: gameweek };
      dispatch({ type: ACTIONS.UPDATE_MANAGER_DATA, payload: updatedManagerResult });
      console.log('3. Leagues after dispatch:', managerResult.leagues.length);

      // Proceed even if sub-fetches fail
      let picksData = null;
      let plannerData = null;
      let top10kData = null;

      try {
        const picksResponse = await fetch(getApiUrl(`/api/fpl/${fplId}/picks/${gameweek}`));
        const picksResult = await picksResponse.json();
        if (picksResponse.ok) {
          picksData = {
            picks: picksResult.picks || [],
            transferPenalty: picksResult.transferPenalty || 0,
            totalLivePoints: picksResult.totalLivePoints || 0,
            autosubs: picksResult.autosubs || [],
            viceCaptainPoints: picksResult.viceCaptainPoints || null,
            liveRank: Number.isFinite(picksResult.liveRank) ? picksResult.liveRank : 0,
            activeChip: picksResult.activeChip || null,
            assistantManagerPoints: picksResult.assistantManagerPoints || 0,
            assistantManager: picksResult.assistantManager || null
          };
          console.log('4. Initial picks data:', picksResult);
        } else {
          console.error('Picks fetch failed:', picksResult.error);
        }
      } catch (err) {
        console.error('Picks fetch error:', err.message);
      }

      try {
        const plannerResponse = await fetch(getApiUrl(`/api/fpl/${fplId}/planner`));
        const plannerResult = await plannerResponse.json();
        if (plannerResponse.ok) {
          plannerData = plannerResult;
        } else {
          console.error('Planner fetch failed:', plannerResult.error);
        }
      } catch (err) {
        console.error('Planner fetch error:', err.message);
      }

      try {
      const top10kResponse = await fetch(getApiUrl(`/api/fpl/top10k/${gameweek}`));    
      const top10kResult = await top10kResponse.json();
        if (top10kResponse.ok) {
          top10kData = top10kResult;
        } else {
          console.error('Top10k fetch failed:', top10kResult.error);
        }
      } catch (err) {
        console.error('Top10k fetch error:', err.message);
      }

      if (picksData) dispatch({ type: ACTIONS.UPDATE_PICKS_DATA, payload: picksData });
      else console.warn('Picks data not updated due to fetch failure');
      if (plannerData) dispatch({ type: ACTIONS.UPDATE_PLANNER_DATA, payload: plannerData });
      else console.warn('Planner data not updated due to fetch failure');
      if (top10kData) dispatch({ type: ACTIONS.UPDATE_TOP10K_DATA, payload: top10kData });
      else console.warn('Top10k data not updated due to fetch failure');

      console.log('5. Leagues before check:', managerResult.leagues.length);
      if (managerResult.leagues.length > 0) {
        const firstLeagueId = managerResult.leagues[0].id.toString();
        console.log('6. Setting selected league:', firstLeagueId);
        dispatch({ type: ACTIONS.SET_SELECTED_LEAGUE, payload: firstLeagueId });
        await fetchLeague(firstLeagueId, gameweek);
      } else {
        console.warn('No leagues found in manager data');
      }
      
      dispatch({ type: ACTIONS.SET_LAST_UPDATED, payload: new Date() });
    } catch (err) {
      console.error(`Fetch error for fplId: ${fplId}:`, err.message);
      dispatch({ type: ACTIONS.SET_ERROR, payload: err.message || 'Fetch failed' });
      dispatch({ type: ACTIONS.UPDATE_MANAGER_DATA, payload: null });
    } finally {
      dispatch({ type: ACTIONS.SET_LOADING, payload: false });
    }
  }, [fplId, fetchLeague]);

  const startPolling = useCallback(() => {
    console.log('Starting polling for live data updates');
    dispatch({ type: ACTIONS.SET_USING_POLLING, payload: true });
    
    if (pollingInterval.current) {
      clearInterval(pollingInterval.current);
    }
    
    fetchLiveData();
    
    pollingInterval.current = setInterval(() => {
      fetchLiveData();
    }, pollingFrequency);
  }, [fetchLiveData]);

  const stopPolling = useCallback(() => {
    if (pollingInterval.current) {
      console.log('Stopping polling');
      clearInterval(pollingInterval.current);
      pollingInterval.current = null;
      dispatch({ type: ACTIONS.SET_USING_POLLING, payload: false });
    }
  }, []);

  const handleLeagueChange = useCallback((e) => {
    if (leagueChangeTimeout.current) clearTimeout(leagueChangeTimeout.current);
    
    dispatch({ type: ACTIONS.SET_LOADING, payload: true });
    
    leagueChangeTimeout.current = setTimeout(() => {
      const leagueId = e.target.value;
      dispatch({ type: ACTIONS.SET_SELECTED_LEAGUE, payload: leagueId });
      console.log(`League changed to ${leagueId}`);
      
      dispatch({ type: ACTIONS.UPDATE_LEAGUE_DATA, payload: null });
      
      if (data?.currentGameweek) {
        fetchLeague(leagueId, data.currentGameweek)
          .finally(() => {
            dispatch({ type: ACTIONS.SET_LOADING, payload: false });
          });
      } else {
        dispatch({ type: ACTIONS.SET_LOADING, payload: false });
        dispatch({ type: ACTIONS.SET_ERROR, payload: 'Current gameweek is not available' });
      }
    }, 300);
  }, [fetchLeague, data]);

  const connectWebSocket = useCallback(() => {
    if (ws.current && ws.current.readyState !== WebSocket.CLOSED) {
      console.log('Existing WebSocket connection detected, skipping new connection');
      return;
    }

   // console.log('Attempting WebSocket connection to ws://localhost:5000');
    ws.current = new WebSocket(WS_BASE_URL());

    ws.current.onopen = () => {
      console.log('WebSocket connected successfully');
      reconnectAttempts.current = 0;
      stopPolling();
      if (ws.current.readyState === WebSocket.OPEN && fplId && data?.currentGameweek) {
        ws.current.send(JSON.stringify({ type: 'subscribe', fplId, gameweek: data.currentGameweek }));
        console.log(`Subscribed to GW ${data.currentGameweek} for fplId ${fplId}`);
      }
    };

    ws.current.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
        return;
      }
    
      if (message.type === 'liveUpdate' && message.gameweek === data?.currentGameweek) {
        console.log('Received live update:', message);
        updateLiveData(message.data);
        
        dispatch({ 
          type: ACTIONS.UPDATE_PICKS_DATA, 
          payload: {
            picks: message.picks,  
            liveRank: message.liveRank,
            totalLivePoints: message.totalLivePoints,
            activeChip: message.activeChip,
            assistantManagerPoints: message.assistantManagerPoints,
            assistantManager: message.assistantManager
          }
        });
      } else if (message.type === 'top10kUpdate' && message.gameweek === data?.currentGameweek) {
        console.log('Received top10k stats update:', message.stats);
        if (updateTimeout.current) clearTimeout(updateTimeout.current);
        updateTimeout.current = setTimeout(() => {
          dispatch({ type: ACTIONS.UPDATE_TOP10K_DATA, payload: message.stats });
        }, 1000);
      } else if (message.type === 'init') {
        if (message.gameweek === data?.currentGameweek) {
          updateLiveData(message.data);
        }
      } else if (message.type === 'error') {
        dispatch({ type: ACTIONS.SET_ERROR, payload: message.message || 'WebSocket error received from server' });
      }
    };
    
    ws.current.onerror = (err) => {
      console.error('WebSocket error occurred:', err);
      dispatch({ type: ACTIONS.SET_ERROR, payload: 'WebSocket connection failed. Please ensure the server is running on port 5000.' });
    };

    ws.current.onclose = (event) => {
      console.log('WebSocket closed:', { code: event.code, reason: event.reason });
      if (reconnectAttempts.current < maxReconnectAttempts) {
        const delay = Math.pow(2, reconnectAttempts.current) * 1000;
        console.log(`Reconnecting in ${delay}ms... Attempt ${reconnectAttempts.current + 1}/${maxReconnectAttempts}`);
        setTimeout(() => {
          reconnectAttempts.current += 1;
          connectWebSocket();
        }, delay);
      } else {
        console.log('Max reconnection attempts reached, falling back to polling');
        startPolling();
      }
    };
  }, [fplId, data?.currentGameweek, updateLiveData, stopPolling, startPolling]);

  const activateAssistantManager = useCallback(async (managerId) => {
    if (!fplId || !data?.currentGameweek) {
      dispatch({ type: ACTIONS.SET_ERROR, payload: 'Missing FPL ID or gameweek' });
      return;
    }
    
    dispatch({ type: ACTIONS.SET_LOADING, payload: true });
    
    try {
      const response = await fetch(getApiUrl(`/api/fpl/${fplId}/assistant-manager/${data.currentGameweek}`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ managerId })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to activate assistant manager');
      }
      
      await refreshLiveData();
      
      dispatch({ type: ACTIONS.SET_ERROR, payload: '' });
    } catch (err) {
      console.error('Error activating assistant manager:', err);
      dispatch({ type: ACTIONS.SET_ERROR, payload: err.message || 'Failed to activate assistant manager' });
    } finally {
      dispatch({ type: ACTIONS.SET_LOADING, payload: false });
    }
  }, [fplId, data, refreshLiveData]);

  const deactivateAssistantManager = useCallback(async () => {
    if (!fplId || !data?.currentGameweek) {
      dispatch({ type: ACTIONS.SET_ERROR, payload: 'Missing FPL ID or gameweek' });
      return;
    }
    
    dispatch({ type: ACTIONS.SET_LOADING, payload: true });
    
    try {
      const response = await fetch(getApiUrl(`/api/fpl/${fplId}/assistant-manager/${data.currentGameweek}`), {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to deactivate assistant manager');
      }
      
      await refreshLiveData();
      
      dispatch({ type: ACTIONS.SET_ERROR, payload: '' });
    } catch (err) {
      console.error('Error deactivating assistant manager:', err);
      dispatch({ type: ACTIONS.SET_ERROR, payload: err.message || 'Failed to deactivate assistant manager' });
    } finally {
      dispatch({ type: ACTIONS.SET_LOADING, payload: false });
    }
  }, [fplId, data, refreshLiveData]);

  useEffect(() => {
    connectWebSocket();
    
    return () => {
      if (ws.current && ws.current.readyState !== WebSocket.CLOSED) {
        ws.current.close();
        console.log('WebSocket cleanup completed');
      }
      if (updateTimeout.current) {
        clearTimeout(updateTimeout.current);
      }
      stopPolling();
    };
  }, [connectWebSocket, stopPolling]);

  useEffect(() => {
    if (fplId && data) {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'subscribe', fplId, gameweek: data.currentGameweek }));
        stopPolling();
      } else if (usingPolling) {
        startPolling();
      }
    }
  }, [fplId, data, usingPolling, startPolling, stopPolling]);


  useEffect(() => {
    if (fplId && data?.currentGameweek) {
      refreshLiveData();
    }
  }, [fplId, data?.currentGameweek, refreshLiveData]);

  const setFplId = useCallback((id) => {
    dispatch({ type: ACTIONS.SET_FPL_ID, payload: id });
  }, []);

  const setSelectedLeague = useCallback((leagueId) => {
    dispatch({ type: ACTIONS.SET_SELECTED_LEAGUE, payload: leagueId });
  }, []);

  return {
    fplId,
    setFplId,
    data,
    picks,
    leagueData,
    plannerData,
    selectedLeague,
    setSelectedLeague,
    error,
    lastUpdated,
    transferPenalty,
    totalLivePoints,
    autosubs,
    viceCaptainPoints,
    liveRank,
    top10kStats,
    currentGameweek: data ? data.currentGameweek : null,
    isLoading,
    usingPolling,
    activeChip,
    assistantManagerPoints,
    assistantManager,
    fetchData,
    refreshLiveData,
    fetchLeague,
    handleLeagueChange,
    activateAssistantManager,
    deactivateAssistantManager
  };
};

export default useFplData;