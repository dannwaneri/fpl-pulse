// client/src/utils/apiConfig.js
export const API_BASE_URL = process.env.NODE_ENV === 'production' 
  ? '' // Empty string for relative URLs in production
  : 'http://localhost:5000';

export const WS_BASE_URL = () => {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsHost = process.env.NODE_ENV === 'production' 
    ? window.location.host
    : 'localhost:5000';
  return `${wsProtocol}//${wsHost}`;
};

export const getApiUrl = (endpoint) => `${API_BASE_URL}${endpoint}`;