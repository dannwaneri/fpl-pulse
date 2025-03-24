const express = require('express');
const router = express.Router();
const axios = require('axios');
const { loadBootstrapData } = require('../services/bootstrapService');

// New route for fetching fixtures
router.get('/fixtures/:gameweek', async (req, res) => {
  try {
    const { gameweek } = req.params;
    const fixturesResponse = await axios.get(`https://fantasy.premierleague.com/api/fixtures/?event=${gameweek}`);
    const liveResponse = await axios.get(`https://fantasy.premierleague.com/api/event/${gameweek}/live/`);
    
    // Enrich fixtures with live data
    const enrichedFixtures = fixturesResponse.data.map(fixture => {
      const homeTeamLiveData = liveResponse.data.elements.filter(el => el.team === fixture.team_h);
      const awayTeamLiveData = liveResponse.data.elements.filter(el => el.team === fixture.team_a);
      
      return {
        ...fixture,
        homeTeamBonus: homeTeamLiveData.reduce((sum, player) => sum + (player.stats.bonus || 0), 0),
        awayTeamBonus: awayTeamLiveData.reduce((sum, player) => sum + (player.stats.bonus || 0), 0)
      };
    });

    res.json(enrichedFixtures);
  } catch (error) {
    console.error('Error fetching fixtures:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch fixtures', 
      details: error.message 
    });
  }
});

// Existing live league route
router.get('/:leagueId/live/:gameweek', async (req, res) => {
  try {
    const { leagueId, gameweek } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    const standingsResponse = await axios.get(`https://fantasy.premierleague.com/api/leagues-classic/${leagueId}/standings/`);
    const liveResponse = await axios.get(`https://fantasy.premierleague.com/api/event/${gameweek}/live/`);
    const bootstrapData = await loadBootstrapData();

    const liveData = liveResponse.data.elements;
    
    const totalEntries = standingsResponse.data.standings.results.length;
    const paginatedResults = standingsResponse.data.standings.results.slice(offset, offset + limit);
    
    const standings = await Promise.all(
      paginatedResults.map(async (entry) => {
        const picksResponse = await axios.get(`https://fantasy.premierleague.com/api/entry/${entry.entry}/event/${gameweek}/picks/`);
        const transfersResponse = await axios.get(`https://fantasy.premierleague.com/api/entry/${entry.entry}/transfers/`);
        const picks = picksResponse.data.picks;

        const transfersForGW = transfersResponse.data.filter(t => t.event === parseInt(gameweek)).length;
        const freeTransfers = 1;
        const extraTransfers = Math.max(0, transfersForGW - freeTransfers);
        const transferPenalty = extraTransfers * -4;

        const livePoints = picks.reduce((total, pick) => {
          const liveStats = liveData.find(el => el.id === pick.element);
          const points = liveStats ? liveStats.stats.total_points * pick.multiplier : 0;
          return total + points;
        }, 0) + transferPenalty;

        return {
          rank: entry.rank,
          managerName: entry.player_name,
          teamName: entry.entry_name,
          totalPoints: entry.total,
          livePoints: livePoints,
          transferPenalty: transferPenalty,
          entryId: entry.entry
        };
      })
    );
    
    res.json({
      leagueName: standingsResponse.data.league.name,
      pagination: {
        total: totalEntries,
        limit: limit,
        offset: offset,
        hasMore: offset + limit < totalEntries
      },
      standings: standings
    });
  } catch (error) {
    res.status(500).json({ 
      error: error.message || 'Error fetching league standings or live data' 
    });
  }
});

module.exports = router;