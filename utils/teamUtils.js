// Utility functions for team-related data and styling

/**
 * Get color class based on player position
 * @param {string} position - Player position (GK, DEF, MID, FWD)
 * @returns {string} Tailwind CSS class for background color
 */
export const getPositionColor = (position) => {
    switch (position) {
      case 'GK': return 'bg-yellow-500';
      case 'DEF': return 'bg-blue-500';
      case 'MID': return 'bg-green-500';
      case 'FWD': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };
  
  /**
   * Get color class based on fixture difficulty
   * @param {number} difficulty - Difficulty rating (1-5)
   * @returns {string} Tailwind CSS classes for background and text color
   */
  export const getDifficultyColor = (difficulty) => {
    switch (difficulty) {
      case 1: return 'bg-green-100 text-green-800';
      case 2: return 'bg-green-200 text-green-800';
      case 3: return 'bg-yellow-100 text-yellow-800';
      case 4: return 'bg-red-100 text-red-800';
      case 5: return 'bg-red-200 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };