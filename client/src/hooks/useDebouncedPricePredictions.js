import { useEffect, useState, useCallback } from 'react';

// Custom hook for debounced price predictions
const useDebouncedPricePredictions = () => {
  const [pricePredictions, setPricePredictions] = useState([]);

  // Fetch price predictions
  const fetchPricePredictions = useCallback(() => {
    fetch('http://localhost:5000/api/fpl/price-predictions')
      .then(response => {
        if (!response.ok) throw new Error('Failed to fetch price predictions');
        return response.json();
      })
      .then(data => {
        setPricePredictions(data);
      })
      .catch(err => {
        console.error('Error fetching price predictions:', err);
      });
  }, []);

  // Initialize fetch on component mount with debounce
  useEffect(() => {
    let timeoutId = null;
    
    // Create a debounced version of fetchPricePredictions
    const debouncedFetch = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        fetchPricePredictions();
      }, 500);
    };
    
    // Call the debounced fetch function
    debouncedFetch();
    
    // Cleanup function to clear any pending timeout when component unmounts
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [fetchPricePredictions]);

  return pricePredictions;
};

export default useDebouncedPricePredictions;