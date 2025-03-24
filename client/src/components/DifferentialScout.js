import React, { useState, useMemo } from 'react';

const DifferentialScout = ({ plannerData, currentSquad, activeChip, assistantManagerPoints }) => {
  const [sortBy, setSortBy] = useState('form'); // Options: 'form', 'potentialPoints', 'difficulty'

  // Safely extract data with fallbacks
  const allPlayers = plannerData?.allPlayers || [];
  const fixtures = plannerData?.fixtures || [];
  const currentGameweek = plannerData?.currentGameweek || 1;

  // Calculate average fixture difficulty for next 3 gameweeks
  const getFixtureDifficulty = (player) => {
    const nextThreeGWs = fixtures.filter(f => f.gameweek >= currentGameweek && f.gameweek < currentGameweek + 3);
    const playerFixtures = nextThreeGWs.map(gw => {
      const match = gw.matches.find(m => m.teamH === player.teamId || m.teamA === player.teamId);
      return match ? (match.teamH === player.teamId ? match.difficultyH : match.difficultyA) : 3; // Default to 3 if no fixture
    });
    return playerFixtures.length > 0 ? playerFixtures.reduce((sum, d) => sum + d, 0) / playerFixtures.length : 3;
  };

  // Calculate potential points with chip adjustments
  const getPotentialPoints = (player) => {
    let basePoints = Number(player.form) || 0;
    if (activeChip === '3cap' && player.multiplier === 2) basePoints *= 3; // Triple Captain
    if (assistantManagerPoints && player.teamId === plannerData?.assistantManager?.team_id) {
      basePoints += assistantManagerPoints / 15; // Hypothetical: Distribute AM points across team
    }
    return basePoints.toFixed(1);
  };

  // Filter and sort differentials
  const differentials = useMemo(() => {
    return allPlayers
      .filter(p => 
        p.selected_by_percent < 10 && 
        Number(p.form) > 4 && 
        !currentSquad.some(s => s.id === p.id) &&
        (activeChip !== 'bboost' || p.position > 11) // Include bench players for Bench Boost
      )
      .map(p => ({
        ...p,
        difficulty: getFixtureDifficulty(p),
        potentialPoints: getPotentialPoints(p),
      }))
      .sort((a, b) => {
        if (sortBy === 'form') return Number(b.form) - Number(a.form);
        if (sortBy === 'potentialPoints') return Number(b.potentialPoints) - Number(a.potentialPoints);
        if (sortBy === 'difficulty') return a.difficulty - b.difficulty;
        return 0;
      })
      .slice(0, 5);
  }, [allPlayers, currentSquad, currentGameweek, fixtures, sortBy, activeChip, assistantManagerPoints]);

  // Render difficulty badge
  const getDifficultyColor = (difficulty) => {
    if (difficulty < 2) return 'bg-green-100 text-green-800';
    if (difficulty < 3) return 'bg-green-200 text-green-800';
    if (difficulty < 4) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md mb-6 border border-gray-100">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-bold text-gray-800 flex items-center">
          <svg className="w-6 h-6 mr-2 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m-6 6h6" />
          </svg>
          Differential Scout {activeChip && `(${activeChip})`}
        </h3>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="border rounded p-1 text-sm bg-gray-50 text-gray-700"
        >
          <option value="form">Sort by Form</option>
          <option value="potentialPoints">Sort by Potential Points</option>
          <option value="difficulty">Sort by Fixture Difficulty</option>
        </select>
      </div>

      {differentials.length === 0 ? (
        <p className="text-gray-600 italic text-center">No differentials found for your criteria.</p>
      ) : (
        <div className="space-y-3">
          {differentials.map(player => (
            <div
              key={player.id}
              className="flex justify-between items-center bg-gray-50 p-3 rounded-lg hover:bg-gray-100"
            >
              <div>
                <p className="font-medium text-gray-800">
                  {player.name} ({player.positionType})
                </p>
                <p className="text-sm text-gray-600">
                  EO: {player.selected_by_percent}% | Form: {player.form} | 
                  <span className={`${getDifficultyColor(player.difficulty)} inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ml-1`}>
                    Difficulty: {player.difficulty.toFixed(1)}
                  </span>
                </p>
              </div>
              <span className="text-lg font-bold text-green-600">
                {player.potentialPoints} pts
              </span>
            </div>
          ))}
        </div>
      )}
      {activeChip === '3cap' && (
        <p className="text-xs text-gray-500 mt-2">*Potential points tripled for captain with Triple Captain active.</p>
      )}
      {activeChip === 'bboost' && (
        <p className="text-xs text-gray-500 mt-2">*Includes bench players for Bench Boost planning.</p>
      )}
      {assistantManagerPoints > 0 && (
        <p className="text-xs text-gray-500 mt-2">*Includes {assistantManagerPoints} Assistant Manager bonus points.</p>
      )}
    </div>
  );
};

export default DifferentialScout;