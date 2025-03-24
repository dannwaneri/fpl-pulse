const express = require('express');
const router = express.Router();
const { getManagerData, getPicksData, getPlannerData, getTop10kStats, predictPriceChanges, getCaptaincySuggestions } = require('../services/fplService');
const { Transfer } = require('../config/db');

// Middleware to validate integer parameters
const validateIntParams = (req, res, next) => {
  // Validate id parameter if present
  if (req.params.id !== undefined) {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id.toString() !== req.params.id) {
      return res.status(400).json({ error: 'Invalid ID parameter: must be an integer' });
    }
    req.params.id = id; // Replace with parsed integer
  }
  
  // Validate gameweek parameter if present
  if (req.params.gameweek !== undefined) {
    const gameweek = parseInt(req.params.gameweek);
    if (isNaN(gameweek) || gameweek.toString() !== req.params.gameweek || gameweek < 1 || gameweek > 38) {
      return res.status(400).json({ error: 'Invalid gameweek parameter: must be an integer between 1 and 38' });
    }
    req.params.gameweek = gameweek; // Replace with parsed integer
  }
  
  next();
};

// Specific routes first
router.get('/price-predictions', async (req, res) => {
  try {
    const predictions = await predictPriceChanges();
    res.json(predictions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Then parameterized routes with validation
router.get('/:id', validateIntParams, async (req, res) => {
  try {
    const data = await getManagerData(req.params.id);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/picks/:gameweek', async (req, res) => {
  const { id, gameweek } = req.params;
  try {
    const picksData = await getPicksData(id, gameweek);
    res.json(picksData);
  } catch (error) {
    console.error(`Error fetching picks data for ID ${id}, GW ${gameweek}:`, error.message);
    res.status(500).json({
      error: 'Failed to fetch picks data',
      message: error.message,
      fallback: {
        picks: [],
        transferPenalty: 0,
        totalLivePoints: 0,
        autosubs: [],
        viceCaptainPoints: null,
        liveRank: null
      }
    });
  }
});
router.get('/:id/planner', validateIntParams, async (req, res) => {
  try {
    const data = await getPlannerData(req.params.id);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/top10k/:gameweek', validateIntParams, async (req, res) => {
  try {
    const data = await getTop10kStats(req.params.gameweek);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Simulate rank
router.get('/:id/rank-simulator/:gameweek', validateIntParams, async (req, res) => {
  try {
    const additionalPoints = parseInt(req.query.points) || 0;
    const data = await simulateRank(req.params.id, req.params.gameweek, additionalPoints);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/captaincy/:gameweek', validateIntParams, async (req, res) => {
  try {
    const data = await getCaptaincySuggestions(req.params.id, req.params.gameweek);
    // If data is null, return an empty array rather than null
    res.json(data || []);
  } catch (error) {
    console.error('Error in captaincy endpoint:', { 
      managerId: req.params.id, 
      gameweek: req.params.gameweek, 
      error: error.message,
      stack: error.stack 
    });
    
    // Return a fallback response instead of an error
    res.json([
      { 
        id: 0, 
        name: "Unable to generate suggestions", 
        teamId: 0,
        form: "0.0", 
        difficulty: 0, 
        eo: 0, 
        score: "0.0" 
      }
    ]);
  }
});

// Persist transfers
router.post('/:id/transfers', validateIntParams, async (req, res) => {
  try {
    const { id } = req.params;
    const { gameweek, out: playerOutId, in: playerInId } = req.body;

    // Validate request body parameters
    if (!gameweek || !playerOutId || !playerInId) {
      return res.status(400).json({ error: 'Missing required fields: gameweek, out, or in' });
    }
    
    // Additional validation for request body integers
    const gwInt = parseInt(gameweek);
    const outInt = parseInt(playerOutId);
    const inInt = parseInt(playerInId);
    
    if (isNaN(gwInt) || gwInt < 1 || gwInt > 38) {
      return res.status(400).json({ error: 'Invalid gameweek: must be an integer between 1 and 38' });
    }
    
    if (isNaN(outInt) || isNaN(inInt)) {
      return res.status(400).json({ error: 'Invalid player IDs: must be integers' });
    }

    // Fetch planner data to validate the transfer
    const plannerData = await getPlannerData(id);
    const playerOut = plannerData.currentPicks.find(p => p.id === outInt);
    const playerIn = plannerData.allPlayers.find(p => p.id === inInt);

    if (!playerOut || !playerIn) {
      return res.status(400).json({ error: 'Invalid player IDs' });
    }

    // Save the transfer to MongoDB
    const transfer = new Transfer({
      fplId: id,
      gameweek: gwInt, // Use validated integer
      playerOut: {
        id: playerOut.id,
        name: playerOut.name,
        positionType: playerOut.positionType,
        cost: playerOut.cost
      },
      playerIn: {
        id: playerIn.id,
        name: playerIn.name,
        positionType: playerIn.positionType,
        cost: playerIn.cost
      },
      timestamp: new Date()
    });

    await transfer.save();
    res.status(201).json({ message: 'Transfer saved successfully', transfer });
  } catch (error) {
    console.error('Error saving transfer:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;