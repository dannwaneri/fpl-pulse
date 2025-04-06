require('dotenv').config();
const mongoose = require('mongoose');
const logger = require('../utils/logger');

// Connection options with retry settings
const mongooseOptions = {
  serverSelectionTimeoutMS: 30000, // Increase from 5000 to 30000
  heartbeatFrequencyMS: 10000,
  autoIndex: true,
};

// Exponential backoff reconnection logic
const reconnectWithBackoff = async (attempt = 1, maxAttempts = 5) => {
  const maxDelay = 10000;
  const baseDelay = 1000;

  try {
    if (mongoose.connection.readyState === 0 || mongoose.connection.readyState === 3) {
      await mongoose.connect(process.env.MONGODB_URI, mongooseOptions);
      logger.info('MongoDB connected successfully');
      return true;
    }
    return true;
  } catch (error) {
    if (attempt >= maxAttempts) {
      logger.error(`Max reconnection attempts (${maxAttempts}) reached:`, error);
      throw error;
    }

    const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
    const jitter = Math.random() * 100;
    const totalDelay = delay + jitter;

    logger.info(`Reconnection attempt ${attempt}/${maxAttempts}. Waiting ${totalDelay}ms...`);
    await new Promise(resolve => setTimeout(resolve, totalDelay));
    return reconnectWithBackoff(attempt + 1, maxAttempts);
  }
};

// Initial connection
reconnectWithBackoff().catch(err => logger.error('Initial connection failed:', err));

const db = mongoose.connection;
db.on('error', (error) => logger.error('MongoDB connection error:', error));
db.on('disconnected', () => {
  logger.info('MongoDB disconnected. Attempting to reconnect...');
  reconnectWithBackoff();
});
db.once('open', () => logger.info('Connected to MongoDB!'));

// Bootstrap Schema - Updated to include managers
const bootstrapSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: 'bootstrap:latest', immutable: true },
  data: {
    events: [{
      id: { type: Number, required: true },
      deadline_time: { type: Date, required: true },
      is_current: { type: Boolean, required: true }
    }],
    teams: [{
      id: { type: Number, required: true },
      name: { type: String, required: true, trim: true }
    }],
    players: [{
      id: { type: Number, required: true },
      web_name: { type: String, required: true, trim: true },
      element_type: { type: Number, required: true, min: 1, max: 4 },
      now_cost: { type: Number, required: true, min: 0 }
    }],
    managers: [{
      id: { type: Number, required: true },
      name: { type: String, required: true, trim: true },
      team_id: { type: Number, required: true },
      cost: { type: Number, required: true, min: 5, max: 30 } // £0.5m–£3.0m in tenths
    }]
  },
  timestamp: { type: Date, default: Date.now, required: true, expires: 3600 }
});

// TopStats Schema - Updated for more flexible structure
const topStatsSchema = new mongoose.Schema({
  _id: { type: String, required: true, immutable: true },
  stats: {
    type: mongoose.Schema.Types.Mixed, // Use Mixed type for more flexibility
    required: true,
    validate: {
      validator: function(value) {
        // Basic validation to ensure we have the minimum required tiers
        return value && (value.top10k || value.top100k);
      },
      message: 'Stats must contain at least one tier of data'
    }
  },
  timestamp: { type: Date, default: Date.now, required: true }
});

// PicksData Schema - Updated to support assistant manager data
const picksDataSchema = new mongoose.Schema({
  _id: { type: String, required: true, immutable: true, match: /^picks:\d+:\d+$/ },
  data: {
    picks: [{
      playerId: { type: Number, required: true },
      name: { type: String },
      position: { type: Number },
      positionType: { type: String },
      multiplier: { type: Number },
      livePoints: { type: Number },
      bonus: { type: Number },
      goals: { type: Number },
      assists: { type: Number },
      teamId: { type: Number },
      eo: { type: mongoose.Schema.Types.Mixed }, // Can be string or number
      minutes: { type: Number },
      isDifferential: { type: Boolean },
      events: [{ 
        type: { type: String },
        points: { type: Number },
        count: { type: Number, default: 1 } // Added count field with default value of 1
      }]
    }],
    transferPenalty: { type: Number, default: 0 },
    totalLivePoints: { type: Number },
    autosubs: [{ 
      in: { type: Number, required: true }, 
      out: { type: Number, required: true } 
    }],
    viceCaptainPoints: { type: Number },
    liveRank: { type: Number },
    activeChip: { type: String, enum: ['wildcard', 'freehit', 'bboost', '3cap', 'assistant_manager', null], default: null },
    assistantManagerPoints: { type: Number, default: 0 },
    assistantManager: {
      id: { type: Number },
      name: { type: String },
      teamId: { type: Number },
      cost: { type: Number }
    }
  },
  timestamp: { type: Date, default: Date.now, required: true }
});

// PlannerData Schema - Updated with assistant manager data
const plannerDataSchema = new mongoose.Schema({
  _id: { type: String, required: true, immutable: true, match: /^planner:\d+$/ },
  data: {
    currentPicks: [{
      id: { type: Number, required: true },
      name: { type: String },
      teamId: { type: Number },
      positionType: { type: String },
      cost: { type: Number },
      position: { type: Number },
      multiplier: { type: Number },
      total_points: { type: Number },
      form: { type: mongoose.Schema.Types.Mixed },
      goals_scored: { type: Number },
      assists: { type: Number }
    }],
    allPlayers: [{
      id: { type: Number, required: true },
      name: { type: String },
      teamId: { type: Number },
      positionType: { type: String },
      cost: { type: Number },
      total_points: { type: Number }
    }],
    fixtures: [{
      gameweek: { type: Number },
      deadline: { type: Date },
      isCurrent: { type: Boolean },
      matches: [{
        teamH: { type: Number },
        teamA: { type: Number },
        teamHName: { type: String },
        teamAName: { type: String },
        difficultyH: { type: Number },
        difficultyA: { type: Number }
      }]
    }],
    budget: { type: Number },
    chipsUsed: [{ type: String }],
    chipsAvailable: {
      wildcard1: { type: Boolean, default: true },
      wildcard2: { type: Boolean, default: true },
      freehit: { type: Boolean, default: true },
      bboost: { type: Boolean, default: true },
      triplecaptain: { type: Boolean, default: true },
      assistant_manager: { type: Boolean, default: true }
    },
    currentGameweek: { type: Number },
    activeChip: { type: String, enum: ['wildcard', 'freehit', 'bboost', '3cap', 'assistant_manager', null], default: null },
    assistantManager: {
      id: { type: Number },
      name: { type: String },
      teamId: { type: Number },
      cost: { type: Number }
    },
    availableManagers: [{
      id: { type: Number },
      name: { type: String },
      teamId: { type: Number },
      cost: { type: Number }
    }]
  },
  timestamp: { type: Date, default: Date.now, required: true }
});

// Transfer Schema - Updated with more flexible position types
const transferSchema = new mongoose.Schema({
  fplId: { type: String, required: true, immutable: true },
  gameweek: { type: Number, required: true, min: 1, max: 38 },
  playerOut: {
    id: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    positionType: { type: String, required: true, enum: ['GK', 'GKP', 'DEF', 'MID', 'FWD'] },
    cost: { type: Number, required: true, min: 0 }
  },
  playerIn: {
    id: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    positionType: { type: String, required: true, enum: ['GK', 'GKP', 'DEF', 'MID', 'FWD'] },
    cost: { type: Number, required: true, min: 0 }
  },
  timestamp: { type: Date, default: Date.now, required: true }
});

// Assistant Manager Schema - For tracking assistant manager activations
const assistantManagerSchema = new mongoose.Schema({
  fplId: { type: String, required: true },
  gameweek: { type: Number, required: true, min: 1, max: 38 },
  managerId: { type: Number, required: true },
  managerName: { type: String, required: true },
  teamId: { type: Number, required: true },
  cost: { type: Number, required: true },
  activated: { type: Date, default: Date.now },
  points: { type: Number, default: 0 }
});

// Add compound index for fplId + gameweek
assistantManagerSchema.index({ fplId: 1, gameweek: 1 }, { unique: true });

// API Metrics Schema - For tracking API reliability and performance
const apiMetricsSchema = new mongoose.Schema({
  endpoint: { 
    type: String, 
    required: true,
    index: true 
  },
  source: { 
    type: String, 
    enum: ['worker', 'direct', 'cache', 'fallback'],
    required: true,
    index: true
  },
  successRate: { 
    type: Number,
    min: 0,
    max: 100 
  },
  responseTime: { 
    type: Number,
    min: 0
  },
  requestCount: {
    type: Number,
    default: 1,
    min: 1
  },
  successCount: {
    type: Number,
    default: 0,
    min: 0
  },
  failureCount: {
    type: Number,
    default: 0,
    min: 0
  },
  lastError: {
    message: String,
    status: Number,
    timestamp: Date
  },
  timestamp: { 
    type: Date, 
    default: Date.now, 
    required: true,
    expires: 604800 // Auto-expire after 7 days
  }
});

// Create compound index for faster querying
apiMetricsSchema.index({ endpoint: 1, source: 1, timestamp: -1 });

// Models
const Bootstrap = mongoose.model('Bootstrap', bootstrapSchema);
const TopStats = mongoose.model('TopStats', topStatsSchema);
const PicksData = mongoose.model('PicksData', picksDataSchema);
const PlannerData = mongoose.model('PlannerData', plannerDataSchema);
const Transfer = mongoose.model('Transfer', transferSchema);
const AssistantManager = mongoose.model('AssistantManager', assistantManagerSchema);
const ApiMetrics = mongoose.model('ApiMetrics', apiMetricsSchema);

module.exports = { 
  db, 
  TopStats, 
  PicksData, 
  PlannerData, 
  Transfer, 
  Bootstrap,
  AssistantManager,
  ApiMetrics,
  reconnectWithBackoff
};