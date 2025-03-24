import React, { memo, useState, useEffect, useMemo } from 'react';

/**
 * LeagueStandings Component
 * Displays FPL league standings with pagination and highlighting for the current user
 */
const LeagueStandings = memo(({ 
  data, 
  leagueData, 
  selectedLeague, 
  handleLeagueChange, 
  fplId, 
  error, 
  isLoading, 
  activeChip, 
  assistantManagerPoints 
}) => {
  // ===== STATE MANAGEMENT =====
  const [currentPage, setCurrentPage] = useState(1);
  const [entriesPerPage, setEntriesPerPage] = useState(10);
  const [paginatedStandings, setPaginatedStandings] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  
  // ===== EFFECTS =====
  // Reset pagination when league changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedLeague]);
  
  // Update pagination data when leagueData changes
  useEffect(() => {
    if (!leagueData?.standings?.length) {
      setPaginatedStandings([]);
      setTotalPages(1);
      return;
    }
    
    const newTotalPages = Math.ceil(leagueData.standings.length / entriesPerPage);
    setTotalPages(newTotalPages);
    
    // Apply pagination
    const startIndex = (currentPage - 1) * entriesPerPage;
    const endIndex = startIndex + entriesPerPage;
    const newPaginatedStandings = leagueData.standings.slice(startIndex, endIndex);
    setPaginatedStandings(newPaginatedStandings);
  }, [leagueData, currentPage, entriesPerPage]);

  // ===== HANDLERS =====
  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  // ===== MEMOIZED VALUES =====
  const displayStandings = useMemo(() => {
    if (!paginatedStandings || paginatedStandings.length === 0) {
      return [];
    }
    
    // Apply assistantManagerPoints to current user's standings
    const adjustedStandings = paginatedStandings.map(entry => ({
      ...entry,
      livePoints: entry.entryId === parseInt(fplId) && assistantManagerPoints ? 
        entry.livePoints + assistantManagerPoints : entry.livePoints,
      totalPoints: entry.entryId === parseInt(fplId) && assistantManagerPoints ? 
        entry.totalPoints + assistantManagerPoints : entry.totalPoints
    }));
    
    // If showing full paginated view, return all standings in current page
    if (entriesPerPage <= 10) return adjustedStandings;
    
    // For highlight view (showing user in context)
    const allStandings = leagueData?.standings || [];
    const userEntry = allStandings.find(entry => entry.entryId === parseInt(fplId));
    const userRank = userEntry?.rank || 0;
    
    // Get top 5
    const topEntries = adjustedStandings.slice(0, 5);
    
    // If user is in top 5, just return top 5
    if (userRank <= 5) return topEntries;
    
    // Otherwise return top 3, user entry, and entries around user
    if (userRank > 5) {
      // Get entries around user
      const userIndex = allStandings.findIndex(entry => entry.entryId === parseInt(fplId));
      
      if (userIndex === -1) {
        return topEntries;
      }
      
      const nearbyEntries = [
        allStandings[userIndex - 1],
        userEntry,
        allStandings[userIndex + 1]
      ].filter(Boolean).map(entry => {
        if (entry.entryId === parseInt(fplId) && assistantManagerPoints) {
          return {
            ...entry,
            livePoints: entry.livePoints + assistantManagerPoints,
            totalPoints: entry.totalPoints + assistantManagerPoints
          };
        }
        return entry;
      });
      
      // Return top 3 and nearby entries
      const result = [...adjustedStandings.slice(0, 3)];
      
      // Add a divider
      if (userRank > 4) {
        result.push({isDivider: true, id: 'divider'});
      }
      
      return [...result, ...nearbyEntries];
    }
    
    return topEntries;
  }, [paginatedStandings, fplId, assistantManagerPoints, leagueData, entriesPerPage]);

  // ===== RENDERING HELPERS =====
  // Loading state skeleton with smoother animation
  if (isLoading) {
    return <LoadingSkeletonView />;
  }

  // Error handling with specific messages
  if (!data?.leagues || !Array.isArray(data.leagues)) {
    return <ErrorView message="Error loading leagues" subMessage="Please check your connection and try again" />;
  }

  if (data.leagues.length === 0) {
    return <EmptyLeaguesView />;
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm mb-6 transition-all hover:shadow-md">
      {/* Header Section */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-medium text-gray-700">League Standings</h3>
        <LeagueSelector 
          leagues={data.leagues}
          selectedLeague={selectedLeague} 
          onChange={handleLeagueChange} 
        />
      </div>
      
      {leagueData ? (
        <div>
          {/* Table headers */}
          <TableHeader />
          
          {/* Table content */}
          <div className="py-2 space-y-2">
            {leagueData.standings && leagueData.standings.length > 0 ? (
              displayStandings.map((entry, index) => (
                entry.isDivider ? (
                  <DividerRow key="divider" />
                ) : (
                  <StandingsRow 
                    key={entry.entryId || index}
                    entry={entry}
                    isCurrentUser={entry.entryId === parseInt(fplId)}
                    activeChip={activeChip}
                    assistantManagerPoints={assistantManagerPoints}
                  />
                )
              ))
            ) : (
              <NoStandingsView error={error} />
            )}
          </div>
          
          {/* Pagination controls */}
          {totalPages > 1 && leagueData.standings && leagueData.standings.length > 0 && (
            <PaginationControls 
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              entriesPerPage={entriesPerPage}
              onEntriesPerPageChange={(value) => {
                setEntriesPerPage(Number(value));
                setCurrentPage(1);
              }}
            />
          )}
          
          {/* League info footer */}
          <LeagueFooter 
            leagueName={leagueData.leagueName} 
            standingsCount={leagueData.standings?.length || 0}
            currentPage={currentPage}
            totalPages={totalPages}
          />
        </div>
      ) : (
        <LeagueLoadingView error={error} />
      )}
    </div>
  );
});

// ===== EXTRACTED SUB-COMPONENTS =====

// Loading Skeleton
const LoadingSkeletonView = () => (
  <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
    <div className="flex justify-between items-center mb-4">
      <div className="h-5 bg-gray-100 rounded w-1/4 animate-pulse"></div>
      <div className="h-8 bg-gray-100 rounded w-1/3 animate-pulse"></div>
    </div>
    <div className="border-b border-gray-100 pb-3 mb-3">
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-1 h-4 bg-gray-50 rounded animate-pulse"></div>
        <div className="col-span-6 h-4 bg-gray-50 rounded animate-pulse"></div>
        <div className="col-span-2 h-4 bg-gray-50 rounded animate-pulse"></div>
        <div className="col-span-3 h-4 bg-gray-50 rounded animate-pulse"></div>
      </div>
    </div>
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="grid grid-cols-12 gap-2">
          <div className="col-span-1 h-5 bg-gray-50 rounded animate-pulse"></div>
          <div className="col-span-6 h-5 bg-gray-50 rounded animate-pulse"></div>
          <div className="col-span-2 h-5 bg-gray-50 rounded animate-pulse"></div>
          <div className="col-span-3 h-5 bg-gray-50 rounded animate-pulse"></div>
        </div>
      ))}
    </div>
  </div>
);

// Error View
const ErrorView = ({ message, subMessage }) => (
  <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
    <div className="flex flex-col items-center justify-center py-8">
      <svg className="w-12 h-12 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p className="text-gray-500 text-center">{message}</p>
      <p className="text-gray-400 text-sm mt-1">{subMessage}</p>
    </div>
  </div>
);

// Empty Leagues View
const EmptyLeaguesView = () => (
  <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
    <div className="flex flex-col items-center justify-center py-8">
      <svg className="w-12 h-12 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
      </svg>
      <p className="text-gray-500 text-center">You are not part of any classic leagues yet</p>
      <p className="text-gray-400 text-sm mt-1">Join a league to see standings here</p>
    </div>
  </div>
);

// League Selector
const LeagueSelector = memo(({ leagues, selectedLeague, onChange }) => (
  <div className="relative">
    <select
      value={selectedLeague || ''}
      onChange={onChange}
      className="py-2 px-4 pr-8 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-green-400 bg-white text-gray-700 text-sm transition-colors"
      aria-label="Select league"
    >
      {leagues.map(league => (
        <option key={league.id} value={league.id}>
          {league.name}
        </option>
      ))}
    </select>
    <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none text-gray-500">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  </div>
));

// Table Header
const TableHeader = () => (
  <div className="grid grid-cols-12 text-xs font-medium text-gray-500 pb-2 border-b border-gray-100">
    <div className="col-span-1">#</div>
    <div className="col-span-6">Manager</div>
    <div className="col-span-2 text-right">Total</div>
    <div className="col-span-3 text-right">GW Points</div>
  </div>
);

// Divider Row
const DividerRow = () => (
  <div className="py-2 text-center">
    <div className="flex items-center justify-center">
      <span className="inline-block w-12 h-px bg-gray-200"></span>
      <span className="text-xs text-gray-400 px-2">•••</span>
      <span className="inline-block w-12 h-px bg-gray-200"></span>
    </div>
  </div>
);

// Standings Row
const StandingsRow = memo(({ entry, isCurrentUser, activeChip, assistantManagerPoints }) => {
  // Rank badge styles based on position
  const getRankDisplay = () => {
    if (entry.rank <= 3) {
      const badgeColors = {
        1: 'bg-yellow-400',
        2: 'bg-gray-400',
        3: 'bg-amber-600'
      };
      
      return (
        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs text-white font-medium ${badgeColors[entry.rank]}`}>
          {entry.rank}
        </span>
      );
    }
    
    return <span className="text-gray-500 text-sm">{entry.rank}</span>;
  };

  return (
    <div 
      className={`grid grid-cols-12 py-2 ${
        isCurrentUser ? 'bg-green-50 font-medium rounded-md px-2' : 'hover:bg-gray-50 transition-colors'
      }`}
    >
      <div className="col-span-1 flex items-center">
        {getRankDisplay()}
      </div>
      <div className="col-span-6 truncate flex items-center" title={`${entry.managerName} (${entry.teamName})`}>
        {entry.managerName}
      </div>
      <div className="col-span-2 text-right text-gray-700 flex items-center justify-end">
        {entry.totalPoints}
      </div>
      <div className="col-span-3 text-right flex items-center justify-end">
        <span className={`${isCurrentUser ? 'text-green-600' : 'text-gray-800'} font-medium`}>
          {entry.livePoints}
        </span>
        {entry.transferPenalty < 0 && activeChip !== 'freehit' && activeChip !== 'wildcard' && (
          <span className="text-xs text-red-500 ml-1 font-medium">
            ({entry.transferPenalty})
          </span>
        )}
        {isCurrentUser && assistantManagerPoints > 0 && (
          <span className="text-xs text-blue-500 ml-1 bg-blue-50 px-1.5 py-0.5 rounded font-medium">
            +{assistantManagerPoints} (AM)
          </span>
        )}
      </div>
    </div>
  );
});

// No Standings View
const NoStandingsView = ({ error }) => (
  <div className="py-8 text-center text-gray-500 text-sm">
    {error ? (
      <div className="flex flex-col items-center">
        <svg className="w-10 h-10 text-red-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>Error: {error}</span>
      </div>
    ) : (
      <div className="flex flex-col items-center">
        <svg className="w-10 h-10 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <span>No standings available for this league</span>
      </div>
    )}
  </div>
);

// Pagination Controls
const PaginationControls = memo(({ 
  currentPage, 
  totalPages, 
  onPageChange, 
  entriesPerPage, 
  onEntriesPerPageChange 
}) => (
  <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between items-center">
    <div className="flex space-x-1">
      <select
        value={entriesPerPage}
        onChange={(e) => onEntriesPerPageChange(e.target.value)}
        className="text-xs border border-gray-200 rounded-md p-1.5 focus:outline-none focus:ring-1 focus:ring-green-400"
        aria-label="Entries per page"
      >
        <option value={10}>10 per page</option>
        <option value={20}>20 per page</option>
        <option value={50}>50 per page</option>
      </select>
    </div>
    
    <div className="flex items-center space-x-1">
      <PaginationButton 
        onClick={() => onPageChange(1)}
        disabled={currentPage === 1}
        aria-label="First page"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
        </svg>
      </PaginationButton>
      
      <PaginationButton 
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        aria-label="Previous page"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </PaginationButton>
      
      {/* Page numbers */}
      <div className="flex space-x-1">
        {Array.from({ length: totalPages }).map((_, i) => {
          const pageNum = i + 1;
          
          // Show first page, last page, current page, and pages around current
          if (
            pageNum === 1 || 
            pageNum === totalPages || 
            (pageNum >= currentPage - 1 && pageNum <= currentPage + 1)
          ) {
            return (
              <button
                key={pageNum}
                onClick={() => onPageChange(pageNum)}
                className={`w-7 h-7 flex items-center justify-center rounded-md text-xs ${
                  currentPage === pageNum 
                    ? 'bg-green-100 text-green-700 font-medium' 
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
                aria-label={`Page ${pageNum}`}
                aria-current={currentPage === pageNum ? 'page' : undefined}
              >
                {pageNum}
              </button>
            );
          }
          
          // Show ellipsis for gaps
          if (
            (pageNum === 2 && currentPage > 3) ||
            (pageNum === totalPages - 1 && currentPage < totalPages - 2)
          ) {
            return <span key={pageNum} className="flex items-center text-gray-400" aria-hidden="true">...</span>;
          }
          
          return null;
        })}
      </div>
      
      <PaginationButton 
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        aria-label="Next page"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </PaginationButton>
      
      <PaginationButton 
        onClick={() => onPageChange(totalPages)}
        disabled={currentPage === totalPages}
        aria-label="Last page"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
        </svg>
      </PaginationButton>
    </div>
  </div>
));

// Pagination Button
const PaginationButton = ({ children, onClick, disabled, ...rest }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`p-1.5 rounded-md text-xs ${
      disabled ? 'text-gray-300 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-100'
    }`}
    {...rest}
  >
    {children}
  </button>
);

// League Footer
const LeagueFooter = memo(({ leagueName, standingsCount, currentPage, totalPages }) => (
  <div className="mt-3 pt-2 border-t border-gray-100 flex justify-between items-center text-xs text-gray-400">
    <span>{leagueName || 'Unknown League'}</span>
    <span>
      {standingsCount > 0 ? `${standingsCount} managers` : '0 managers'}
      {totalPages > 1 && ` • Page ${currentPage} of ${totalPages}`}
    </span>
  </div>
));

// League Loading View
const LeagueLoadingView = ({ error }) => (
  <div className="flex items-center justify-center py-10">
    {error ? (
      <p className="text-red-500 text-sm flex items-center">
        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {error}
      </p>
    ) : (
      <p className="text-gray-500 text-sm flex items-center">
        <svg className="animate-spin mr-2 h-5 w-5 text-green-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Loading league standings...
      </p>
    )}
  </div>
);

export default LeagueStandings;