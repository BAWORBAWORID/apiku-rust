/**
 * Configuration Cache — Single source of truth for configuration.json
 * Reads once at startup, auto-invalidates via file watcher.
 * Eliminates all sync file reads of configuration.json across the codebase.
 */
import fs from 'fs';
import path from 'path';
import logger from './logger.js';

const CONFIG_FILE = path.join(process.cwd(), 'configuration.json');

let _config = null;
let _lastLoaded = 0;

function loadSync() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      _config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      _lastLoaded = Date.now();
    }
  } catch (err) {
    logger.error(`Config cache load failed: ${err.message}`);
  }
}

// Load once at startup
loadSync();

// Watch for changes and invalidate
try {
  fs.watch(CONFIG_FILE, (eventType) => {
    if (eventType === 'change') {
      loadSync();
    }
  });
} catch (err) {
  logger.warn(`Config file watcher failed: ${err.message}`);
}

/**
 * Get cached configuration object. Never reads from disk.
 * @returns {object} Configuration object
 */
export function getConfig() {
  return _config || {};
}

/**
 * Force reload configuration from disk (e.g., after admin edit).
 */
export function reloadConfig() {
  loadSync();
  return _config;
}

/**
 * Get a specific config key.
 * @param {string} key
 * @returns {any}
 */
export function getConfigKey(key) {
  return _config ? _config[key] : undefined;
}

export default { getConfig, reloadConfig, getConfigKey };
