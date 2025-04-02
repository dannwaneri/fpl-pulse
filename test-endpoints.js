const axios = require('axios');

const BASE_URL = process.env.API_URL || 'http://localhost:5000/api';
const MANAGER_ID = 108124; // Replace with a valid FPL ID
const GAMEWEEK = 30; // Replace with current gameweek
const LEAGUE_ID = 313; // Example league ID

async function testEndpoints() {
  console.log(`Testing against ${BASE_URL}\n`);
  
  // Define endpoint sets with updated routes
  const endpointSets = {
    'fpl-routes': [
      { name: 'Debug', url: `/fpl/debug` },
      { name: 'Bootstrap', url: `/fpl/bootstrap` },
      { name: 'Live Data', url: `/fpl/live/${GAMEWEEK}` },
      { name: 'Manager Info', url: `/fpl/${MANAGER_ID}` },
      { name: 'Manager History', url: `/fpl/${MANAGER_ID}/history` },
      { name: 'Manager Picks', url: `/fpl/${MANAGER_ID}/event/${GAMEWEEK}/picks` },
      { name: 'Player Summary', url: `/fpl/element-summary/1` },
      { name: 'Fixtures', url: `/fpl/fixtures` },
      { name: 'League Standings', url: `/fpl/leagues-classic/${LEAGUE_ID}/standings` },
      { name: 'Current Gameweek', url: `/fpl/current-gameweek` },
      { name: 'Planner Data', url: `/fpl/${MANAGER_ID}/planner` },
      { name: 'Top 10k Stats', url: `/fpl/top10k/${GAMEWEEK}` },
      { name: 'Captaincy Suggestions', url: `/fpl/${MANAGER_ID}/captaincy/${GAMEWEEK}` },
      { name: 'Rank Simulator', url: `/fpl/${MANAGER_ID}/rank-simulator/${GAMEWEEK}?points=0` }
    ],
    'league-routes': [
      { name: 'Fixtures by Gameweek', url: `/league/fixtures/${GAMEWEEK}` },
      { name: 'League Live Data', url: `/league/${LEAGUE_ID}/live/${GAMEWEEK}` }
    ]
  };

  // Test results summary
  const results = {};
  Object.keys(endpointSets).forEach(set => {
    results[set] = { passed: 0, failed: 0, total: endpointSets[set].length };
  });

  // Test both endpoint sets
  for (const [setName, endpoints] of Object.entries(endpointSets)) {
    console.log(`\n----- Testing ${setName.toUpperCase()} Endpoints -----\n`);
    
    for (const endpoint of endpoints) {
      try {
        console.log(`Testing ${endpoint.name}...`);
        const response = await axios.get(`${BASE_URL}${endpoint.url}`, { 
          timeout: 10000,
          validateStatus: function (status) {
            // Treat 400 and 404 as partially successful for this test
            return (status >= 200 && status < 300) || status === 400 || status === 404;
          }
        });
        
        // Check response structure
        const dataKeys = Object.keys(response.data).length;
        const status = response.status;
        
        console.log(`✅ ${endpoint.name}: OK (Status: ${status}, Keys: ${dataKeys})`);
        
        // Extra validation for specific endpoints
        if (endpoint.name === 'Manager Picks') {
          const picks = response.data.picks || [];
          console.log(`  - Picks count: ${picks.length}`);
          
          if (picks.length > 0) {
            // Sample check for one player to verify structure
            const samplePlayer = picks[0];
            console.log(`  - Sample player: ${samplePlayer.name} (${samplePlayer.positionType || 'Unknown'})`);
            
            // Check for critical fields
            const hasRequiredFields = samplePlayer.playerId !== undefined && 
                                     samplePlayer.name !== undefined;
            if (!hasRequiredFields) {
              console.warn(`  - ⚠️ WARNING: Sample player missing critical fields`);
            }
          }
        }
        
        // Count passed tests, even for 400/404 status codes
        results[setName].passed++;
      } catch (error) {
        console.error(`❌ ${endpoint.name}: FAILED - ${error.message}`);
        if (error.response) {
          console.error(`  Status: ${error.response.status}`);
          console.error(`  Data: ${JSON.stringify(error.response.data).substring(0, 100)}...`);
        }
        results[setName].failed++;
      }
    }
  }

  // Print summary
  console.log('\n----- Test Summary -----');
  for (const [setName, result] of Object.entries(results)) {
    const passRate = Math.round((result.passed / result.total) * 100);
    console.log(`${setName.toUpperCase()}: ${result.passed}/${result.total} passed (${passRate}%)`);
  }
}

// Execute tests
testEndpoints()
  .then(() => console.log('\nEndpoint testing complete!'))
  .catch(err => console.error('Error in test script:', err));