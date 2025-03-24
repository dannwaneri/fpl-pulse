// No need for node-fetch, use built-in https module
const https = require('https');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

/**
 * Simple https request function with promise interface
 * @param {string} url - The URL to fetch
 * @param {Object} options - Request options
 * @returns {Promise<Object>} - Response data
 */
function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsRequest(res.headers.location, options)
          .then(resolve)
          .catch(reject);
      }
      
      // Check status
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`Status Code: ${res.statusCode}`));
      }
      
      // Handle data
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      // Resolve on end
      res.on('end', () => {
        try {
          // Try to parse as JSON first
          if (res.headers['content-type'] && res.headers['content-type'].includes('application/json')) {
            resolve(JSON.parse(data));
          } else {
            resolve(data);
          }
        } catch (e) {
          // If parsing fails, return raw data
          resolve(data);
        }
      });
    });
    
    // Handle errors
    req.on('error', (err) => {
      reject(err);
    });
    
    // End request
    req.end();
  });
}

/**
 * Updates the managers.json file with current Premier League managers
 * This script fetches manager data from reliable sources and formats it for the FPL application
 */
async function updateManagers() {
  try {
    console.log('Fetching current Premier League managers data...');
    
    // Approach 1: Try to fetch from official API if available
    let managers = await fetchFromOfficialApi();
    
    // Approach 2: Fall back to web scraping if API doesn't work
    if (!managers || managers.length === 0) {
      console.log('API fetch failed or returned empty, trying web scraping...');
      managers = await scrapeManagersFromWeb();
    }
    
    // Approach 3: Fall back to manual data if both approaches fail
    if (!managers || managers.length === 0) {
      console.log('Web scraping failed, using backup data...');
      managers = getBackupManagerData();
    }
    
    // Validate and clean the data
    managers = validateManagerData(managers);
    
    // Write to file
    const outputPath = path.resolve(__dirname, '../src/data/managers.json');
    fs.writeFileSync(outputPath, JSON.stringify(managers, null, 2));
    console.log(`Successfully updated managers data. Saved to ${outputPath}`);
    console.log(`Total managers: ${managers.length}`);
    
    // Print preview
    console.log('\nPreview of first 3 managers:');
    console.log(managers.slice(0, 3));
  } catch (error) {
    console.error('Error updating managers:', error);
    process.exit(1);
  }
}

/**
 * Attempts to fetch manager data from official sources
 */
async function fetchFromOfficialApi() {
  try {
    // Try official FPL API first (adjust URL as needed)
    const data = await httpsRequest('https://fantasy.premierleague.com/api/bootstrap-static/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    // Check if managers data exists in the API response
    if (data.managers && Array.isArray(data.managers) && data.managers.length > 0) {
      console.log('Successfully fetched managers from official API');
      return data.managers;
    }
    
    // If we have teams but not managers, we can construct basic manager data
    if (data.teams && Array.isArray(data.teams) && data.teams.length > 0) {
      console.log('Constructing manager data from teams information');
      // This is a simplified example - in reality you'd need more complex mapping
      return data.teams.map((team, index) => ({
        id: index + 1,
        name: team.manager_name || `Manager of ${team.name}`,
        team_id: team.id,
        cost: calculateManagerCost(team)
      }));
    }
    
    return null;
  } catch (error) {
    console.warn('Failed to fetch from official API:', error.message);
    return null;
  }
}

/**
 * Scrapes manager data from Premier League website or similar sources
 */
async function scrapeManagersFromWeb() {
  try {
    // Premier League official site or another reliable source
    const html = await httpsRequest('https://www.premierleague.com/managers', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ = cheerio.load(html);
    const managers = [];
    
    // This selector needs to be adjusted based on the actual page structure
    $('.managerCard').each((i, el) => {
      const name = $(el).find('.managerName').text().trim();
      const teamName = $(el).find('.managerTeam').text().trim();
      
      // Find team_id based on team name
      const team_id = mapTeamNameToId(teamName);
      
      if (name && team_id) {
        managers.push({
          id: i + 1,
          name: name,
          team_id: team_id,
          cost: calculateManagerCost({ name: teamName, strength: 3 }) // Default strength
        });
      }
    });
    
    if (managers.length > 0) {
      console.log(`Successfully scraped ${managers.length} managers from the web`);
      return managers;
    }
    
    return null;
  } catch (error) {
    console.warn('Failed to scrape managers from web:', error.message);
    return null;
  }
}

/**
 * Maps team names to team IDs
 */
function mapTeamNameToId(teamName) {
  const teamMapping = {
    'Arsenal': 1,
    'Manchester City': 2,
    'Bournemouth': 3,
    'Brentford': 4,
    'Brighton': 5,
    'Chelsea': 6,
    'Crystal Palace': 7,
    'Everton': 8,
    'Fulham': 9,
    'Wolves': 10,
    'Ipswich Town': 11,
    'Southampton': 12,
    'Liverpool': 13,
    'Manchester United': 14,
    'Newcastle': 15,
    'Nottingham Forest': 16,
    'Tottenham': 17,
    'West Ham': 18,
    'Leicester': 19,
    'Aston Villa': 20
    // Add other teams as needed
  };
  
  // Try direct match
  if (teamMapping[teamName]) {
    return teamMapping[teamName];
  }
  
  // Try partial match
  for (const [mappedName, id] of Object.entries(teamMapping)) {
    if (teamName.includes(mappedName) || mappedName.includes(teamName)) {
      return id;
    }
  }
  
  // Default fallback
  return Math.floor(Math.random() * 20) + 1;
}

/**
 * Calculate manager cost based on team strength/popularity
 */
function calculateManagerCost(team) {
  // Base cost calculation logic
  const baseMap = {
    'Manchester City': 20,
    'Liverpool': 18,
    'Arsenal': 15,
    'Chelsea': 16,
    'Tottenham': 15,
    'Manchester United': 15,
    'Newcastle': 14,
    'Aston Villa': 16
    // Add other notable teams
  };
  
  // If we have a direct match
  if (team.name && baseMap[team.name]) {
    return baseMap[team.name];
  }
  
  // Default calculation based on team strength if available
  if (team.strength) {
    return 10 + (team.strength * 2);
  }
  
  // Random cost between 10-18 if nothing else available
  return Math.floor(Math.random() * 8) + 10;
}

/**
 * Fallback data when API and scraping fail
 */
function getBackupManagerData() {
  return [
    { id: 1, name: "Mikel Arteta", team_id: 1, cost: 15 },      // Arsenal
    { id: 2, name: "Pep Guardiola", team_id: 2, cost: 20 },     // Man City
    { id: 3, name: "Andoni Iraola", team_id: 3, cost: 12 },     // Bournemouth
    { id: 4, name: "Thomas Frank", team_id: 4, cost: 13 },      // Brentford
    { id: 5, name: "Fabian Hürzeler", team_id: 5, cost: 14 },   // Brighton
    { id: 6, name: "Enzo Maresca", team_id: 6, cost: 16 },      // Chelsea
    { id: 7, name: "Oliver Glasner", team_id: 7, cost: 11 },    // Crystal Palace
    { id: 8, name: "David Moyes", team_id: 8, cost: 10 },        // Everton
    { id: 9, name: "Marco Silva", team_id: 9, cost: 12 },       // Fulham
    { id: 10, name: "Vitor Pereira", team_id: 10, cost: 11 },     // Wolves
    { id: 11, name: "Kieran McKenna", team_id: 11, cost: 13 },  // Ipswich Town
    { id: 12, name: "Ivan JurićS", team_id: 12, cost: 12 },  // Southampton
    { id: 13, name: "Arne Slot", team_id: 13, cost: 18 },       // Liverpool
    { id: 14, name: "ruben amorim", team_id: 14, cost: 15 },    // Man United
    { id: 15, name: "Eddie Howe", team_id: 15, cost: 14 },      // Newcastle
    { id: 16, name: "Nuno Espírito Santo", team_id: 16, cost: 12 }, // Nottingham Forest
    { id: 17, name: "Ange Postecoglou", team_id: 17, cost: 15 }, // Tottenham
    { id: 18, name: "Graham Potter", team_id: 18, cost: 13 }, // West Ham
    { id: 19, name: "ruud van nistelrooy", team_id: 19, cost: 12 },    // Leicester
    { id: 20, name: "Unai Emery", team_id: 20, cost: 16 }       // Aston Villa
  ];
}

/**
 * Validates and normalizes manager data
 */
function validateManagerData(managers) {
  if (!Array.isArray(managers)) {
    console.error('Invalid managers data: not an array');
    return getBackupManagerData();
  }
  
  // Filter out invalid entries and normalize
  return managers.filter(manager => {
    return manager && manager.name && manager.team_id;
  }).map((manager, index) => {
    // Ensure all required fields exist
    return {
      id: manager.id || index + 1,
      name: manager.name,
      team_id: parseInt(manager.team_id),
      cost: parseInt(manager.cost) || 10 // Default cost if missing
    };
  });
}

// Run the update
updateManagers();