const axios = require('axios');
const logger = require('../utils/logger');

class FPLAPIProxyService {
  constructor() {
    this.errorTracker = {
      totalAttempts: 0,
      successfulAttempts: 0,
      failedAttempts: 0,
      lastErrors: []
    };
  }

  async fetchLiveData(gameweek) {
    this.errorTracker.totalAttempts++;
    const url = `https://fantasy.premierleague.com/api/event/${gameweek}/live/`;
    
    // Comprehensive logging before request
    logger.info('Attempting to fetch live data', {
      gameweek,
      timestamp: new Date().toISOString(),
      attemptCount: this.errorTracker.totalAttempts,
      service: 'FPLAPIProxy'
    });
    
    try {
      const response = await this.fetchWithRetry(url);
      
      // Success logging
      logger.info('Live data retrieved successfully', {
        gameweek,
        elementsCount: response.data.elements?.length || 0,
        service: 'FPLAPIProxy'
      });
      
      this.errorTracker.successfulAttempts++;
      return response.data;
    } catch (error) {
      // Error tracking and logging
      this.errorTracker.failedAttempts++;
      this._trackError(error, gameweek);
      throw error;
    }
  }

  async fetchWithRetry(url, retries = 3, delayMs = 1000) {
    const delay = (ms) => new Promise(resolve => {
      const jitter = Math.random() * 300;
      setTimeout(resolve, ms + jitter);
    });
    
    for (let i = 0; i < retries; i++) {
      try {
        // Log the fetch attempt
        logger.info(`Fetch attempt ${i + 1}/${retries} for ${url}`, {
          url,
          attempt: i + 1,
          maxRetries: retries,
          service: 'FPLAPIProxy'
        });
        
        // Perform the axios get request
        const response = await axios.get(url, {
          timeout: 15000, // 15 seconds timeout
          headers: this._generateRequestHeaders()
        });
        
        // Log successful response
        logger.info(`Successful fetch for ${url}`, {
          status: response.status,
          dataKeys: Object.keys(response.data),
          service: 'FPLAPIProxy'
        });
        
        // Validate response structure
        if (!response || !response.data) {
          throw new Error('Invalid response structure');
        }
        
        if (!response.data.elements || !Array.isArray(response.data.elements)) {
          throw new Error('Invalid elements structure in response');
        }
        
        return response;
      } catch (err) {
        // Detailed error logging
        logger.error(`Fetch attempt ${i + 1}/${retries} failed for ${url}`, {
          errorMessage: err.message,
          status: err.response?.status,
          errorDetails: err.response?.data,
          service: 'FPLAPIProxy'
        });
        
        // Handle specific error scenarios
        if (err.response) {
          switch (err.response.status) {
            case 403: // Forbidden
              logger.warn(`Forbidden access for ${url}`, { service: 'FPLAPIProxy' });
              break;
            case 429: // Rate limited
              const retryAfter = err.response.headers['retry-after'] 
                ? Math.max(parseInt(err.response.headers['retry-after'], 10) * 1000, 1000)
                : 60000;
              logger.info(`Rate limited, waiting ${retryAfter}ms`, { service: 'FPLAPIProxy' });
              await delay(retryAfter);
              continue;
            case 500: // Server error
            case 502: // Bad Gateway
            case 503: // Service Unavailable
            case 504: // Gateway Timeout
              logger.warn(`Server error for ${url}, status: ${err.response.status}`, { service: 'FPLAPIProxy' });
              break;
          }
        }
        
        // Exponential backoff with jitter
        if (i < retries - 1) {
          const jitteredDelay = delayMs * Math.pow(2, i) + Math.random() * 1000;
          logger.info(`Waiting ${jitteredDelay}ms before retry`, { service: 'FPLAPIProxy' });
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

  _generateRequestHeaders() {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://fantasy.premierleague.com/',
      'Origin': 'https://fantasy.premierleague.com',
      'X-Requested-With': 'XMLHttpRequest',
      // Add any additional headers that might help bypass restrictions
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin'
    };
  }

  _trackError(error, gameweek) {
    // Maintain a rolling log of recent errors
    const errorEntry = {
      timestamp: new Date().toISOString(),
      gameweek,
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
    logger.error('FPL API Fetch Error', {
      ...errorEntry,
      service: 'FPLAPIProxy'
    });
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
      lastErrors: this.errorTracker.lastErrors
    };
  }
}

module.exports = new FPLAPIProxyService();