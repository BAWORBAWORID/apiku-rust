/**
 * In-Memory LRU Caching Layer (QuickResponse Engine)
 * High-speed caching for static/data-heavy endpoints to achieve < 5ms response times.
 */

import logger from "./logger.js";

class MemoryCache {
  constructor(maxEntries = 500) {
    this.cache = new Map();
    this.maxEntries = maxEntries;
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Promote the entry on access so eviction is true LRU, not insertion-order FIFO.
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.value;
  }

  set(key, value, ttlSeconds = 300) {
    // Replacing an existing key should also refresh its LRU position.
    if (this.cache.has(key)) this.cache.delete(key);
    while (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey === undefined) break;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

export const apiCache = new MemoryCache();

/**
 * Express middleware for caching GET endpoint responses
 * Usage inside an endpoint or router: app.get('/route', cacheMiddleware(300), ...)
 */
export function cacheMiddleware(ttlSeconds = 300) {
  return (req, res, next) => {
    if (req.method !== "GET") return next();

    const cacheKey = req.originalUrl || req.url;
    const cachedResponse = apiCache.get(cacheKey);

    if (cachedResponse) {
      res.setHeader("X-Cache", "HIT");
      res.setHeader("X-Cache-TTL", ttlSeconds);
      return res.status(cachedResponse.status || 200).json(cachedResponse.data);
    }

    // Intercept json response to cache it before sending
    const originalJson = res.json.bind(res);
    res.json = (data) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        apiCache.set(cacheKey, { status: res.statusCode, data }, ttlSeconds);
      }
      res.setHeader("X-Cache", "MISS");
      return originalJson(data);
    };

    next();
  };
}

export default apiCache;
