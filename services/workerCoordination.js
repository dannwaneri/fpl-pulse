// services/workerCoordination.js
const os = require('os');
const { Cache } = require('../config/db');
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
    return this.acquireLock(lockKey, workerId, ttlSeconds);
  },
  
  /**
   * Acquire a distributed lock
   * @param {string} lockKey - Lock identifier
   * @param {string} owner - Lock owner
   * @param {number} ttlSeconds - Lock expiration in seconds
   * @returns {Promise<boolean>} - True if lock acquired
   */
  async acquireLock(lockKey, owner, ttlSeconds = 60) {
    try {
      const lockId = `lock:${lockKey}`;
      const expires = new Date(Date.now() + ttlSeconds * 1000);
      
      // Try a simpler approach without using metadata
      const result = await Cache.findOneAndUpdate(
        { 
          _id: lockId,
          expires: { $lt: new Date() } // Lock expired
        },
        {
          _id: lockId,
          data: { owner: owner, acquired: new Date() },
          expires
        },
        { upsert: true, new: true }
      );
      
      // Check if we own the lock
      return result.data && result.data.owner === owner;
    } catch (err) {
      logger.error(`Error acquiring lock ${lockKey}`, { error: err.message });
      return false;
    }
  },
  
  /**
   * Release leadership for a task
   * @param {string} taskName - Name of the task
   * @returns {Promise<boolean>} - True if released
   */
  async releaseLeadership(taskName) {
    const lockKey = `leader:${taskName}`;
    return this.releaseLock(lockKey, workerId);
  },
  
  /**
   * Release a distributed lock
   * @param {string} lockKey - Lock identifier
   * @param {string} owner - Lock owner
   * @returns {Promise<boolean>} - True if lock released
   */
  async releaseLock(lockKey, owner) {
    try {
      const lockId = `lock:${lockKey}`;
      
      // Only release if we own the lock
      const result = await Cache.findOneAndDelete({
        _id: lockId,
        'data.owner': owner
      });
      
      return !!result;
    } catch (err) {
      logger.error(`Error releasing lock ${lockKey}`, { error: err.message });
      return false;
    }
  },
  
  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {Promise<any>} - Cached value or null
   */
  async getFromCache(key) {
    try {
      const cached = await Cache.findOne({ _id: key });
      
      if (cached && cached.data) {
        // Update access count
        await Cache.updateOne(
          { _id: key },
          { $inc: { 'metadata.accessCount': 1 } }
        );
        
        return cached.data;
      }
      
      return null;
    } catch (err) {
      logger.error(`Error getting cache key ${key}`, { error: err.message });
      return null;
    }
  },
  
  /**
   * Set a value in cache
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttlSeconds - Time to live in seconds
   * @returns {Promise<boolean>} - Success status
   */
  async setInCache(key, value, ttlSeconds = 3600) {
    try {
      const expires = new Date(Date.now() + ttlSeconds * 1000);
      
      await Cache.updateOne(
        { _id: key },
        {
          data: value,
          expires,
          metadata: {
            owner: workerId,
            createdAt: new Date(),
            accessCount: 0
          }
        },
        { upsert: true }
      );
      
      return true;
    } catch (err) {
      logger.error(`Error setting cache key ${key}`, { error: err.message });
      return false;
    }
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
      const completed = await this.getFromCache(taskKey);
      
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
    return this.setInCache(taskKey, { 
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
        const alreadyCompleted = await this.getFromCache(taskCompletedKey);
        
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