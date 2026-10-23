/**
 * @license
 * Copyright (C) 2026 BAWORBAWORID
 * https://github.com/BAWORBAWORID
 */

import 'dotenv/config';
import fs from "fs";
import path from "path";
import { bot } from './telegram.js';
import logger from '../utils/logger.js';
import { getConfig } from '../utils/configCache.js';

// ==================== KONFIGURASI ====================
const DATA_DIR = path.join(process.cwd(), "data");
const LOG_DIR = path.join(process.cwd(), "logs");
const BANNED_FILE = path.join(DATA_DIR, "banned-ips.json");
const WHITELIST_FILE = path.join(DATA_DIR, "whitelist-ips.json");
const REQUEST_LOG = path.join(LOG_DIR, "request-logs.log");
const LOCK_FILE = path.join(DATA_DIR, "global-lock.json");
const REQUESTS_FILE = path.join(DATA_DIR, "requests-data.json"); // NEW: Simpan data requests
const NOTIF_LOG_FILE = path.join(DATA_DIR, "notifications-log.json"); // NEW: Log notifikasi yang sudah dikirim
const NOTIF_FEED_FILE = path.join(DATA_DIR, "notifications-feed.json"); // NEW: Detailed feed for dashboard
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 jam (daily)
const MAX_REQUESTS = 500; // Max 500 request per hari
const VIOLATION_LIMIT = 20; // Maksimum pelanggaran sebelum di-ban
const UNIQUE_WINDOW_MS = 120 * 1000; // 120 detik untuk unique IP tracking
const MAX_UNIQUE_IP = 100; // Maksimum unique IP per window
const LOCK_HOURS = 1; // Durasi global lock dalam jam
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 jam
const VIOLATION_EXPIRY = 24 * 60 * 60 * 1000; // 24 jam - violation reset
const NOTIF_COOLDOWN = 60 * 1000; // 60 detik cooldown notifikasi per IP

// Telegram
const CHAT_ID = process.env.CHAT_ID || process.env.TELEGRAM_CHAT_ID || 5323386592;

// ==================== DATA STRUCTURES ====================
/**
 * @typedef {Object} IpRequestData
 * @property {number} count - Jumlah request dalam window saat ini
 * @property {number} windowStart - Waktu window dimulai
 * @property {number} totalRequests - Total request (untuk tracking)
 * @property {number} violations - Jumlah pelanggaran (akumulasi)
 * @property {number[]} violationTimes - Timestamp pelanggaran untuk tracking expiry
 * @property {number} lastRequest - Waktu request terakhir
 * @property {number} firstRequest - Waktu request pertama
 * @property {string} lastPath - Path terakhir yang diakses
 * @property {string} lastUserAgent - User agent terakhir
 * @property {number} lastNotif - Waktu notifikasi terakhir
 */

/** @type {Map<string, IpRequestData>} */
const requests = new Map();

/** @type {Set<string>} */
const uniqueIPs = new Set();

/** @type {number} */
let uniqueWindowStart = Date.now();

// File-based data
let banned = { ips: {} };
let whitelist = { ips: {} };
let notificationsLog = { sent: [] }; // Log notifikasi yang sudah dikirim

// ==================== HELPER FUNCTIONS ====================
const getHostname = (req) => {
  return (
    req.headers['x-forwarded-host'] ||
    req.headers.host ||
    req.hostname ||
    'unknown'
  );
};

const CLOUDFLARE_IPS = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];

function ipToNum(ip) {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isCloudflareIP(ip) {
  if (!ip || !ip.includes('.')) return false;
  const ipNum = ipToNum(ip);
  for (const range of CLOUDFLARE_IPS) {
    const [subnet, bits] = range.split('/');
    const mask = ~((1 << (32 - bits)) - 1) >>> 0;
    if ((ipNum & mask) === (ipToNum(subnet) & mask)) return true;
  }
  return false;
}

function cleanIPv6(ip) {
  if (!ip) return null;
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

/**
 * Normalize IP for banned/whitelist check
 * - Expand IPv6 :: compression
 * - Extract IPv4 from ::ffff: prefix
 * - Return consistent format for matching
 */
function normalizeIPForBanCheck(ip) {
  if (!ip) return '';
  // Extract IPv4 from ::ffff: prefix
  if (ip.startsWith('::ffff:')) {
    return ip.slice(7);
  }
  // Expand IPv6 :: compression for consistent matching
  if (ip.includes('::') && !ip.startsWith('::ffff:')) {
    const [left, right] = ip.split('::');
    const leftParts = left ? left.split(':') : [];
    const rightParts = right ? right.split(':') : [];
    const missing = 8 - leftParts.length - rightParts.length;
    if (missing > 0) {
      const zeros = Array(missing).fill('0000');
      const expanded = [...leftParts, ...Array(missing).fill('0000'), ...rightParts];
      return expanded.map(p => p.padStart(4, '0')).join(':');
    }
  }
  return ip;
}

function isLocalhost(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0';
}

const IPv4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPv6_RE = /^[0-9a-fA-F:]+$/;

function isValidIP(ip) {
  if (!ip) return false;
  return IPv4_RE.test(ip) || IPv6_RE.test(ip);
}

export function getClientIP(req) {
  const rawRemote = req.socket?.remoteAddress || '';
  const remote = cleanIPv6(rawRemote);

  // 1. If connection is from Cloudflare edge IP → trust cf-connecting-ip
  if (isCloudflareIP(remote)) {
    const cfIP = cleanIPv6(req.headers['cf-connecting-ip']);
    if (cfIP && isValidIP(cfIP)) return cfIP;
  }

  // 2. If socket is localhost (Cloudflare/-proxy connects via loopback) → use req.ip
  //    req.ip is derived from X-Forwarded-For by Express (trust proxy=1)
  if (isLocalhost(remote)) {
    const reqIP = cleanIPv6(req.ip);
    if (reqIP && !isLocalhost(reqIP) && isValidIP(reqIP)) return reqIP;
    // fallback: check X-Forwarded-For directly
    const xff = cleanIPv6(req.headers['x-forwarded-for']?.split(',')[0]?.trim());
    if (xff && !isLocalhost(xff) && isValidIP(xff)) return xff;
  }

  // 3. Use socket address directly (not behind proxy, or proxy IP is real)
  if (remote && isValidIP(remote)) return remote;

  // 4. Last resort: req.ip
  const reqIP = cleanIPv6(req.ip);
  if (reqIP && isValidIP(reqIP)) return reqIP;

  return remote || '0.0.0.0';
}

const jakartaTZ = 'Asia/Jakarta';
const fmtTime = new Intl.DateTimeFormat('en-CA', { timeZone: jakartaTZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const fmtDisplay = new Intl.DateTimeFormat('en-GB', { timeZone: jakartaTZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function formatTime(timestamp = Date.now()) {
  return fmtTime.format(new Date(timestamp)).replace(',', '');
}

function formatDisplayTime(timestamp) {
  return fmtDisplay.format(new Date(timestamp)).replace(',', '');
}

// ==================== FILE OPERATIONS ====================
function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  
  const defaultBanned = { ips: {} };
  const defaultWhitelist = { ips: {} };
  const defaultLock = { locked: false, until: 0, reason: '' };
  const defaultRequests = {};
  const defaultNotifLog = { sent: [] };
  
  if (!fs.existsSync(BANNED_FILE)) 
    fs.writeFileSync(BANNED_FILE, JSON.stringify(defaultBanned, null, 2));
  if (!fs.existsSync(WHITELIST_FILE)) 
    fs.writeFileSync(WHITELIST_FILE, JSON.stringify(defaultWhitelist, null, 2));
  if (!fs.existsSync(REQUEST_LOG)) 
    fs.writeFileSync(REQUEST_LOG, "");
  if (!fs.existsSync(LOCK_FILE))
    fs.writeFileSync(LOCK_FILE, JSON.stringify(defaultLock, null, 2));
  if (!fs.existsSync(REQUESTS_FILE))
    fs.writeFileSync(REQUESTS_FILE, JSON.stringify(defaultRequests, null, 2));
  if (!fs.existsSync(NOTIF_LOG_FILE))
    fs.writeFileSync(NOTIF_LOG_FILE, JSON.stringify(defaultNotifLog, null, 2));
}

// Load semua data dari file
function loadAllData() {
  // Load banned
  try {
    const raw = fs.readFileSync(BANNED_FILE, "utf8");
    banned = raw ? JSON.parse(raw) : { ips: {} };
    if (!banned.ips) banned.ips = {};
  } catch (err) {
    logger.error("Failed to load banned ips file:", err);
    banned = { ips: {} };
  }

  // Load whitelist
  try {
    const raw = fs.readFileSync(WHITELIST_FILE, "utf8");
    whitelist = raw ? JSON.parse(raw) : { ips: {} };
    if (!whitelist.ips) whitelist.ips = {};
    
    // Auto-add localhost
    const localhostv4 = "127.0.0.1";
    const localhostv6 = "::1";
    let updated = false;

    if (!whitelist.ips[localhostv4]) {
      whitelist.ips[localhostv4] = { 
        addedAt: new Date().toISOString(), 
        reason: "Localhost" 
      };
      updated = true;
    }
    if (!whitelist.ips[localhostv6]) {
      whitelist.ips[localhostv6] = { 
        addedAt: new Date().toISOString(), 
        reason: "Localhost" 
      };
      updated = true;
    }

    if (updated) saveWhitelist();
  } catch (err) {
    logger.error("Failed to load whitelist file:", err);
    whitelist = { ips: {} };
  }

  // Load requests data dari file
  try {
    const raw = fs.readFileSync(REQUESTS_FILE, "utf8");
    const savedRequests = raw ? JSON.parse(raw) : {};
    
    // Konversi ke Map
    requests.clear();
    for (const [ip, data] of Object.entries(savedRequests)) {
      requests.set(ip, data);
    }
    logger.info(`📊 Loaded ${requests.size} IPs from storage`);
  } catch (err) {
    logger.error("Failed to load requests data:", err);
  }

  // Load notifications log
  try {
    const raw = fs.readFileSync(NOTIF_LOG_FILE, "utf8");
    notificationsLog = raw ? JSON.parse(raw) : { sent: [] };
    
    // Bersihkan log notifikasi yang lebih dari 24 jam
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    notificationsLog.sent = notificationsLog.sent.filter(n => n.timestamp > oneDayAgo);
    saveNotifLog();
  } catch (err) {
    logger.error("Failed to load notifications log:", err);
    notificationsLog = { sent: [] };
  }
}

function saveWhitelist() {
  try {
    fs.writeFileSync(WHITELIST_FILE, JSON.stringify(whitelist, null, 2));
  } catch (err) {
    logger.error("Failed to save whitelist file:", err);
  }
}

function saveBanned() {
  try {
    fs.writeFileSync(BANNED_FILE, JSON.stringify(banned, null, 2));
  } catch (err) {
    logger.error("Failed to save banned ips file:", err);
  }
}

let _requestsDirty = false;

/**
 * Mark data as dirty — actual disk write happens via periodic interval.
 * This replaces the old saveRequestsToFile() calls in the hot path
 * so no serialization/setTimeout overhead per request.
 */
function markDirty() {
  _requestsDirty = true;
}

function flushToDisk() {
  if (!_requestsDirty) return;
  _requestsDirty = false;
  try {
    const requestsObj = {};
    for (const [ip, data] of requests.entries()) {
      requestsObj[ip] = data;
    }
    fs.writeFile(REQUESTS_FILE, JSON.stringify(requestsObj, null, 2), () => {});
  } catch (err) {
    logger.error("Failed to save requests data:", err);
  }
}

function forceSyncSave() {
  if (!_requestsDirty) return;
  _requestsDirty = false;
  try {
    const requestsObj = {};
    for (const [ip, data] of requests.entries()) {
      requestsObj[ip] = data;
    }
    fs.writeFileSync(REQUESTS_FILE, JSON.stringify(requestsObj, null, 2));
  } catch (err) {
    logger.error("Failed to save requests data:", err);
  }
}

// Legacy alias for backward compat — calls markDirty + triggers periodic flush
function saveRequestsToFile() {
  markDirty();
}

function saveNotifLog() {
  try {
    fs.writeFileSync(NOTIF_LOG_FILE, JSON.stringify(notificationsLog, null, 2));
  } catch (err) {
    logger.error("Failed to save notifications log:", err);
  }
}

/**
 * Save detailed notification to feed file for admin dashboard
 */
function saveNotificationToFeed(notification) {
  try {
    let feed = [];
    if (fs.existsSync(NOTIF_FEED_FILE)) {
      try {
        const raw = fs.readFileSync(NOTIF_FEED_FILE, 'utf8');
        if (raw.length < 1024 * 1024) {
          feed = JSON.parse(raw);
        }
      } catch { feed = []; }
    }
    
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    // Filter out entries older than 24 hours
    feed = feed.filter(n => now - (n.timestamp || 0) < ONE_DAY);

    feed.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
      type: notification.type,
      ip: notification.ip || null,
      hostname: notification.hostname || null,
      path: notification.path || null,
      method: notification.method || null,
      message: notification.message || getNotificationMessage(notification),
      timestamp: notification.timestamp || now,
      timeFormatted: formatDisplayTime(notification.timestamp || now),
      details: notification.response || null,
      violations: notification.violations || null,
      violationLimit: notification.violationLimit || null,
      count: notification.count || null,
      maxReq: notification.maxReq || null
    });
    
    // Max 50 entries — overwrite oldest when exceeded
    if (feed.length > 50) {
      feed = feed.slice(0, 50);
    }
    
    fs.writeFile(NOTIF_FEED_FILE, JSON.stringify(feed, null, 2), () => {});
  } catch (err) {
    logger.error("Failed to save notification feed:", err);
  }
}

function getNotificationMessage(notif) {
  switch(notif.type) {
    case 'spam': return `SPAM detected from ${notif.ip} on ${notif.path}`;
    case 'violation': return `Violation #${notif.violations} for ${notif.ip}`;
    case 'ban': return `IP ${notif.ip} has been banned`;
    case 'unban': return `IP ${notif.ip} has been unbanned`;
    case 'lock': return `Global API lock activated`;
    case 'unlock': return `Global API lock deactivated`;
    case 'stats': return `Daily stats report`;
    default: return `Notification: ${notif.type}`;
  }
}

function appendLog(line) {
  try {
    fs.appendFileSync(REQUEST_LOG, line + "\n");
  } catch (err) {
    logger.error("Failed to append request log:", err);
  }
}

// Capture startup timestamp to prevent watcher-triggered reloads during initialization
const _moduleStartTime = Date.now();
const STARTUP_GRACE_MS = 3000; // 3 seconds — skip reloads triggered by init-phase file writes

// Initialize
ensureFiles();
loadAllData();

// Auto-save setiap 5 menit
setInterval(flushToDisk, 5 * 60 * 1000);

// Save data saat process akan di-restart (PM2, SIGINT, SIGTERM)
function gracefulShutdown(signal) {    logger.info(`📊 Saving rate limit data before ${signal}...`);
  forceSyncSave();
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ==================== FILE WATCHERS (Debounced) ====================
// Debounce untuk mencegah cascade loop — fs.watch di Linux sering double-fire
let _reloadTimer = null;
const _reloadDelay = 200; // ms

function debouncedReload(source) {
  // Skip reloads during startup grace period to avoid double-load from
  // init-phase file writes (e.g., configuration.json updated by initializeAPI)
  if (Date.now() - _moduleStartTime < STARTUP_GRACE_MS) {
    return;
  }
  if (_reloadTimer) {
    clearTimeout(_reloadTimer);
  }
  _reloadTimer = setTimeout(() => {
    _reloadTimer = null;
    logger.info(`🔄 ${source} changed, reloading...`);
    loadAllData();
  }, _reloadDelay);
}

fs.watch(WHITELIST_FILE, (eventType) => {
  if (eventType === 'change') debouncedReload('Whitelist');
});

fs.watch(BANNED_FILE, (eventType) => {
  if (eventType === 'change') debouncedReload('Banned IPs');
});

// ==================== TELEGRAM NOTIFICATIONS ====================
/**
 * Cek apakah boleh mengirim notifikasi untuk IP dan tipe tertentu
 */
function canSendNotification(ip, type, cooldownMs = NOTIF_COOLDOWN) {
  const now = Date.now();
  
  // Cari notifikasi terakhir untuk IP dan tipe ini
  const lastNotif = notificationsLog.sent.find(n => 
    n.ip === ip && n.type === type
  );
  
  if (!lastNotif) return true;
  
  // Cek cooldown
  return (now - lastNotif.timestamp) > cooldownMs;
}

/**
 * Catat notifikasi yang dikirim
 */
function logNotification(ip, type) {
  const now = Date.now();
  
  // Hapus notifikasi lama untuk IP dan tipe yang sama
  notificationsLog.sent = notificationsLog.sent.filter(n => 
    !(n.ip === ip && n.type === type)
  );
  
  // Tambah notifikasi baru
  notificationsLog.sent.push({
    ip,
    type,
    timestamp: now
  });
  
  // Batasi ukuran log (simpan 1000 notifikasi terakhir)
  if (notificationsLog.sent.length > 1000) {
    notificationsLog.sent = notificationsLog.sent.slice(-1000);
  }
  
  saveNotifLog();
}

async function sendTelegramNotification(options) {
  if (!CHAT_ID || !bot) {
    return;
  }

  const {
    type,
    ip,
    hostname,
    path,
    method,
    userAgent,
    count,
    maxReq,
    violations,
    violationLimit,
    reason,
    response, // Tambahan untuk menampilkan response
    apiKey,
    statusCode,
    timestamp = Date.now()
  } = options;

  // Cek cooldown untuk tipe notifikasi tertentu
  if (type === 'warning' || type === 'violation' || type === 'request') {
    if (!canSendNotification(ip, type)) {
      return; // Skip notifikasi jika masih dalam cooldown
    }
  }

  const timeStr = formatDisplayTime(timestamp);
  const emoji = {
    'spam': '🚨', // Ganti warning jadi spam
    'violation': '🔴',
    'ban': '⛔',
    'unban': '✅',
    'lock': '🔒',
    'unlock': '🔓',
    'stats': '📊',
    'premium': '🔑'
  }[type] || '📌';

  let message = '';

  switch(type) {
    case 'spam': // Ganti dari warning ke spam
      message = 
        `${emoji} *SPAM TERDETEKSI*\n\n` +
        `🕒 Waktu: \`${timeStr}\`\n` +
        `🌐 Host: \`${hostname}\`\n` +
        `📌 IP: \`${ip}\`\n` +
        `🔗 Path: \`${path}\`\n` +
        `📡 Method: \`${method}\`\n` +
        `📊 Penggunaan: \`${count}/${maxReq}\` (melebihi batas!)\n` +
        `⚠️ Total Pelanggaran: \`${violations}/${violationLimit}\`\n` +
        `⏳ Reset: ${Math.ceil((options.windowReset - timestamp) / 1000)} detik lagi\n\n`;
      
      // Tambahkan response jika ada
      if (response) {
        message += `📦 *Response yang dikirim:*\n\`\`\`json\n${JSON.stringify(response, null, 2)}\n\`\`\``;
      }
      break;

    case 'violation':
      message = 
        `${emoji} *PELANGGARAN BERTAMBAH*\n\n` +
        `🕒 Waktu: \`${timeStr}\`\n` +
        `🌐 Host: \`${hostname}\`\n` +
        `📌 IP: \`${ip}\`\n` +
        `🔗 Path: \`${path}\`\n` +
        `📊 Total Pelanggaran: \`${violations}/${violationLimit}\`\n` +
        `⚠️ Sisa sebelum ban: \`${violationLimit - violations}\` kali\n\n`;
      
      if (response) {
        message += `📦 *Response yang dikirim:*\n\`\`\`json\n${JSON.stringify(response, null, 2)}\n\`\`\``;
      }
      break;

    case 'ban':
      message = 
        `${emoji} *IP TERBLOKIR PERMANEN*\n\n` +
        `🕒 Waktu: \`${timeStr}\`\n` +
        `🌐 Host: \`${hostname}\`\n` +
        `📌 IP: \`${ip}\`\n` +
        `📊 Alasan: \`${reason}\`\n` +
        `⚠️ Total Pelanggaran: \`${violations}\`\n` +
        `🔗 Path terakhir: \`${path}\``;
      break;

    case 'unban':
      message = 
        `${emoji} *IP DIBUKA BLOKIRNYA*\n\n` +
        `🕒 Waktu: \`${timeStr}\`\n` +
        `📌 IP: \`${ip}\``;
      break;

    case 'lock':
      message = 
        `${emoji} *GLOBAL API LOCK*\n\n` +
        `🕒 Waktu: \`${timeStr}\`\n` +
        `⏳ Durasi: \`${LOCK_HOURS} jam\`\n` +
        `📌 Alasan: \`${reason}\``;
      break;

    case 'unlock':
      message = 
        `${emoji} *MAINTENANCE SELESAI*\n\n` +
        `🕒 Waktu: \`${timeStr}\`\n` +
        `✅ REST API dapat digunakan kembali`;
      break;

    case 'stats':
      message = 
        `${emoji} *STATISTIK RATE LIMITER*\n\n` +
        `🕒 Waktu: \`${timeStr}\`\n` +
        `👥 IP Aktif: \`${options.activeIps}\`\n` +
        `⛔ IP Terblokir: \`${options.bannedCount}\`\n` +
        `✅ IP Whitelist: \`${options.whitelistedCount}\`\n` +
        `📊 Total Request: \`${options.totalRequests}\`\n` +
        `⚠️ Total Pelanggaran: \`${options.totalViolations}\`\n` +
        `🔒 Status Lock: \`${options.lockStatus}\``;
      break;

    case 'premium':
    case 'vip': {
      let respText = '';
      if (response) {
        respText = typeof response === 'string' ? response : JSON.stringify(response, null, 2);
        if (respText.length > 800) respText = respText.slice(0, 800) + '…';
        respText = `\n\`\`\`json\n${respText}\n\`\`\``;
      } else {
        respText = `Status ${statusCode || '-'}`;
      }
      message =
        `${emoji} *${type === 'vip' ? 'VIP' : 'PREMIUM'} API REQUEST*\n\n` +
        `🕒 Waktu: \`${timeStr}\`\n` +
        `🌐 IP: \`${ip || 'Unknown'}\`\n` +
        `🔗 Method: \`${method || '-'}\`\n` +
        `🛣 Endpoint: \`${path || '-'}\`\n` +
        `🔐 API Key: \`${apiKey || '-'}\`\n` +
        `📦 Response:${respText}`;
      break;
    }
  }

  try {
    // if (type === 'premium') logger.info('[PREM-DBG] message=' + message.slice(0, 500));
    await bot.telegram.sendMessage(CHAT_ID, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
    
    // Catat notifikasi yang dikirim (kecuali stats)
    if (type !== 'stats') {
      logNotification(ip, type);
    }
  } catch (err) {
    logger.error('Failed to send Telegram notification:', err);
  }
  
  // Always save to dashboard feed (including stats)
  saveNotificationToFeed(options);
}

// ==================== GLOBAL LOCK FUNCTIONS ====================
function getLockStatus() {
  try {
    return JSON.parse(fs.readFileSync(LOCK_FILE));
  } catch {
    return { locked: false, until: 0, reason: '' };
  }
}

function saveLockStatus(lockData) {
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2));
}

function activateGlobalLock(reason) {
  const until = Date.now() + LOCK_HOURS * 60 * 60 * 1000;
  const lockData = { locked: true, until, reason };
  saveLockStatus(lockData);

  sendTelegramNotification({
    type: 'lock',
    reason,
    timestamp: Date.now()
  });    logger.info(`🔒 Global lock activated: ${reason}`);
}

function isLocked() {
  const lock = getLockStatus();
  if (!lock.locked) return false;

  if (Date.now() > lock.until) {
    saveLockStatus({ locked: false, until: 0, reason: '' });
    
    sendTelegramNotification({
      type: 'unlock',
      timestamp: Date.now()
    });
    
    logger.info('🔓 Global lock expired');
    return false;
  }

  return true;
}

// ==================== IP MANAGEMENT ====================
/**
 * Ban IP address
 */
function banIp(ip, reason = "rate_limit_exceeded", requestInfo = {}) {
  // Cek whitelist
  if (whitelist.ips && whitelist.ips[ip]) {
    logger.info(`[Protection] Prevented banning of whitelisted IP: ${ip}`);
    return false;
  }

  const now = new Date().toISOString();
  const timestamp = Date.now();
  
  if (!banned.ips) banned.ips = {};
  
  banned.ips[ip] = {
    bannedAt: now,
    bannedAtTimestamp: timestamp,
    reason,
    by: "rateLimiter",
    lastPath: requestInfo.path || 'unknown',
    lastMethod: requestInfo.method || 'unknown',
    violations: requestInfo.violations || 0
  };
  
  saveBanned();
  appendLog(`[BAN] ${now} ${ip} reason=${reason}`);
  
  // Hapus dari requests map
  requests.delete(ip);
  saveRequestsToFile();
  
  // Kirim notifikasi ban (tanpa cooldown)
  sendTelegramNotification({
    type: 'ban',
    ip,
    hostname: requestInfo.hostname || 'unknown',
    path: requestInfo.path || 'unknown',
    method: requestInfo.method || 'unknown',
    reason,
    violations: requestInfo.violations || 0,
    timestamp
  });
  
  return true;
}

/**
 * Unban IP address
 */
function unbanIp(ip) {
  if (banned.ips && banned.ips[ip]) {
    const now = new Date().toISOString();
    delete banned.ips[ip];
    saveBanned();
    appendLog(`[UNBAN] ${now} ${ip}`);
    
    sendTelegramNotification({
      type: 'unban',
      ip,
      timestamp: Date.now()
    });
    
    return true;
  }
  return false;
}

/**
 * Bersihkan violation yang sudah expired
 */
/**
 * Hitung jeda (ms) hingga jam tertentu (WIB) berikutnya.
 * Asia/Jakarta = UTC+7 tetap tanpa DST → pakai offset +7 jam.
 */
function getMsUntilNext(now, hourWIB) {
  const nowWIB = new Date(now + 7 * 60 * 60 * 1000);
  let target = Date.UTC(nowWIB.getUTCFullYear(), nowWIB.getUTCMonth(), nowWIB.getUTCDate(), hourWIB, 0, 0, 0) - 7 * 60 * 60 * 1000;
  if (target <= now) target += 24 * 60 * 60 * 1000;
  return target - now;
}

/**
 * Kirim laporan statistik harian (tepat 07:00 WIB, 1x/hari).
 */
function sendDailyStats() {
  const now = Date.now();
  const nowWIB = new Date(now + 7 * 60 * 60 * 1000);
  const today = nowWIB.toDateString();
  const lastStatsDay = notificationsLog.sent
    .filter(n => n.type === 'stats')
    .map(n => new Date(n.timestamp).toDateString())
    .pop();

  if (lastStatsDay === today) return;

  const totalViolations = Array.from(requests.values())
    .reduce((sum, d) => sum + (d.violations || 0), 0);

  const stats = {
    type: 'stats',
    activeIps: requests.size,
    bannedCount: Object.keys(banned.ips || {}).length,
    whitelistedCount: Object.keys(whitelist.ips || {}).length,
    totalRequests: Array.from(requests.values()).reduce((sum, d) => sum + (d.totalRequests || 0), 0),
    totalViolations,
    lockStatus: isLocked() ? '🔒 Active' : '🔓 Inactive',
    timestamp: now
  };

  sendTelegramNotification(stats);
  logNotification('system', 'stats');
}

/**
 * Jadwalkan laporan harian agar menembak persis 07:00 WIB.
 * Reschedule otomatis 24 jam setelah setiap pengiriman.
 */
function scheduleDailyReport() {
  const delay = getMsUntilNext(Date.now(), 7);
  setTimeout(() => {
    sendDailyStats();
    scheduleDailyReport();
  }, delay);
}

/**
 * Bersihkan violation yang sudah expired
 */
function cleanupExpiredViolations() {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [ip, data] of requests.entries()) {
    if (data.violationTimes && Array.isArray(data.violationTimes)) {
      // Filter violation yang masih dalam periode 24 jam
      const validViolations = data.violationTimes.filter(time => 
        now - time < VIOLATION_EXPIRY
      );
      
      if (validViolations.length !== data.violationTimes.length) {
        data.violationTimes = validViolations;
        data.violations = validViolations.length;
        cleanedCount++;
      }
    }
  }
  
  if (cleanedCount > 0) {
    logger.info(`[Cleanup] Reset violations for ${cleanedCount} IPs`);
    saveRequestsToFile();
  }
}

/**
 * Cleanup data yang tidak aktif
 */
function cleanup() {
  const now = Date.now();
  let cleanedCount = 0;
  
  // Bersihkan violation expired
  cleanupExpiredViolations();
  
  // Bersihkan IP yang tidak aktif (30 hari)
  for (const [ip, data] of requests.entries()) {
    if (now - data.lastRequest > 30 * 24 * 60 * 60 * 1000) {
      requests.delete(ip);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    logger.info(`[Cleanup] Removed ${cleanedCount} inactive IPs`);
    saveRequestsToFile();
  }
  
  // Bersihkan log notifikasi yang lebih dari 24 jam
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  notificationsLog.sent = notificationsLog.sent.filter(n => n.timestamp > oneDayAgo);
  saveNotifLog();
  
  // Reset notification feed setiap awal bulan (tanggal 1, jam 00:00-01:00 WIB)
  const nowWIB = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const currentHourWIB = nowWIB.getUTCHours();
  const monthKey = nowWIB.getUTCFullYear() + '-' + (nowWIB.getUTCMonth() + 1);
  const lastResetMonth = notificationsLog.sent
    .filter(n => n.type === 'monthly_reset')
    .map(n => new Date(n.timestamp).toISOString().slice(0, 7))
    .pop();
  
  if (lastResetMonth !== monthKey && nowWIB.getUTCDate() === 1 && currentHourWIB === 0) {
    try {
      fs.writeFileSync(NOTIF_FEED_FILE, '[]');
      logger.info(`[Cleanup] Notification feed reset for month ${monthKey}`);
    } catch {}
    logNotification('system', 'monthly_reset');
  }
}

setInterval(cleanup, CLEANUP_INTERVAL_MS);

// Kirim laporan statistik harian tepat 07:00 WIB
scheduleDailyReport();

// ==================== MAIN RATE LIMITER ====================
function rateLimiterMiddleware() {
  return (req, res, next) => {
    const config = getConfig();
    // Dynamic config from configuration.json (editable from admin dashboard)
    const maxReq = (config.rateLimit && config.rateLimit.maxRequests) ? config.rateLimit.maxRequests : MAX_REQUESTS;
    const windowMs = (config.rateLimit && config.rateLimit.windowMs) ? config.rateLimit.windowMs : WINDOW_MS;
    const violationLimit = (config.spamDetection && config.spamDetection.maxViolations) ? config.spamDetection.maxViolations : VIOLATION_LIMIT;
    const maxUniqueIp = (config.spamDetection && config.spamDetection.maxUniqueIPs) ? config.spamDetection.maxUniqueIPs : MAX_UNIQUE_IP;

    // Check if rate limiting is disabled
    if (config.rateLimit && config.rateLimit.enabled === false) {
      return next();
    }

    // Get client info
    const ip = getClientIP(req);
    const hostname = getHostname(req);
    const path = req.path;
    const method = req.method;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const now = Date.now();

    // Bypass localhost — tetap set headers
    if (ip === '127.0.0.1' || ip === '::1') {
      res.setHeader('X-RateLimit-Limit', maxReq);
      res.setHeader('X-RateLimit-Remaining', maxReq);
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));
      res.setHeader('X-Violation-Count', 0);
      return next();
    }

    // Check banned - normalize IP first
    const normalizedIp = normalizeIPForBanCheck(ip);
    if (banned.ips && banned.ips[normalizedIp]) {
      return res.status(403).json({
        success: false,
        error: "IP kamu diblokir permanen",
        reason: banned.ips[normalizedIp].reason,
        bannedAt: banned.ips[normalizedIp].bannedAt
      });
    }

    // Check whitelist — normalize IP
    if (whitelist.ips && whitelist.ips[normalizedIp]) {
      res.setHeader('X-RateLimit-Limit', maxReq);
      res.setHeader('X-RateLimit-Remaining', maxReq);
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));
      res.setHeader('X-Violation-Count', 0);
      return next();
    }

    if (isLocked()) {
      return res.status(503).json({
        success: false,
        error: "API sedang maintenance, coba beberapa jam lagi"
      });
    }

    // ===== UNIQUE IP TRACKING =====
    if (now - uniqueWindowStart > UNIQUE_WINDOW_MS) {
      uniqueIPs.clear();
      uniqueWindowStart = now;
    }

    uniqueIPs.add(ip);
    
    if (uniqueIPs.size > maxUniqueIp) {
      activateGlobalLock('Terlalu banyak IP unik (indikasi fake IP spam)');
      return res.status(503).json({
        success: false,
        error: "API dikunci sementara karena abuse"
      });
    }

    // ===== RATE LIMIT CHECK =====
    let data = requests.get(ip);

    if (!data) {
      // IP baru - inisialisasi data
      data = {
        count: 1,
        windowStart: now,
        totalRequests: 1,
        violations: 0,
        violationTimes: [],
        lastRequest: now,
        firstRequest: now,
        lastPath: path,
        lastUserAgent: userAgent,
        lastNotif: 0
      };
      requests.set(ip, data);
      saveRequestsToFile();
      // Set headers untuk IP baru
      const windowReset = now + windowMs;
      res.setHeader('X-RateLimit-Limit', maxReq);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxReq - 1));
      res.setHeader('X-RateLimit-Reset', Math.ceil(windowReset / 1000));
      res.setHeader('X-Violation-Count', 0);
      return next();
    }

    // Update data
    data.lastRequest = now;
    data.lastPath = path;
    data.lastUserAgent = userAgent;
    data.totalRequests = (data.totalRequests || 0) + 1;

    // Cek apakah window baru (reset setiap 24 jam)
    if (now - data.windowStart > windowMs) {
      // Reset counter untuk window baru
      data.count = 1;
      data.windowStart = now;
      
      requests.set(ip, data);
      saveRequestsToFile();
      // Set headers untuk window baru
      const windowReset = now + windowMs;
      res.setHeader('X-RateLimit-Limit', maxReq);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxReq - 1));
      res.setHeader('X-RateLimit-Reset', Math.ceil(windowReset / 1000));
      res.setHeader('X-Violation-Count', data.violations || 0);
      return next();
    }

    // Increment counter dalam window yang sama
    data.count++;

    // Set headers
    const remaining = Math.max(0, maxReq - data.count);
    const windowReset = data.windowStart + windowMs;
    res.setHeader('X-RateLimit-Limit', maxReq);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(windowReset / 1000));
    res.setHeader('X-Violation-Count', data.violations || 0);

    // CEK RATE LIMIT - Jika melebihi batas (SPAM)
    if (data.count > maxReq) {
      // Tambah violation
      if (!data.violationTimes) data.violationTimes = [];
      data.violationTimes.push(now);
      data.violations = data.violationTimes.length;
      
      // Siapkan response yang akan dikirim
      const errorResponse = {
        success: false,
        error: 'Terlalu banyak request',
        message: `Maksimal ${maxReq} request per hari`,
        retryAfter: Math.ceil((windowReset - now) / 1000),
        currentUsage: data.count,
        limit: maxReq,
        violations: data.violations,
        violationLimit,
        willBeBannedAfter: violationLimit - data.violations
      };

      // Kirim notifikasi SPAM (hanya jika belum dalam cooldown)
      sendTelegramNotification({
        type: 'spam',
        ip,
        hostname,
        path,
        method,
        count: data.count,
        maxReq,
        violations: data.violations,
        violationLimit,
        windowReset,
        response: errorResponse, // Sertakan response yang dikirim
        timestamp: now
      });

      // Cek apakah sudah mencapai batas violation untuk di-ban
      if (data.violations >= violationLimit) {
        // BAN PERMANEN
        banIp(ip, `Violation limit reached (${violationLimit}x exceed rate limit)`, {
          hostname,
          path,
          method,
          violations: data.violations
        });
        
        return res.status(403).json({
          success: false,
          error: 'IP kamu diblokir permanen karena spam berulang',
          reason: `Telah melebihi batas rate limit sebanyak ${violationLimit} kali`,
          violations: data.violations
        });
      }

      // Kirim notifikasi violation (hanya setiap kelipatan 5 atau violation pertama)
      if (data.violations === 1 || data.violations % 5 === 0) {
        sendTelegramNotification({
          type: 'violation',
          ip,
          hostname,
          path,
          method,
          violations: data.violations,
          violationLimit,
          response: errorResponse,
          timestamp: now
        });
      }

      // Simpan data sebelum response
      requests.set(ip, data);
      saveRequestsToFile();

      // Rate limit exceeded - return 429
      return res.status(429).json(errorResponse);
    }

    // Simpan data dan lanjutkan (request normal - TIDAK ADA NOTIFIKASI)
    requests.set(ip, data);
    saveRequestsToFile();
    next();
  };
}

// ==================== ADMIN HANDLERS ====================
function adminUnbanHandler(req, res) {
  const adminKey = process.env.ADMIN_KEY || null;
  const provided = req.headers["x-admin-key"] || req.body?.adminKey || req.query?.adminKey;

  if (!adminKey) {
    return res.status(500).json({ 
      success: false, 
      error: "ADMIN_KEY not configured on server." 
    });
  }

  if (!provided || provided !== adminKey) {
    return res.status(401).json({ 
      success: false, 
      error: "Unauthorized. Provide valid admin key." 
    });
  }

  const { ip } = req.body;
  if (!ip) {
    return res.status(400).json({ 
      success: false, 
      error: "Provide ip in request body to unban." 
    });
  }

  const ok = unbanIp(ip);
  if (ok) {
    return res.json({ 
      success: true, 
      message: `IP ${ip} unbanned.` 
    });
  }
  
  return res.status(404).json({ 
    success: false, 
    error: `IP ${ip} not found in ban list.` 
  });
}

function adminResetViolationsHandler(req, res) {
  const adminKey = process.env.ADMIN_KEY || null;
  const provided = req.headers["x-admin-key"] || req.body?.adminKey || req.query?.adminKey;

  if (!adminKey || provided !== adminKey) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  const { ip } = req.body;
  if (!ip) {
    return res.status(400).json({ success: false, error: "Provide ip" });
  }

  if (requests.has(ip)) {
    const data = requests.get(ip);
    data.violations = 0;
    data.violationTimes = [];
    requests.set(ip, data);
    saveRequestsToFile();
    
    return res.json({ 
      success: true, 
      message: `Violations reset for IP ${ip}` 
    });
  }

  return res.status(404).json({ 
    success: false, 
    error: `IP ${ip} not found` 
  });
}

function adminStatsHandler(req, res) {
  const adminKey = process.env.ADMIN_KEY || null;
  const provided = req.headers["x-admin-key"] || req.query?.adminKey;

  if (!adminKey || provided !== adminKey) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  const config = getConfig();
  const now = Date.now();
  const lockStatus = getLockStatus();
  
  // Hitung statistik
  let totalRequests = 0;
  let totalViolations = 0;
  const activeIps = [];
  
  for (const [ip, data] of requests.entries()) {
    totalRequests += data.totalRequests || 0;
    totalViolations += data.violations || 0;
    
    activeIps.push({
      ip,
      currentWindow: data.count,
      totalRequests: data.totalRequests || 0,
      violations: data.violations || 0,
      lastRequest: formatDisplayTime(data.lastRequest),
      firstRequest: formatDisplayTime(data.firstRequest),
      windowReset: formatDisplayTime(data.windowStart + ((config.rateLimit && config.rateLimit.windowMs) ? config.rateLimit.windowMs : WINDOW_MS)),
      remaining: Math.max(0, ((config.rateLimit && config.rateLimit.maxRequests) ? config.rateLimit.maxRequests : MAX_REQUESTS) - data.count),
      lastPath: data.lastPath
    });
  }

  // Urutkan berdasarkan violations terbanyak
  activeIps.sort((a, b) => b.violations - a.violations);

  const stats = {
    success: true,
    timestamp: formatDisplayTime(now),
    summary: {
      activeIps: requests.size,
      bannedCount: Object.keys(banned.ips || {}).length,
      whitelistedCount: Object.keys(whitelist.ips || {}).length,
      totalRequestsToday: totalRequests,
      totalViolations,
      uniqueIPsInWindow: uniqueIPs.size,
      maxUniqueIPs: (config.spamDetection && config.spamDetection.maxUniqueIPs) ? config.spamDetection.maxUniqueIPs : MAX_UNIQUE_IP
    },
    lock: {
      status: lockStatus.locked ? 'LOCKED' : 'UNLOCKED',
      until: lockStatus.locked ? formatDisplayTime(lockStatus.until) : null,
      reason: lockStatus.reason || null
    },
    limits: {
      maxRequestsPerWindow: (config.rateLimit && config.rateLimit.maxRequests) ? config.rateLimit.maxRequests : MAX_REQUESTS,
      windowSeconds: ((config.rateLimit && config.rateLimit.windowMs) ? config.rateLimit.windowMs : WINDOW_MS) / 1000,
      violationLimit: (config.spamDetection && config.spamDetection.maxViolations) ? config.spamDetection.maxViolations : VIOLATION_LIMIT,
      violationExpiry: '24 jam'
    },
    topViolators: activeIps.slice(0, 10)
  };

  res.json(stats);
}

// ==================== EXPORTS ====================
export default {
  middleware: rateLimiterMiddleware(),
  adminUnbanHandler,
  adminStatsHandler,
  adminResetViolationsHandler,
  banIp,
  unbanIp,
  getBannedList: () => banned,
  getStats: () => ({
    activeIps: requests.size,
    bannedCount: Object.keys(banned.ips || {}).length,
    whitelistedCount: Object.keys(whitelist.ips || {}).length,
    uniqueIPsInWindow: uniqueIPs.size,
    totalViolations: Array.from(requests.values()).reduce((sum, d) => sum + (d.violations || 0), 0)
  }),
  getIpData: (ip) => {
    if (requests.has(ip)) {
      const data = requests.get(ip);
      return {
        ip,
        currentWindow: data.count,
        totalRequests: data.totalRequests || 0,
        violations: data.violations || 0,
        violationLimit: (config.spamDetection && config.spamDetection.maxViolations) ? config.spamDetection.maxViolations : VIOLATION_LIMIT,
        remainingBeforeBan: ((config.spamDetection && config.spamDetection.maxViolations) ? config.spamDetection.maxViolations : VIOLATION_LIMIT) - (data.violations || 0),
        lastRequest: formatDisplayTime(data.lastRequest),
        firstRequest: formatDisplayTime(data.firstRequest),
        windowReset: formatDisplayTime(data.windowStart + ((config.rateLimit && config.rateLimit.windowMs) ? config.rateLimit.windowMs : WINDOW_MS)),
        lastPath: data.lastPath
      };
    }
    return null;
  },
  resetIpCounter: (ip) => {
    if (requests.has(ip)) {
      const data = requests.get(ip);
      data.count = 0;
      data.windowStart = Date.now();
      requests.set(ip, data);
      saveRequestsToFile();
      return true;
    }
    return false;
  },
  resetViolations: (ip) => {
    if (requests.has(ip)) {
      const data = requests.get(ip);
      data.violations = 0;
      data.violationTimes = [];
      requests.set(ip, data);
      saveRequestsToFile();
      return true;
    }
    return false;
  }
};

export async function notifyPremiumRequest({ path, ip, apiKey, method, statusCode, response, status } = {}) {
  try {
    // logger.info(`[PREM-DBG] method=${method} status=${statusCode} ip=${ip} path=${path} key=${apiKey?.slice(0,13)}... resp=${typeof response}`);
    await sendTelegramNotification({
      type: status === 'vip' ? 'vip' : 'premium',
      path,
      ip,
      apiKey,
      method,
      statusCode,
      response,
      timestamp: Date.now()
    });
  } catch {
    // jangan blokir request utama kalau notif gagal
  }
}