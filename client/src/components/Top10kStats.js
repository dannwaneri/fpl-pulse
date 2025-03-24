import React, { useState, useEffect, useCallback, memo } from 'react';
import { getApiUrl } from '../utils/apiConfig';

const Top10kStats = memo(({ gameweek, isLoading, userPicks, activeChip }) => {
  const [stats, setStats] = useState(null);
  const [loadingStage, setLoadingStage] = useState('Initializing');
  const [error, setError] = useState('');
  const [selectedTier, setSelectedTier] = useState('top10k');
  const [isRetrying, setIsRetrying] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Helper function for exponential backoff retry
  const fetchWithRetry = async (url, maxRetries = 3) => {
    let retries = 0;
    let lastError;

    while (retries < maxRetries) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed with status: ${response.status}`);
        return await response.json();
      } catch (err) {
        lastError = err;
        retries++;
        if (retries < maxRetries) {
          setIsRetrying(true);
          const delay = Math.pow(2, retries) * 500;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    setIsRetrying(false);
    throw lastError;
  };

  // Helper function to save data to localStorage with TTL
  const saveToCache = (key, data, ttl = 24 * 60 * 60 * 1000) => { // 24-hour TTL
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

  const refreshData = useCallback(async (forceRefresh = false) => {
    if (!gameweek) return;
    
    try {
      setLoadingStage('Fetching league data');
      
      // Create a cache key for top10k stats
      const cacheKey = `top10k_stats_${gameweek}`;
      
      // Try to get data from cache first if not forcing refresh
      if (!forceRefresh) {
        const cachedData = getFromCache(cacheKey);
        if (cachedData) {
          setStats(cachedData);
          setLastUpdated(new Date(cachedData.timestamp || Date.now()));
          setLoadingStage('Initializing');
          setError('');
          return;
        }
      }
      
      // If no cache or forcing refresh, fetch from API
      const data = await fetchWithRetry(getApiUrl(`/api/fpl/top10k/${gameweek}${forceRefresh ? '?refresh=true' : ''}`));
      
      setLoadingStage('Processing top managers');
      setStats(data);
      setLastUpdated(new Date());
      setError('');
      setIsRetrying(false);
      
      // Cache the successful response
      saveToCache(cacheKey, {...data, timestamp: Date.now()});
    } catch (err) {
      console.error('Error fetching top stats:', err.message);
      setError(err.message);
      setStats(null);
      setIsRetrying(false);
      setLoadingStage('Initializing');
    }
  }, [gameweek]);

  useEffect(() => {
    if (!isLoading && gameweek) refreshData();
  }, [gameweek, isLoading, refreshData]);

  // Combined loading/error states
  if (isLoading || loadingStage !== 'Initializing') 
    return (
      <div className="bg-white p-6 rounded-lg shadow-md mb-6">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
          <div className="h-6 bg-gray-200 rounded w-1/2 mb-4"></div>
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-4 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-2">
          {isLoading ? 'Loading top stats...' : loadingStage}
        </p>
      </div>
    );
  if (isRetrying) 
    return <div className="bg-white p-6 rounded-lg shadow-md mb-6">Connection issue. Retrying...</div>;
  if (error) 
    return <div className="bg-white p-6 rounded-lg shadow-md mb-6 text-red-500">Error: {error}</div>;
  if (!stats || !gameweek) 
    return <div className="bg-white p-6 rounded-lg shadow-md mb-6">No top stats available for GW {gameweek || 'unknown'}</div>;

  const currentStats = stats[selectedTier] || { averagePoints: 0, topPlayers: [], formations: {}, eoBreakdown: {} };
  const userPickIds = userPicks ? userPicks.map(p => p.playerId) : [];
  
  const threats = currentStats.eoBreakdown && Object.keys(currentStats.eoBreakdown).length > 0
    ? Object.entries(currentStats.eoBreakdown)
        .filter(([id]) => !userPickIds.includes(parseInt(id)))
        .sort(([, a], [, b]) => parseFloat(b.eo) - parseFloat(a.eo))
        .slice(0, 5)
    : [];

  const renderPaginatedList = (items, renderItem, emptyMessage) => {
    if (!items || items.length === 0) return <p className="text-gray-600">{emptyMessage}</p>;
    return <div className="space-y-2">{items.map(renderItem)}</div>;
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md mb-6 border border-gray-100">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-800">Top Managers Stats {activeChip && `(${activeChip})`}</h3>
        <div className="flex items-center space-x-2">
          <select
            value={selectedTier}
            onChange={(e) => setSelectedTier(e.target.value)}
            className="border rounded p-1 text-sm"
          >
            <option value="top1k">Top 1k</option>
            <option value="top10k">Top 10k</option>
            <option value="top100k">Top 100k</option>
            <option value="top1m">Top 1M</option>
          </select>
          <button 
            onClick={() => refreshData(true)} 
            className="ml-2 p-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
            title="Refresh data"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>
      
      {lastUpdated && (
        <div className="text-xs text-gray-500 -mt-3 mb-3">
          Last updated: {lastUpdated.toLocaleString()}
        </div>
      )}

      <div className="bg-purple-50 p-3 rounded-lg mb-4 flex items-center justify-center">
        <div className="text-center">
          <span className="text-2xl font-bold text-purple-700">
            {typeof currentStats.averagePoints === 'number' ? currentStats.averagePoints.toFixed(1) : 'N/A'}
          </span>
          <p className="text-sm text-gray-600">Average Points {activeChip === 'bboost' && '(Bench Boost)'}</p>
        </div>
      </div>

      <div className="mb-4">
        <h4 className="text-md font-medium text-gray-700 mb-2">Top 10 EO Players</h4>
        {renderPaginatedList(
          currentStats.topPlayers,
          (player) => (
            <div key={player.id} className="flex justify-between bg-gray-50 p-2 rounded">
              <span className="font-medium">{player.name}</span>
              <span className="text-purple-700 font-medium">EO: {player.eo}%</span>
            </div>
          ),
          "No player data available."
        )}
      </div>

      <div className="mb-4">
        <h4 className="text-md font-medium text-gray-700 mb-2">Popular Formations</h4>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(currentStats.formations || {})
            .sort(([, countA], [, countB]) => countB - countA)
            .map(([formation, count]) => (
              <div key={formation} className="bg-gray-50 p-2 rounded text-center">
                <div className="font-medium">{formation}</div>
                <div className="text-sm text-gray-600">{count} teams</div>
              </div>
            ))}
        </div>
      </div>

      {userPicks && (
        <div>
          <h4 className="text-md font-medium text-gray-700 mb-2">Threats (High EO You Don't Own)</h4>
          {renderPaginatedList(
            threats,
            ([id, { name, eo }]) => (
              <div key={id} className="flex justify-between bg-red-50 p-2 rounded">
                <span className="font-medium">{name}</span>
                <span className="text-red-700 font-medium">EO: {eo}%</span>
              </div>
            ),
            "No significant threats identified."
          )}
        </div>
      )}
    </div>
  );
});

export default Top10kStats;