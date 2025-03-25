import React, { memo } from 'react';
import useFplData from './hooks/useFplData';
import Header from './components/Header';
import ManagerInfo from './components/ManagerInfo';
import PicksTable from './components/PicksTable';
import LeagueStandings from './components/LeagueStandings';
import TransferPlanner from './components/TransferPlanner'
import Top10kStats from './components/Top10kStats';
import WhatIfRankSimulator from './components/WhatIfRankSimulator';
import PlayerComparisonTool from './components/PlayerComparisonTool';
import CaptaincyOptimizer from './components/CaptaincyOptimizer';

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


 console.log('App state:', { 
   fplId, 
   currentGameweek, 
   picks: safePicks.length, 
   activeChip, 
   assistantManagerPoints 
 }); // Debug log

// Extract threats from top10kStats (assuming it's available from a parent component or context)
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
        {/* Add this to display loading/error state */}
        <div className="bg-white p-6 rounded-lg shadow-md mb-4 text-center">
          <h2 className="text-xl font-bold mb-2">FPL Pulse Status</h2>
          <p className="text-gray-700">
            {isLoading ? 'Loading data...' : error ? `Error: ${error}` : 'Ready to load your team!'}
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <input
            type="text"
            value={fplId}
            onChange={(e) => setFplId(e.target.value)}
            placeholder="Enter your FPL ID"
            className="flex-1 p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-green-400"
          />
          <button
            onClick={fetchData}
            className="bg-green-500 text-white p-3 rounded-lg shadow hover:bg-green-600 transition"
          >
            Load Team
          </button>
          <button
            onClick={refreshLiveData}
            className="bg-teal-500 text-white p-3 rounded-lg shadow hover:bg-teal-600 transition disabled:bg-gray-400 disabled:cursor-not-allowed"
            disabled={!data}
          >
            Refresh
          </button>
        </div>

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
        {currentGameweek && (
          <CaptaincyOptimizer fplId={fplId} gameweek={currentGameweek} />
        )}
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
        <TransferPlanner
          plannerData={plannerData}
          fplId={fplId}
          isLoading={isLoading}
          activeChip={activeChip}
          assistantManager={assistantManager}
        />
        {plannerData && (
          <PlayerComparisonTool plannerData={plannerData} currentSquad={safePicks} />
        )}
       {data && currentGameweek && (
          <Top10kStats
            gameweek={currentGameweek}
            isLoading={isLoading}
            userPicks={safePicks}
          />
        )}
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

        {error && <p className="mt-4 text-red-500 text-center">{error}</p>}
      </div>
    </div>
  );
});

export default App;