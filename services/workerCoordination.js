// services/workerCoordination.js
const os = require('os');
const mongooseCache = require('./mongooseCache');
const logger = require('../utils/logger');

// Generate a unique worker ID
const workerId = `${os.hostname()}-${process.pid}-${Date.now()}`;

const workerCoordination = {
  /**
   * Try to become the leader for a specific task
   * @param {string} taskName - Name of the task
   * @param {number} ttlSeconds - How long the leadership lasts
   * @returns {Promise<boolean>} - True if became leader
   */
  async becomeLeader(taskName, ttlSeconds = 60) {
    const lockKey = `leader:${taskName}`;
    return mongooseCache.acquireLock(lockKey, workerId, ttlSeconds);
  },
  
  /**
   * Release leadership for a task
   * @param {string} taskName - Name of the task
   * @returns {Promise<boolean>} - True if released
   */
  async releaseLeadership(taskName) {
    const lockKey = `leader:${taskName}`;
    return mongooseCache.releaseLock(lockKey, workerId);
  },
  
  /**
   * Wait for a task to be completed by any worker
   * @param {string} taskName - Name of the task
   * @param {number} maxWaitMs - Maximum wait time
   * @param {number} checkIntervalMs - Interval between checks
   * @returns {Promise<boolean>} - True if task completed
   */
  async waitForTaskCompletion(taskName, maxWaitMs = 30000, checkIntervalMs = 500) {
    const taskKey = `task:${taskName}:completed`;
    const startTime = Date.now();
    
    // Poll for task completion with exponential backoff
    let attempt = 0;
    
    while (Date.now() - startTime < maxWaitMs) {
      const completed = await mongooseCache.get(taskKey);
      
      if (completed) {
        logger.info(`Task ${taskName} completed by another worker`);
        return true;
      }
      
      // Calculate delay with exponential backoff
      const delay = Math.min(
        checkIntervalMs * Math.pow(1.5, attempt),
        1000 // Max 1 second between checks
      );
      
      await new Promise(resolve => setTimeout(resolve, delay));
      attempt++;
    }
    
    logger.warn(`Timed out waiting for task ${taskName}`);
    return false;
  },
  
  /**
   * Mark a task as completed
   * @param {string} taskName - Name of the task
   * @param {number} ttlSeconds - How long to keep the completed mark
   * @returns {Promise<boolean>} - Success status
   */
  async markTaskCompleted(taskName, ttlSeconds = 3600) {
    const taskKey = `task:${taskName}:completed`;
    return mongooseCache.set(taskKey, { 
      completedBy: workerId, 
      completedAt: new Date() 
    }, ttlSeconds);
  },
  
  /**
   * Initialize bootstrap data with leader election
   * @param {Function} loadBootstrapFn - Function that loads bootstrap data
   * @returns {Promise<Object>} - Bootstrap data
   */
  async initializeBootstrapData(loadBootstrapFn) {
    const taskName = 'bootstrap-init';
    const taskCompletedKey = `task:${taskName}:completed`;
    
    // Try to become the leader
    const isLeader = await this.becomeLeader(taskName, 60);
    
    if (isLeader) {
      logger.info(`Worker ${workerId} became leader for bootstrap initialization`);
      
      try {
        // Check if already completed to avoid duplicate work
        const alreadyCompleted = await mongooseCache.get(taskCompletedKey);
        
        if (!alreadyCompleted) {
          // Load bootstrap data (this is the expensive operation)
          const bootstrapData = await loadBootstrapFn(true);
          
          // Mark task as completed
          await this.markTaskCompleted(taskName, 3600);
          
          logger.info(`Bootstrap data initialized by leader ${workerId}`);
          return bootstrapData;
        } else {
          logger.info('Bootstrap already initialized by another worker');
          
          // Still need to return the bootstrap data
          return await loadBootstrapFn(false);
        }
      } finally {
        // Always release leadership when done
        await this.releaseLeadership(taskName);
      }
    } else {
      logger.info('Another worker is leader for bootstrap initialization, waiting');
      
      // Wait for the task to be completed
      const completed = await this.waitForTaskCompletion(taskName, 30000);
      
      if (completed) {
        // Task completed, load from cache
        return await loadBootstrapFn(false);
      } else {
        // Timeout occurred, try loading anyway
        logger.warn('Timed out waiting for bootstrap initialization, loading directly');
        return await loadBootstrapFn(false);
      }
    }
  },
  
  /**
   * Get the worker ID
   * @returns {string} - Unique worker ID
   */
  getWorkerId() {
    return workerId;
  }
};

module.exports = workerCoordination;