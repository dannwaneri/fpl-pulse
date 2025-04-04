const axios = require('axios');
const https = require('https');
const logger = require('../utils/logger');

class FPLAPIProxyService {
  constructor() {
    // Use logger directly to avoid constructor issues
    this.logger = typeof logger === 'function' ? logger('FPLAPIProxy') : 
                 logger.create ? logger.create('FPLAPIProxy') :
                 logger.getLogger ? logger.getLogger('FPLAPIProxy') : 
                 logger;
                 
    // Error tracking
    this.errorTracker = {
      totalAttempts: 0,
      successfulAttempts: 0,
      failedAttempts: 0,
      lastErrors: []
    };
    
    // Configure base URLs
    this.baseURL = process.env.FPL_WORKER_URL || 'https://fpl-api.fpl-test.workers.dev';
    this.directURL = 'https://fantasy.premierleague.com/api';
  }

  async fetchLiveData(gameweek) {
    this.errorTracker.totalAttempts++;
    
    // Comprehensive logging before request
    this.logger.info('Attempting to fetch live data', {
      gameweek,
      timestamp: new Date().toISOString(),
      attemptCount: this.errorTracker.totalAttempts
    });
    
    try {
      // First attempt: Try the Cloudflare Worker proxy
      try {
        this.logger.info(`Attempting to fetch via worker: ${this.baseURL}/fpl-proxy/event/${gameweek}/live`);
        
        const workerResponse = await axios.get(`${this.baseURL}/fpl-proxy/event/${gameweek}/live`, {
          timeout: 15000,
          headers: {
            'User-Agent': 'FPL Pulse/1.0',
            'Accept': 'application/json'
          }
        });
        
        // Validate worker response
        if (workerResponse.data && Array.isArray(workerResponse.data.elements)) {
          this.logger.info('Successfully fetched live data via worker', {
            gameweek,
            elementsCount: workerResponse.data.elements.length
          });
          
          this.errorTracker.successfulAttempts++;
          return workerResponse.data;
        } else {
          throw new Error('Invalid data structure from worker');
        }
      } catch (workerError) {
        // Log worker error and try direct approach
        this.logger.warn('Worker fetch failed, attempting direct fetch', {
          error: workerError.message,
          status: workerError.response?.status
        });
        
        // Second attempt: Try direct FPL API with retry logic
        const response = await this.fetchWithRetry(`${this.directURL}/event/${gameweek}/live/`);
        
        this.logger.info('Live data retrieved successfully via direct API', {
          gameweek,
          elementsCount: response.data.elements?.length || 0
        });
        
        this.errorTracker.successfulAttempts++;
        return response.data;
      }
    } catch (error) {
      // Error tracking and logging
      this.errorTracker.failedAttempts++;
      this._trackError(error, gameweek);
      throw error;
    }
  }

  async fetchBootstrapData() {
    this.errorTracker.totalAttempts++;
    
    // Comprehensive logging before request
    this.logger.info('Attempting to fetch bootstrap data', {
      timestamp: new Date().toISOString(),
      attemptCount: this.errorTracker.totalAttempts
    });
    
    try {
      // First attempt: Try the Cloudflare Worker proxy
      try {
        this.logger.info(`Attempting to fetch bootstrap via worker: ${this.baseURL}/fpl-proxy/bootstrap-static/`);
        
        const workerResponse = await axios.get(`${this.baseURL}/fpl-proxy/bootstrap-static/`, {
          timeout: 15000,
          headers: {
            'User-Agent': 'FPL Pulse/1.0',
            'Accept': 'application/json'
          }
        });
        
        // Validate worker response
        if (workerResponse.data && Array.isArray(workerResponse.data.elements)) {
          this.logger.info('Successfully fetched bootstrap data via worker', {
            elementsCount: workerResponse.data.elements.length,
            teamsCount: workerResponse.data.teams.length,
            eventsCount: workerResponse.data.events.length
          });
          
          this.errorTracker.successfulAttempts++;
          return workerResponse.data;
        } else {
          throw new Error('Invalid data structure from worker');
        }
      } catch (workerError) {
        // Log worker error and try direct approach
        this.logger.warn('Worker fetch failed for bootstrap data, attempting direct fetch', {
          error: workerError.message,
          status: workerError.response?.status
        });
        
        // Second attempt: Try direct FPL API with retry logic
        const response = await this.fetchWithRetry(`${this.directURL}/bootstrap-static/`);
        
        this.logger.info('Bootstrap data retrieved successfully via direct API', {
          elementsCount: response.data.elements?.length || 0,
          teamsCount: response.data.teams?.length || 0
        });
        
        this.errorTracker.successfulAttempts++;
        return response.data;
      }
    } catch (error) {
      // Error tracking and logging
      this.errorTracker.failedAttempts++;
      this._trackError(error, 'bootstrap');
      throw error;
    }
  }
  
  async fetchManagerData(managerId) {
    this.errorTracker.totalAttempts++;
    
    // Comprehensive logging before request
    this.logger.info('Attempting to fetch manager data', {
      managerId,
      timestamp: new Date().toISOString(),
      attemptCount: this.errorTracker.totalAttempts
    });
    
    try {
      // First attempt: Try the Cloudflare Worker proxy
      try {
        this.logger.info(`Attempting to fetch manager data via worker: ${this.baseURL}/fpl-proxy/entry/${managerId}/`);
        
        const workerResponse = await axios.get(`${this.baseURL}/fpl-proxy/entry/${managerId}/`, {
          timeout: 15000,
          headers: {
            'User-Agent': 'FPL Pulse/1.0',
            'Accept': 'application/json'
          }
        });
        
        // Validate worker response
        if (workerResponse.data && workerResponse.data.player_first_name) {
          const historyResponse = await axios.get(`${this.baseURL}/fpl-proxy/entry/${managerId}/history/`, {
            timeout: 15000,
            headers: {
              'User-Agent': 'FPL Pulse/1.0',
              'Accept': 'application/json'
            }
          });
          
          this.logger.info('Successfully fetched manager data via worker', {
            managerId,
            name: `${workerResponse.data.player_first_name} ${workerResponse.data.player_last_name}`,
            currentGameweek: workerResponse.data.current_event,
            leaguesCount: workerResponse.data.leagues?.classic?.length || 0
          });
          
          this.errorTracker.successfulAttempts++;
          return {
            managerData: workerResponse.data,
            historyData: historyResponse.data
          };
        } else {
          throw new Error('Invalid manager data structure from worker');
        }
      } catch (workerError) {
        // Log worker error and try direct approach
        this.logger.warn('Worker fetch failed for manager data, attempting direct fetch', {
          managerId,
          error: workerError.message,
          status: workerError.response?.status
        });
        
        // Second attempt: Try direct FPL API with retry logic
        const managerResponse = await this.fetchWithRetry(`${this.directURL}/entry/${managerId}/`);
        const historyResponse = await this.fetchWithRetry(`${this.directURL}/entry/${managerId}/history/`);
        
        if (!managerResponse.data || !managerResponse.data.player_first_name) {
          throw new Error('Invalid manager data structure from direct API');
        }
        
        this.logger.info('Manager data retrieved successfully via direct API', {
          managerId,
          name: `${managerResponse.data.player_first_name} ${managerResponse.data.player_last_name}`,
          currentGameweek: managerResponse.data.current_event
        });
        
        this.errorTracker.successfulAttempts++;
        return {
          managerData: managerResponse.data,
          historyData: historyResponse.data
        };
      }
    } catch (error) {
      // Error tracking and logging
      this.errorTracker.failedAttempts++;
      this._trackError(error, `manager_${managerId}`);
      throw error;
    }
  }

  // Fetch picks data for a specific manager and gameweek
  async fetchPicksData(managerId, gameweek) {
    this.errorTracker.totalAttempts++;
    
    // Comprehensive logging before request
    this.logger.info('Attempting to fetch picks data', {
      managerId,
      gameweek,
      timestamp: new Date().toISOString(),
      attemptCount: this.errorTracker.totalAttempts
    });
    
    try {
      // First attempt: Try the Cloudflare Worker proxy
      try {
        this.logger.info(`Attempting to fetch picks via worker: ${this.baseURL}/fpl-proxy/entry/${managerId}/event/${gameweek}/picks/`);
        
        const workerResponse = await axios.get(`${this.baseURL}/fpl-proxy/entry/${managerId}/event/${gameweek}/picks/`, {
          timeout: 15000,
          headers: {
            'User-Agent': 'FPL Pulse/1.0',
            'Accept': 'application/json'
          }
        });
        
        // Validate worker response
        if (workerResponse.data && Array.isArray(workerResponse.data.picks)) {
          this.logger.info('Successfully fetched picks data via worker', {
            managerId,
            gameweek,
            picksCount: workerResponse.data.picks.length,
            activeChip: workerResponse.data.active_chip
          });
          
          this.errorTracker.successfulAttempts++;
          return workerResponse.data;
        } else {
          throw new Error('Invalid picks data structure from worker');
        }
      } catch (workerError) {
        // Log worker error and try direct approach
        this.logger.warn('Worker fetch failed for picks data, attempting direct fetch', {
          managerId,
          gameweek,
          error: workerError.message,
          status: workerError.response?.status
        });
        
        // Second attempt: Try direct FPL API with retry logic
        const response = await this.fetchWithRetry(`${this.directURL}/entry/${managerId}/event/${gameweek}/picks/`);
        
        this.logger.info('Picks data retrieved successfully via direct API', {
          managerId,
          gameweek,
          picksCount: response.data.picks?.length || 0
        });
        
        this.errorTracker.successfulAttempts++;
        return response.data;
      }
    } catch (error) {
      // Error tracking and logging
      this.errorTracker.failedAttempts++;
      this._trackError(error, `picks_${managerId}_${gameweek}`);
      throw error;
    }
  }

  // Fetch fixtures data for a specific gameweek
  async fetchFixtures(gameweek) {
    this.errorTracker.totalAttempts++;
    
    // Comprehensive logging before request
    this.logger.info('Attempting to fetch fixtures data', {
      gameweek,
      timestamp: new Date().toISOString(),
      attemptCount: this.errorTracker.totalAttempts
    });
    
    try {
      // First attempt: Try the Cloudflare Worker proxy
      try {
        this.logger.info(`Attempting to fetch fixtures via worker: ${this.baseURL}/fpl-proxy/fixtures/?event=${gameweek}`);
        
        const workerResponse = await axios.get(`${this.baseURL}/fpl-proxy/fixtures/?event=${gameweek}`, {
          timeout: 15000,
          headers: {
            'User-Agent': 'FPL Pulse/1.0',
            'Accept': 'application/json'
          }
        });
        
        // Validate worker response
        if (workerResponse.data && Array.isArray(workerResponse.data)) {
          this.logger.info('Successfully fetched fixtures data via worker', {
            gameweek,
            fixturesCount: workerResponse.data.length
          });
          
          this.errorTracker.successfulAttempts++;
          return workerResponse.data;
        } else {
          throw new Error('Invalid fixtures data structure from worker');
        }
      } catch (workerError) {
        // Log worker error and try direct approach
        this.logger.warn('Worker fetch failed for fixtures data, attempting direct fetch', {
          gameweek,
          error: workerError.message,
          status: workerError.response?.status
        });
        
        // Second attempt: Try direct FPL API with retry logic
        const response = await this.fetchWithRetry(`${this.directURL}/fixtures/?event=${gameweek}`);
        
        this.logger.info('Fixtures data retrieved successfully via direct API', {
          gameweek,
          fixturesCount: response.data?.length || 0
        });
        
        this.errorTracker.successfulAttempts++;
        return response.data;
      }
    } catch (error) {
      // Error tracking and logging
      this.errorTracker.failedAttempts++;
      this._trackError(error, `fixtures_${gameweek}`);
      throw error;
    }
  }

  // Fetch league standings data
  async fetchLeagueStandings(leagueId) {
    this.errorTracker.totalAttempts++;
    
    // Comprehensive logging before request
    this.logger.info('Attempting to fetch league standings', {
      leagueId,
      timestamp: new Date().toISOString(),
      attemptCount: this.errorTracker.totalAttempts
    });
    
    try {
      // First attempt: Try the Cloudflare Worker proxy
      try {
        this.logger.info(`Attempting to fetch league standings via worker: ${this.baseURL}/fpl-proxy/leagues-classic/${leagueId}/standings/`);
        
        const workerResponse = await axios.get(`${this.baseURL}/fpl-proxy/leagues-classic/${leagueId}/standings/`, {
          timeout: 15000,
          headers: {
            'User-Agent': 'FPL Pulse/1.0',
            'Accept': 'application/json'
          }
        });
        
        // Validate worker response
        if (workerResponse.data && workerResponse.data.standings && Array.isArray(workerResponse.data.standings.results)) {
          this.logger.info('Successfully fetched league standings via worker', {
            leagueId,
            leagueName: workerResponse.data.league?.name,
            entriesCount: workerResponse.data.standings.results.length
          });
          
          this.errorTracker.successfulAttempts++;
          return workerResponse.data;
        } else {
          throw new Error('Invalid league standings structure from worker');
        }
      } catch (workerError) {
        // Log worker error and try direct approach
        this.logger.warn('Worker fetch failed for league standings, attempting direct fetch', {
          leagueId,
          error: workerError.message,
          status: workerError.response?.status
        });
        
        // Second attempt: Try direct FPL API with retry logic
        const response = await this.fetchWithRetry(`${this.directURL}/leagues-classic/${leagueId}/standings/`);
        
        this.logger.info('League standings retrieved successfully via direct API', {
          leagueId,
          leagueName: response.data.league?.name,
          entriesCount: response.data.standings?.results?.length || 0
        });
        
        this.errorTracker.successfulAttempts++;
        return response.data;
      }
    } catch (error) {
      // Error tracking and logging
      this.errorTracker.failedAttempts++;
      this._trackError(error, `league_${leagueId}`);
      throw error;
    }
  }

  // Fetch player summary data
  async fetchPlayerSummary(playerId) {
    this.errorTracker.totalAttempts++;
    
    // Comprehensive logging before request
    this.logger.info('Attempting to fetch player summary', {
      playerId,
      timestamp: new Date().toISOString(),
      attemptCount: this.errorTracker.totalAttempts
    });
    
    try {
      // First attempt: Try the Cloudflare Worker proxy
      try {
        this.logger.info(`Attempting to fetch player summary via worker: ${this.baseURL}/fpl-proxy/element-summary/${playerId}/`);
        
        const workerResponse = await axios.get(`${this.baseURL}/fpl-proxy/element-summary/${playerId}/`, {
          timeout: 15000,
          headers: {
            'User-Agent': 'FPL Pulse/1.0',
            'Accept': 'application/json'
          }
        });
        
        // Validate worker response
        if (workerResponse.data && Array.isArray(workerResponse.data.history)) {
          this.logger.info('Successfully fetched player summary via worker', {
            playerId,
            fixturesCount: workerResponse.data.fixtures?.length || 0,
            historyCount: workerResponse.data.history?.length || 0
          });
          
          this.errorTracker.successfulAttempts++;
          return workerResponse.data;
        } else {
          throw new Error('Invalid player summary structure from worker');
        }
      } catch (workerError) {
        // Log worker error and try direct approach
        this.logger.warn('Worker fetch failed for player summary, attempting direct fetch', {
          playerId,
          error: workerError.message,
          status: workerError.response?.status
        });
        
        // Second attempt: Try direct FPL API with retry logic
        const response = await this.fetchWithRetry(`${this.directURL}/element-summary/${playerId}/`);
        
        this.logger.info('Player summary retrieved successfully via direct API', {
          playerId,
          fixturesCount: response.data.fixtures?.length || 0,
          historyCount: response.data.history?.length || 0
        });
        
        this.errorTracker.successfulAttempts++;
        return response.data;
      }
    } catch (error) {
      // Error tracking and logging
      this.errorTracker.failedAttempts++;
      this._trackError(error, `player_${playerId}`);
      throw error;
    }
  }
  
  // Fetch transfers data for a manager
  async fetchTransfersData(managerId) {
    this.errorTracker.totalAttempts++;
    
    // Comprehensive logging before request
    this.logger.info('Attempting to fetch transfers data', {
      managerId,
      timestamp: new Date().toISOString(),
      attemptCount: this.errorTracker.totalAttempts
    });
    
    try {
      // First attempt: Try the Cloudflare Worker proxy
      try {
        this.logger.info(`Attempting to fetch transfers via worker: ${this.baseURL}/fpl-proxy/entry/${managerId}/transfers/`);
        
        const workerResponse = await axios.get(`${this.baseURL}/fpl-proxy/entry/${managerId}/transfers/`, {
          timeout: 15000,
          headers: {
            'User-Agent': 'FPL Pulse/1.0',
            'Accept': 'application/json'
          }
        });
        
        // Validate worker response
        if (workerResponse.data && Array.isArray(workerResponse.data)) {
          this.logger.info('Successfully fetched transfers data via worker', {
            managerId,
            transfersCount: workerResponse.data.length
          });
          
          this.errorTracker.successfulAttempts++;
          return workerResponse.data;
        } else {
          throw new Error('Invalid transfers data structure from worker');
        }
      } catch (workerError) {
        // Log worker error and try direct approach
        this.logger.warn('Worker fetch failed for transfers data, attempting direct fetch', {
          managerId,
          error: workerError.message,
          status: workerError.response?.status
        });
        
        // Second attempt: Try direct FPL API with retry logic
        const response = await this.fetchWithRetry(`${this.directURL}/entry/${managerId}/transfers/`);
        
        this.logger.info('Transfers data retrieved successfully via direct API', {
          managerId,
          transfersCount: response.data?.length || 0
        });
        
        this.errorTracker.successfulAttempts++;
        return response.data;
      }
    } catch (error) {
      // Error tracking and logging
      this.errorTracker.failedAttempts++;
      this._trackError(error, `transfers_${managerId}`);
      throw error;
    }
  }
  
  // Fetch player history data
  async fetchPlayerHistory(playerId) {
    this.errorTracker.totalAttempts++;
    
    // Comprehensive logging before request
    this.logger.info('Attempting to fetch player history', {
      playerId,
      timestamp: new Date().toISOString(),
      attemptCount: this.errorTracker.totalAttempts
    });
    
    try {
      // First attempt: Try the Cloudflare Worker proxy
      try {
        this.logger.info(`Attempting to fetch player history via worker: ${this.baseURL}/fpl-proxy/element-summary/${playerId}/`);
        
        const workerResponse = await axios.get(`${this.baseURL}/fpl-proxy/element-summary/${playerId}/`, {
          timeout: 15000,
          headers: {
            'User-Agent': 'FPL Pulse/1.0',
            'Accept': 'application/json'
          }
        });
        
        // Validate worker response
        if (workerResponse.data && 
           (Array.isArray(workerResponse.data.history) || Array.isArray(workerResponse.data.fixtures))) {
          this.logger.info('Successfully fetched player history via worker', {
            playerId,
            historyEntries: workerResponse.data.history?.length || 0,
            fixturesCount: workerResponse.data.fixtures?.length || 0
          });
          
          this.errorTracker.successfulAttempts++;
          return workerResponse.data;
        } else {
          throw new Error('Invalid player history data structure from worker');
        }
      } catch (workerError) {
        // Log worker error and try direct approach
        this.logger.warn('Worker fetch failed for player history, attempting direct fetch', {
          playerId,
          error: workerError.message,
          status: workerError.response?.status
        });
        
        // Second attempt: Try direct FPL API with retry logic
        const response = await this.fetchWithRetry(`${this.directURL}/element-summary/${playerId}/`);
        
        if (!response.data || (!Array.isArray(response.data.history) && !Array.isArray(response.data.fixtures))) {
          throw new Error('Invalid player history data structure from direct API');
        }
        
        this.logger.info('Player history retrieved successfully via direct API', {
          playerId,
          historyEntries: response.data.history?.length || 0,
          fixturesCount: response.data.fixtures?.length || 0
        });
        
        this.errorTracker.successfulAttempts++;
        return response.data;
      }
    } catch (error) {
      // Error tracking and logging
      this.errorTracker.failedAttempts++;
      this._trackError(error, `player_history_${playerId}`);
      throw error;
    }
  }

  async fetchWithRetry(url, retries = 3, delayMs = 1000) {
    const delay = (ms) => new Promise(resolve => {
      const jitter = Math.random() * 300;
      setTimeout(resolve, ms + jitter);
    });
    
    // Create a cancellable request
    const CancelToken = axios.CancelToken;
    const source = CancelToken.source();
    
    // Set timeout to automatically cancel after 10 seconds
    const timeoutId = setTimeout(() => {
      source.cancel('Request timeout');
    }, 10000);
    
    for (let i = 0; i < retries; i++) {
      try {
        // Log the fetch attempt
        this.logger.info(`Fetch attempt ${i + 1}/${retries} for ${url}`, {
          url,
          attempt: i + 1,
          maxRetries: retries
        });
        
        // Use a different user agent for each attempt
        const userAgent = this._getRandomUserAgent();
        
        // Perform the axios get request
        const response = await axios.get(url, {
          timeout: 15000,
          cancelToken: source.token,
          headers: {
            'User-Agent': userAgent,
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://fantasy.premierleague.com/',
            'Origin': 'https://fantasy.premierleague.com',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          },
          // Use a fresh axios instance to avoid cookie persistence
          httpsAgent: new https.Agent({ 
            rejectUnauthorized: true,
            keepAlive: false
          })
        });
        
        // Clear the timeout
        clearTimeout(timeoutId);
        
        // Log successful response
        this.logger.info(`Successful fetch for ${url}`, {
          status: response.status,
          dataKeys: Object.keys(response.data)
        });
        
        // Validate response structure based on endpoint type
        if (!response || !response.data) {
          throw new Error('Invalid response structure');
        }
        
        // For live data endpoints
        if (url.includes('/live/')) {
          if (!response.data.elements || !Array.isArray(response.data.elements)) {
            throw new Error('Invalid elements structure in response');
          }
        }
        
        // For bootstrap data endpoints
        if (url.includes('bootstrap-static')) {
          if (!response.data.elements || !Array.isArray(response.data.elements) || 
              !response.data.teams || !Array.isArray(response.data.teams)) {
            throw new Error('Invalid bootstrap data structure in response');
          }
        }
        
        return response;
      } catch (err) {
        // Clear the timeout to avoid memory leaks
        clearTimeout(timeoutId);
        
        // Detailed error logging
        this.logger.error(`Fetch attempt ${i + 1}/${retries} failed for ${url}`, {
          errorMessage: err.message,
          status: err.response?.status,
          errorDetails: err.response?.data
        });
        
        // Handle specific error scenarios
        if (err.response) {
          switch (err.response.status) {
            case 429: // Rate limited
              const retryAfter = err.response.headers['retry-after'] 
                ? Math.max(parseInt(err.response.headers['retry-after'], 10) * 1000, 1000)
                : 60000;
              this.logger.info(`Rate limited, waiting ${retryAfter}ms`);
              await delay(retryAfter);
              continue;
            case 403: // Forbidden - try with a different user agent next time
              this.logger.warn(`Forbidden access for ${url}, will try different user agent`);
              break;
            case 500: // Server error
            case 502: // Bad Gateway
            case 503: // Service Unavailable
            case 504: // Gateway Timeout
              this.logger.warn(`Server error for ${url}, status: ${err.response.status}`);
              break;
          }
        }
        
        // Exponential backoff with jitter
        if (i < retries - 1) {
          const jitteredDelay = delayMs * Math.pow(2, i) + Math.random() * 1000;
          this.logger.info(`Waiting ${jitteredDelay}ms before retry`);
          await delay(jitteredDelay);
        }
        
        // Throw on last attempt
        if (i === retries - 1) {
          throw err;
        }
      }
    }
    
    // Fallback throw if all retries fail
    throw new Error(`Failed to fetch ${url} after ${retries} attempts`);
  }

  _getRandomUserAgent() {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0'
    ];
    
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  _trackError(error, context) {
    // Maintain a rolling log of recent errors
    const errorEntry = {
      timestamp: new Date().toISOString(),
      context,
      message: error.message,
      status: error.response?.status,
      type: error.name
    };
    
    // Keep only the last 10 errors
    this.errorTracker.lastErrors.push(errorEntry);
    if (this.errorTracker.lastErrors.length > 10) {
      this.errorTracker.lastErrors.shift();
    }
    
    // Log the error
    this.logger.error('FPL API Fetch Error', errorEntry);
  }

  // Diagnostic method to get error tracking information
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