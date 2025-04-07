const axios = require('axios');
const https = require('https');
const logger = require('../utils/logger');
const mongooseCache = require('./mongooseCache');
const workerCoordination = require('./workerCoordination');

const memoryCache = {
  data: {},
  set: function(key, value, ttl = 300000) {
    this.data[key] = {
      value,
      expiry: Date.now() + ttl
    };
  },
  get: function(key) {
    const item = this.data[key];
    if (!item) return null;
    if (Date.now() > item.expiry) {
      delete this.data[key];
      return null;
    }
    return item.value;
  }
};

class FPLAPIProxyService {
  constructor() {
    this.logger = typeof logger === 'function' ? logger('FPLAPIProxy') : 
                 logger.create ? logger.create('FPLAPIProxy') :
                 logger.getLogger ? logger.getLogger('FPLAPIProxy') : 
                 logger;
    
    this.errorTracker = {
      totalAttempts: 0,
      successfulAttempts: 0,
      failedAttempts: 0,
      lastErrors: []
    };
    
    this.baseURL = process.env.FPL_WORKER_URL || 'https://fpl-api.fpl-test.workers.dev';
    this.directURL = 'https://fantasy.premierleague.com/api';
  }

  async fetchLiveData(gameweek) {
    this.errorTracker.totalAttempts++;
    const cacheKey = `liveData:${gameweek}`;
  
    const memoryCached = memoryCache.get(cacheKey);
    if (memoryCached) {
      this.logger.info('Using memory cache for live data', { gameweek });
      return memoryCached;
    }
  
    try {
      const liveData = await mongooseCache.getOrSet(
        cacheKey,
        async () => {
          const lockKey = `apilock:live:${gameweek}`;
          const lockAcquired = await mongooseCache.acquireLock(
            lockKey,
            workerCoordination.getWorkerId(),
            10
          );
  
          try {
            try {
              const workerResponse = await axios.get(
                `${this.baseURL}/fpl-proxy/event/${gameweek}/live`,
                { timeout: 15000, headers: { 'User-Agent': this._getRandomUserAgent(), 'Accept': 'application/json' } }
              );
              if (workerResponse.data && Array.isArray(workerResponse.data.elements)) {
                memoryCache.set(cacheKey, workerResponse.data, 180000);
                this.errorTracker.successfulAttempts++;
                return workerResponse.data;
              }
              throw new Error('Invalid data structure from worker');
            } catch (workerError) {
              this.logger.warn('Worker fetch failed, attempting direct', { error: workerError.message });
              const response = await this.fetchWithRetry(`${this.directURL}/event/${gameweek}/live/`);
              memoryCache.set(cacheKey, response.data, 180000);
              this.errorTracker.successfulAttempts++;
              return response.data;
            }
          } finally {
            if (lockAcquired) await mongooseCache.releaseLock(lockKey, workerCoordination.getWorkerId());
          }
        },
        600 // 10 minutes TTL
      );
      return liveData;
    } catch (error) {
      this._trackError(error, gameweek);
      // Your snippet integrated here
      try {
        // API call failed
        const staleData = await mongooseCache.get(`stale:${cacheKey}`);
        if (staleData) {
          return staleData;
        }
      } catch (staleError) {
        this.logger.error('Error fetching stale data', { error: staleError.message });
      }
      throw error; // Re-throw original error if no stale data
    }
  }
  async fetchBootstrapData() {
    this.errorTracker.totalAttempts++;
    const cacheKey = 'bootstrap:data';

    return workerCoordination.initializeBootstrapData(async (forceFresh) => {
      if (!forceFresh) {
        const cached = await mongooseCache.get(cacheKey);
        if (cached) return cached;
      }

      const lockKey = 'apilock:bootstrap';
      const lockAcquired = await mongooseCache.acquireLock(lockKey, workerCoordination.getWorkerId(), 20);

      try {
        try {
          const workerResponse = await axios.get(
            `${this.baseURL}/fpl-proxy/bootstrap-static/`,
            { timeout: 15000, headers: { 'User-Agent': this._getRandomUserAgent(), 'Accept': 'application/json' } }
          );
          if (workerResponse.data && Array.isArray(workerResponse.data.elements)) {
            await mongooseCache.set(cacheKey, workerResponse.data, 3600);
            await mongooseCache.set(`stale:${cacheKey}`, workerResponse.data, 86400);
            this.errorTracker.successfulAttempts++;
            return workerResponse.data;
          }
          throw new Error('Invalid data structure from worker');
        } catch (workerError) {
          this.logger.warn('Worker fetch failed', { error: workerError.message });
          const response = await this.fetchWithRetry(`${this.directURL}/bootstrap-static/`);
          await mongooseCache.set(cacheKey, response.data, 3600);
          await mongooseCache.set(`stale:${cacheKey}`, response.data, 86400);
          this.errorTracker.successfulAttempts++;
          return response.data;
        }
      } finally {
        if (lockAcquired) await mongooseCache.releaseLock(lockKey, workerCoordination.getWorkerId());
      }
    });
  }

  async fetchManagerData(managerId) {
    this.errorTracker.totalAttempts++;
    const cacheKey = `managerData:${managerId}`;

    const memoryCached = memoryCache.get(cacheKey);
    if (memoryCached) {
      this.logger.info('Using memory cache for manager data', { managerId });
      return memoryCached;
    }

    try {
      const managerData = await mongooseCache.getOrSet(
        cacheKey,
        async () => {
          const lockKey = `apilock:manager:${managerId}`;
          const lockAcquired = await mongooseCache.acquireLock(lockKey, workerCoordination.getWorkerId(), 10);

          try {
            try {
              const [workerResponse, historyResponse] = await Promise.all([
                axios.get(`${this.baseURL}/fpl-proxy/entry/${managerId}/`, {
                  timeout: 15000,
                  headers: { 'User-Agent': this._getRandomUserAgent(), 'Accept': 'application/json' }
                }),
                axios.get(`${this.baseURL}/fpl-proxy/entry/${managerId}/history/`, {
                  timeout: 15000,
                  headers: { 'User-Agent': this._getRandomUserAgent(), 'Accept': 'application/json' }
                })
              ]);
              if (workerResponse.data && workerResponse.data.player_first_name) {
                const data = { managerData: workerResponse.data, historyData: historyResponse.data };
                memoryCache.set(cacheKey, data, 300000);
                this.errorTracker.successfulAttempts++;
                return data;
              }
              throw new Error('Invalid manager data structure from worker');
            } catch (workerError) {
              this.logger.warn('Worker fetch failed', { error: workerError.message });
              const [managerResponse, historyResponse] = await Promise.all([
                this.fetchWithRetry(`${this.directURL}/entry/${managerId}/`),
                this.fetchWithRetry(`${this.directURL}/entry/${managerId}/history/`)
              ]);
              const data = { managerData: managerResponse.data, historyData: historyResponse.data };
              memoryCache.set(cacheKey, data, 300000);
              this.errorTracker.successfulAttempts++;
              return data;
            }
          } finally {
            if (lockAcquired) await mongooseCache.releaseLock(lockKey, workerCoordination.getWorkerId());
          }
        },
        3600 // 1 hour TTL
      );
      return managerData;
    } catch (error) {
      this._trackError(error, `manager_${managerId}`);
      const staleData = await mongooseCache.get(`stale:${cacheKey}`);
      if (staleData) return staleData;
      throw error;
    }
  }

  async fetchPicksData(managerId, gameweek) {
    this.errorTracker.totalAttempts++;
    const cacheKey = `picksData:${managerId}:${gameweek}`;

    const memoryCached = memoryCache.get(cacheKey);
    if (memoryCached) {
      this.logger.info('Using memory cache for picks data', { managerId, gameweek });
      return memoryCached;
    }

    try {
      const picksData = await mongooseCache.getOrSet(
        cacheKey,
        async () => {
          const lockKey = `apilock:picks:${managerId}:${gameweek}`;
          const lockAcquired = await mongooseCache.acquireLock(lockKey, workerCoordination.getWorkerId(), 10);

          try {
            try {
              const workerResponse = await axios.get(
                `${this.baseURL}/fpl-proxy/entry/${managerId}/event/${gameweek}/picks/`,
                { timeout: 15000, headers: { 'User-Agent': this._getRandomUserAgent(), 'Accept': 'application/json' } }
              );
              if (workerResponse.data && Array.isArray(workerResponse.data.picks)) {
                memoryCache.set(cacheKey, workerResponse.data, 300000);
                this.errorTracker.successfulAttempts++;
                return workerResponse.data;
              }
              throw new Error('Invalid picks data structure from worker');
            } catch (workerError) {
              this.logger.warn('Worker fetch failed', { error: workerError.message });
              const response = await this.fetchWithRetry(
                `${this.directURL}/entry/${managerId}/event/${gameweek}/picks/`
              );
              memoryCache.set(cacheKey, response.data, 300000);
              this.errorTracker.successfulAttempts++;
              return response.data;
            }
          } finally {
            if (lockAcquired) await mongooseCache.releaseLock(lockKey, workerCoordination.getWorkerId());
          }
        },
        3600 // 1 hour TTL
      );
      return picksData;
    } catch (error) {
      this._trackError(error, `picks_${managerId}_${gameweek}`);
      const staleData = await mongooseCache.get(`stale:${cacheKey}`);
      if (staleData) return staleData;
      throw error;
    }
  }

  async fetchFixtures(gameweek) {
    this.errorTracker.totalAttempts++;
    const cacheKey = `fixtures:${gameweek}`;

    const memoryCached = memoryCache.get(cacheKey);
    if (memoryCached) {
      this.logger.info('Using memory cache for fixtures', { gameweek });
      return memoryCached;
    }

    try {
      const fixturesData = await mongooseCache.getOrSet(
        cacheKey,
        async () => {
          const lockKey = `apilock:fixtures:${gameweek}`;
          const lockAcquired = await mongooseCache.acquireLock(lockKey, workerCoordination.getWorkerId(), 10);

          try {
            try {
              const workerResponse = await axios.get(
                `${this.baseURL}/fpl-proxy/fixtures/?event=${gameweek}`,
                { timeout: 15000, headers: { 'User-Agent': this._getRandomUserAgent(), 'Accept': 'application/json' } }
              );
              if (workerResponse.data && Array.isArray(workerResponse.data)) {
                memoryCache.set(cacheKey, workerResponse.data, 300000);
                this.errorTracker.successfulAttempts++;
                return workerResponse.data;
              }
              throw new Error('Invalid fixtures data structure from worker');
            } catch (workerError) {
              this.logger.warn('Worker fetch failed', { error: workerError.message });
              const response = await this.fetchWithRetry(`${this.directURL}/fixtures/?event=${gameweek}`);
              memoryCache.set(cacheKey, response.data, 300000);
              this.errorTracker.successfulAttempts++;
              return response.data;
            }
          } finally {
            if (lockAcquired) await mongooseCache.releaseLock(lockKey, workerCoordination.getWorkerId());
          }
        },
        3600 // 1 hour TTL
      );
      return fixturesData;
    } catch (error) {
      this._trackError(error, `fixtures_${gameweek}`);
      const staleData = await mongooseCache.get(`stale:${cacheKey}`);
      if (staleData) return staleData;
      throw error;
    }
  }

  async fetchLeagueStandings(leagueId) {
    this.errorTracker.totalAttempts++;
    const cacheKey = `leagueStandings:${leagueId}`;

    const memoryCached = memoryCache.get(cacheKey);
    if (memoryCached) {
      this.logger.info('Using memory cache for league standings', { leagueId });
      return memoryCached;
    }

    try {
      const leagueData = await mongooseCache.getOrSet(
        cacheKey,
        async () => {
          const lockKey = `apilock:league:${leagueId}`;
          const lockAcquired = await mongooseCache.acquireLock(lockKey, workerCoordination.getWorkerId(), 10);

          try {
            try {
              const workerResponse = await axios.get(
                `${this.baseURL}/fpl-proxy/leagues-classic/${leagueId}/standings/`,
                { timeout: 15000, headers: { 'User-Agent': this._getRandomUserAgent(), 'Accept': 'application/json' } }
              );
              if (workerResponse.data && workerResponse.data.standings && Array.isArray(workerResponse.data.standings.results)) {
                memoryCache.set(cacheKey, workerResponse.data, 300000);
                this.errorTracker.successfulAttempts++;
                return workerResponse.data;
              }
              throw new Error('Invalid league standings structure from worker');
            } catch (workerError) {
              this.logger.warn('Worker fetch failed', { error: workerError.message });
              const response = await this.fetchWithRetry(
                `${this.directURL}/leagues-classic/${leagueId}/standings/`
              );
              memoryCache.set(cacheKey, response.data, 300000);
              this.errorTracker.successfulAttempts++;
              return response.data;
            }
          } finally {
            if (lockAcquired) await mongooseCache.releaseLock(lockKey, workerCoordination.getWorkerId());
          }
        },
        3600 // 1 hour TTL
      );
      return leagueData;
    } catch (error) {
      this._trackError(error, `league_${leagueId}`);
      const staleData = await mongooseCache.get(`stale:${cacheKey}`);
      if (staleData) return staleData;
      throw error;
    }
  }

  async fetchPlayerSummary(playerId) {
    this.errorTracker.totalAttempts++;
    const cacheKey = `playerSummary:${playerId}`;

    const memoryCached = memoryCache.get(cacheKey);
    if (memoryCached) {
      this.logger.info('Using memory cache for player summary', { playerId });
      return memoryCached;
    }

    try {
      const playerData = await mongooseCache.getOrSet(
        cacheKey,
        async () => {
          const lockKey = `apilock:player:${playerId}`;
          const lockAcquired = await mongooseCache.acquireLock(lockKey, workerCoordination.getWorkerId(), 10);

          try {
            try {
              const workerResponse = await axios.get(
                `${this.baseURL}/fpl-proxy/element-summary/${playerId}/`,
                { timeout: 15000, headers: { 'User-Agent': this._getRandomUserAgent(), 'Accept': 'application/json' } }
              );
              if (workerResponse.data && Array.isArray(workerResponse.data.history)) {
                memoryCache.set(cacheKey, workerResponse.data, 300000);
                this.errorTracker.successfulAttempts++;
                return workerResponse.data;
              }
              throw new Error('Invalid player summary structure from worker');
            } catch (workerError) {
              this.logger.warn('Worker fetch failed', { error: workerError.message });
              const response = await this.fetchWithRetry(
                `${this.directURL}/element-summary/${playerId}/`
              );
              memoryCache.set(cacheKey, response.data, 300000);
              this.errorTracker.successfulAttempts++;
              return response.data;
            }
          } finally {
            if (lockAcquired) await mongooseCache.releaseLock(lockKey, workerCoordination.getWorkerId());
          }
        },
        3600 // 1 hour TTL
      );
      return playerData;
    } catch (error) {
      this._trackError(error, `player_${playerId}`);
      const staleData = await mongooseCache.get(`stale:${cacheKey}`);
      if (staleData) return staleData;
      throw error;
    }
  }

  async fetchTransfersData(managerId) {
    this.errorTracker.totalAttempts++;
    const cacheKey = `transfers:${managerId}`;

    const memoryCached = memoryCache.get(cacheKey);
    if (memoryCached) {
      this.logger.info('Using memory cache for transfers data', { managerId });
      return memoryCached;
    }

    try {
      const transfersData = await mongooseCache.getOrSet(
        cacheKey,
        async () => {
          const lockKey = `apilock:transfers:${managerId}`;
          const lockAcquired = await mongooseCache.acquireLock(lockKey, workerCoordination.getWorkerId(), 10);

          try {
            try {
              const workerResponse = await axios.get(
                `${this.baseURL}/fpl-proxy/entry/${managerId}/transfers/`,
                { timeout: 15000, headers: { 'User-Agent': this._getRandomUserAgent(), 'Accept': 'application/json' } }
              );
              if (workerResponse.data && Array.isArray(workerResponse.data)) {
                memoryCache.set(cacheKey, workerResponse.data, 300000);
                this.errorTracker.successfulAttempts++;
                return workerResponse.data;
              }
              throw new Error('Invalid transfers data structure from worker');
            } catch (workerError) {
              this.logger.warn('Worker fetch failed', { error: workerError.message });
              const response = await this.fetchWithRetry(
                `${this.directURL}/entry/${managerId}/transfers/`
              );
              memoryCache.set(cacheKey, response.data, 300000);
              this.errorTracker.successfulAttempts++;
              return response.data;
            }
          } finally {
            if (lockAcquired) await mongooseCache.releaseLock(lockKey, workerCoordination.getWorkerId());
          }
        },
        3600 // 1 hour TTL
      );
      return transfersData;
    } catch (error) {
      this._trackError(error, `transfers_${managerId}`);
      const staleData = await mongooseCache.get(`stale:${cacheKey}`);
      if (staleData) return staleData;
      throw error;
    }
  }

  async fetchPlayerHistory(playerId) {
    this.errorTracker.totalAttempts++;
    const cacheKey = `playerHistory:${playerId}`;

    const memoryCached = memoryCache.get(cacheKey);
    if (memoryCached) {
      this.logger.info('Using memory cache for player history', { playerId });
      return memoryCached;
    }

    try {
      const historyData = await mongooseCache.getOrSet(
        cacheKey,
        async () => {
          const lockKey = `apilock:playerHistory:${playerId}`;
          const lockAcquired = await mongooseCache.acquireLock(lockKey, workerCoordination.getWorkerId(), 10);

          try {
            try {
              const workerResponse = await axios.get(
                `${this.baseURL}/fpl-proxy/element-summary/${playerId}/`,
                { timeout: 15000, headers: { 'User-Agent': this._getRandomUserAgent(), 'Accept': 'application/json' } }
              );
              if (workerResponse.data && (Array.isArray(workerResponse.data.history) || Array.isArray(workerResponse.data.fixtures))) {
                memoryCache.set(cacheKey, workerResponse.data, 300000);
                this.errorTracker.successfulAttempts++;
                return workerResponse.data;
              }
              throw new Error('Invalid player history data structure from worker');
            } catch (workerError) {
              this.logger.warn('Worker fetch failed', { error: workerError.message });
              const response = await this.fetchWithRetry(
                `${this.directURL}/element-summary/${playerId}/`
              );
              memoryCache.set(cacheKey, response.data, 300000);
              this.errorTracker.successfulAttempts++;
              return response.data;
            }
          } finally {
            if (lockAcquired) await mongooseCache.releaseLock(lockKey, workerCoordination.getWorkerId());
          }
        },
        3600 // 1 hour TTL
      );
      return historyData;
    } catch (error) {
      this._trackError(error, `player_history_${playerId}`);
      const staleData = await mongooseCache.get(`stale:${cacheKey}`);
      if (staleData) return staleData;
      throw error;
    }
  }

  async fetchRankData(managerId, gameweek, currentPoints, seasonPoints, managerRank) {
    this.errorTracker.totalAttempts++;
    const cacheKey = `rankData:${managerId}:${gameweek}:${currentPoints}`;

    const memoryCached = memoryCache.get(cacheKey);
    if (memoryCached) {
      this.logger.info('Using memory cache for rank data', { managerId, gameweek });
      return memoryCached;
    }

    try {
      const rankData = await mongooseCache.getOrSet(
        cacheKey,
        async () => {
          const lockKey = `apilock:rank:${managerId}:${gameweek}`;
          const lockAcquired = await mongooseCache.acquireLock(lockKey, workerCoordination.getWorkerId(), 10);

          try {
            try {
              const workerResponse = await axios.get(
                `${this.baseURL}/api/fpl/${managerId}/rank-simulator/${gameweek}?points=0`,
                { timeout: 15000, headers: { 'User-Agent': this._getRandomUserAgent(), 'Accept': 'application/json' } }
              );
              if (workerResponse.data && workerResponse.data.simulatedRank) {
                memoryCache.set(cacheKey, workerResponse.data, 300000);
                this.errorTracker.successfulAttempts++;
                return workerResponse.data;
              }
              throw new Error('Invalid rank data structure from worker');
            } catch (workerError) {
              this.logger.warn('Worker fetch failed, fetching required data', { error: workerError.message });
              const [bootstrapData, top10kStats] = await Promise.all([
                this.fetchBootstrapData(),
                this.fetchTop10kStats(gameweek).catch(err => null)
              ]);
              const data = { bootstrapData, top10kStats, currentPoints, seasonPoints, managerRank };
              memoryCache.set(cacheKey, data, 300000);
              this.errorTracker.successfulAttempts++;
              return data;
            }
          } finally {
            if (lockAcquired) await mongooseCache.releaseLock(lockKey, workerCoordination.getWorkerId());
          }
        },
        300 // 5 minutes TTL
      );
      return rankData;
    } catch (error) {
      this._trackError(error, `rank_${managerId}_${gameweek}`);
      const staleData = await mongooseCache.get(`stale:${cacheKey}`);
      if (staleData) return staleData;
      throw error;
    }
  }

  async fetchTop10kStats(gameweek) {
    this.errorTracker.totalAttempts++;
    const cacheKey = `top10k:${gameweek}`;

    const memoryCached = memoryCache.get(cacheKey);
    if (memoryCached) {
      this.logger.info('Using memory cache for top10k stats', { gameweek });
      return memoryCached;
    }

    try {
      const top10kData = await mongooseCache.getOrSet(
        cacheKey,
        async () => {
          const lockKey = `apilock:top10k:${gameweek}`;
          const lockAcquired = await mongooseCache.acquireLock(lockKey, workerCoordination.getWorkerId(), 10);

          try {
            const workerResponse = await axios.get(
              `${this.baseURL}/api/fpl/top10k/${gameweek}`,
              { timeout: 15000, headers: { 'User-Agent': this._getRandomUserAgent(), 'Accept': 'application/json' } }
            );
            if (workerResponse.data) {
              memoryCache.set(cacheKey, workerResponse.data, 1800000);
              this.errorTracker.successfulAttempts++;
              return workerResponse.data;
            }
            throw new Error('Invalid top10k data structure from worker');
          } catch (workerError) {
            this.logger.warn('Worker fetch failed for top10k stats', { error: workerError.message });
            this.errorTracker.failedAttempts++;
            return null;
          } finally {
            if (lockAcquired) await mongooseCache.releaseLock(lockKey, workerCoordination.getWorkerId());
          }
        },
        1800 // 30 minutes TTL
      );
      return top10kData;
    } catch (error) {
      this._trackError(error, `top10k_${gameweek}`);
      throw error;
    }
  }

  async fetchWithRetry(url, retries = 2, delayMs = 2000) {
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms + Math.random() * 300));

    const rateLimitKey = `ratelimit:global`;
    const globalRateLimit = await mongooseCache.get(rateLimitKey);
    if (globalRateLimit && new Date(globalRateLimit.until) > new Date()) {
      throw new Error(`Rate limited until ${globalRateLimit.until}`);
    }

    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios.get(url, {
          timeout: 15000,
          headers: {
            'User-Agent': this._getRandomUserAgent(),
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://fantasy.premierleague.com/',
            'Origin': 'https://fantasy.premierleague.com'
          },
          httpsAgent: new https.Agent({ rejectUnauthorized: true, keepAlive: false })
        });
        return response;
      } catch (err) {
        this.logger.error(`Fetch attempt ${i + 1}/${retries} failed for ${url}`, {
          errorMessage: err.message,
          status: err.response?.status
        });

        if (err.response?.status === 429) {
          const retryAfter = err.response.headers['retry-after'] 
            ? parseInt(err.response.headers['retry-after']) * 1000
            : 120000;
          const limitUntil = new Date(Date.now() + retryAfter);
          await mongooseCache.set(rateLimitKey, { until: limitUntil, reason: 'API returned 429' }, Math.ceil(retryAfter / 1000));
          if (i === retries - 1) throw err;
          await delay(retryAfter);
        } else if (i < retries - 1) {
          await delay(delayMs * Math.pow(2, i));
        } else {
          throw err;
        }
      }
    }
  }

  _getRandomUserAgent() {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  _trackError(error, context) {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      context,
      message: error.message,
      status: error.response?.status
    };
    this.errorTracker.lastErrors.push(errorEntry);
    if (this.errorTracker.lastErrors.length > 10) this.errorTracker.lastErrors.shift();
    this.logger.error('FPL API Fetch Error', errorEntry);
  }

  getErrorTrackerStatus() {
    return {
      totalAttempts: this.errorTracker.totalAttempts,
      successfulAttempts: this.errorTracker.successfulAttempts,
      failedAttempts: this.errorTracker.failedAttempts,
      successRate: this.errorTracker.totalAttempts > 0 
        ? ((this.errorTracker.successfulAttempts / this.errorTracker.totalAttempts) * 100).toFixed(2) + '%'
        : '0%',
      lastErrors: this.errorTracker.lastErrors,
      usingWorker: !!process.env.FPL_WORKER_URL
    };
  }
}

module.exports = new FPLAPIProxyService();