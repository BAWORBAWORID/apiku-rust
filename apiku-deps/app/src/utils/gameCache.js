/**
 * Game Data Cache — In-memory cache for game JSON data from GitHub.
 * Eliminates HTTP fetch on every request for 27 game endpoints.
 * TTL: 10 minutes (auto-refresh on expiry).
 */
import axios from 'axios';
import logger from './logger.js';

const cache = new Map();
const DEFAULT_TTL = 10 * 60 * 1000; // 10 minutes

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Fetch JSON from URL with caching.
 * @param {string} url - GitHub raw URL
 * @param {number} [ttl=600000] - Cache TTL in ms
 * @returns {Promise<any>} Parsed JSON data
 */
export async function fetchCached(url, ttl = DEFAULT_TTL) {
  const now = Date.now();
  const entry = cache.get(url);

  if (entry && (now - entry.timestamp) < ttl) {
    return entry.data;
  }

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': DEFAULT_UA }
    });

    cache.set(url, { data: response.data, timestamp: now });
    return response.data;
  } catch (err) {
    // Return stale cache if available
    if (entry) {
      logger.warn(`Game cache: using stale data for ${url} (${err.message})`);
      return entry.data;
    }
    throw err;
  }
}

/**
 * Pick a random item from an array.
 * @param {any[]} arr
 * @returns {{ item: any, index: number, total: number }}
 */
export function pickRandom(arr) {
  if (!arr || !Array.isArray(arr) || arr.length === 0) {
    throw new Error('Empty or invalid data array');
  }
  const index = Math.floor(Math.random() * arr.length);
  return { item: arr[index], index, total: arr.length };
}

/**
 * Clear all cached data (for testing/admin).
 */
export function clearCache() {
  cache.clear();
}

export default { fetchCached, pickRandom, clearCache };
