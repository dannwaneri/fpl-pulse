import React, { useState, useEffect } from 'react';

const CaptaincyOptimizer = ({ fplId, gameweek, activeChip }) => {
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isRetrying, setIsRetrying] = useState(false);

  // Helper function for exponential backoff retry
  const fetchWithRetry = async (url, maxRetries = 3) => {
    let retries = 0;
    let lastError;

    while (retries < maxRetries) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
          throw new Error(errorData.error || `Failed with status: ${response.status}`);
        }
        return await response.json();
      } catch (err) {
        lastError = err;
        retries++;
        if (retries < maxRetries) {
          setIsRetrying(true);
          // Exponential backoff: wait 2^retries * 500ms before next retry
          const delay = Math.pow(2, retries) * 500;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    setIsRetrying(false);
    throw lastError;
  };

  // Helper function to save data to localStorage with TTL
  const saveToCache = (key, data, ttl = 24 * 3600000) => { // 24-hour TTL
    const now = new Date();
    const item = {
      data,
      expiry: now.getTime() + ttl,
    };
    localStorage.setItem(key, JSON.stringify(item));
  };

  // Helper function to get data from localStorage with TTL check
  const getFromCache = (key) => {
    const itemStr = localStorage.getItem(key);
    if (!itemStr) return null;

    const item = JSON.parse(itemStr);
    const now = new Date();
    
    // Check if the item has expired
    if (now.getTime() > item.expiry) {
      localStorage.removeItem(key);
      return null;
    }
    
    return item.data;
  };

  useEffect(() => {
    const fetchSuggestions = async () => {
      if (!fplId || !gameweek) return;
      
      setIsLoading(true);
      setError('');
      
      // Create cache keys
      const cacheKey = `captaincy_${fplId}_${gameweek}`;
      const top10kCacheKey = `top10k_${gameweek}`;
      
      // Try to get data from cache first
      const cachedSuggestions = getFromCache(cacheKey);
      const cachedTop10k = getFromCache(top10kCacheKey);
      
      if (cachedSuggestions) {
        setSuggestions(cachedSuggestions);
        setIsLoading(false);
        return;
      }
      
      try {
        // Fetch both captaincy suggestions and top10k data in parallel
        const [suggestionsData, top10kData] = await Promise.all([
          fetchWithRetry(`http://localhost:5000/api/fpl/${fplId}/captaincy/${gameweek}${activeChip ? `?chip=${activeChip}` : ''}`),
          cachedTop10k || fetchWithRetry(`http://localhost:5000/api/fpl/top10k/${gameweek}`)
        ]);
        
        // Validate and cross-check EO values
        const validatedSuggestions = suggestionsData.map(player => ({
          ...player,
          eo: Number(player.eo) || Number(top10kData.top100k?.eoBreakdown[player.id]?.eo) || 0,
          score: activeChip === '3cap' ? player.score * 3 : player.score // Triple Captain adjustment
        }));
        
        setSuggestions(validatedSuggestions);
        
        // Cache the successful responses
        saveToCache(cacheKey, validatedSuggestions);
        if (!cachedTop10k) saveToCache(top10kCacheKey, top10kData);
      } catch (err) {
        setError(`Failed to load suggestions: ${err.message}`);
      } finally {
        setIsLoading(false);
        setIsRetrying(false);
      }
    };
    
    fetchSuggestions();
  }, [fplId, gameweek, activeChip]);

  return (
    <div className="bg-white p-6 rounded-lg shadow-md mb-6 border border-gray-100">
      <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
        <svg className="w-6 h-6 mr-2 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Captaincy Optimizer - GW {gameweek || 'N/A'} {activeChip === '3cap' && '(Triple Captain)'}
      </h3>

      {isLoading ? (
        <div className="text-center text-gray-600 animate-pulse">
          {isRetrying ? 'Retrying connection...' : 'Loading captaincy suggestions...'}
          <div className="mt-2 space-y-2">
            {Array(3).fill().map((_, i) => (
              <div key={i} className="bg-gray-200 h-12 rounded"></div>
            ))}
          </div>
        </div>
      ) : error ? (
        <div className="text-center text-red-500">{error}</div>
      ) : suggestions.length === 0 ? (
        <div className="text-center text-gray-600">No suggestions available yet.</div>
      ) : (
        <div className="space-y-4">
          <h4 className="text-md font-medium text-gray-700">Top Picks</h4>
          {suggestions.map((player, index) => (
            <div key={player.id} className="bg-gray-50 p-3 rounded-lg flex justify-between items-center">
              <div>
                <p className="font-medium text-gray-800">{index + 1}. {player.name}</p>
                <p className="text-sm text-gray-600">
                  Form: {player.form} | Difficulty: {player.difficulty} | EO: {player.eo}%
                </p>
              </div>
              <span className="text-xl font-bold text-green-600">{player.score}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CaptaincyOptimizer;