import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';

const WhatIfRankSimulator = ({ 
  fplId, 
  gameweek, 
  currentLivePoints, 
  currentRank, 
  picks, 
  threats, 
  activeChip, 
  assistantManagerPoints 
}) => {
  const [simulatedPoints, setSimulatedPoints] = useState({});
  const [simulatedRank, setSimulatedRank] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const ownedPlayers = picks || [];
  const threatPlayers = threats || [];
  
  // Maximum reasonable points a player might score in a gameweek
  const MAX_PLAYER_POINTS = 30;

  const handlePointChange = (playerId, points) => {
    // Ensure points are non-negative and within reasonable range
    const validatedPoints = Math.min(Math.max(0, points), MAX_PLAYER_POINTS);
    setSimulatedPoints(prev => ({ ...prev, [playerId]: validatedPoints }));
  };

  const calculateTotalSimulatedPoints = useCallback(() => {
    let total = Object.entries(simulatedPoints).reduce((sum, [id, points]) => {
      const player = picks.find(p => p.playerId === parseInt(id));
      
      // Triple Captain: Multiply captain's points by 3
      if (player?.multiplier === 2 && activeChip === 'triplecaptain') {
        return sum + (points * 3);
      }
      
      return sum + points;
    }, 0);

    // Bench Boost: Add points from all bench players
    if (activeChip === 'bboost') {
      total = Object.values(simulatedPoints).reduce((sum, points) => sum + points, 0);
    }

    // Add Assistant Manager points if chip is active
    return total + (activeChip === 'assistant_manager' ? (assistantManagerPoints || 0) : 0);
  }, [simulatedPoints, picks, activeChip, assistantManagerPoints]);

  const fetchSimulatedRank = useCallback(async () => {
    setIsLoading(true);
    try {
      const totalAdditionalPoints = calculateTotalSimulatedPoints();
      const response = await fetch(`http://localhost:5000/api/fpl/${fplId}/rank-simulator/${gameweek}?points=${totalAdditionalPoints}`);
      
      if (!response.ok) {
        throw new Error('Failed to simulate rank');
      }
      
      const data = await response.json();
      setSimulatedRank(data.simulatedRank);
      toast.success('Rank simulation completed successfully');
    } catch (err) {
      toast.error(`Simulation failed: ${err.message}`);
      setSimulatedRank(null);
    } finally {
      setIsLoading(false);
    }
  }, [fplId, gameweek, calculateTotalSimulatedPoints]);

  useEffect(() => {
    if (Object.keys(simulatedPoints).length > 0) {
      fetchSimulatedRank();
    }
  }, [simulatedPoints, fetchSimulatedRank]);

  const playerVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
    exit: { opacity: 0, y: -20, transition: { duration: 0.3 } }
  };

  return (
    <div className="bg-gradient-to-b from-green-800 to-green-900 p-6 rounded-lg shadow-lg mb-6 border-2 border-white">
      <div className="flex items-center mb-4">
        <svg className="w-6 h-6 mr-2 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <h3 className="text-xl font-bold text-white">
          What-If Rank Simulator - GW {gameweek || 'N/A'} 
          {activeChip && ` (${activeChip === 'triplecaptain' ? 'Triple Captain' : 
                              activeChip === 'bboost' ? 'Bench Boost' : 
                              activeChip === 'assistant_manager' ? 'Assistant Manager' : 
                              activeChip})`}
        </h3>
      </div>

      <div className="relative bg-black bg-opacity-40 rounded-lg p-4 mb-4 shadow-inner border border-white border-opacity-20">
        <AnimatePresence>
          <div className="space-y-4">
            <div>
              <h4 className="text-md font-medium text-green-300 mb-2">Your Players</h4>
              {ownedPlayers.length > 0 ? (
                ownedPlayers.map(player => (
                  <motion.div 
                    key={player.playerId} 
                    variants={playerVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className={`flex items-center justify-between mb-2 p-2 rounded ${
                      player.multiplier === 2 && activeChip === 'triplecaptain' 
                        ? 'bg-yellow-900 bg-opacity-60' 
                        : 'bg-green-900 bg-opacity-50'
                    }`}
                  >
                    <span className="text-sm font-medium text-white">
                      {player.name} 
                      {player.multiplier === 2 && activeChip === 'triplecaptain' && ' (3x)'}
                    </span>
                    <input
                      type="number"
                      min="0"
                      max={MAX_PLAYER_POINTS}
                      value={simulatedPoints[player.playerId] || 0}
                      onChange={(e) => handlePointChange(player.playerId, parseInt(e.target.value) || 0)}
                      className="w-16 p-1 border rounded text-center bg-green-700 text-white focus:ring-2 focus:ring-green-400"
                    />
                  </motion.div>
                ))
              ) : (
                <p className="text-gray-400 italic text-center">No players loaded yet.</p>
              )}
            </div>

            <div>
              <h4 className="text-md font-medium text-red-300 mb-2">Threats</h4>
              {threatPlayers.length > 0 ? (
                threatPlayers.map(([id, { name }]) => (
                  <motion.div 
                    key={id} 
                    variants={playerVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className="flex items-center justify-between mb-2 p-2 bg-red-900 bg-opacity-50 rounded"
                  >
                    <span className="text-sm font-medium text-white">{name}</span>
                    <input
                      type="number"
                      min="0"
                      max={MAX_PLAYER_POINTS}
                      value={simulatedPoints[id] || 0}
                      onChange={(e) => handlePointChange(id, parseInt(e.target.value) || 0)}
                      className="w-16 p-1 border rounded text-center bg-red-700 text-white focus:ring-2 focus:ring-red-400"
                    />
                  </motion.div>
                ))
              ) : (
                <p className="text-gray-400 italic text-center">No threats identified yet.</p>
              )}
            </div>
          </div>
        </AnimatePresence>
      </div>

      <div className="bg-black bg-opacity-40 p-4 rounded-lg">
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div>
            <p className="text-sm text-gray-300">Current Live Points:</p>
            <p className="font-bold text-white">{currentLivePoints || 0}</p>
          </div>
          <div>
            <p className="text-sm text-gray-300">Simulated Points:</p>
            <p className="font-bold text-green-300">
              {(currentLivePoints || 0) + calculateTotalSimulatedPoints()}
              {activeChip === 'assistant_manager' && assistantManagerPoints > 0 && 
                ` (+${assistantManagerPoints} AM)`}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-300">Current Rank:</p>
            <p className="font-bold text-white">{currentRank ? currentRank.toLocaleString() : 'N/A'}</p>
          </div>
          <div>
            <p className="text-sm text-gray-300">Simulated Rank:</p>
            <p className="font-bold text-green-300">
              {isLoading ? 'Calculating...' : simulatedRank ? simulatedRank.toLocaleString() : 'N/A'}
            </p>
          </div>
        </div>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={fetchSimulatedRank}
          className="w-full bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition disabled:bg-gray-600 disabled:cursor-not-allowed"
          disabled={isLoading || Object.keys(simulatedPoints).length === 0}
        >
          {isLoading ? 'Simulating...' : 'Simulate Rank'}
        </motion.button>
      </div>
    </div>
  );
};

export default WhatIfRankSimulator;