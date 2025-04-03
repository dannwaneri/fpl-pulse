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
                 
    // Authentication state
    this.cookies = null;
    this.csrfToken = null;
    this.lastAuthAttempt = null;
    
    // Error tracking
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
    this.logger.info('Attempting to fetch live data', {
      gameweek,
      timestamp: new Date().toISOString(),
      attemptCount: this.errorTracker.totalAttempts
    });
    
    try {
      // Ensure we have authentication before proceeding
      await this._ensureAuthentication();
      
      const response = await this.fetchWithRetry(url);
      
      // Success logging
      this.logger.info('Live data retrieved successfully', {
        gameweek,
        elementsCount: response.data.elements?.length || 0
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

  async _ensureAuthentication() {
    // If we don't have cookies or they're stale (older than 30 minutes), re-authenticate
    const now = Date.now();
    if (!this.cookies || !this.lastAuthAttempt || (now - this.lastAuthAttempt > 30 * 60 * 1000)) {
      this.logger.info('Authentication needed', {
        hasCookies: !!this.cookies,
        lastAuthAttempt: this.lastAuthAttempt ? new Date(this.lastAuthAttempt).toISOString() : null
      });
      
      await this._authenticate();
    }
  }

  async _authenticate() {
    try {
      // Simulate a login request or fetch initial page to get cookies
      const response = await axios.get('https://fantasy.premierleague.com/login', {
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        headers: this._generateRequestHeaders(),
        withCredentials: true
      });

      // Extract cookies and CSRF token
      const cookies = response.headers['set-cookie'];
      const csrfTokenMatch = response.data && typeof response.data === 'string' 
        ? response.data.match(/csrfToken\s*=\s*['"]([^'"]+)['"]/i)
        : null;
      
      if (cookies) {
        this.cookies = cookies.join('; ');
      }
      
      if (csrfTokenMatch && csrfTokenMatch[1]) {
        this.csrfToken = csrfTokenMatch[1];
      }

      this.lastAuthAttempt = Date.now();

      this.logger.info('Authentication process completed', {
        hasCookies: !!this.cookies,
        hasCsrfToken: !!this.csrfToken,
        cookieLength: this.cookies ? this.cookies.length : 0
      });
    } catch (error) {
      this.logger.error('Authentication failed', {
        errorMessage: error.message,
        status: error.response?.status,
        stack: error.stack
      });
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
        this.logger.info(`Fetch attempt ${i + 1}/${retries} for ${url}`, {
          url,
          attempt: i + 1,
          maxRetries: retries,
          hasAuth: !!this.cookies
        });
        
        // Make the authenticated request
        const response = await this._makeAuthenticatedRequest(url);
        
        // Log successful response
        this.logger.info(`Successful fetch for ${url}`, {
          status: response.status,
          dataKeys: Object.keys(response.data)
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
        this.logger.error(`Fetch attempt ${i + 1}/${retries} failed for ${url}`, {
          errorMessage: err.message,
          status: err.response?.status,
          errorDetails: err.response?.data
        });
        
        // Reset authentication on auth errors
        if (err.response && (err.response.status === 401 || err.response.status === 403)) {
          this.logger.info('Authentication failed, resetting credentials', {
            status: err.response.status
          });
          this.cookies = null;
          this.csrfToken = null;
          this.lastAuthAttempt = null;
          
          // Try to re-authenticate immediately
          try {
            await this._authenticate();
          } catch (authError) {
            this.logger.error('Failed to re-authenticate', {
              error: authError.message
            });
          }
        }
        
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

  _makeAuthenticatedRequest(url) {
    const headers = this._generateRequestHeaders();
    
    // Add authentication headers if available
    if (this.cookies) {
      headers['Cookie'] = this.cookies;
    }
    
    if (this.csrfToken) {
      headers['X-CSRFToken'] = this.csrfToken;
    }
    
    return axios.get(url, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers,
      withCredentials: true,
      timeout: 15000
    });
  }

  _generateRequestHeaders() {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://fantasy.premierleague.com/',
      'Origin': 'https://fantasy.premierleague.com',
      'X-Requested-With': 'XMLHttpRequest',
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
      authStatus: {
        hasCookies: !!this.cookies,
        hasCsrfToken: !!this.csrfToken,
        lastAuthAttempt: this.lastAuthAttempt ? new Date(this.lastAuthAttempt).toISOString() : null
      }
    };
  }
}

module.exports = new FPLAPIProxyService();