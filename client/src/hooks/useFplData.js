import { useEffect, useRef, useCallback, useReducer, useState } from 'react';
import { getApiUrl, WS_BASE_URL } from '../utils/apiConfig';

// Module-level WebSocket management
let globalWs = null;
let globalWsClients = 0;
let globalWsConnectionState = 'disconnected';
let globalReconnectTimer = null;

const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

// Client-side caching
const clientCache = {
  data: {},
  set: function(key, value, ttl = 60000) {
    this.data[key] = {
      value,
      expiry: Date.now() + ttl,
      timestamp: Date.now()
    };
  },
  get: function(key) {
    const item = this.data[key];
    if (!item) return null;
    if (Date.now() > item.expiry) {
      delete this.data[key];
      return null;
    }
    return item.value;
  },
  has: function(key) {
    return !!this.get(key);
  }
};

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
      return { ...initialState, fplId: state.fplId };
    case ACTIONS.UPDATE_MANAGER_DATA:
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
  const [wsConnectionState, setWsConnectionState] = useState(globalWsConnectionState);
  
  const pollingFrequency = 60000; // 60 seconds
  const ws = useRef(null);
  const reconnectAttempts = useRef(0);
  const updateTimeout = useRef(null);
  const pollingInterval = useRef(null);
  const leagueChangeTimeout = useRef(null);

  const fetchLeague = useCallback(async (leagueId, gameweek) => {
    if (!leagueId || !gameweek) return;
    
    const cacheKey = `league:${leagueId}:${gameweek}`;
    if (clientCache.has(cacheKey)) {
      console.log('Using cached league data');
      dispatch({ type: ACTIONS.UPDATE_LEAGUE_DATA, payload: clientCache.get(cacheKey) });
      return;
    }

    try {
      dispatch({ type: ACTIONS.SET_LOADING, payload: true });
      const response = await fetch(getApiUrl(`/api/league/${leagueId}/live/${gameweek}/`));
      if (!response.ok) throw new Error('Failed to fetch league data');
      const result = await response.json();
      clientCache.set(cacheKey, result, 180000); // 3 min TTL
      dispatch({ type: ACTIONS.UPDATE_LEAGUE_DATA, payload: result });
      dispatch({ type: ACTIONS.SET_ERROR, payload: '' });
    } catch (err) {
      console.error('League fetch error:', err.message);
      dispatch({ type: ACTIONS.SET_ERROR, payload: err.message });
    } finally {
      dispatch({ type: ACTIONS.SET_LOADING, payload: false });
    }
  }, []);

  const updateLiveData = useCallback((liveData) => {
    if (!state.data || !state.fplId || !state.picks.length) return;
    
    const updatedPicks = state.picks.map(pick => {
      const liveStats = liveData.find(el => el.id === pick.playerId)?.stats || {};
      return {
        ...pick,
        livePoints: liveStats.total_points ? liveStats.total_points * pick.multiplier : 0,
        bonus: liveStats.bonus || 0,
        goals: liveStats.goals_scored || 0,
        assists: liveStats.assists || 0,
        minutes: liveStats.minutes || 0,
        teamShortName: pick.teamShortName,
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
      if (state.activeChip === 'bboost') return sum + p.livePoints;
      return sum + (p.multiplier > 0 ? p.livePoints : 0);
    }, 0) + state.transferPenalty;

    if (state.activeChip === 'assistant_manager' && state.assistantManagerPoints) {
      calculatedTotalPoints += state.assistantManagerPoints;
    }

    if (updateTimeout.current) clearTimeout(updateTimeout.current);
    updateTimeout.current = setTimeout(async () => {
      dispatch({ 
        type: ACTIONS.UPDATE_PICKS_DATA, 
        payload: {
          picks: updatedPicks,
          totalLivePoints: calculatedTotalPoints
        }
      });
      dispatch({ type: ACTIONS.SET_LAST_UPDATED, payload: new Date() });
    }, 1000);
  }, [state.data, state.fplId, state.picks, state.transferPenalty, state.activeChip, state.assistantManagerPoints]);

  const refreshLiveData = useCallback(async () => {
    if (!state.data || !state.fplId) return;
    
    dispatch({ type: ACTIONS.SET_LOADING, payload: true });
    try {
      const gameweek = state.data.currentGameweek;
      const response = await fetch(getApiUrl(`/api/fpl/${state.fplId}/event/${gameweek}/picks`));
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to fetch picks');
      
      dispatch({ 
        type: ACTIONS.UPDATE_PICKS_DATA, 
        payload: {
          picks: result.picks || [],
          transferPenalty: result.transferPenalty || 0,
          totalLivePoints: result.totalLivePoints || 0,
          autosubs: result.autosubs || [],
          viceCaptainPoints: result.viceCaptainPoints || null,
          liveRank: Number.isFinite(result.liveRank) ? result.liveRank : 0,
          activeChip: result.activeChip || null,
          assistantManagerPoints: result.assistantManagerPoints || 0,
          assistantManager: result.assistantManager || null
        }
      });

      if (state.selectedLeague) await fetchLeague(state.selectedLeague, gameweek);
      dispatch({ type: ACTIONS.SET_LAST_UPDATED, payload: new Date() });
    } catch (err) {
      dispatch({ type: ACTIONS.SET_ERROR, payload: err.message });
    } finally {
      dispatch({ type: ACTIONS.SET_LOADING, payload: false });
    }
  }, [state.data, state.fplId, state.selectedLeague, fetchLeague]);

  const fetchLiveData = useCallback(async () => {
    if (!state.data || !state.fplId) return;
    
    const gameweek = state.data.currentGameweek;
    const liveDataCacheKey = `liveData:${state.fplId}:${gameweek}`;
    let picksResult;

    if (clientCache.has(liveDataCacheKey)) {
      const cached = clientCache.get(liveDataCacheKey);
      if (Date.now() - cached.timestamp < 30000) {
        console.log('Using cached live data');
        picksResult = cached;
      }
    }

    if (!picksResult) {
      const response = await fetch(getApiUrl(`/api/fpl/${state.fplId}/event/${gameweek}/picks`));
      if (!response.ok) return;
      picksResult = await response.json();
      clientCache.set(liveDataCacheKey, picksResult, 45000); // 45s TTL
    }

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

    if (state.top10kStats && (!clientCache.has('top10kLastUpdate') || Date.now() - clientCache.get('top10kLastUpdate')?.timestamp > 120000)) {
      const response = await fetch(getApiUrl(`/api/fpl/top10k/${gameweek}`));
      if (response.ok) {
        const result = await response.json();
        dispatch({ type: ACTIONS.UPDATE_TOP10K_DATA, payload: result });
        clientCache.set('top10kLastUpdate', { timestamp: Date.now() }, 3600000);
      }
    }

    if (state.selectedLeague) {
      const leagueUpdateKey = `leagueUpdate:${state.selectedLeague}`;
      if (!clientCache.has(leagueUpdateKey) || Date.now() - clientCache.get(leagueUpdateKey)?.timestamp > 180000) {
        await fetchLeague(state.selectedLeague, gameweek);
        clientCache.set(leagueUpdateKey, { timestamp: Date.now() }, 3600000);
      }
    }

    dispatch({ type: ACTIONS.SET_LAST_UPDATED, payload: new Date() });
  }, [state.data, state.fplId, state.selectedLeague, state.top10kStats, updateLiveData, fetchLeague]);

  const fetchData = useCallback(async () => {
    if (!state.fplId || state.fplId.trim() === '') {
      dispatch({ type: ACTIONS.SET_ERROR, payload: 'Please enter a valid FPL ID' });
      return;
    }

    dispatch({ type: ACTIONS.SET_LOADING, payload: true });
    dispatch({ type: ACTIONS.RESET_DATA });

    try {
      const managerCacheKey = `manager:${state.fplId}`;
      let managerResult = clientCache.get(managerCacheKey);
      
      if (!managerResult) {
        const response = await fetch(getApiUrl(`/api/fpl/entry/${state.fplId}`));
        managerResult = await response.json();
        if (!response.ok) throw new Error(managerResult.error || 'Failed to fetch manager data');
        clientCache.set(managerCacheKey, managerResult, 300000); // 5 min TTL
      }

      const gameweek = managerResult.currentGameweek || 1;
      dispatch({ type: ACTIONS.UPDATE_MANAGER_DATA, payload: { ...managerResult, currentGameweek: gameweek } });

      await Promise.all([
        (async () => {
          const picksCacheKey = `picks:${state.fplId}:${gameweek}`;
          let picksResult = clientCache.get(picksCacheKey);
          if (!picksResult) {
            const response = await fetch(getApiUrl(`/api/fpl/${state.fplId}/event/${gameweek}/picks`));
            picksResult = await response.json();
            if (response.ok) clientCache.set(picksCacheKey, picksResult, 120000); // 2 min TTL
          }
          if (picksResult) {
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
          }
        })(),
        (async () => {
          const plannerCacheKey = `planner:${state.fplId}`;
          let plannerResult = clientCache.get(plannerCacheKey);
          if (!plannerResult) {
            const response = await fetch(getApiUrl(`/api/fpl/${state.fplId}/planner`));
            plannerResult = await response.json();
            if (response.ok) clientCache.set(plannerCacheKey, plannerResult, 600000); // 10 min TTL
          }
          if (plannerResult) dispatch({ type: ACTIONS.UPDATE_PLANNER_DATA, payload: plannerResult });
        })(),
        (async () => {
          const top10kCacheKey = `top10k:${gameweek}`;
          let top10kResult = clientCache.get(top10kCacheKey);
          if (!top10kResult) {
            const response = await fetch(getApiUrl(`/api/fpl/top10k/${gameweek}`));
            top10kResult = await response.json();
            if (response.ok) clientCache.set(top10kCacheKey, top10kResult, 300000); // 5 min TTL
          }
          if (top10kResult) dispatch({ type: ACTIONS.UPDATE_TOP10K_DATA, payload: top10kResult });
        })()
      ]);

      if (managerResult.leagues?.length) {
        const firstLeagueId = managerResult.leagues[0].id.toString();
        dispatch({ type: ACTIONS.SET_SELECTED_LEAGUE, payload: firstLeagueId });
        setTimeout(() => fetchLeague(firstLeagueId, gameweek), 1000);
      }

      dispatch({ type: ACTIONS.SET_LAST_UPDATED, payload: new Date() });
    } catch (err) {
      console.error('Fetch error:', err.message);
      dispatch({ type: ACTIONS.SET_ERROR, payload: err.message });
      dispatch({ type: ACTIONS.UPDATE_MANAGER_DATA, payload: null });
    } finally {
      dispatch({ type: ACTIONS.SET_LOADING, payload: false });
    }
  }, [state.fplId, fetchLeague]);

  const startPolling = useCallback(() => {
    console.log('Starting polling');
    if (!state.usingPolling) {
      dispatch({ type: ACTIONS.SET_USING_POLLING, payload: true });
      fetchLiveData();
      pollingInterval.current = setInterval(fetchLiveData, pollingFrequency);
    }
  }, [fetchLiveData, state.usingPolling]);

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
    const leagueId = e.target.value;
    dispatch({ type: ACTIONS.SET_SELECTED_LEAGUE, payload: leagueId });

    leagueChangeTimeout.current = setTimeout(() => {
      if (state.data?.currentGameweek) {
        fetchLeague(leagueId, state.data.currentGameweek)
          .finally(() => dispatch({ type: ACTIONS.SET_LOADING, payload: false }));
      }
    }, 300);
  }, [state.data, fetchLeague]);

  const connectWebSocket = useCallback(() => {
    if (globalWsConnectionState === 'connecting') return;

    if (globalWs?.readyState === WebSocket.OPEN) {
      ws.current = globalWs;
      globalWsClients++;
      setWsConnectionState('connected');
      if (state.fplId && state.data?.currentGameweek) {
        globalWs.send(JSON.stringify({ 
          type: 'subscribe', 
          fplId: state.fplId, 
          gameweek: state.data.currentGameweek 
        }));
      }
      return;
    }

    setWsConnectionState('connecting');
    globalWsConnectionState = 'connecting';

    try {
      globalWs = new WebSocket(WS_BASE_URL());
      ws.current = globalWs;
      globalWsClients++;

      globalWs.onopen = () => {
        console.log('WebSocket connected');
        globalWsConnectionState = 'connected';
        setWsConnectionState('connected');
        reconnectAttempts.current = 0;
        stopPolling();
        if (state.fplId && state.data?.currentGameweek) {
          globalWs.send(JSON.stringify({ 
            type: 'subscribe', 
            fplId: state.fplId, 
            gameweek: state.data.currentGameweek 
          }));
        }
        globalWs.pingInterval = setInterval(() => {
          if (globalWs.readyState === WebSocket.OPEN) {
            globalWs.send(JSON.stringify({ type: 'ping' }));
          }
        }, 45000);
      };

      globalWs.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch (err) {
          console.error('WebSocket message parse error:', err);
          return;
        }

        switch (message.type) {
          case 'pong':
            break;
          case 'liveUpdate':
            if (message.gameweek === state.data?.currentGameweek && message.fplId === state.fplId) {
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
            }
            break;
          case 'top10kUpdate':
            if (message.gameweek === state.data?.currentGameweek) {
              if (updateTimeout.current) clearTimeout(updateTimeout.current);
              updateTimeout.current = setTimeout(() => {
                dispatch({ type: ACTIONS.UPDATE_TOP10K_DATA, payload: message.stats });
              }, 1000);
            }
            break;
          case 'init':
            if (message.gameweek === state.data?.currentGameweek) {
              updateLiveData(message.data);
            }
            break;
          case 'error':
            dispatch({ type: ACTIONS.SET_ERROR, payload: message.message });
            break;
          default:
            console.log('Unknown message type:', message.type);
        }
      };

      globalWs.onerror = (err) => {
        console.error('WebSocket error:', err);
      };

      globalWs.onclose = (event) => {
        console.log('WebSocket closed:', event);
        globalWsConnectionState = 'disconnected';
        setWsConnectionState('disconnected');
        if (globalWs.pingInterval) clearInterval(globalWs.pingInterval);

        if (event.code !== 1000 && event.code !== 1001 && globalWsClients > 0) {
          const delay = Math.min(
            INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts.current) + Math.random() * 300,
            MAX_RECONNECT_DELAY
          );
          console.log(`Reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempts.current + 1}/${MAX_RECONNECT_ATTEMPTS})`);
          globalReconnectTimer = setTimeout(() => {
            reconnectAttempts.current++;
            connectWebSocket();
          }, delay);
        } else if (globalWsClients > 0) {
          startPolling();
        }
      };
    } catch (err) {
      console.error('WebSocket creation error:', err);
      globalWsConnectionState = 'disconnected';
      setWsConnectionState('disconnected');
      startPolling();
    }
  }, [state.fplId, state.data, updateLiveData, startPolling, stopPolling]);

  const activateAssistantManager = useCallback(async (managerId) => {
    if (!state.fplId || !state.data?.currentGameweek) return;
    
    dispatch({ type: ACTIONS.SET_LOADING, payload: true });
    try {
      const response = await fetch(getApiUrl(`/api/fpl/${state.fplId}/assistant-manager/${state.data.currentGameweek}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managerId })
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Failed to activate assistant manager');
      await refreshLiveData();
    } catch (err) {
      dispatch({ type: ACTIONS.SET_ERROR, payload: err.message });
    } finally {
      dispatch({ type: ACTIONS.SET_LOADING, payload: false });
    }
  }, [state.fplId, state.data, refreshLiveData]);

  const deactivateAssistantManager = useCallback(async () => {
    if (!state.fplId || !state.data?.currentGameweek) return;
    
    dispatch({ type: ACTIONS.SET_LOADING, payload: true });
    try {
      const response = await fetch(getApiUrl(`/api/fpl/${state.fplId}/assistant-manager/${state.data.currentGameweek}`), {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Failed to deactivate assistant manager');
      await refreshLiveData();
    } catch (err) {
      dispatch({ type: ACTIONS.SET_ERROR, payload: err.message });
    } finally {
      dispatch({ type: ACTIONS.SET_LOADING, payload: false });
    }
  }, [state.fplId, state.data, refreshLiveData]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      globalWsClients--;
      if (globalWsClients <= 0 && globalWs) {
        if (globalWs.readyState !== WebSocket.CLOSED) {
          globalWs.close(1000, 'No active clients');
        }
        globalWs = null;
        if (globalReconnectTimer) {
          clearTimeout(globalReconnectTimer);
          globalReconnectTimer = null;
        }
      }
      stopPolling();
      if (updateTimeout.current) clearTimeout(updateTimeout.current);
      if (leagueChangeTimeout.current) clearTimeout(leagueChangeTimeout.current);
    };
  }, [connectWebSocket, stopPolling]);

  useEffect(() => {
    if (state.fplId && state.data?.currentGameweek) {
      if (globalWs?.readyState === WebSocket.OPEN) {
        globalWs.send(JSON.stringify({ 
          type: 'subscribe', 
          fplId: state.fplId, 
          gameweek: state.data.currentGameweek 
        }));
        stopPolling();
      } else if (wsConnectionState !== 'connecting') {
        connectWebSocket();
        if (!state.usingPolling) startPolling();
      }
    }
  }, [state.fplId, state.data?.currentGameweek, wsConnectionState, connectWebSocket, startPolling, stopPolling, state.usingPolling]);

  useEffect(() => {
    if (state.fplId && state.data?.currentGameweek) {
      refreshLiveData();
    }
  }, [state.fplId, state.data?.currentGameweek, refreshLiveData]);

  return {
    fplId: state.fplId,
    setFplId: (id) => dispatch({ type: ACTIONS.SET_FPL_ID, payload: id }),
    data: state.data,
    picks: state.picks,
    leagueData: state.leagueData,
    plannerData: state.plannerData,
    selectedLeague: state.selectedLeague,
    setSelectedLeague: (id) => dispatch({ type: ACTIONS.SET_SELECTED_LEAGUE, payload: id }),
    error: state.error,
    lastUpdated: state.lastUpdated,
    transferPenalty: state.transferPenalty,
    totalLivePoints: state.totalLivePoints,
    autosubs: state.autosubs,
    viceCaptainPoints: state.viceCaptainPoints,
    liveRank: state.liveRank,
    top10kStats: state.top10kStats,
    currentGameweek: state.data?.currentGameweek || null,
    isLoading: state.isLoading,
    usingPolling: state.usingPolling,
    connectionStatus: wsConnectionState,
    activeChip: state.activeChip,
    assistantManagerPoints: state.assistantManagerPoints,
    assistantManager: state.assistantManager,
    fetchData,
    refreshLiveData,
    fetchLeague,
    handleLeagueChange,
    activateAssistantManager,
    deactivateAssistantManager,
    reconnectWebSocket: connectWebSocket
  };
};

export default useFplData;