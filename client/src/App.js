import React, { lazy, Suspense, memo } from 'react';
import useFplData from './hooks/useFplData';
import Header from './components/Header';
import ManagerInfo from './components/ManagerInfo';
import PicksTable from './components/PicksTable';

// Lazy load non-essential components
const LeagueStandings = lazy(() => import('./components/LeagueStandings'));
const TransferPlanner = lazy(() => import('./components/TransferPlanner'));
const Top10kStats = lazy(() => import('./components/Top10kStats'));
const WhatIfRankSimulator = lazy(() => import('./components/WhatIfRankSimulator'));
const PlayerComparisonTool = lazy(() => import('./components/PlayerComparisonTool'));
const CaptaincyOptimizer = lazy(() => import('./components/CaptaincyOptimizer'));

// Loading placeholder
const ComponentLoader = () => (
  <div className="bg-white p-6 rounded-lg shadow-md mb-6 animate-pulse">
    <div className="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
    <div className="h-24 bg-gray-100 rounded mb-3"></div>
    <div className="h-12 bg-gray-200 rounded"></div>
  </div>
);

const App = memo(() => {
  const {
    fplId,
    setFplId,
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
    currentGameweek,
    isLoading,
    fetchData,
    refreshLiveData,
    handleLeagueChange,
    top10kStats,
    activeChip,
    assistantManagerPoints,
    assistantManager
  } = useFplData();

  const safePicks = picks || [];

  // Extract threats from top10kStats
  const threats = top10kStats?.top10k?.eoBreakdown
    ? Object.entries(top10kStats.top10k.eoBreakdown)
        .filter(([id]) => !picks.some(p => p.playerId === parseInt(id)))
        .sort(([, a], [, b]) => b.eo - a.eo)
        .slice(0, 5)
    : [];

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center py-8 px-4 font-sans">
      <Header />
      <div className="w-full max-w-4xl">
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <input
            type="text"
            value={fplId}
            onChange={(e) => setFplId(e.target.value)}
            placeholder="Enter your FPL ID"
            className="flex-1 p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-green-400"
            aria-label="FPL ID"
          />
          <button
            onClick={fetchData}
            className="bg-green-500 text-white p-3 rounded-lg shadow hover:bg-green-600 transition"
            disabled={isLoading}
          >
            {isLoading ? 'Loading...' : 'Load Team'}
          </button>
          <button
            onClick={refreshLiveData}
            className="bg-teal-500 text-white p-3 rounded-lg shadow hover:bg-teal-600 transition disabled:bg-gray-400 disabled:cursor-not-allowed"
            disabled={!data || isLoading}
          >
            Refresh
          </button>
        </div>

        {/* Critical UI components load immediately */}
        <ManagerInfo
          data={data}
          totalLivePoints={totalLivePoints}
          transferPenalty={transferPenalty}
          liveRank={liveRank}
          isLoading={isLoading}
          picks={picks}
          activeChip={activeChip}
          assistantManagerPoints={assistantManagerPoints}
          assistantManager={assistantManager}
        />
        <PicksTable
          picks={safePicks}
          lastUpdated={lastUpdated}
          autosubs={autosubs}
          viceCaptainPoints={viceCaptainPoints}
          isLoading={isLoading}
          liveRank={liveRank}
          totalLivePoints={totalLivePoints}
          top10kStats={top10kStats}
          activeChip={activeChip}
          assistantManagerPoints={assistantManagerPoints}
          assistantManager={assistantManager}
          currentGameweek={currentGameweek}
        />

        {/* Lazy-loaded components with Suspense fallbacks */}
        <Suspense fallback={<ComponentLoader />}>
          {currentGameweek && (
            <CaptaincyOptimizer fplId={fplId} gameweek={currentGameweek} />
          )}
        </Suspense>

        <Suspense fallback={<ComponentLoader />}>
          {data && (
            <LeagueStandings
              data={data}
              leagueData={leagueData}
              selectedLeague={selectedLeague}
              handleLeagueChange={handleLeagueChange}
              fplId={fplId}
              error={error}
              isLoading={isLoading}
              activeChip={activeChip}
              assistantManagerPoints={assistantManagerPoints}
            />
          )}
        </Suspense>

        <Suspense fallback={<ComponentLoader />}>
          <TransferPlanner
            plannerData={plannerData}
            fplId={fplId}
            isLoading={isLoading}
            activeChip={activeChip}
            assistantManager={assistantManager}
          />
        </Suspense>

        <Suspense fallback={<ComponentLoader />}>
          {plannerData && (
            <PlayerComparisonTool plannerData={plannerData} currentSquad={safePicks} />
          )}
        </Suspense>

        <Suspense fallback={<ComponentLoader />}>
          {data && currentGameweek && (
            <Top10kStats
              gameweek={currentGameweek}
              isLoading={isLoading}
              userPicks={safePicks}
            />
          )}
        </Suspense>

        <Suspense fallback={<ComponentLoader />}>
          <WhatIfRankSimulator
            fplId={fplId}
            gameweek={currentGameweek}
            currentLivePoints={totalLivePoints}
            currentRank={liveRank}
            picks={picks}
            threats={threats}
            isLoading={isLoading}
            activeChip={activeChip}
            assistantManagerPoints={assistantManagerPoints}
          />
        </Suspense>

        {error && <p className="mt-4 text-red-500 text-center">{error}</p>}
      </div>
    </div>
  );
});

export default App;