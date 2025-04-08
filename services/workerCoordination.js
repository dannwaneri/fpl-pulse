// services/mongooseCache.js
const { Cache } = require('../db');
const logger = require('../utils/logger');

/**
 * Generic cache service using MongoDB
 */
const mongooseCache = {
  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {Promise<any>} - Cached value or null
   */
  async get(key) {
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
   * @param {string} owner - Optional owner identifier
   * @returns {Promise<boolean>} - Success status
   */
  async set(key, value, ttlSeconds = 3600, owner = null) {
    try {
      const expires = new Date(Date.now() + ttlSeconds * 1000);
      
      await Cache.updateOne(
        { _id: key },
        {
          data: value,
          expires,
          metadata: {
            owner: owner || 'system',
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
   * Delete a key from cache
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} - Success status
   */
  async delete(key) {
    try {
      await Cache.deleteOne({ _id: key });
      return true;
    } catch (err) {
      logger.error(`Error deleting cache key ${key}`, { error: err.message });
      return false;
    }
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
   * Clear all expired items (normally handled by MongoDB TTL index)
   * @returns {Promise<number>} - Number of items removed
   */
  async clearExpired() {
    try {
      const now = new Date();
      const result = await Cache.deleteMany({
        expires: { $lt: now }
      });
      
      return result.deletedCount;
    } catch (err) {
      logger.error('Error clearing expired cache items', { error: err.message });
      return 0;
    }
  }
};

module.exports = mongooseCache;