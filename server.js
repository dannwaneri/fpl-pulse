require('dotenv').config();
const cluster = require('cluster');
const os = require('os');
const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const mongoose = require('mongoose');
const fplRoutes = require('./routes/fplRoutes');
const leagueRoutes = require('./routes/leagueRoutes');
const { reconnectWithBackoff } = require('./config/db'); // Updated to use db.js
const { setupWebSocket } = require('./services/websocketService');
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
  app.use(cors());
  app.use(express.json());

  // Routes
  app.use('/api/fpl', fplRoutes);
  app.use('/api/league', leagueRoutes);

  // Error handling middleware (after routes)
 // app.use(notFoundHandler); // 404 handler
  //app.use(errorHandler);    // General error handler

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