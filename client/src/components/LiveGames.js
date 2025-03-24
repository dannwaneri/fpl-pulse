import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import throttle from 'lodash/throttle';

const LiveGames = memo(({ gameweek }) => {
  const [matches, setMatches] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortControllerRef = useRef(null);

  const fetchWithRetry = useCallback(async (url, maxRetries = 3) => {
    let retries = 0;
    let lastError;

    while (retries < maxRetries) {
      try {
        // Abort previous request if exists
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        
        // Create new abort controller
        abortControllerRef.current = new AbortController();

        const response = await fetch(url, {
          signal: abortControllerRef.current.signal,
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        return await response.json();
      } catch (err) {
        lastError = err;
        retries++;
        
        if (err.name === 'AbortError') {
          console.warn('Fetch aborted');
          return null;
        }
        
        if (retries < maxRetries) {
          const delay = Math.pow(2, retries) * 500; // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }, []);

  const fetchLiveGames = useCallback(async () => {
    if (!gameweek) return;

    setIsLoading(true);
    setError(null);

    try {
      const fixturesData = await fetchWithRetry(`http://localhost:5000/api/league/fixtures/${gameweek}`);

      if (!fixturesData) {
        throw new Error('No fixtures data received');
      }

      const liveMatches = fixturesData
        .filter(f => !f.finished && f.started)
        .map(match => ({
          id: match.id || Date.now(),
          homeTeam: match.team_h_name || 'Unknown Home Team',
          awayTeam: match.team_a_name || 'Unknown Away Team',
          homeScore: match.team_h_score ?? 0,
          awayScore: match.team_a_score ?? 0,
          homeBonus: match.homeTeamBonus || 0,
          awayBonus: match.awayTeamBonus || 0
        }));

      setMatches(liveMatches);
      setError(null);
    } catch (err) {
      console.error('Live Games Fetch Error:', err);
      setError({
        message: navigator.onLine 
          ? 'Failed to fetch live game data. Please try again later.' 
          : 'No internet connection. Please check your network.',
        canRetry: true
      });
      setMatches([]);
    } finally {
      setIsLoading(false);
    }
  }, [gameweek, fetchWithRetry]);

  // Error boundary for network issues
  useEffect(() => {
    const handleOnline = () => {
      console.log('Network is back online, attempting to reconnect');
      fetchLiveGames();
    };

    const handleOffline = () => {
      console.warn('Network connection lost');
      setError({
        message: 'Network connection lost. Please check your internet.',
        canRetry: true
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [fetchLiveGames]);

  // Fetch mechanism with throttling and interval for automatic refresh
  useEffect(() => {
    if (!gameweek) return;

    // More aggressive throttling to prevent excessive calls
    const throttledFetch = throttle(fetchLiveGames, 15000, { 
      leading: true,
      trailing: true 
    });
    
    // Initial fetch
    throttledFetch();
    
    // Set up interval for periodic updates during live games
    const intervalId = setInterval(() => {
      throttledFetch();
    }, 60000); // Refresh every minute for live data

    return () => {
      // Cleanup: abort any ongoing fetch, cancel throttle and clear interval
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      throttledFetch.cancel();
      clearInterval(intervalId);
    };
  }, [gameweek, fetchLiveGames]);

  const handleRetry = useCallback(() => {
    // Clear previous error and retry
    setError(null);
    fetchLiveGames();
  }, [fetchLiveGames]);

  const matchVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
    exit: { opacity: 0, y: -20, transition: { duration: 0.3 } }
  };

  return (
    <div className="bg-gradient-to-b from-green-800 to-green-900 p-6 rounded-lg shadow-lg mb-6 border-2 border-white">
      <div className="flex items-center mb-4">
        <svg className="w-6 h-6 mr-2 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <h3 className="text-xl font-bold text-white">Live Games - GW {gameweek || 'N/A'}</h3>
      </div>

      {isLoading && !matches.length ? (
        <div className="bg-black bg-opacity-40 p-4 rounded-lg text-white text-center animate-pulse">
          Loading live matches...
        </div>
      ) : error ? (
        <div className="bg-red-900 bg-opacity-40 p-4 rounded-lg text-white text-center space-y-3">
          <p>Error: {error.message}</p>
          {error.canRetry && (
            <button 
              onClick={handleRetry}
              className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded transition duration-300"
            >
              Retry Fetch
            </button>
          )}
        </div>
      ) : matches.length === 0 ? (
        <div className="bg-black bg-opacity-40 p-4 rounded-lg text-white text-center">
          No ongoing matches for GW {gameweek || 'N/A'}
        </div>
      ) : (
        <AnimatePresence>
          {matches.map(match => (
            <motion.div 
              key={match.id} 
              variants={matchVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="bg-black bg-opacity-40 p-4 rounded-lg shadow-inner border border-white border-opacity-20 mb-4"
            >
              <div className="flex justify-between items-center mb-2">
                <div className="flex-1 text-center">
                  <span className="text-white font-medium">{match.homeTeam}</span>
                </div>
                <div className="flex items-center">
                  <span className="text-white font-bold mx-2">{match.homeScore} - {match.awayScore}</span>
                </div>
                <div className="flex-1 text-center">
                  <span className="text-white font-medium">{match.awayTeam}</span>
                </div>
              </div>
              <div className="text-sm text-green-200 text-center">
                <p>Projected Bonus: 
                  <span className="mx-2">
                    {match.homeTeam}: <span className="font-bold text-yellow-300">{match.homeBonus}</span>
                  </span>
                  <span className="mx-2">
                    {match.awayTeam}: <span className="font-bold text-yellow-300">{match.awayBonus}</span>
                  </span>
                </p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      )}
    </div>
  );
});

export default LiveGames;