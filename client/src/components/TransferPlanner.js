import React, { useState, useEffect, memo } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import useDebouncedPricePredictions from '../hooks/useDebouncedPricePredictions';

const TransferPlanner = memo(({ plannerData, fplId, isLoading, activeChip, assistantManagerPoints }) => {
  const [currentSquad, setCurrentSquad] = useState([]);
  const [budget, setBudget] = useState(0);
  const [transfers, setTransfers] = useState([]);
  const [selectedGameweek, setSelectedGameweek] = useState(1);
  const [planName, setPlanName] = useState('');
  const [selectedPlayerOut, setSelectedPlayerOut] = useState(null);
  const [chips, setChips] = useState({
    wildcard1: { used: false, gameweek: null },
    wildcard2: { used: false, gameweek: null },
    freehit: { used: false, gameweek: null },
    bboost: { used: false, gameweek: null },
    triplecaptain: { used: false, gameweek: null },
    assistant_manager: { used: false, gameweek: null }
  });
  const pricePredictions = useDebouncedPricePredictions();
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });

  // Derived value for adjusted budget
  const adjustedBudget = (plannerData?.budget || 0) - 
    (chips.assistant_manager?.used ? (plannerData?.assistantManagerCost || 10) : 0);

  // Effect for initial setup based on plannerData
  useEffect(() => {
    if (plannerData) {
      setCurrentSquad(plannerData.currentPicks || []);
      setBudget(plannerData.budget || 0); // Set initial budget without adjustment
      setSelectedGameweek(plannerData.currentGameweek || 1);
      
      if (plannerData.currentPicks && plannerData.currentPicks.length > 0) {
        setSelectedPlayerOut(plannerData.currentPicks[0].id);
      }

      if (plannerData.chipsAvailable) {
        setChips(prevChips => ({ ...prevChips, ...plannerData.chipsAvailable }));
      }
    }
  }, [plannerData, fplId]);

  // Effect to sync budget with assistant_manager chip changes
  useEffect(() => {
    setBudget(adjustedBudget);
  }, [adjustedBudget]);

  const validateSquad = (squad, newPlayer = null) => {
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
  };

  const handleTransfer = async (playerOutId, playerInId) => {
    const playerOut = currentSquad.find(p => p.id === parseInt(playerOutId));
    const playerIn = plannerData?.allPlayers.find(p => p.id === parseInt(playerInId));
    if (!playerOut || !playerIn) return;

    const costDifference = playerOut.cost - playerIn.cost;
    const newSquad = currentSquad.map(p => (p.id === parseInt(playerOutId) ? { ...playerIn, position: p.position, multiplier: p.multiplier } : p));

    if (!validateSquad(newSquad)) {
      alert('Invalid squad: Must have 15 players (2 GK, 5 DEF, 5 MID, 3 FWD), max 3 per team, and a valid starting XI (1+ GK, 3+ DEF, 1+ MID, 1+ FWD).');
      return;
    }

    if (budget + costDifference >= 0 || chips.wildcard1?.used || chips.wildcard2?.used || chips.freehit?.gameweek === selectedGameweek) {
      try {
        const response = await fetch(`http://localhost:5000/api/fpl/${fplId}/transfers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameweek: selectedGameweek, out: playerOutId, in: playerInId }),
        });
        if (!response.ok) throw new Error('Failed to save transfer');
        setCurrentSquad(newSquad);
        setBudget(budget + costDifference);
        setTransfers([...transfers, { gameweek: selectedGameweek, out: playerOut, in: playerIn }]);
      } catch (err) {
        alert(err.message);
      }
    } else {
      alert('Insufficient budget for this transfer!');
    }
  };

  const handleCaptaincy = (playerId, type) => {
    const newSquad = currentSquad.map(p => ({
      ...p,
      multiplier: p.id === playerId ? (type === 'captain' ? 2 : 1) : (p.multiplier > 1 && p.id !== playerId ? (type === 'vice' ? 1 : p.multiplier) : p.multiplier)
    }));
    setCurrentSquad(newSquad);
  };

  const handleChip = (chipType) => {
    if (chips[chipType]?.used && chips[chipType]?.gameweek !== selectedGameweek) {
      alert(`${chipType} already used in GW ${chips[chipType].gameweek}!`);
      return;
    }

    const updatedChips = { 
      ...chips, 
      [chipType]: { used: true, gameweek: selectedGameweek } 
    };

    if (chipType === 'freehit') {
      setCurrentSquad(plannerData?.currentPicks || []);
    }

    if (chipType === 'assistant_manager') {
      const assistantManagerCost = plannerData?.assistantManagerCost || 10;
      setBudget(prevBudget => prevBudget - assistantManagerCost); // Adjust budget directly
    }

    setChips(updatedChips);
  };

  const resetChip = (chipType) => {
    const updatedChips = { 
      ...chips, 
      [chipType]: { used: false, gameweek: null } 
    };

    if (chipType === 'assistant_manager') {
      const assistantManagerCost = plannerData?.assistantManagerCost || 10;
      setBudget(prevBudget => prevBudget + assistantManagerCost); // Adjust budget directly
    }

    setChips(updatedChips);
  };

  const savePlan = () => {
    if (!planName) {
      alert('Please enter a plan name.');
      return;
    }
    const plan = { name: planName, squad: currentSquad, budget, transfers, chips };
    localStorage.setItem(`fplPlan_${planName}`, JSON.stringify(plan));
    alert('Plan saved!');
  };

  const loadPlan = (name) => {
    const savedPlan = localStorage.getItem(`fplPlan_${name}`);
    if (savedPlan) {
      const { squad, budget, transfers, chips } = JSON.parse(savedPlan);
      setCurrentSquad(squad);
      setBudget(budget);
      setTransfers(transfers);
      setChips(chips);
      setPlanName(name);
      alert('Plan loaded!');
    } else {
      alert('No plan found with that name.');
    }
  };

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const reorderedSquad = Array.from(currentSquad);
    const [movedPlayer] = reorderedSquad.splice(result.source.index, 1);
    reorderedSquad.splice(result.destination.index, 0, movedPlayer);
    const updatedSquad = reorderedSquad.map((player, index) => ({
      ...player,
      position: index + 1
    }));
    if (validateSquad(updatedSquad)) {
      setCurrentSquad(updatedSquad);
    } else {
      alert('Invalid squad arrangement!');
    }
  };

  const getFixtureDetails = (teamId, gameweek) => {
    const gwFixtures = plannerData?.fixtures?.find(f => f.gameweek === gameweek)?.matches || [];
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

  const getPositionColor = (position) => {
    switch (position) {
      case 'GK': return 'bg-yellow-500';
      case 'DEF': return 'bg-blue-500';
      case 'MID': return 'bg-green-500';
      case 'FWD': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getDifficultyColor = (difficulty) => {
    switch (difficulty) {
      case 1: return 'bg-green-100 text-green-800';
      case 2: return 'bg-green-200 text-green-800';
      case 3: return 'bg-yellow-100 text-yellow-800';
      case 4: return 'bg-red-100 text-red-800';
      case 5: return 'bg-red-200 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const sortSquad = (key) => {
    const direction = sortConfig.key === key && sortConfig.direction === 'asc' ? 'desc' : 'asc';
    setSortConfig({ key, direction });

    const sortedSquad = [...currentSquad].sort((a, b) => {
      if (key === 'predictedChange') {
        const aPred = pricePredictions.find(p => p.id === a.id)?.predictedChange || 0;
        const bPred = pricePredictions.find(p => p.id === b.id)?.predictedChange || 0;
        return direction === 'asc' ? aPred - bPred : bPred - aPred;
      }
      return direction === 'asc' ? a[key] - b[key] : b[key] - a[key];
    });
    setCurrentSquad(sortedSquad);
  };

  if (isLoading) return <div className="bg-white p-6 rounded-lg shadow-md mb-6 animate-pulse">Loading...</div>;
  if (!plannerData) return <div className="bg-white p-6 rounded-lg shadow-md mb-6 text-gray-600 italic">No planner data available.</div>;

  const gks = currentSquad.filter(p => p.positionType === 'GK');
  const defs = currentSquad.filter(p => p.positionType === 'DEF');
  const mids = currentSquad.filter(p => p.positionType === 'MID');
  const fwds = currentSquad.filter(p => p.positionType === 'FWD');

  return (
    <div className="bg-gradient-to-br from-white to-green-50 p-6 rounded-lg shadow-md mb-6">
      <h3 className="text-xl font-bold text-gray-800 mb-4">Transfer Planner</h3>

      {/* Budget Display with Assistant Manager Points */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between">
          <p className="text-gray-700">Available Budget:</p>
          <p className="text-xl font-bold text-green-600">
            £{budget.toFixed(1)}m 
            {assistantManagerPoints > 0 && ` +${assistantManagerPoints} pts (AM)`}
          </p>
        </div>
      </div>

      {/* Chips Section with All 6 Chips */}
      <div className="bg-white p-4 rounded-lg shadow-sm mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Chips</label>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => handleChip('wildcard1')}
            className={`p-2 rounded-md ${chips.wildcard1?.used ? 'bg-blue-100 text-blue-800' : 'bg-blue-600 text-white'}`}
          >
            Wildcard 1 {chips.wildcard1?.used ? `(GW ${chips.wildcard1.gameweek})` : ''}
          </button>
          <button
            onClick={() => resetChip('wildcard1')}
            className="p-2 rounded-md bg-gray-200 text-gray-700"
            disabled={!chips.wildcard1?.used}
          >
            Reset WC1
          </button>

          <button
            onClick={() => handleChip('wildcard2')}
            className={`p-2 rounded-md ${chips.wildcard2?.used ? 'bg-blue-200 text-blue-900' : 'bg-blue-700 text-white'}`}
          >
            Wildcard 2 {chips.wildcard2?.used ? `(GW ${chips.wildcard2.gameweek})` : ''}
          </button>
          <button
            onClick={() => resetChip('wildcard2')}
            className="p-2 rounded-md bg-gray-200 text-gray-700"
            disabled={!chips.wildcard2?.used}
          >
            Reset WC2
          </button>

          <button
            onClick={() => handleChip('freehit')}
            className={`p-2 rounded-md ${chips.freehit?.used ? 'bg-purple-100 text-purple-800' : 'bg-purple-600 text-white'}`}
          >
            Free Hit {chips.freehit?.used ? `(GW ${chips.freehit.gameweek})` : ''}
          </button>
          <button
            onClick={() => resetChip('freehit')}
            className="p-2 rounded-md bg-gray-200 text-gray-700"
            disabled={!chips.freehit?.used}
          >
            Reset FH
          </button>

          <button
            onClick={() => handleChip('bboost')}
            className={`p-2 rounded-md ${chips.bboost?.used ? 'bg-green-100 text-green-800' : 'bg-green-600 text-white'}`}
          >
            Bench Boost {chips.bboost?.used ? `(GW ${chips.bboost.gameweek})` : ''}
          </button>
          <button
            onClick={() => resetChip('bboost')}
            className="p-2 rounded-md bg-gray-200 text-gray-700"
            disabled={!chips.bboost?.used}
          >
            Reset BB
          </button>

          <button
            onClick={() => handleChip('triplecaptain')}
            className={`p-2 rounded-md ${chips.triplecaptain?.used ? 'bg-yellow-100 text-yellow-800' : 'bg-yellow-600 text-white'}`}
          >
            Triple Captain {chips.triplecaptain?.used ? `(GW ${chips.triplecaptain.gameweek})` : ''}
          </button>
          <button
            onClick={() => resetChip('triplecaptain')}
            className="p-2 rounded-md bg-gray-200 text-gray-700"
            disabled={!chips.triplecaptain?.used}
          >
            Reset TC
          </button>

          <button
            onClick={() => handleChip('assistant_manager')}
            className={`p-2 rounded-md ${chips.assistant_manager?.used ? 'bg-red-100 text-red-800' : 'bg-red-600 text-white'}`}
          >
            Asst Manager {chips.assistant_manager?.used ? `(GW ${chips.assistant_manager.gameweek})` : ''}
          </button>
          <button
            onClick={() => resetChip('assistant_manager')}
            className="p-2 rounded-md bg-gray-200 text-gray-700"
            disabled={!chips.assistant_manager?.used}
          >
            Reset AM
          </button>
        </div>
      </div>

      {/* Controls Section */}
      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg shadow-sm">
          <label className="block text-sm font-medium text-gray-700 mb-2">Gameweek</label>
          <select
            value={selectedGameweek}
            onChange={(e) => setSelectedGameweek(parseInt(e.target.value))}
            className="block w-full p-2 border border-gray-300 rounded-md"
          >
            {plannerData?.fixtures?.map(f => (
              <option key={f.gameweek} value={f.gameweek}>GW {f.gameweek}</option>
            ))}
          </select>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm">
          <label className="block text-sm font-medium text-gray-700 mb-2">Transfer Plan</label>
          <div className="flex space-x-2">
            <input
              type="text"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              placeholder="Enter plan name"
              className="block w-full p-2 border border-gray-300 rounded-md"
            />
            <button onClick={savePlan} className="bg-green-600 text-white px-3 py-2 rounded-md">Save</button>
            <button onClick={() => loadPlan(planName)} className="bg-blue-600 text-white px-3 py-2 rounded-md">Load</button>
          </div>
        </div>
      </div>

      {/* Transfer Planning Section */}
      <div className="bg-white p-4 rounded-lg shadow-sm mb-6">
        <h4 className="text-md font-semibold text-gray-700 mb-3">Plan Transfer</h4>
        <div className="flex flex-col md:flex-row gap-2 md:items-center">
          <select 
            value={selectedPlayerOut || ''}
            onChange={(e) => setSelectedPlayerOut(parseInt(e.target.value))}
            className="p-2 border border-gray-300 rounded-md md:w-1/3"
          >
            {currentSquad.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.positionType})</option>
            ))}
          </select>
          <div className="flex items-center justify-center p-2">
            <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </div>
          <select
            onChange={(e) => handleTransfer(selectedPlayerOut, e.target.value)}
            className="p-2 border border-gray-300 rounded-md md:w-1/3"
            defaultValue=""
          >
            <option value="">Select Player In</option>
            {plannerData?.allPlayers
              ?.filter(p => {
                const playerOut = currentSquad.find(sq => sq.id === selectedPlayerOut);
                return playerOut && p.positionType === playerOut.positionType;
              })
              .sort((a, b) => a.cost - b.cost)
              .map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} (£{p.cost.toFixed(1)}m)
                </option>
              ))}
          </select>
        </div>
      </div>

      {/* Current Squad Pitch */}
      <div className="bg-white p-4 rounded-lg shadow-sm mb-6">
        <h4 className="text-md font-semibold text-gray-700 mb-3">Current Squad</h4>
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="relative bg-green-100 rounded-lg p-4">
            <div className="absolute inset-0">
              <div className="border-2 border-green-300 rounded-lg w-full h-full"></div>
              <div className="border-2 border-green-300 rounded-lg w-1/3 h-1/4 absolute top-0 left-1/2 transform -translate-x-1/2"></div>
            </div>

            <div className="relative z-10 space-y-4">
              <Droppable droppableId="gk" direction="horizontal">
                {(provided) => (
                  <div className="flex justify-center gap-2" ref={provided.innerRef} {...provided.droppableProps}>
                    {gks.map((player, index) => (
                      <Draggable key={player.id} draggableId={player.id.toString()} index={index}>
                        {(provided) => (
                          <PlayerCard
                            player={player}
                            color={getPositionColor(player.positionType)}
                            provided={provided}
                            handleCaptaincy={handleCaptaincy}
                            pricePrediction={pricePredictions.find(p => p.id === player.id)?.predictedChange || 0}
                            currentSquad={currentSquad}
                          />
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>

              <Droppable droppableId="def" direction="horizontal">
                {(provided) => (
                  <div className="flex justify-around gap-2" ref={provided.innerRef} {...provided.droppableProps}>
                    {defs.map((player, index) => (
                      <Draggable key={player.id} draggableId={player.id.toString()} index={index}>
                        {(provided) => (
                          <PlayerCard
                            player={player}
                            color={getPositionColor(player.positionType)}
                            provided={provided}
                            handleCaptaincy={handleCaptaincy}
                            pricePrediction={pricePredictions.find(p => p.id === player.id)?.predictedChange || 0}
                            currentSquad={currentSquad}
                          />
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>

              <Droppable droppableId="mid" direction="horizontal">
                {(provided) => (
                  <div className="flex justify-around gap-2" ref={provided.innerRef} {...provided.droppableProps}>
                    {mids.map((player, index) => (
                      <Draggable key={player.id} draggableId={player.id.toString()} index={index}>
                        {(provided) => (
                          <PlayerCard
                            player={player}
                            color={getPositionColor(player.positionType)}
                            provided={provided}
                            handleCaptaincy={handleCaptaincy}
                            pricePrediction={pricePredictions.find(p => p.id === player.id)?.predictedChange || 0}
                            currentSquad={currentSquad}
                          />
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>

              <Droppable droppableId="fwd" direction="horizontal">
                {(provided) => (
                  <div className="flex justify-around gap-2" ref={provided.innerRef} {...provided.droppableProps}>
                    {fwds.map((player, index) => (
                      <Draggable key={player.id} draggableId={player.id.toString()} index={index}>
                        {(provided) => (
                          <PlayerCard
                            player={player}
                            color={getPositionColor(player.positionType)}
                            provided={provided}
                            handleCaptaincy={handleCaptaincy}
                            pricePrediction={pricePredictions.find(p => p.id === player.id)?.predictedChange || 0}
                            currentSquad={currentSquad}
                          />
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          </div>

          {/* Squad Table with Sortable Price Prediction Column */}
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-100 text-gray-700 text-sm">
                  <th className="p-2">Player</th>
                  <th className="p-2">Position</th>
                  <th className="p-2">Cost</th>
                  <th className="p-2 cursor-pointer" onClick={() => sortSquad('predictedChange')}>
                    Price Change {sortConfig.key === 'predictedChange' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                  </th>
                </tr>
              </thead>
              <tbody>
                {currentSquad.map(player => (
                  <tr key={player.id} className="border-b hover:bg-gray-50">
                    <td className="p-2">{player.name}</td>
                    <td className="p-2">{player.positionType}</td>
                    <td className="p-2">£{player.cost.toFixed(1)}m</td>
                    <td className="p-2">
                      <span className={pricePredictions.find(p => p.id === player.id)?.predictedChange > 0 ? 'text-green-600' : pricePredictions.find(p => p.id === player.id)?.predictedChange < 0 ? 'text-red-600' : ''}>
                        {pricePredictions.find(p => p.id === player.id)?.predictedChange || 0}£m
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DragDropContext>
      </div>

      {/* Fixtures Grid */}
      <div className="bg-white p-4 rounded-lg shadow-sm mb-6">
        <h4 className="text-md font-semibold text-gray-700 mb-3">Upcoming Fixtures</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-700 text-sm">
                <th className="p-2">Player</th>
                {Array.from({ length: 5 }, (_, i) => selectedGameweek + i).map(gw => (
                  <th key={gw} className="p-2 text-center">GW {gw}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {currentSquad.map(player => (
                <tr key={player.id} className="border-b hover:bg-gray-50">
                  <td className="p-2 flex items-center">
                    <div className={`${getPositionColor(player.positionType)} w-2 h-6 mr-2`}></div>
                    {player.name}
                  </td>
                  {Array.from({ length: 5 }, (_, i) => selectedGameweek + i).map(gw => {
                    const { opponent, difficulty, location } = getFixtureDetails(player.teamId, gw);
                    return (
                      <td key={gw} className="p-2 text-center">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getDifficultyColor(difficulty)}`}>
                          {opponent} ({location})
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Transfer History */}
      <div className="bg-white p-4 rounded-lg shadow-sm">
        <h4 className="text-md font-semibold text-gray-700 mb-3">Transfer History</h4>
        {transfers.length > 0 ? (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-700 text-sm">
                <th className="p-2">Gameweek</th>
                <th className="p-2">Out</th>
                <th className="p-2">In</th>
                <th className="p-2 text-right">Cost Difference</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t, index) => (
                <tr key={index} className="border-b hover:bg-gray-50">
                  <td className="p-2">GW {t.gameweek}</td>
                  <td className="p-2">{t.out.name}</td>
                  <td className="p-2">{t.in.name}</td>
                  <td className="p-2 text-right">
                    <span className={`${(t.out.cost - t.in.cost) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {(t.out.cost - t.in.cost) >= 0 ? '+' : ''}£{(t.out.cost - t.in.cost).toFixed(1)}m
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-gray-500 italic text-center py-4">No transfers planned yet.</p>
        )}
      </div>
    </div>
  );
});

const PlayerCard = ({ player, color, provided, handleCaptaincy, pricePrediction, currentSquad }) => {
  const isCaptain = player.multiplier === 2;
  return (
    <div
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      className="w-24 text-center bg-white rounded shadow-md"
    >
      <div className={`${color} h-2 w-full rounded-t`}></div>
      <div className="p-2">
        <p className="text-xs font-medium text-gray-800 truncate">{player.name}</p>
        <p className="text-xs text-gray-600">£{player.cost.toFixed(1)}m</p>
        <p className={`text-xs ${pricePrediction > 0 ? 'text-green-600' : pricePrediction < 0 ? 'text-red-600' : 'text-gray-600'}`}>
          {pricePrediction > 0 ? '+' : ''}{pricePrediction}£m
        </p>
        <div className="flex justify-center gap-1 mt-1">
          <button
            onClick={() => handleCaptaincy(player.id, 'captain')}
            className={`w-6 h-6 rounded-full ${isCaptain ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            C
          </button>
          <button
            onClick={() => handleCaptaincy(player.id, 'vice')}
            className={`w-6 h-6 rounded-full ${player.multiplier === 1 && currentSquad.some(p => p.multiplier === 2 && p.id !== player.id) ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            V
          </button>
        </div>
      </div>
    </div>
  );
};

export default TransferPlanner;