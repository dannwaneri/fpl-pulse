require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const cluster = require('cluster');
const os = require('os');
const WebSocket = require('ws');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { reconnectWithBackoff, Bootstrap } = require('./config/db');
const { DEFAULT_BOOTSTRAP_DATA, loadBootstrapData } = require('./services/bootstrapService');
const fplRoutes = require('./routes/fplRoutes');
const leagueRoutes = require('./routes/leagueRoutes');
const { setupWebSocket } = require('./services/websocketService');
const logger = require('./utils/logger');

const numCPUs = os.cpus().length;
const PORT = process.env.PORT || 5000;

if (cluster.isMaster) {
  logger.info(`Master ${process.pid} is running`);

  // Fork workers for each CPU core
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    logger.warn(`Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
    logger.info('Starting a new worker...');
    cluster.fork(); // Replace dead worker
  });
} else {
  // Worker process
  const app = express();

  // Enhanced initialization routine
  const initializeApp = async () => {
    try {
      await reconnectWithBackoff();
      logger.info('MongoDB connection established');

      // Pre-populate cache with DEFAULT_BOOTSTRAP_DATA if no valid cache exists
      const existingCache = await Bootstrap.findOne({ _id: 'bootstrap:latest' }).exec();
      if (!existingCache || !existingCache.data || (!existingCache.data.elements?.length && !existingCache.data.teams?.length)) {
        await Bootstrap.updateOne(
          { _id: 'bootstrap:latest' },
          { $set: { data: DEFAULT_BOOTSTRAP_DATA, timestamp: Date.now() } },
          { upsert: true }
        );
        logger.info('Pre-populated MongoDB cache with default bootstrap data');
      } else {
        logger.info('Cache already populated', {
          elementCount: existingCache.data.elements?.length || 0,
          teamCount: existingCache.data.teams?.length || 0
        });
      }

      // Force an initial bootstrap data refresh in the background
      loadBootstrapData().catch(err => 
        logger.warn('Background bootstrap refresh failed, will continue with cached data', { 
          error: err.message 
        })
      );
      
    } catch (error) {
      logger.error('Failed to initialize app', { message: error.message });
      logger.warn('Continuing with fallback mechanisms');
    }
  };

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Set up the FPL API proxy with improved headers
  app.use('/fpl-proxy', createProxyMiddleware({
    target: 'https://fantasy.premierleague.com',
    changeOrigin: true,
    pathRewrite: { '^/fpl-proxy': '/api' },
    onProxyReq: (proxyReq) => {
      proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      proxyReq.setHeader('Accept', 'application/json, text/plain, */*');
      proxyReq.setHeader('Accept-Language', 'en-US,en;q=0.9');
      proxyReq.setHeader('Origin', 'https://fantasy.premierleague.com');
      proxyReq.setHeader('Referer', 'https://fantasy.premierleague.com/');
    },
    onProxyRes: (proxyRes, req, res) => {
      // Check for HTML responses and handle accordingly
      const contentType = proxyRes.headers['content-type'] || '';
      if (contentType.includes('text/html')) {
        logger.warn('FPL API returned HTML instead of JSON', {
          path: req.path,
          contentType
        });
      }
    },
    onError: (err, req, res) => {
      logger.error('Proxy error:', { message: err.message, path: req.path });
      res.status(500).json({ 
        error: 'Proxy error', 
        message: 'Could not connect to FPL API. Using cached data.'
      });
    }
  }));

  // API Routes
  app.use('/api/fpl', fplRoutes);
  app.use('/api/league', leagueRoutes);

  // Serve static files from the React app
  app.use(express.static(path.join(__dirname, 'client/build')));

  // For any route that is not an API route, serve the React app
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client/build/index.html'));
  });

  // Initialize the application
  initializeApp().then(() => {
    // Start server after initialization
    const server = app.listen(PORT, () => {
      logger.info(`Worker ${process.pid} running on http://localhost:${PORT}`);
    });

    // WebSocket setup
    const wss = new WebSocket.Server({ server });
    setupWebSocket(wss);

    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info(`Worker ${process.pid} shutting down...`);
      server.close(() => {
        process.exit(0);
      });
    });
  });
}