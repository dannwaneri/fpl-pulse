import React, { memo, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import PropTypes from 'prop-types';



const STAT_ICONS = {
  goal: '⚽',
  assist: '🎯',
  clean_sheet: '🛡️',
  save: '🧤',
  yellow_card: '🟨',
  red_card: '🟥',
  own_goal: '😩',
  penalty_saved: '🚫',
  penalty_missed: '❌',
  bonus: '🌟'
};
// Bonus Icon Helper
const getBonusIcon = (points) => {
  const bonusEmojis = {
    1: '1️⃣',
    2: '2️⃣',
    3: '3️⃣',
  };
  return bonusEmojis[points] || `${points}`;
};



// Jersey Image Functions
export const getJerseyImage = (teamShortName) => {
  const jerseyUrls = {
    ARS: '/assets/jerseys/arsenal.png',
    AVL: '/assets/jerseys/aston-villa.png',
    BHA: '/assets/jerseys/brighton.png',
    BOU: '/assets/jerseys/bournemouth.png',
    BRE: '/assets/jerseys/brentford.png',
    LEI: '/assets/jerseys/leicester.png',
    CHE: '/assets/jerseys/chelsea.png',
    CRY: '/assets/jerseys/crystal-palace.png',
    EVE: '/assets/jerseys/everton.png',
    FUL: '/assets/jerseys/fulham.png',
    LIV: '/assets/jerseys/liverpool.png',
    SOU: '/assets/jerseys/southampton.png',
    MCI: '/assets/jerseys/man-city.png',
    MUN: '/assets/jerseys/man-utd.png',
    NEW: '/assets/jerseys/newcastle.png',
    NFO: '/assets/jerseys/nottingham.png',
    IPS: '/assets/jerseys/ipswich.png',
    TOT: '/assets/jerseys/tottenham.png',
    WHU: '/assets/jerseys/west-ham.png',
    WOL: '/assets/jerseys/wolves.png',
  };
  return jerseyUrls[teamShortName] || '/assets/jerseys/default.png';
};

export const handleJerseyError = (event) => {
  event.target.src = '/assets/jerseys/default.png';
};

// Constants
const POSITION_COLORS = {
  GK: 'bg-yellow-500',
  DEF: 'bg-blue-500',
  MID: 'bg-green-500',
  FWD: 'bg-red-500',
};

const ANIMATIONS = {
  player: { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.3 } }, exit: { opacity: 0, y: -20, transition: { duration: 0.3 } } },
  points: { animate: { scale: [1, 1.1, 1], transition: { duration: 0.5, repeat: 1 } } },
  autoSub: { initial: { opacity: 0, x: -20 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: 20 }, transition: { duration: 0.5 } },
  details: { initial: { height: 0, opacity: 0 }, animate: { height: 'auto', opacity: 1 }, exit: { height: 0, opacity: 0 }, transition: { duration: 0.3 } },
  differential: { initial: { opacity: 0, scale: 0.9 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 0.3 } },
  threat: { initial: { opacity: 0, x: 20 }, animate: { opacity: 1, x: 0 }, transition: { duration: 0.4 } },
};

// Custom Hook to Categorize Player Data
const useCategorizedData = (picks, top10kStats, currentGameweek) => {
  return useMemo(() => {
    if (!picks?.length) {
      console.log('No picks provided');
      return { categorizedPicks: { gks: [], defs: [], mids: [], fwds: [], bench: [] }, differentials: [], threats: [] };
    }

    console.log('Picks before categorization:', picks);

    const positionTypes = picks.map(p => ({ 
      id: p.playerId, 
      name: p.name, 
      posType: p.positionType, 
      multiplier: p.multiplier 
    }));
    console.log('Position types:', positionTypes);

    const categorizedPicks = {
      gks: picks.filter((p) => {
        const isGk = p.positionType === 'GK' || 
                   p.positionType === 'GKP' || 
                   p.positionType?.toLowerCase() === 'gk' ||
                   p.positionType?.toLowerCase().includes('goal');
        const isStarter = p.multiplier > 0;
        return isGk && isStarter;
      }),
      defs: picks.filter((p) => {
        const isDef = p.positionType === 'DEF' || 
                    p.positionType?.toLowerCase() === 'def' ||
                    p.positionType?.toLowerCase().includes('defend');
        const isStarter = p.multiplier > 0;
        return isDef && isStarter;
      }),
      mids: picks.filter((p) => {
        const isMid = p.positionType === 'MID' || 
                    p.positionType?.toLowerCase() === 'mid' ||
                    p.positionType?.toLowerCase().includes('mid');
        const isStarter = p.multiplier > 0;
        return isMid && isStarter;
      }),
      fwds: picks.filter((p) => {
        const isFwd = p.positionType === 'FWD' || 
                    p.positionType?.toLowerCase() === 'fwd' ||
                    p.positionType?.toLowerCase().includes('forw');
        const isStarter = p.multiplier > 0;
        return isFwd && isStarter;
      }),
      bench: picks.filter((p) => p.multiplier === 0),
    };

    console.log('Categorized picks result:', {
      gksCount: categorizedPicks.gks.length,
      defsCount: categorizedPicks.defs.length,
      midsCount: categorizedPicks.mids.length,
      fwdsCount: categorizedPicks.fwds.length,
      benchCount: categorizedPicks.bench.length
    });

    if (categorizedPicks.gks.length === 0) {
      console.warn('No goalkeepers found after categorization!');
      const possibleGks = picks.filter(p => 
        p.positionType === 'GK' || 
        p.positionType === 'GKP' || 
        p.positionType?.toLowerCase() === 'gk' ||
        p.positionType?.toLowerCase().includes('goal')
      );
      console.log('Possible goalkeepers with any multiplier:', possibleGks);
    }

    const differentials = picks.filter((p) => p.isDifferential);
    const threats = top10kStats?.top10k?.eoBreakdown
      ? Object.entries(top10kStats.top10k.eoBreakdown)
          .filter(([id]) => !picks.some((p) => p.playerId === parseInt(id)))
          .map(([id, { name, eo, teamShortName }]) => {
            const liveStats = global.liveDataCache?.[currentGameweek]?.find(el => el.id === parseInt(id))?.stats || {};
            return [id, { name, eo, teamShortName, livePoints: liveStats.total_points || 0 }];
          })
          .sort(([, a], [, b]) => b.eo - a.eo)
          .slice(0, 5)
      : [];

    return { categorizedPicks, differentials, threats };
  }, [picks, top10kStats, currentGameweek]);
};

// Main Component
const PicksTable = memo(({ picks, lastUpdated, autosubs, viceCaptainPoints, isLoading, liveRank, totalLivePoints, top10kStats, activeChip, currentGameweek }) => {
  console.log('Picks received in PicksTable (detailed):', JSON.stringify(picks, null, 2))
  const { categorizedPicks, differentials, threats } = useCategorizedData(picks, top10kStats, currentGameweek || 1);
  const isBenchBoost = activeChip === 'Bench Boost';
  
  // Find the player with highest points
  const highestPointsPlayer = picks?.length ? picks.reduce((max, pick) => 
    (pick.livePoints || 0) > (max?.livePoints || 0) ? pick : max, picks[0]) : null;

  if (isLoading) return <LoadingState />;
  if (!picks?.length) return <EmptyState />;

  return (
    <div className="bg-gradient-to-br from-green-700 to-green-900 p-4 sm:p-6 rounded-xl shadow-xl border-2 border-white transition-all duration-300 hover:shadow-2xl">
      <Header lastUpdated={lastUpdated} liveRank={liveRank} totalLivePoints={totalLivePoints} activeChip={activeChip} />
      <FieldView categorizedPicks={categorizedPicks} highestPointsPlayer={highestPointsPlayer} />
      <BenchSection bench={categorizedPicks.bench} isBenchBoost={isBenchBoost} highestPointsPlayer={highestPointsPlayer} />
      {autosubs.length > 0 && <AutoSubsSection autosubs={autosubs} picks={picks} />}
      {viceCaptainPoints > 0 && <ViceCaptainSection points={viceCaptainPoints} />}
      {differentials.length > 0 && <DifferentialsSection differentials={differentials} />}
      {threats.length > 0 && <ThreatsSection threats={threats} />}
      <Legend />
    </div>
  );
});

// Component Parts
const LoadingState = () => (
  <div className="bg-gradient-to-br from-green-700 to-green-900 p-6 rounded-xl shadow-lg animate-pulse border-2 border-white">
    <div className="h-6 bg-gray-300 rounded w-1/4 mb-4"></div>
    <div className="grid grid-cols-2 gap-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-20 bg-gray-300 rounded"></div>
      ))}
    </div>
  </div>
);

const EmptyState = () => (
  <div className="bg-gradient-to-br from-green-700 to-green-900 p-6 rounded-xl shadow-lg text-center text-white border-2 border-white">
    <p className="text-lg font-semibold">No lineup data available</p>
    <p className="text-sm mt-2">Enter your FPL ID to see your squad!</p>
  </div>
);

const Header = memo(({ lastUpdated, liveRank, totalLivePoints, activeChip }) => (
  <div className="mb-6 flex flex-col sm:flex-row justify-between items-center">
    <h3 className="text-2xl font-extrabold text-white drop-shadow-md">
      <span className="text-green-400">FPL</span>Pulse
      {activeChip && <ChipBadge type={activeChip} />}
    </h3>
    <div className="flex flex-wrap gap-3 mt-2 sm:mt-0">
      {totalLivePoints !== undefined && (
        <div className="bg-black bg-opacity-60 rounded-full px-4 py-1 flex items-center">
          <span className="text-white text-sm mr-2">GW Points:</span>
          <span className="text-green-400 font-bold">{totalLivePoints}</span>
        </div>
      )}
      {liveRank && (
        <div className="bg-black bg-opacity-60 rounded-full px-4 py-1 flex items-center">
          <span className="text-white text-sm mr-2">Live Rank:</span>
          <span className="text-green-400 font-bold">{liveRank.toLocaleString()}</span>
        </div>
      )}
      {lastUpdated && (
        <span className="text-sm text-white bg-black bg-opacity-50 rounded-full px-3 py-1">
          Updated: {lastUpdated.toLocaleTimeString()}
        </span>
      )}
    </div>
  </div>
));

const ChipBadge = ({ type }) => {
  if (type === 'Wildcard') {
    return (
      <span className="ml-2 text-sm bg-green-500 text-white px-2 py-1 rounded-full shadow-md animate-pulse">
        <svg className="w-4 h-4 mr-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 14l-7-7m0 0l-7 7m7-7V3" />
        </svg>
        Wildcard Active
      </span>
    );
  }
  return <span className="ml-2 text-sm bg-blue-500 text-white px-2 py-1 rounded-full shadow-md">{type}</span>;
};

const FieldBackground = memo(() => (
  <div className="absolute inset-0 opacity-80">
    <div className="border-2 border-white border-opacity-60 rounded-xl w-full h-full bg-green-600"></div>
    <div className="w-20 h-20 sm:w-24 sm:h-24 border-2 border-white border-opacity-60 rounded-full absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"></div>
    <div className="border-t-2 border-white border-opacity-60 w-full absolute top-1/2 transform -translate-y-1/2"></div>
    <div className="border-2 border-white border-opacity-60 rounded-lg w-1/3 h-1/4 absolute top-0 left-1/2 transform -translate-x-1/2"></div>
    <div className="border-2 border-white border-opacity-60 rounded-lg w-1/3 h-1/4 absolute bottom-0 left-1/2 transform -translate-x-1/2"></div>
    <div className="border-2 border-white border-opacity-60 w-1/6 h-1/12 absolute top-0 left-1/2 transform -translate-x-1/2"></div>
    <div className="border-2 border-white border-opacity-60 w-1/6 h-1/12 absolute bottom-0 left-1/2 transform -translate-x-1/2"></div>
  </div>
));

const PlayerCard = memo(({ pick, color, isBench = false, isBenchBoost = false, isHighestPoints = false }) => {
  const isCaptain = pick.multiplier === 2;
  const isTripleCaptain = pick.multiplier === 3;
  const isViceCaptain = pick.multiplier === 1 && pick.viceCaptainPoints > 0;
  const hasPoints = pick.livePoints > 0;
  const isDifferential = pick.isDifferential;

  // Team-specific styling
  const teamStyles = {
    ARS: { glow: 'drop-shadow(0 0 8px rgba(239, 1, 7, 0.5))', underline: 'border-red-600', ring: 'ring-red-600' },
    AVL: { glow: 'drop-shadow(0 0 8px rgba(149, 206, 255, 0.5))', underline: 'border-sky-300', ring: 'ring-sky-300' },
    BHA: { glow: 'drop-shadow(0 0 8px rgba(0, 87, 184, 0.5))', underline: 'border-blue-700', ring: 'ring-blue-700' },
    BOU: { glow: 'drop-shadow(0 0 8px rgba(218, 41, 28, 0.5))', underline: 'border-red-500', ring: 'ring-red-500' },
    BRE: { glow: 'drop-shadow(0 0 8px rgba(227, 6, 19, 0.5))', underline: 'border-red-600', ring: 'ring-red-600' },
    LEI: { glow: 'drop-shadow(0 0 8px rgba(0, 53, 102, 0.5))', underline: 'border-blue-800', ring: 'ring-blue-800' },
    CHE: { glow: 'drop-shadow(0 0 8px rgba(3, 70, 148, 0.5))', underline: 'border-blue-600', ring: 'ring-blue-600' },
    CRY: { glow: 'drop-shadow(0 0 8px rgba(27, 69, 143, 0.5))', underline: 'border-blue-700', ring: 'ring-blue-700' },
    EVE: { glow: 'drop-shadow(0 0 8px rgba(0, 47, 108, 0.5))', underline: 'border-blue-900', ring: 'ring-blue-900' },
    FUL: { glow: 'drop-shadow(0 0 8px rgba(255, 255, 255, 0.5))', underline: 'border-white', ring: 'ring-white' },
    LIV: { glow: 'drop-shadow(0 0 8px rgba(200, 16, 46, 0.5))', underline: 'border-red-500', ring: 'ring-red-500' },
    SOU: { glow: 'drop-shadow(0 0 8px rgba(215, 0, 0, 0.5))', underline: 'border-red-600', ring: 'ring-red-600' },
    MCI: { glow: 'drop-shadow(0 0 8px rgba(108, 195, 244, 0.5))', underline: 'border-sky-300', ring: 'ring-sky-300' },
    MUN: { glow: 'drop-shadow(0 0 8px rgba(255, 0, 0, 0.5))', underline: 'border-red-600', ring: 'ring-red-600' },
    NEW: { glow: 'drop-shadow(0 0 8px rgba(0, 0, 0, 0.5))', underline: 'border-black', ring: 'ring-black' },
    NFO: { glow: 'drop-shadow(0 0 8px rgba(221, 0, 0, 0.5))', underline: 'border-red-600', ring: 'ring-red-600' },
    IPS: { glow: 'drop-shadow(0 0 8px rgba(0, 56, 149, 0.5))', underline: 'border-blue-700', ring: 'ring-blue-700' },
    TOT: { glow: 'drop-shadow(0 0 8px rgba(255, 255, 255, 0.5))', underline: 'border-white', ring: 'ring-white' },
    WHU: { glow: 'drop-shadow(0 0 8px rgba(115, 37, 61, 0.5))', underline: 'border-maroon-700', ring: 'ring-maroon-700' },
    WOL: { glow: 'drop-shadow(0 0 8px rgba(253, 185, 19, 0.5))', underline: 'border-yellow-500', ring: 'ring-yellow-500' },
  };
  const teamStyle = pick.teamShortName && teamStyles[pick.teamShortName] 
    ? teamStyles[pick.teamShortName] 
    : { glow: '', underline: 'border-gray-400', ring: 'ring-gray-400' };

    // PlayerCard Component - Updated getPlayerStats Function
const getPlayerStats = () => {
  if (!pick.events || !Array.isArray(pick.events)) {
    return { bonusIcon: null, statIcons: [] };
  }
  
  let bonusIcon = null;
  const statIcons = [];
  
  pick.events.forEach(event => {
    if (!event || !event.type) return;
    
    // Normalize the event type
    const type = event.type.toLowerCase().replace(/\s+/g, '_');
    
    // Handle bonus points separately
    if (type === 'bonus') {
      const points = parseInt(event.points || event.value || 0);
      if (points > 0) {
        bonusIcon = getBonusIcon(points);
      }
      return;
    }
    
    // Get the appropriate icon for other stats
    const icon = STAT_ICONS[type];
    if (!icon) return;
    
    // Add multiple icons based on occurrences (except for goals, which already works this way)
    const count = Math.max(1, parseInt(event.count || event.value || 1));
for (let i = 0; i < count; i++) {
  statIcons.push(icon);
}
  });
  
  return { bonusIcon, statIcons };
};
    const { bonusIcon, statIcons } = getPlayerStats();
  return (
    <motion.div
      variants={ANIMATIONS.player}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={`relative ${isBench ? 'w-24' : 'w-28'} bg-transparent flex flex-col items-center rounded-lg overflow-hidden transition-all duration-200 hover:scale-105`}
    >
      {/* Jersey Container */}
      <div className="relative w-16 h-20 flex justify-center items-center">
        {pick.teamShortName ? (
          <img
            src={getJerseyImage(pick.teamShortName)}
            alt={`${pick.teamShortName} jersey`}
            onError={handleJerseyError}
            className={`w-full h-full object-contain filter ${teamStyle.glow} transition-transform duration-300 hover:brightness-110`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-200 rounded-t-lg">
            <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
            </svg>
          </div>
        )}

        {/* Captain/Triple Captain/Vice-Captain Badges */}
        {(isCaptain || isTripleCaptain || isViceCaptain) && (
          <span
            className={`absolute top-0 right-0 w-6 h-6 flex items-center justify-center text-xs font-bold rounded-full shadow-md ${
              isTripleCaptain ? 'bg-yellow-500 ring-2 ring-yellow-300 animate-pulse' : isCaptain ? 'bg-green-500' : 'bg-gray-500'
            } text-white transform translate-x-2 -translate-y-2`}
            aria-label={isTripleCaptain ? 'Triple Captain' : isCaptain ? 'Captain' : 'Vice Captain'}
          >
            {isTripleCaptain ? 'TC' : isCaptain ? 'C' : 'VC'}
          </span>
        )}

        {/* Differential Indicator */}
        {isDifferential && (
          <span
            className="absolute top-0 left-0 w-4 h-4 bg-purple-500 rounded-full animate-pulse transform -translate-x-1 -translate-y-1"
            title="Differential"
          ></span>
        )}

        {isHighestPoints && (
          <span
            className="absolute top-0 left-0 w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center text-xs font-bold bg-yellow-500 text-white rounded-full shadow-md transform -translate-x-2 -translate-y-2"
            title="Highest Points"
          >
            ⭐
          </span>
        )}
      </div>


      {/* Player Info Container */}
      <div className="w-full bg-white rounded-b-lg p-2 flex flex-col items-center shadow-sm">
        {/* Player Name */}
        <p className="text-xs font-bold uppercase text-gray-800 tracking-tight truncate w-full text-center">
          {pick.name}
        </p>

        {/* Points */}
        <motion.div
          className={`mt-1 w-8 h-8 flex items-center justify-center rounded-full text-white font-bold text-sm ${
            hasPoints && !isBench ? 'bg-gradient-to-r from-green-500 to-green-700 animate-pulse' : 'bg-gray-300'
          }`}
          {...(hasPoints && !isBench ? ANIMATIONS.points : {})}
        >
          {pick.livePoints || 0}
        </motion.div>

        <div className="flex flex-col items-center">
  {/* Bonus points display */}
  {bonusIcon && (
    <div className="mt-1 w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full text-white font-bold text-xs bg-gradient-to-r from-yellow-500 to-yellow-700 animate-pulse">
      {bonusIcon}
    </div>
  )}

  {/* Performance stats icons */}
  {statIcons.length > 0 && (
    <div className="flex flex-wrap justify-center gap-1 mt-1">
      {statIcons.map((icon, idx) => (
        <span key={idx} className="text-sm">
          {icon}
        </span>
      ))}
    </div>
  )}
</div>

        {/* Ownership Stats */}
        <div className="flex justify-between w-full mt-1 text-xs">
          {pick.eo && (
            <span className="text-green-600 font-medium">
              EO: {pick.eo}%
            </span>
          )}
          {pick.ownership && pick.ownership !== "0" && (
  <span className="text-purple-600 font-medium">
    {pick.ownership}%
  </span>
)}
        </div>
      </div>

      {/* Bench Boost Indicator */}
      {isBench && isBenchBoost && (
        <span className="absolute -top-1 -left-1 px-1 py-0.5 bg-blue-500 text-white text-xs font-bold rounded-full shadow">
          BB
        </span>
      )}
    </motion.div>
  );
});

const PositionRow = memo(({ players, positionType, color, highestPointsPlayer }) => (
  <div className="flex justify-center gap-2 sm:gap-4 flex-wrap">
    <AnimatePresence>
      {players.length > 0 ? (
        players.map((pick) => (
          <PlayerCard 
            key={pick.playerId} 
            pick={pick} 
            color={color} 
            isHighestPoints={pick.playerId === highestPointsPlayer?.playerId} 
          />
        ))
      ) : (
        <motion.div variants={ANIMATIONS.player} initial="hidden" animate="visible" className="text-white text-sm italic">
          No {positionType} Selected
        </motion.div>
      )}
    </AnimatePresence>
  </div>
));


const FieldView = memo(({ categorizedPicks, highestPointsPlayer }) => (
  <div className="relative bg-green-700 bg-opacity-70 rounded-xl p-4 sm:p-6 mb-6 shadow-inner border border-white border-opacity-30">
    <FieldBackground />
    <div className="relative z-10 space-y-6 sm:space-y-8">
      <PositionRow players={categorizedPicks.gks} positionType="GK" color={POSITION_COLORS.GK} highestPointsPlayer={highestPointsPlayer} />
      <PositionRow players={categorizedPicks.defs} positionType="DEF" color={POSITION_COLORS.DEF} highestPointsPlayer={highestPointsPlayer} />
      <PositionRow players={categorizedPicks.mids} positionType="MID" color={POSITION_COLORS.MID} highestPointsPlayer={highestPointsPlayer} />
      <PositionRow players={categorizedPicks.fwds} positionType="FWD" color={POSITION_COLORS.FWD} highestPointsPlayer={highestPointsPlayer} />
    </div>
  </div>
));

const BenchSection = memo(({ bench, isBenchBoost, highestPointsPlayer }) => (
  <div className="mb-6 bg-gray-800 bg-opacity-70 rounded-xl p-4 sm:p-6 border border-gray-600 shadow-lg">
    <h4 className="text-lg font-bold text-white mb-3 drop-shadow flex items-center">
      Substitutes Bench
      {isBenchBoost && (
        <span className="ml-2 text-sm bg-blue-500 text-white px-2 py-1 rounded-full shadow">
          Bench Boost Active
        </span>
      )}
    </h4>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
      <AnimatePresence>
        {bench.map((pick) => (
          <PlayerCard
            key={pick.playerId}
            pick={pick}
            color={POSITION_COLORS[pick.positionType]}
            isBench
            isBenchBoost={isBenchBoost}
            isHighestPoints={pick.playerId === highestPointsPlayer?.playerId}
          />
        ))}
      </AnimatePresence>
    </div>
  </div>
));

const DifferentialsSection = memo(({ differentials }) => {
  if (!differentials?.length) return null;

  return (
    <motion.div
      {...ANIMATIONS.differential}
      className="mt-6 p-4 bg-purple-900 bg-opacity-90 rounded-xl shadow-lg border border-purple-500"
    >
      <h4 className="text-base font-bold text-purple-200 mb-3 flex items-center">
        <svg className="w-4 h-4 mr-2 text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        Differential Gems
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
        {differentials.map((pick) => (
          <div
            key={pick.playerId}
            className="bg-purple-800 bg-opacity-60 rounded-lg p-2 border border-purple-400 flex items-center justify-between hover:bg-purple-700 transition-colors duration-200"
          >
            <div className="flex items-center">
              <img
                src={getJerseyImage(pick.teamShortName || 'UNK')}
                alt={`${pick.teamShortName || 'UNK'} jersey`}
                onError={handleJerseyError}
                className="h-6 w-6 object-contain mr-2 filter drop-shadow-sm hover:brightness-110 transition-all duration-200"
              />
              <div>
                <p className="text-white text-sm font-medium truncate max-w-[120px]">{pick.name}</p>
                <div className="flex items-center text-xs text-purple-200">
                  <span className="mr-2">{pick.positionType}</span>
                  <span>EO: {pick.eo}%</span>
                </div>
              </div>
            </div>
            <div className="bg-purple-600 rounded-full w-8 h-8 flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-sm">{pick.livePoints || 0}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-purple-300 mt-2 italic">Low-EO picks to boost your rank.</p>
    </motion.div>
  );
});

const ThreatsSection = memo(({ threats }) => {
  if (!threats?.length) return null;

  return (
    <motion.div
      {...ANIMATIONS.threat}
      className="mt-6 p-4 bg-red-900 bg-opacity-90 rounded-xl shadow-lg border border-red-500"
    >
      <h4 className="text-base font-bold text-red-200 mb-3 flex items-center">
        <svg className="w-4 h-4 mr-2 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01M12 4a8 8 0 100 16 8 8 0 000-16z" />
        </svg>
        Top 10k Threats
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
        {threats.map(([id, { name, eo, teamShortName, livePoints }]) => (
          <div
            key={id}
            className="bg-red-800 bg-opacity-60 rounded-lg p-2 border border-red-400 flex items-center justify-between hover:bg-red-700 transition-colors duration-200"
          >
            <div className="flex items-center">
              {teamShortName && (
                <img
                  src={getJerseyImage(teamShortName || 'UNK')}
                  alt={`${teamShortName || 'UNK'} jersey`}
                  onError={handleJerseyError}
                  className="h-6 w-6 object-contain mr-2 filter drop-shadow-sm hover:brightness-110 transition-all duration-200"
                />
              )}
              <div>
                <p className="text-white text-sm font-medium truncate max-w-[120px]">{name}</p>
                <p className="text-xs text-red-200">EO: {eo}%</p>
              </div>
            </div>
            <div className="bg-red-600 rounded-full w-8 h-8 flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-sm">{livePoints !== undefined ? livePoints : '0'}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-red-300 mt-2 italic">High-EO players in top 10k you don’t own.</p>
    </motion.div>
  );
});

const AutoSubsSection = memo(({ autosubs, picks }) => {
  if (!autosubs?.length) return null;

  return (
    <div className="mt-6 p-4 bg-black bg-opacity-60 rounded-xl shadow-lg border border-white border-opacity-20">
      <h4 className="text-base font-bold text-green-400 mb-2 drop-shadow">Auto-Subs</h4>
      <AnimatePresence>
        {autosubs.map((sub, index) => {
          const inPlayer = picks.find((p) => p.playerId === sub.in) || { name: 'Unknown', teamShortName: 'UNK' };
          const outPlayer = picks.find((p) => p.playerId === sub.out) || { name: 'Unknown', teamShortName: 'UNK' };

          return (
            <motion.div
              key={index}
              {...ANIMATIONS.autoSub}
              className="flex items-center p-2 bg-black bg-opacity-40 rounded-lg mb-2 hover:bg-black hover:bg-opacity-50 transition-colors duration-200"
            >
              <span className="flex-1 text-white flex items-center">
                <span className="px-1.5 py-0.5 bg-green-600 text-white text-xs font-bold rounded mr-2">IN</span>
                <img
                  src={getJerseyImage(inPlayer.teamShortName)}
                  alt={`${inPlayer.teamShortName} jersey`}
                  onError={handleJerseyError}
                  className="h-5 w-5 object-contain mr-2 filter drop-shadow-sm hover:brightness-110 transition-all duration-200"
                />
                <span className="text-sm truncate max-w-[120px]">{inPlayer.name}</span>
              </span>
              <svg className="w-5 h-5 mx-2 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="flex-1 text-white text-opacity-80 flex items-center">
                <span className="px-1.5 py-0.5 bg-red-600 text-white text-xs font-bold rounded mr-2">OUT</span>
                <img
                  src={getJerseyImage(outPlayer.teamShortName)}
                  alt={`${outPlayer.teamShortName} jersey`}
                  onError={handleJerseyError}
                  className="h-5 w-5 object-contain mr-2 opacity-60 filter drop-shadow-sm"
                />
                <span className="text-sm line-through truncate max-w-[120px]">{outPlayer.name}</span>
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
});

const ViceCaptainSection = memo(({ points }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.5 }}
    className="mt-6 p-3 bg-black bg-opacity-50 rounded-xl shadow-lg border border-white border-opacity-10"
  >
    <p className="text-white">
      Vice-Captain Points: <span className="font-bold text-green-300">{points}</span>
    </p>
  </motion.div>
));

const Legend = memo(() => (
  <div className="mt-4 p-4 bg-black bg-opacity-40 rounded-xl shadow-inner">
    <h4 className="text-sm font-bold text-white mb-2">Legend</h4>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
      <div className="flex items-center">
        <span className="w-3 h-3 bg-purple-500 rounded-full mr-2"></span>
        <span className="text-white">Your Differential</span>
      </div>
      <div className="flex items-center">
        <span className="w-3 h-3 bg-red-500 rounded-full mr-2"></span>
        <span className="text-white">Top 10k Threat</span>
      </div>
      <div className="flex items-center">
        <span className="px-1 bg-green-600 text-white text-xs font-bold rounded mr-2">C</span>
        <span className="text-white">Captain</span>
      </div>
      <div className="flex items-center">
        <span className="px-1 bg-green-600 text-white text-xs font-bold rounded mr-2 ring-1 ring-yellow-400">TC</span>
        <span className="text-white">Triple Captain</span>
      </div>
      <div className="flex items-center">
        <span className="px-1 bg-gray-600 text-white text-xs font-bold rounded mr-2">VC</span>
        <span className="text-white">Vice Captain</span>
      </div>
      <div className="flex items-center">
        <span className="text-yellow-300 mr-1">⭐</span>
        <span className="text-white">Highest Points</span>
      </div>
      <div className="flex items-center">
        <span className="text-purple-400 mr-1">EO:</span>
        <span className="text-white">Effective Ownership</span>
      </div>
    </div>
  </div>
));

// PropTypes
PicksTable.propTypes = {
  picks: PropTypes.arrayOf(
    PropTypes.shape({
      playerId: PropTypes.number.isRequired,
      name: PropTypes.string.isRequired,
      positionType: PropTypes.oneOf(['GK', 'DEF', 'MID', 'FWD']).isRequired,
      multiplier: PropTypes.number.isRequired,
      livePoints: PropTypes.number,
      events: PropTypes.arrayOf(
        PropTypes.shape({
          type: PropTypes.string.isRequired,
          points: PropTypes.number.isRequired,
        })
      ),
      viceCaptainPoints: PropTypes.number,
      isDifferential: PropTypes.bool,
      eo: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      teamShortName: PropTypes.string,
    })
  ),
  lastUpdated: PropTypes.instanceOf(Date),
  autosubs: PropTypes.arrayOf(
    PropTypes.shape({
      in: PropTypes.number.isRequired,
      out: PropTypes.number.isRequired,
    })
  ),
  viceCaptainPoints: PropTypes.number,
  isLoading: PropTypes.bool,
  liveRank: PropTypes.number,
  totalLivePoints: PropTypes.number,
  top10kStats: PropTypes.object,
  activeChip: PropTypes.string,
};

PicksTable.defaultProps = {
  picks: [],
  autosubs: [],
  viceCaptainPoints: 0,
  isLoading: false,
  liveRank: null,
  totalLivePoints: null,
  top10kStats: null,
  activeChip: null,
};

export default PicksTable;