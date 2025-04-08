// services/mongooseCache.js
const mongoose = require('mongoose');
const logger = require('../utils/logger');

// Create a dedicated schema for caching
const cacheSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true },
  expires: { type: Date, required: true, index: { expires: 0 } }, // TTL index
  metadata: {
    source: String,
    owner: String,
    createdAt: { type: Date, default: Date.now },
    accessCount: { type: Number, default: 0 }
  }
});

// Create a model if it doesn't already exist
const Cache = mongoose.models.Cache || mongoose.model('Cache', cacheSchema);

// Cache service
const mongooseCache = {
  /**
   * Get data from cache
   * @param {string} key - Cache key
   * @returns {Promise<any>} - Cached data or null
   */
  async get(key) {
    try {
      // Find a non-expired cache entry
      const cacheDoc = await Cache.findOneAndUpdate(
        { _id: key, expires: { $gt: new Date() } },
        { $inc: { 'metadata.accessCount': 1 } },
        { new: true }
      );
      
      if (cacheDoc) {
        logger.info(`Cache hit for ${key}, age: ${(Date.now() - cacheDoc.metadata.createdAt) / 1000}s`);
        return cacheDoc.data;
      }
      
      logger.info(`Cache miss for ${key}`);
      return null;
    } catch (err) {
      logger.error(`Mongoose cache get error for ${key}`, { error: err.message });
      return null;
    }
  },
  
  /**
   * Store data in cache
   * @param {string} key - Cache key
   * @param {any} value - Data to cache
   * @param {number} ttlSeconds - Time to live in seconds
   * @param {Object} options - Additional options
   * @returns {Promise<boolean>} - Success status
   */
  async set(key, value, ttlSeconds = 3600, options = {}) {
    try {
      const expires = new Date(Date.now() + ttlSeconds * 1000);
      
      await Cache.findOneAndUpdate(
        { _id: key },
        { 
          data: value, 
          expires,
          metadata: {
            source: options.source || 'app',
            owner: options.owner,
            createdAt: new Date(),
            accessCount: 0
          }
        },
        { upsert: true, new: true }
      );
      
      logger.info(`Cache set for ${key}, expires in ${ttlSeconds} seconds`);
      return true;
    } catch (err) {
      logger.error(`Mongoose cache set error for ${key}`, { error: err.message });
      return false;
    }
  },
  
  /**
   * Check if key exists in cache
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} - True if exists and not expired
   */
  async exists(key) {
    try {
      const count = await Cache.countDocuments({ 
        _id: key, 
        expires: { $gt: new Date() } 
      });
      return count > 0;
    } catch (err) {
      logger.error(`Mongoose cache exists error for ${key}`, { error: err.message });
      return false;
    }
  },
  
  /**
   * Delete cache entry
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} - Success status
   */
  async delete(key) {
    try {
      await Cache.deleteOne({ _id: key });
      logger.info(`Cache deleted for ${key}`);
      return true;
    } catch (err) {
      logger.error(`Mongoose cache delete error for ${key}`, { error: err.message });
      return false;
    }
  },
  
  /**
   * Delete all cache entries with a prefix
   * @param {string} prefix - Cache key prefix
   * @returns {Promise<number>} - Number of entries deleted
   */
  async deleteMany(prefix) {
    try {
      const result = await Cache.deleteMany({ 
        _id: { $regex: new RegExp(`^${prefix}`) } 
      });
      logger.info(`Deleted ${result.deletedCount} cache entries with prefix ${prefix}`);
      return result.deletedCount;
    } catch (err) {
      logger.error(`Mongoose cache deleteMany error for prefix ${prefix}`, { error: err.message });
      return 0;
    }
  },
  
  /**
   * Get or set cache data with a single operation
   * @param {string} key - Cache key
   * @param {Function} fetchFn - Function to call if cache misses
   * @param {number} ttlSeconds - Cache TTL in seconds
   * @returns {Promise<any>} - Cached or freshly fetched data
   */
  async getOrSet(key, fetchFn, ttlSeconds = 3600) {
    try {
      // Try to get from cache first
      const cachedData = await this.get(key);
      if (cachedData !== null) {
        return cachedData;
      }
      
      // If not in cache, fetch fresh data
      logger.info(`Cache miss for ${key}, fetching fresh data`);
      const freshData = await fetchFn();
      
      // Cache the fresh data
      if (freshData !== undefined && freshData !== null) {
        await this.set(key, freshData, ttlSeconds);
      }
      
      return freshData;
    } catch (err) {
      logger.error(`Mongoose cache getOrSet error for ${key}`, { error: err.message });
      throw err; // Rethrow to allow caller to handle
    }
  },
  
  /**
   * Acquire a distributed lock
   * @param {string} lockKey - Lock identifier
   * @param {string} owner - Lock owner identifier
   * @param {number} ttlSeconds - Lock timeout in seconds
   * @returns {Promise<boolean>} - True if lock acquired
   */
  async acquireLock(lockKey, owner, ttlSeconds = 60) {
    try {
      const lockId = `lock:${lockKey}`;
      const expires = new Date(Date.now() + ttlSeconds * 1000);
      
      // First try a direct insert
      try {
        const newLock = new Cache({
          _id: lockId,
          data: { acquired: new Date() },
          expires,
          metadata: {
            owner,
            createdAt: new Date(),
            accessCount: 0
          }
        });
        
        await newLock.save();
        logger.info(`Lock ${lockId} created and acquired by ${owner}`);
        return true;
      } catch (insertErr) {
        // If insert fails due to duplicate key, the lock already exists
        if (insertErr.code === 11000) {
          // Try to update the lock if it's expired
          try {
            const result = await Cache.findOneAndUpdate(
              { 
                _id: lockId,
                expires: { $lt: new Date() } // Only update if expired
              },
              {
                data: { acquired: new Date() },
                expires,
                metadata: {
                  owner,
                  createdAt: new Date(),
                  accessCount: 0
                }
              },
              { new: true }
            );
            
            // If we got a result back, we acquired the lock
            if (result) {
              logger.info(`Expired lock ${lockId} acquired by ${owner}`);
              return true;
            } else {
              // Lock exists and is not expired
              logger.info(`Lock ${lockId} already held by another worker`);
              return false;
            }
          } catch (updateErr) {
            logger.error(`Error updating expired lock ${lockId}`, { error: updateErr.message });
            return false;
          }
        } else {
          // Some other error occurred during insert
          throw insertErr;
        }
      }
    } catch (err) {
      logger.error(`Error acquiring lock ${lockKey}`, { error: err.message });
      return false;
    }
  },
  
  /**
   * Release a distributed lock
   * @param {string} lockKey - Lock identifier
   * @param {string} owner - Lock owner identifier
   * @returns {Promise<boolean>} - True if lock released
   */
  async releaseLock(lockKey, owner) {
    try {
      const lockId = `lock:${lockKey}`;
      
      // Only release if we own the lock
      const result = await Cache.findOneAndDelete({
        _id: lockId,
        'metadata.owner': owner
      });
      
      const released = !!result;
      logger.info(`Lock ${lockId} ${released ? 'released' : 'not released'} by ${owner}`);
      return released;
    } catch (err) {
      logger.error(`Error releasing lock ${lockKey}`, { error: err.message });
      return false;
    }
  }
};

module.exports = mongooseCache;