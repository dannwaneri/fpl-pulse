import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const ITEMS_PER_PAGE = 50;

const PlayerComparisonTool = ({ plannerData, currentSquad, activeChip }) => {
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  const [comparisonMetrics, setComparisonMetrics] = useState({});
  const [visiblePlayers, setVisiblePlayers] = useState([]);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Safely get player data with fallbacks for undefined values
  const allPlayers = useMemo(() => plannerData?.allPlayers || [], [plannerData?.allPlayers]);
  const squadPlayers = useMemo(() => currentSquad || [], [currentSquad]);

  // Create a combined list of unique players
  const comparisonOptions = useMemo(() => {
    const uniquePlayers = new Map();
    squadPlayers.forEach(p => uniquePlayers.set(p.id, p));
    allPlayers.forEach(p => uniquePlayers.set(p.id, p));
    return Array.from(uniquePlayers.values());
  }, [squadPlayers, allPlayers]);

  // Safely format currency with fallbacks
  const formatCurrency = useCallback((value) => {
    if (value === undefined || value === null) return "0.0";
    return typeof value === 'number' ? value.toFixed(1) : "0.0";
  }, []);

  // Get player cost with fallbacks
  const getPlayerCost = useCallback((player) => {
    if (!player) return 0;
    if (player.cost !== undefined && player.cost !== null) return player.cost;
    if (player.now_cost !== undefined && player.now_cost !== null) return player.now_cost / 10;
    return 0;
  }, []);

  // Lazy loading implementation
  const loadMorePlayers = useCallback(() => {
    const start = (page - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const newVisible = comparisonOptions.slice(0, end);
    setVisiblePlayers(newVisible);
  }, [comparisonOptions, page]);

  useEffect(() => {
    loadMorePlayers();
  }, [loadMorePlayers]);

  const handleScroll = (e) => {
    const bottom = e.target.scrollHeight - e.target.scrollTop <= e.target.clientHeight + 50;
    if (bottom && visiblePlayers.length < comparisonOptions.length) {
      setPage(prev => prev + 1);
    }
  };

  const fetchDetailedStats = useCallback(async () => {
    if (selectedPlayers.length === 0) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const updatedPlayers = await Promise.all(
        selectedPlayers.map(async (player) => {
          // Skip fetch if we already have form data
          if (player.form) {
            return player;
          }
          
          try {
            const response = await fetch(`https://fantasy.premierleague.com/api/element-summary/${player.id}/`);
            
            if (!response.ok) {
              throw new Error(`Failed to fetch stats for ${player.name || 'player'}`);
            }
            
            const data = await response.json();
            const history = data.history || [];
            const recentHistory = history.slice(-5);
            const totalPoints = history.reduce((sum, h) => sum + (h.total_points || 0), 0);
            
            return {
              ...player,
              total_points: activeChip === '3cap' && player.multiplier === 2 ? totalPoints * 3 : totalPoints,
              form: recentHistory.length > 0 
                ? (recentHistory.reduce((sum, h) => sum + (h.total_points || 0), 0) / recentHistory.length).toFixed(1) 
                : "0.0",
              goals_scored: history.reduce((sum, h) => sum + (h.goals_scored || 0), 0),
              assists: history.reduce((sum, h) => sum + (h.assists || 0), 0),
            };
          } catch (err) {
            console.warn(`Error fetching data for player ${player.id}:`, err);
            // Return player with default values rather than failing the whole operation
            return {
              ...player,
              total_points: 0,
              form: "0.0",
              goals_scored: 0,
              assists: 0,
              fetchError: true
            };
          }
        })
      );

      setSelectedPlayers(updatedPlayers);
      
      // Build metrics with safe defaults
      const metrics = updatedPlayers.reduce((acc, player) => {
        if (!player) return acc;
        
        acc[player.id] = {
          name: player.name || 'Unknown Player',
          points: player.total_points || 0,
          cost: getPlayerCost(player),
          form: player.form || "0.0",
          goals: player.goals_scored || 0,
          assists: player.assists || 0,
          hasError: player.fetchError || false
        };
        return acc;
      }, {});
      
      setComparisonMetrics(metrics);
    } catch (err) {
      setError(`Failed to load player stats: ${err.message}`);
      console.warn('Fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedPlayers, getPlayerCost, activeChip]);

  useEffect(() => {
    if (selectedPlayers.length > 0) fetchDetailedStats();
  }, [selectedPlayers, fetchDetailedStats]);

  const handlePlayerSelect = (playerId) => {
    if (!playerId) return;
    
    const parsedId = parseInt(playerId, 10);
    if (isNaN(parsedId)) return;
    
    const player = comparisonOptions.find(p => p.id === parsedId);
    if (player && !selectedPlayers.some(p => p.id === player.id)) {
      setSelectedPlayers(prev => [...prev, player].slice(0, 4));
    }
  };

  const removePlayer = (playerId) => {
    if (!playerId) return;
    setSelectedPlayers(prev => prev.filter(p => p.id !== playerId));
  };

  const playerVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
    exit: { opacity: 0, y: -20, transition: { duration: 0.3 } }
  };

  // Format chip name for display
  const formatChipName = (chip) => {
    if (!chip) return '';
    const chipNames = {
      '3cap': 'Triple Captain',
      'freehit': 'Free Hit',
      'wildcard': 'Wildcard',
      'bboost': 'Bench Boost'
    };
    return chipNames[chip] || chip;
  };

  return (
    <div className="bg-gradient-to-b from-green-800 to-green-900 p-6 rounded-lg shadow-lg mb-6 border-2 border-white">
      <div className="flex items-center mb-4">
        <svg className="w-6 h-6 mr-2 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <h3 className="text-xl font-bold text-white">
          Player Comparison Tool {activeChip && `(${formatChipName(activeChip)})`}
        </h3>
      </div>

      <div className="bg-black bg-opacity-40 rounded-lg p-4 mb-4 shadow-inner border border-white border-opacity-20">
        <div className="mb-4">
          <label className="block text-sm font-medium text-green-300 mb-2">Add Player to Compare</label>
          <select
            onChange={(e) => handlePlayerSelect(e.target.value)}
            className="p-2 border border-white border-opacity-20 rounded-md w-full bg-green-900 text-white"
            defaultValue=""
            onScroll={handleScroll}
            disabled={isLoading}
          >
            <option value="" className="bg-green-800">Select Player</option>
            {visiblePlayers.map(player => (
              <option 
                key={`player-${player.id}`}  // Unique key added here
                value={player.id} 
                className="bg-green-800"
              >
                {player.name || 'Unknown Player'} ({player.positionType || 'UNK'}) - £{formatCurrency(getPlayerCost(player))}m
              </option>
            ))}
            {visiblePlayers.length < comparisonOptions.length && (
              <option disabled className="bg-green-800">Scroll to load more...</option>
            )}
          </select>
        </div>

        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-green-900 bg-opacity-40 p-2 rounded mb-4 text-white text-center"
          >
            Loading player stats...
          </motion.div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-red-900 bg-opacity-40 p-2 rounded mb-4 text-white text-center"
          >
            {error}
            <button
              onClick={fetchDetailedStats}
              className="ml-2 text-green-300 hover:text-green-100 underline"
              disabled={isLoading}
            >
              Retry
            </button>
          </motion.div>
        )}

        <AnimatePresence>
          {selectedPlayers.length > 0 ? (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="overflow-x-auto"
            >
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-green-900 text-green-300 text-sm">
                    <th className="p-2">Player</th>
                    <th className="p-2">Points</th>
                    <th className="p-2">Cost</th>
                    <th className="p-2">Form</th>
                    <th className="p-2">Goals</th>
                    <th className="p-2">Assists</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {selectedPlayers.map(player => {
                    const metrics = comparisonMetrics[player.id] || {};
                    const hasError = metrics.hasError;
                    const isTripleCaptain = activeChip === '3cap' && player.multiplier === 2;
                    
                    return (
                      <motion.tr 
                        key={`selected-${player.id}`}  // Unique key added here
                        variants={playerVariants}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                        className={`border-b border-green-700 hover:bg-green-800 bg-green-900 bg-opacity-50 ${hasError ? 'opacity-70' : ''}`}
                      >
                        <td className="p-2 text-white">
                          {metrics.name || player.name || 'Unknown Player'}
                          {isTripleCaptain && (
                            <span className="ml-2 bg-yellow-600 text-xs rounded px-1 py-0.5 text-white">3×</span>
                          )}
                        </td>
                        <td className="p-2 text-green-300">{metrics.points || 0}</td>
                        <td className="p-2 text-white">£{formatCurrency(metrics.cost || getPlayerCost(player))}m</td>
                        <td className="p-2 text-green-300">{metrics.form || "0.0"}</td>
                        <td className="p-2 text-white">{metrics.goals || 0}</td>
                        <td className="p-2 text-green-300">{metrics.assists || 0}</td>
                        <td className="p-2">
                          <motion.button
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            onClick={() => removePlayer(player.id)}
                            className="text-red-400 hover:text-red-300 text-sm"
                            disabled={isLoading}
                          >
                            Remove
                          </motion.button>
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </motion.div>
          ) : (
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-gray-400 italic text-center py-4"
            >
              Select players to compare their stats.
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default PlayerComparisonTool;