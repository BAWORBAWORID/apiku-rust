/**
 * Visitor Tracker — Track unique visitors per day
 * Stores hashed IPs for privacy, counts unique daily + total visitors.
 * Uses in-memory cache with debounced async writes to eliminate sync I/O.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_FILE = path.join(process.cwd(), 'data', 'visitors.json');
const SALT = 'zyvorapi-visitor-2026';
const FLUSH_INTERVAL = 30000; // flush to disk every 30s

function hashIP(ip) {
  return crypto.createHash('sha256').update(SALT + (ip || 'unknown')).digest('hex').slice(0, 16);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// In-memory cache
let _data = null;
let _dirty = false;

function load() {
  if (_data) return _data;
  try {
    if (fs.existsSync(DATA_FILE)) {
      _data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch {}
  if (!_data) _data = { total: 0, today: {}, todayCount: 0, todayDate: today() };
  return _data;
}

function flushToDisk() {
  if (!_dirty || !_data) return;
  _dirty = false;
  try {
    fs.writeFile(DATA_FILE, JSON.stringify(_data, null, 2), () => {});
  } catch {}
}

// Periodic flush
setInterval(flushToDisk, FLUSH_INTERVAL);

// Flush on shutdown
process.on('SIGINT', flushToDisk);
process.on('SIGTERM', flushToDisk);

export function trackVisitor(ip) {
  const data = load();
  const date = today();
  const hashed = hashIP(ip);

  if (data.todayDate !== date) {
    data.today = {};
    data.todayCount = 0;
    data.todayDate = date;
  }

  if (data.today[hashed]) return false;

  data.today[hashed] = Date.now();
  data.todayCount++;
  data.total++;
  _dirty = true;
  return true;
}

export function getVisitorStats() {
  const data = load();
  const date = today();

  if (data.todayDate !== date) {
    data.today = {};
    data.todayCount = 0;
    data.todayDate = date;
    _dirty = true;
  }

  return { total: data.total, today: data.todayCount };
}

export default { trackVisitor, getVisitorStats };
