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