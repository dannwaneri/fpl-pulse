/**
 * Get fixture details for a team in a specific gameweek
 * 
 * @param {number} teamId - The team ID
 * @param {number} gameweek - The gameweek number
 * @param {Array} fixtures - The fixtures data from plannerData
 * @returns {Object} Fixture details including opponent, difficulty, and location
 */
export const getFixtureDetails = (teamId, gameweek, fixtures) => {
    if (!fixtures || !teamId) {
      return { opponent: '-', difficulty: 3, location: '-' };
    }
    
    const gwFixtures = fixtures.find(f => f.gameweek === gameweek)?.matches || [];
    const fixture = gwFixtures.find(f => f.teamH === teamId || f.teamA === teamId);
    
    if (fixture) {
      const isHome = fixture.teamH === teamId;
      return {
        opponent: isHome ? fixture.teamAName : fixture.teamHName,
        difficulty: isHome ? fixture.difficultyH : fixture.difficultyA,
        location: isHome ? 'H' : 'A'
      };
    }
    
    return { opponent: '-', difficulty: 3, location: '-' };
  };