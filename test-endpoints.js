const axios = require('axios');

const BASE_URL = 'http://localhost:5000';
const MANAGER_ID = 12345; // Replace with a valid FPL ID
const GAMEWEEK = 29; // Replace with current gameweek

async function testEndpoints() {
  const endpoints = [
    { name: 'Debug', url: `/fpl-basic/debug` },
    { name: 'Bootstrap', url: `/fpl-basic/bootstrap` },
    { name: 'Live Data', url: `/fpl-basic/live/${GAMEWEEK}` },
    { name: 'Manager Info', url: `/fpl-basic/entry/${MANAGER_ID}` },
    { name: 'Manager History', url: `/fpl-basic/entry/${MANAGER_ID}/history` },
    { name: 'Manager Picks', url: `/fpl-basic/entry/${MANAGER_ID}/event/${GAMEWEEK}/picks` },
    { name: 'Player Summary', url: `/fpl-basic/element-summary/1` },
    { name: 'Fixtures', url: `/fpl-basic/fixtures` },
    { name: 'League Standings', url: `/fpl-basic/leagues-classic/313/standings` },
    { name: 'Current Gameweek', url: `/fpl-basic/current-gameweek` },
    { name: 'Health', url: `/fpl-basic/health` },
    { name: 'Planner Data', url: `/fpl-basic/entry/${MANAGER_ID}/planner` }
  ];

  for (const endpoint of endpoints) {
    try {
      console.log(`Testing ${endpoint.name}...`);
      const response = await axios.get(`${BASE_URL}${endpoint.url}`);
      console.log(`✅ ${endpoint.name}: OK (${Object.keys(response.data).length} keys)`);
      
      // For planner, add more detailed logging
      if (endpoint.name === 'Planner Data') {
        const data = response.data;
        console.log(`  - Current Picks: ${data.currentPicks?.length || 0}`);
        console.log(`  - All Players: ${data.allPlayers?.length || 0}`);
        console.log(`  - Fixtures: ${data.fixtures?.length || 0}`);
        console.log(`  - Current Gameweek: ${data.currentGameweek}`);
      }
    } catch (error) {
      console.error(`❌ ${endpoint.name}: FAILED - ${error.message}`);
      if (error.response) {
        console.error(`  Status: ${error.response.status}`);
        console.error(`  Data: ${JSON.stringify(error.response.data).substring(0, 100)}...`);
      }
    }
  }

  // Test cache clear endpoint
  try {
    console.log('\nTesting Cache Clear...');
    const cacheResponse = await axios.post(`${BASE_URL}/fpl-basic/cache/clear`);
    console.log(`✅ Cache Clear: OK`);
  } catch (error) {
    console.error(`❌ Cache Clear: FAILED - ${error.message}`);
  }
}

testEndpoints()
  .then(() => console.log('\nEndpoint testing complete!'))
  .catch(err => console.error('Error in test script:', err));