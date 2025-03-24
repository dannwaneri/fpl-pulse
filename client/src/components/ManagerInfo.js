import React, { useEffect, memo } from 'react';
import PropTypes from 'prop-types';

/**
 * ManagerInfo Component
 * Displays FPL manager information, statistics, and status
 */
const ManagerInfo = memo(({ 
  data, 
  totalLivePoints, 
  transferPenalty, 
  liveRank, 
  isLoading, 
  activeChip, 
  chipsUsed = [] 
}) => {
  // Dev-only logging
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('ManagerInfo re-rendered with data:', data);
    }
  }, [data, isLoading]);

  // Component states
  if (isLoading) {
    return <SkeletonLoadingState />;
  }

  if (!data) {
    return <NoDataState />;
  }

  // Format data
  const formattedRank = data.rank ? data.rank.toLocaleString() : 'N/A';
  const formattedLiveRank = liveRank ? liveRank.toLocaleString() : 'N/A';
  const rankChange = (data.rank && liveRank) ? data.rank - liveRank : null;
  
  // Determine rank change status and styling
  const rankChangeInfo = getRankChangeInfo(rankChange);
  
  // Check active chips
  const isFreeHitActive = activeChip === 'Free Hit';
  const isWildcardActive = activeChip === 'Wildcard';
  const wildcardCount = chipsUsed.filter(c => c === 'Wildcard').length;

  return (
    <div className="bg-gradient-to-br from-gray-800 to-gray-900 p-6 rounded-2xl shadow-xl border border-gray-700 mb-8 transition-all hover:shadow-2xl">
      {/* Manager Header Section */}
      <ManagerHeader 
        name={data.name} 
        teamName={data.teamName} 
        isFreeHitActive={isFreeHitActive} 
      />
      
      {/* Stats Grid */}
      <StatsGrid 
        totalPoints={data.totalPoints}
        formattedRank={formattedRank}
        formattedLiveRank={formattedLiveRank}
        rankChangeInfo={rankChangeInfo}
        totalLivePoints={totalLivePoints}
        transferPenalty={transferPenalty}
      />
      
      {/* Wildcard Status Section */}
      <WildcardStatus 
        isActive={isWildcardActive} 
        count={wildcardCount}
        currentGameweek={data.currentGameweek || 1} 
      />
      
      {/* Assistant Manager Section */}
      <AssistantManagerSection />
    </div>
  );
});

// ===== HELPER FUNCTIONS =====

/**
 * Helper to determine rank change information
 */
const getRankChangeInfo = (rankChange) => {
  if (rankChange === null) return { 
    icon: "M5 12h.01M12 12h.01M19 12h.01", 
    color: 'text-gray-400' 
  };
  
  if (rankChange > 0) {
    return { 
      icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6", 
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-900 bg-opacity-40',
      label: `↑ ${Math.abs(rankChange).toLocaleString()}`
    };
  }
  
  return { 
    icon: "M13 17h8m0 0V9m0 8l-8-8-4 4-6-6", 
    color: 'text-red-400',
    bgColor: 'bg-red-900 bg-opacity-40',
    label: `↓ ${Math.abs(rankChange).toLocaleString()}`
  };
};

// ===== COMPONENT PARTS =====

// Skeleton Loading State
const SkeletonLoadingState = () => (
  <div className="bg-gradient-to-br from-gray-800 to-gray-900 p-6 rounded-2xl shadow-xl border border-gray-700">
    <div className="flex items-center space-x-4 mb-6">
      <div className="w-16 h-16 bg-gray-700 rounded-full animate-pulse"></div>
      <div className="space-y-3 flex-1">
        <div className="h-6 bg-gray-700 rounded w-1/3 animate-pulse"></div>
        <div className="h-4 bg-gray-700 rounded w-1/4 animate-pulse"></div>
      </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-gray-700 rounded-lg p-4">
          <div className="h-4 bg-gray-600 rounded w-2/3 mb-3 animate-pulse"></div>
          <div className="h-6 bg-gray-600 rounded w-1/3 animate-pulse"></div>
        </div>
      ))}
    </div>
  </div>
);

// No Data State
const NoDataState = () => (
  <div className="bg-gradient-to-br from-gray-800 to-gray-900 p-6 rounded-2xl shadow-xl text-center border border-gray-700">
    <svg className="w-16 h-16 text-gray-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
    <p className="text-lg font-semibold text-gray-300">No manager data available</p>
    <p className="text-sm mt-2 text-gray-400">Please check your connection or try again later</p>
  </div>
);

// Manager Header Component
const ManagerHeader = memo(({ name, teamName, isFreeHitActive }) => (
  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
    <div className="flex items-center">
      <div className="w-16 h-16 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-2xl shadow-lg ring-2 ring-blue-500 ring-opacity-50">
        {name ? name.charAt(0).toUpperCase() : '?'}
      </div>
      <div className="ml-4">
        <h2 className="text-2xl font-bold text-white tracking-tight">
          {name || 'Manager Name Not Available'}
        </h2>
        {teamName && (
          <div className="text-sm text-gray-300 font-medium">{teamName}</div>
        )}
      </div>
    </div>
    <div className="flex flex-wrap gap-2">
      <span className="inline-flex items-center px-4 py-2 rounded-full text-sm font-medium bg-gray-800 text-gray-300 shadow-md border border-gray-700">
        <svg className="w-5 h-5 mr-2 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Season 2024/25
      </span>
      {isFreeHitActive && (
        <span className="inline-flex items-center px-4 py-2 rounded-full text-sm font-medium bg-cyan-800 text-cyan-100 shadow-md border border-cyan-700 animate-pulse">
          <svg className="w-5 h-5 mr-2 text-cyan-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Free Hit Active
        </span>
      )}
    </div>
  </div>
));

// Stats Grid Component
const StatsGrid = memo(({ 
  totalPoints, 
  formattedRank, 
  formattedLiveRank, 
  rankChangeInfo,
  totalLivePoints,
  transferPenalty
}) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
    <StatCard 
      title="Season Points"
      value={totalPoints !== undefined ? totalPoints : 'N/A'}
      icon="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6m6 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
      colorFrom="blue-700"
      colorTo="blue-800"
      borderColor="blue-600"
      iconColor="blue-300"
    />
    
    <StatCard 
      title="Season Rank"
      value={formattedRank}
      icon="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
      colorFrom="emerald-700"
      colorTo="emerald-800"
      borderColor="emerald-600"
      iconColor="emerald-300"
    />
    
    <StatCard 
      title="Live Rank"
      value={formattedLiveRank}
      icon={rankChangeInfo.icon}
      colorFrom="indigo-700"
      colorTo="indigo-800"
      borderColor="indigo-600"
      iconColor="indigo-300"
      extra={
        rankChangeInfo.label && (
          <span className={`ml-3 px-2 py-1 text-sm font-medium ${rankChangeInfo.color} ${rankChangeInfo.bgColor} rounded-lg`}>
            {rankChangeInfo.label}
          </span>
        )
      }
    />
    
    <StatCard 
      title="Gameweek Points"
      value={totalLivePoints !== undefined ? totalLivePoints : 'N/A'}
      icon="M13 10V3L4 14h7v7l9-11h-7z"
      colorFrom="amber-700"
      colorTo="amber-800"
      borderColor="amber-600"
      iconColor="amber-300"
      extra={
        transferPenalty < 0 && (
          <span className="ml-3 px-2 py-1 text-xs bg-red-500 text-white rounded-full flex items-center shadow-md">
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 12H4" />
            </svg>
            {transferPenalty}
          </span>
        )
      }
    />
  </div>
));

// Stat Card Component
const StatCard = memo(({ 
  title, 
  value, 
  icon, 
  colorFrom, 
  colorTo, 
  borderColor, 
  iconColor,
  extra
}) => (
  <div className={`bg-gradient-to-r from-${colorFrom} to-${colorTo} rounded-lg p-4 border border-${borderColor} shadow-md hover:shadow-lg transition-shadow`}>
    <div className="flex items-center mb-3">
      <svg className={`w-6 h-6 text-${iconColor} mr-2`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={icon} />
      </svg>
      <p className="text-sm font-medium text-white opacity-90">{title}</p>
    </div>
    <div className="flex items-baseline">
      <span className="text-3xl font-bold text-white">{value}</span>
      {extra}
    </div>
  </div>
));

// Wildcard Status Component
const WildcardStatus = memo(({ isActive, count, currentGameweek }) => {
  // If we're past gameweek 20 and count is 0, it means the first wildcard expired unused
  const isFirstWildcardExpired = currentGameweek > 20;
  const displayedCount = isFirstWildcardExpired && count === 0 ? 1 : count;
  
  return (
    <div className="mt-4 flex justify-center">
      <span className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-medium shadow-md ${
        isActive ? 'bg-green-500 text-white' : 'bg-gray-800 text-gray-300'
      }`}>
        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 14l-7-7m0 0l-7 7m7-7V3" />
        </svg>
        {isActive ? 'Wildcard Active' : `Wildcards Used: ${displayedCount}/2`}
      </span>
    </div>
  );
});

// Assistant Manager Section Component
const AssistantManagerSection = memo(() => (
  <div className="mt-6 p-4 rounded-xl bg-black bg-opacity-30 border border-gray-700 transition-all hover:bg-opacity-40">
    <div className="flex flex-col sm:flex-row items-center">
      <div className="mr-3 flex-shrink-0">
        <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      </div>
      <div className="mt-2 sm:mt-0 text-center sm:text-left">
        <h3 className="text-lg font-bold text-white">Assistant Manager</h3>
        <p className="text-sm text-gray-300">Get AI insights for your team before the deadline</p>
      </div>
      <button 
        className="ml-auto mt-3 sm:mt-0 bg-gradient-to-r from-cyan-500 to-blue-500 text-white px-4 py-2 rounded-lg shadow hover:from-cyan-600 hover:to-blue-600 transition duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-opacity-50"
        aria-label="Get AI advice for your team"
      >
        <span className="flex items-center">
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          Get Advice
        </span>
      </button>
    </div>
  </div>
));

// PropTypes
ManagerInfo.propTypes = {
  data: PropTypes.shape({
    name: PropTypes.string,
    teamName: PropTypes.string,
    totalPoints: PropTypes.number,
    rank: PropTypes.number
  }),
  totalLivePoints: PropTypes.number,
  transferPenalty: PropTypes.number,
  liveRank: PropTypes.number,
  isLoading: PropTypes.bool,
  activeChip: PropTypes.string,
  chipsUsed: PropTypes.arrayOf(PropTypes.string)
};

ManagerInfo.defaultProps = {
  data: null,
  totalLivePoints: undefined,
  transferPenalty: 0,
  liveRank: undefined,
  isLoading: false,
  activeChip: null,
  chipsUsed: []
};

export default ManagerInfo;