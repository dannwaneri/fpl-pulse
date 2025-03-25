require('dotenv').config();
const cluster = require('cluster');
const os = require('os');
const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const mongoose = require('mongoose');
const fplRoutes = require('./routes/fplRoutes');
const leagueRoutes = require('./routes/leagueRoutes');
const { reconnectWithBackoff } = require('./config/db'); // Updated to use db.js
const { setupWebSocket } = require('./services/websocketService');
const { createProxyMiddleware } = require('http-proxy-middleware');
//const { errorHandler, notFoundHandler } = require('./errorHandler');

const numCPUs = os.cpus().length; // Number of CPU cores for clustering
const PORT = process.env.PORT || 5000;

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  // Fork workers for each CPU core
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
    console.log('Starting a new worker...');
    cluster.fork(); // Replace dead worker
  });
} else {
  // Worker process
  const app = express();

  // Middleware
  app.use(cors({
    origin: ['https://fpl-pulse.onrender.com', 'http://localhost:3000'],
    credentials: true
  }));
  app.use(express.json());



  // Use before your routes
  app.use('/fpl-proxy', createProxyMiddleware({
    target: 'https://fantasy.premierleague.com',
    changeOrigin: true,
    pathRewrite: {
      '^/fpl-proxy': '/api'
    },
    onProxyReq: (proxyReq) => {
      // Set more realistic browser headers
      proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
      proxyReq.setHeader('Accept', 'application/json, text/plain, */*');
      proxyReq.setHeader('Accept-Language', 'en-US,en;q=0.9');
      proxyReq.setHeader('Referer', 'https://fantasy.premierleague.com/');
      proxyReq.setHeader('X-Requested-With', 'XMLHttpRequest');
      proxyReq.setHeader('sec-ch-ua', '"Chromium";v="122", "Google Chrome";v="122", "Not:A-Brand";v="99"');
      proxyReq.setHeader('sec-ch-ua-mobile', '?0');
      proxyReq.setHeader('sec-ch-ua-platform', '"Windows"');
      proxyReq.setHeader('Sec-Fetch-Site', 'same-origin');
      proxyReq.setHeader('Sec-Fetch-Mode', 'cors');
      proxyReq.setHeader('Sec-Fetch-Dest', 'empty');
    },
    // Handle proxy errors
    onError: (err, req, res) => {
      console.error('Proxy error:', err);
      res.status(500).json({ error: 'Proxy error', message: err.message });
    }
  }));

  // Routes
  app.use('/api/fpl', fplRoutes);
  app.use('/api/league', leagueRoutes);

  // Error handling middleware (after routes)
 // app.use(notFoundHandler); // 404 handler
  //app.use(errorHandler);    // General error handler
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'client/build')));
  
    app.get('*', function(req, res) {
      res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
    });
  }

  // Start server
  const server = app.listen(PORT, () => {
    console.log(`Worker ${process.pid} running on http://localhost:${PORT}`);
  });

  // WebSocket setup
  const wss = new WebSocket.Server({ server });
  setupWebSocket(wss);

  // MongoDB connection with retry logic from db.js
  reconnectWithBackoff().catch(err => console.error('Worker MongoDB connection failed:', err));

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log(`Worker ${process.pid} shutting down...`);
    server.close(() => {
      mongoose.connection.close(false, () => {
        console.log(`Worker ${process.pid} MongoDB connection closed`);
        process.exit(0);
      });
    });
  });
}