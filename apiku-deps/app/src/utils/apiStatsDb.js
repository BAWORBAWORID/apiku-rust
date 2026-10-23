import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import { getConfig } from './configCache.js';

const STATS_PATH = path.join(process.cwd(), 'api-stats.json');
const STATS_BACKUP_PATH = path.join(process.cwd(), 'api-stats.bak.json');
const SAVE_DEBOUNCE_MS = 5000;

let data = null;
let saveTimer = null;
let savePending = false;

function getDefaultData() {
  return {
    daily: {},
    weekly: {},
    monthly: {},
    allTime: { total: 0, byEndpoint: {} },
    _metadata: { lastUpdated: new Date().toISOString(), version: 'json' }
  };
}

function getPeriods() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const janFirst = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now - janFirst) / (24 * 60 * 60 * 1000));
  const weekNumber = Math.ceil((now.getDay() + 1 + days) / 7);

  return {
    dateStr,
    weekStr: `${now.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`,
    monthStr: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  };
}

function normalizeData(parsed) {
  const normalized = parsed && typeof parsed === 'object' ? parsed : {};
  if (!normalized.daily || typeof normalized.daily !== 'object') normalized.daily = {};
  if (!normalized.weekly || typeof normalized.weekly !== 'object') normalized.weekly = {};
  if (!normalized.monthly || typeof normalized.monthly !== 'object') normalized.monthly = {};
  if (!normalized.allTime || typeof normalized.allTime !== 'object') {
    normalized.allTime = { total: 0, byEndpoint: {} };
  }
  if (!Number.isFinite(normalized.allTime.total)) normalized.allTime.total = 0;
  if (!normalized.allTime.byEndpoint || typeof normalized.allTime.byEndpoint !== 'object') {
    normalized.allTime.byEndpoint = {};
  }
  if (!normalized._metadata || typeof normalized._metadata !== 'object') normalized._metadata = {};
  if (!normalized._metadata.version) normalized._metadata.version = 'json';
  if (!normalized._metadata.lastUpdated) normalized._metadata.lastUpdated = new Date().toISOString();
  return normalized;
}

function save() {
  if (!data) return false;

  try {
    data._metadata.lastUpdated = new Date().toISOString();
    const jsonStr = JSON.stringify(data, null, 2);
    const tempPath = `${STATS_PATH}.tmp`;

    fs.writeFileSync(tempPath, jsonStr, 'utf8');

    if (fs.existsSync(STATS_PATH) && data.allTime?.total > 0) {
      try {
        fs.copyFileSync(STATS_PATH, STATS_BACKUP_PATH);
      } catch {}
    }

    fs.renameSync(tempPath, STATS_PATH);
    savePending = false;
    return true;
  } catch (error) {
    logger.error(`Stats save failed: ${error.message}`);
    return false;
  }
}

function scheduleSave() {
  savePending = true;
  if (saveTimer) return;

  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (savePending) save();
  }, SAVE_DEBOUNCE_MS);
}

function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (savePending) return save();
  return true;
}

function ensurePeriod(store, key) {
  if (!store[key] || typeof store[key] !== 'object') {
    store[key] = { total: 0, byEndpoint: {} };
  }
  if (!Number.isFinite(store[key].total)) store[key].total = 0;
  if (!store[key].byEndpoint || typeof store[key].byEndpoint !== 'object') {
    store[key].byEndpoint = {};
  }
  return store[key];
}

function ensureEndpoint(allTime, endpoint) {
  if (!allTime.byEndpoint[endpoint] || typeof allTime.byEndpoint[endpoint] !== 'object') {
    allTime.byEndpoint[endpoint] = { total: 0, byStatus: {} };
  }
  const entry = allTime.byEndpoint[endpoint];
  if (!Number.isFinite(entry.total)) entry.total = 0;
  if (!entry.byStatus || typeof entry.byStatus !== 'object') entry.byStatus = {};
  return entry;
}

export async function initDb() {
  try {
    if (data) return true;

    const loadFile = (filePath) => {
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      return raw ? normalizeData(JSON.parse(raw)) : null;
    };

    try {
      data = loadFile(STATS_PATH);
      if (data) {
        logger.ready('Stats loaded from JSON');
        return true;
      }
    } catch (error) {
      logger.warn(`Corrupted api-stats.json detected (${error.message}), attempting recovery from backup...`);
    }

    try {
      data = loadFile(STATS_BACKUP_PATH);
      if (data) {
        save();
        logger.ready('Restored stats from verified backup (api-stats.bak.json) after sudden restart!');
        return true;
      }
    } catch (error) {
      logger.error(`Backup restoration failed: ${error.message}`);
    }

    data = getDefaultData();
    save();
    logger.ready('Stats initialized default (JSON)');
    return true;
  } catch (error) {
    logger.error(`Stats init failed: ${error.message}`);
    data = getDefaultData();
    return true;
  }
}

export function isConnected() {
  return data !== null;
}

export async function hasData() {
  if (!data) return false;
  return data.allTime.total > 0 || Object.keys(data.daily).length > 0;
}

export async function recordHit(endpoint, statusCode, periods) {
  if (!data) return;

  try {
    const p = periods || getPeriods();
    const statusGroup = Math.floor(Number(statusCode) / 100) || 0;

    const daily = ensurePeriod(data.daily, p.dateStr);
    daily.total++;
    daily.byEndpoint[endpoint] = (daily.byEndpoint[endpoint] || 0) + 1;

    const weekly = ensurePeriod(data.weekly, p.weekStr);
    weekly.total++;
    weekly.byEndpoint[endpoint] = (weekly.byEndpoint[endpoint] || 0) + 1;

    const monthly = ensurePeriod(data.monthly, p.monthStr);
    monthly.total++;
    monthly.byEndpoint[endpoint] = (monthly.byEndpoint[endpoint] || 0) + 1;

    data.allTime.total++;
    const endpointData = ensureEndpoint(data.allTime, endpoint);
    endpointData.total++;
    endpointData.byStatus[statusGroup] = (endpointData.byStatus[statusGroup] || 0) + 1;

    scheduleSave();
  } catch (error) {
    logger.error(`Stats record failed: ${error.message}`);
  }
}

export async function getStatsSummary() {
  if (!data) return null;

  try {
    const periods = getPeriods();
    const today = data.daily[periods.dateStr];
    const week = data.weekly[periods.weekStr];
    const month = data.monthly[periods.monthStr];
    const config = getConfig();
    const popularLimit = Number(config.popularLimit) || 50;

    const popularEndpoints = Object.entries(data.allTime.byEndpoint)
      .map(([endpoint, endpointData]) => ({
        endpoint,
        hits: endpointData.total || 0,
        successRate: endpointData.total > 0
          ? Math.min(100, Math.round(((endpointData.byStatus?.[2] || 0) / endpointData.total) * 100))
          : 0
      }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, popularLimit);

    return {
      today: today?.total || 0,
      thisWeek: week?.total || 0,
      thisMonth: month?.total || 0,
      total: data.allTime.total,
      popularEndpoints,
      lastUpdated: data._metadata.lastUpdated
    };
  } catch (error) {
    logger.error(`Stats summary failed: ${error.message}`);
    return null;
  }
}

export async function loadAllStats() {
  if (!data) return null;
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    return null;
  }
}

export async function migrateFromJson(jsonStats) {
  if (!jsonStats || !data) return;

  if (await hasData()) {
    logger.info('Stats data already exists, skipping migration');
    return;
  }

  data.daily = jsonStats.daily || {};
  data.weekly = jsonStats.weekly || {};
  data.monthly = jsonStats.monthly || {};
  data.allTime = jsonStats.allTime || { total: 0, byEndpoint: {} };
  data = normalizeData(data);
  scheduleSave();
  logger.ready('Stats migration complete');
}

export async function closeDb() {
  if (!data) return;
  flushSave();
  if (data) save();
  logger.info('Stats saved to JSON');
}
