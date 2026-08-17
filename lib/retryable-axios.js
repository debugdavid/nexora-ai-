// Retryable axios instance with exponential backoff and 429 handling
require('dotenv').config();
const axios = require('axios');
const axiosRetry = require('axios-retry');

const timeoutMs = parseInt(process.env.AXIOS_TIMEOUT_MS || '60000', 10);
const retries = parseInt(process.env.RETRY_ATTEMPTS || '3', 10);

const instance = axios.create({ timeout: timeoutMs });

axiosRetry(instance, {
  retries,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    // Retry on network errors, idempotent requests, or 429 Too Many Requests
    return axiosRetry.isNetworkOrIdempotentRequestError(error) || (error && error.response && error.response.status === 429);
  },
  onRetry: (retryCount, error, requestConfig) => {
    try {
      console.warn(`axios retry #${retryCount} for ${requestConfig.method.toUpperCase()} ${requestConfig.url}: ${error?.message || error}`);
    } catch (e) {
      console.warn('axios retry', retryCount);
    }
  }
});

module.exports = instance;
