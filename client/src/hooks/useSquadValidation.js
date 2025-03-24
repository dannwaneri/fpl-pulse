import { useCallback } from 'react';

/**
 * Custom hook for squad validation
 * 
 * @returns {Function} validateSquad function
 */
const useSquadValidation = () => {
  /**
   * Validates if a squad meets all FPL requirements
   * 
   * @param {Array} squad - Array of player objects
   * @param {Object} newPlayer - Optional new player to add/replace
   * @returns {boolean} Whether the squad is valid or not
   */
  const validateSquad = useCallback((squad, newPlayer = null) => {
    const updatedSquad = newPlayer ? [...squad.filter(p => p.id !== newPlayer.id), newPlayer] : squad;
    const positions = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    const teams = {};
    const starters = updatedSquad.filter(p => p.position <= 11);

    updatedSquad.forEach(player => {
      positions[player.positionType]++;
      teams[player.teamId] = (teams[player.teamId] || 0) + 1;
    });
    starters.forEach(player => positions[player.positionType]--);

    const validXI = starters.length === 11 && positions.GK >= 1 && positions.DEF >= 3 && positions.MID >= 1 && positions.FWD >= 1;

    return (
      updatedSquad.length === 15 &&
      positions.GK === 2 &&
      positions.DEF === 5 &&
      positions.MID === 5 &&
      positions.FWD === 3 &&
      Object.values(teams).every(count => count <= 3) &&
      validXI
    );
  }, []);

  return validateSquad;
};

export default useSquadValidation;