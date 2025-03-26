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
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

// Configuration constants
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const numCPUs = os.cpus().length;

// Create rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: NODE_ENV === 'production' ? 1000 : 5000, // Limit each IP to X requests per windowMs
  message: 'Too many requests, please try again later',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Enhanced cluster management
const setupWorker = () => {
  const app = express();

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'cdnjs.cloudflare.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'wss:', 'ws:']
      }
    }
  }));

  // Compression middleware
  app.use(compression());

  // Middleware
  app.use(cors({
    origin: NODE_ENV === 'production' 
      ? ['https://fpl-pulse.onrender.com', 'https://www.fpl-pulse.com'] 
      : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
  app.use(express.json({ limit: '50kb' })); // Prevent large payloads
  app.use(express.urlencoded({ extended: true, limit: '50kb' }));

  // Apply rate limiting to all requests
  app.use('/api/', apiLimiter);

  // Enhanced initialization routine
  const initializeApp = async () => {
    try {
      // Establish MongoDB connection
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

  // Set up the FPL API proxy with improved headers and error handling
app.use('/fpl-proxy', createProxyMiddleware({
  target: 'https://fantasy.premierleague.com',
  changeOrigin: true,
  pathRewrite: { '^/fpl-proxy': '/api' },
  onProxyReq: (proxyReq) => {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    ];
    
    // Explicitly set cookies from environment variables if available
    if (process.env.FPL_COOKIES) {
      proxyReq.setHeader('Cookie', process.env.FPL_COOKIES);
    }
    
    proxyReq.setHeader('User-Agent', userAgents[Math.floor(Math.random() * userAgents.length)]);
    proxyReq.setHeader('Accept', 'application/json, text/plain, */*');
    proxyReq.setHeader('Accept-Language', 'en-US,en;q=0.9');
    proxyReq.setHeader('Accept-Encoding', 'gzip, deflate, br');
    proxyReq.setHeader('Connection', 'keep-alive');
    proxyReq.setHeader('Origin', 'https://fantasy.premierleague.com');
    proxyReq.setHeader('Referer', 'https://fantasy.premierleague.com/api/');
    proxyReq.setHeader('Sec-Fetch-Dest', 'empty');
    proxyReq.setHeader('Sec-Fetch-Mode', 'cors');
    proxyReq.setHeader('Sec-Fetch-Site', 'same-origin');
  },
  onProxyRes: (proxyRes, req) => {
    const contentType = proxyRes.headers['content-type'] || '';
    if (contentType.includes('text/html')) {
      logger.warn('FPL API returned HTML instead of JSON', {
        path: req.path,
        contentType
      });
    }
    
    // Handle rate limiting
    if (proxyRes.statusCode === 429) {
      logger.warn('Rate limited by FPL API', {
        path: req.path,
        retryAfter: proxyRes.headers['retry-after']
      });
    }
  },
  onError: (err, req) => {
    logger.error('Proxy error:', { 
      message: err.message, 
      path: req.path,
      code: err.code
    });
  }
}));

  // API Routes
  app.use('/api/fpl', fplRoutes);
  app.use('/api/league', leagueRoutes);

  // Error handling middleware
  app.use((err, req, res, next) => {
    logger.error('Unhandled error', { 
      method: req.method, 
      path: req.path, 
      error: err.message 
    });
    
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message 
    });
  });

  // Serve static files from the React app in production
  if (NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'client/build')));

    // For any route that is not an API route, serve the React app
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'client/build/index.html'));
    });
  }

  // Initialize the application
  initializeApp().then(() => {
    // Start server after initialization
    const server = app.listen(PORT, () => {
      logger.info(`Worker ${process.pid} running on http://localhost:${PORT}`);
      logger.info(`Environment: ${NODE_ENV}`);
    });

    // WebSocket setup
    const wss = new WebSocket.Server({ server });
    setupWebSocket(wss);

    // Graceful shutdown
    const gracefulShutdown = (signal) => {
      logger.info(`Received ${signal}. Shutting down gracefully...`);
      server.close(() => {
        logger.info('HTTP server closed.');
        // Close database connections, etc.
        process.exit(0);
      });

      // Force close server after 10 seconds
      setTimeout(() => {
        logger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 10000);
    };

    // Handle termination signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  }).catch(error => {
    logger.error('Failed to start server', { message: error.message });
    process.exit(1);
  });
};

// Cluster management
if (cluster.isPrimary && NODE_ENV === 'production') {
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
  // Worker process or development mode
  setupWorker();
}

module.exports = { setupWorker };
