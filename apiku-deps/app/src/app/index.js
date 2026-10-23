/**
 * @license
 * Copyright (C) 2026 BAWORBAWORID
 * https://github.com/BAWORBAWORID
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import 'dotenv/config';
import express from "express";
import session from "express-session";
import FileStore from "session-file-store";
import multer from "multer";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath, pathToFileURL } from "url";
import chokidar from 'chokidar';
import cookieParser from "cookie-parser";
import crypto from "crypto";
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

import logger from "../utils/logger.js";
import logApiRequest from "../utils/logApiRequest.js";
import botShieldMiddleware from "../utils/botShield.js";

import { apiCache } from "../utils/apiCache.js";
import startCacheCleaner from "../utils/cacheCleaner.js";
import setupHmrLoader from "../utils/hmrLoader.js";
import setupMiddleware from "../middleware/index.js";
import setupResponseFormatter from "./responseFormatter.js";
import rateLimiter from '../middleware/rateLimiter.js';
import sendReport from '../update/report.js';
import QRCode from 'qrcode';
import {
  createDonation,
  checkDonationStatus,
  getDonationSummary,
  MIN_AMOUNT,
  MAX_AMOUNT,
} from '../utils/donasi.js';
import bcrypt from 'bcryptjs';
import adminAuth from '../middleware/adminAuth.js';
import { initDb, recordHit, getStatsSummary, loadAllStats, migrateFromJson, isConnected, closeDb } from '../utils/apiStatsDb.js';
import { trackVisitor, getVisitorStats } from '../utils/visitorTracker.js';
import { getConfig, reloadConfig } from '../utils/configCache.js';
import { loadApiKeys, saveApiKeys, invalidateApiKeysCache } from '../utils/apiKeysStore.js';
import { notifyPremiumRequest, getClientIP } from '../middleware/rateLimiter.js';
import { cleanupExpiredSessions } from '../utils/session.js';




// Lazy-loaded heavy modules
let si = null;
async function getSI() {
  if (!si) si = await import('systeminformation');
  return si;
}

// Cloudflare Turnstile configuration
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY;
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = path.join(process.cwd(), 'configuration.json');
const PROXY_FILE = path.join(process.cwd(), 'proxy.txt');
const PROXY_DIR = path.join(process.cwd(), 'proxy');
const ADMIN_USERS_FILE = path.join(process.cwd(), 'data', 'admin-users.json');

let APP_VERSION = '1.9.6';
try {
  const cfg = getConfig();
  if (cfg.releases?.[0]?.version) APP_VERSION = cfg.releases[0].version;
} catch {}

// ==================== API KEYS STORE ====================
// Shared via apiKeysStore.js (single cache + sync write)

const uploadDir = path.join(process.cwd(), "files");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const sessionsDir = path.join(process.cwd(), 'data', 'sessions');
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

const storage = multer.memoryStorage();
const upload = multer({ storage });

const app = express();

// ==========================================
// HELPER FUNCTIONS
// ==========================================

// Format bytes to human readable format
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Format uptime to human readable format
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0) parts.push(`${secs}s`);
    
    return parts.join(' ') || '0s';
}

// Function to hide/sensor IP addresses
function hideIPAddress(ip) {
    if (!ip) return ip;
    
    // Handle IPv6 localhost
    if (ip === '::1' || ip === '::ffff:127.0.0.1') {
        return ip; // Don't hide localhost
    }
    
    // Handle IPv4
    if (ip.includes('.')) {
        const parts = ip.split('.');
        if (parts.length === 4) {
            // Hide last 2 octets
            return `${parts[0]}.${parts[1]}.*.*`;
        }
    }
    
    // Handle IPv6
    if (ip.includes(':')) {
        // Show first 4 segments, hide the rest
        const parts = ip.split(':');
        if (parts.length >= 4) {
            return `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}:****:****:****:****`;
        }
    }
    
    return '***.***.***.***'; // Default hidden format
}

// Function to hide/sensor MAC addresses
function hideMACAddress(mac) {
    if (!mac || mac === '00:00:00:00:00:00') return mac;
    // Show first 3 pairs, hide last 3 pairs
    const parts = mac.split(':');
    if (parts.length === 6) {
        return `${parts[0]}:${parts[1]}:${parts[2]}:**:**:**`;
    }
    return '**:**:**:**:**:**';
}

// Function to sanitize network interfaces (hide IPs and MACs)
function sanitizeNetworkInterfaces(interfaces) {
    return interfaces.map(iface => ({
        name: iface.iface,
        addresses: iface.ip4 ? [{
            address: hideIPAddress(iface.ip4),
            family: 'IPv4',
            internal: iface.internal || false,
            mac: hideMACAddress(iface.mac)
        }] : []
    }));
}

// Function to sanitize proxy list (hide credentials in response)
function sanitizeProxies(proxies) {
    return proxies.map(proxy => {
        const sanitized = {
            name: proxy.name,
            protocol: proxy.protocol || 'http',
            fromFile: proxy.fromFile || false
        };

        if (proxy.url) {
            // Hide credentials in URL if present
            try {
                const url = new URL(proxy.url);
                if (url.username || url.password) {
                    sanitized.url = `${url.protocol}//${url.hostname}:${url.port}`;
                    sanitized.hasAuth = true;
                } else {
                    sanitized.url = proxy.url;
                }
            } catch {
                sanitized.url = proxy.url.split('@').pop() || proxy.url;
            }
        }

        if (proxy.ip && proxy.port) {
            sanitized.ip = hideIPAddress(proxy.ip);
            sanitized.port = proxy.port;
            sanitized.hasAuth = !!(proxy.username || proxy.password);
        }

        return sanitized;
    });
}

// middleware dasar — express.json/urlencoded applied by setupMiddleware
app.use(cookieParser());

// session config
const FileStoreSession = FileStore(session);

// session config with file store for persistence across restarts
app.use(
  session({
    name: "apiku.sid",
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    store: new FileStoreSession({
      path: path.join(process.cwd(), 'data', 'sessions'),
      ttl: 86400 * 30, // 30 days in seconds
      retries: 2,
      logFn: function() {} // silent store logging
    }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
    }
  })
);

// ==========================================
// PROXY MANAGER SYSTEM (HTTP + SOCKS4/5)
// ==========================================

/**
 * Detect proxy protocol from URL string
 * Supports: http://, https://, socks4://, socks5://
 * Default: http://
 */
function detectProxyProtocol(url) {
  if (!url) return 'http';
  const lower = url.toLowerCase();
  if (lower.startsWith('socks5://')) return 'socks5';
  if (lower.startsWith('socks4://')) return 'socks4';
  if (lower.startsWith('https://')) return 'https';
  if (lower.startsWith('http://')) return 'http';
  return 'http';
}

/**
 * Create a proxy agent for use with fetch/axios/node-fetch
 * Returns the appropriate agent based on protocol
 * @param {string} proxyUrl - Full proxy URL (socks5://ip:port, http://ip:port, etc)
 * @returns {Object|null} Agent instance or null
 */
function createProxyAgent(proxyUrl) {
  if (!proxyUrl) return null;

  const protocol = detectProxyProtocol(proxyUrl);

  try {
    if (protocol === 'socks4' || protocol === 'socks5') {
      // socks-proxy-agent handles both socks4 and socks5
      return new SocksProxyAgent(proxyUrl);
    }
    // HTTP/HTTPS proxy
    return new HttpsProxyAgent(proxyUrl);
  } catch (error) {
    logger.error(`Failed to create proxy agent for ${protocol}: ${error.message}`);
    return null;
  }
}

class ProxyManager {
  constructor() {
    // Default proxies (CORS proxies — HTTP only)
    this.defaultProxies = [
      { name: "caliph", url: "https://cors.caliph.my.id/", protocol: "https" },
      { name: "eu", url: "https://cors.eu.org/", protocol: "https" },
      { name: "rpoxy", url: "https://rpoxy.apis6.workers.dev/", protocol: "https" },
      { name: "prox", url: "https://prox.26bruunjorl.workers.dev/", protocol: "https" },
      { name: "aged", url: "https://aged-hill-ab3a.apis4.workers.dev/", protocol: "https" },
      { name: "wave", url: "https://plain-wave-6f5f.apis1.workers.dev/", protocol: "https" },
      { name: "hill", url: "https://young-hill-815e.apis3.workers.dev/", protocol: "https" },
      { name: "icy", url: "https://icy-morning-72e2.apis2.workers.dev/", protocol: "https" },
      { name: "fazri", url: "https://cors.fazri.workers.dev/", protocol: "https" },
      { name: "spring", url: "https://spring-night-57a1.3540746063.workers.dev/", protocol: "https" },
      { name: "sizable", url: "https://cors.sizable.workers.dev/", protocol: "https" },
      { name: "jiashu", url: "https://jiashu.1win.eu.org/", protocol: "https" }
    ];

    // Initialize proxies array
    this.proxies = [...this.defaultProxies];

    // Load proxies from file if exists
    this.loadProxiesFromFile();

    // Setup file watcher for proxy.txt
    this.setupFileWatcher();
  }

  /**
   * Auto-detect protocol from filename
   * sock5.txt / socks5.txt → socks5
   * sock4.txt / socks4.txt / ssock.txt → socks4
   * http.txt / proxy.txt → http
   */
  detectProtocolFromFilename(filename) {
    const lower = filename.toLowerCase();
    if (lower.includes('sock5') || lower.includes('socks5')) return 'socks5';
    if (lower.includes('sock4') || lower.includes('socks4') || lower.includes('ssock')) return 'socks4';
    return 'http';
  }

  /**
   * Parse proxy lines from a file content
   * Supports:
   *   socks5://ip:port
   *   socks5://user:pass@ip:port
   *   ip:port (uses defaultProtocol)
   *   ip:port:user:pass (uses defaultProtocol)
   */
  parseProxyLines(content, defaultProtocol, fileIndex) {
    const lines = content.split('\n').filter(line => line.trim() !== '' && !line.trim().startsWith('#'));
    const proxies = [];
    let counter = 0;

    lines.forEach((line) => {
      const trimmed = line.trim();
      let proxyUrl, protocol, ip, port, username, password;

      // Check if line has protocol prefix
      if (/^(socks[45]|https?):\/\//i.test(trimmed)) {
        protocol = detectProxyProtocol(trimmed);
        proxyUrl = trimmed;

        try {
          const url = new URL(trimmed);
          ip = url.hostname;
          port = url.port;
          username = url.username || '';
          password = url.password || '';
        } catch {
          ip = trimmed;
          port = '';
        }
      } else {
        // ip:port or ip:port:user:pass format
        const parts = trimmed.split(':');
        if (parts.length >= 2) {
          ip = parts[0];
          port = parts[1];
          username = parts[2] || '';
          password = parts[3] || '';
          protocol = defaultProtocol;

          // Build URL with protocol prefix
          const protoPrefix = `${protocol}://`;
          if (username && password) {
            proxyUrl = `${protoPrefix}${username}:${password}@${ip}:${port}`;
          } else {
            proxyUrl = `${protoPrefix}${ip}:${port}`;
          }
        } else {
          return; // Skip invalid lines
        }
      }

      counter++;
      proxies.push({
        name: `${protocol}_${fileIndex}_${counter}`,
        url: proxyUrl,
        protocol,
        ip,
        port,
        username,
        password,
        fromFile: true
      });
    });

    return proxies;
  }

  /**
   * Load proxies from proxy/ directory and proxy.txt
   * Scans proxy/ for .txt files, auto-detects protocol from filename
   * Also supports legacy proxy.txt (defaults to HTTP)
   */
  loadProxiesFromFile() {
    const fileProxies = [];
    let fileIndex = 0;

    // 1. Load from proxy/ directory
    try {
      if (fs.existsSync(PROXY_DIR)) {
        const files = fs.readdirSync(PROXY_DIR).filter(f => f.endsWith('.txt')).sort();

        for (const file of files) {
          const filePath = path.join(PROXY_DIR, file);
          const content = fs.readFileSync(filePath, 'utf8');
          const protocol = this.detectProtocolFromFilename(file);
          const proxies = this.parseProxyLines(content, protocol, ++fileIndex);

          if (proxies.length > 0) {
            fileProxies.push(...proxies);
            logger.info(`Loaded ${proxies.length} ${protocol.toUpperCase()} proxies from proxy/${file}`);
          }
        }
      }
    } catch (error) {
      logger.error(`Failed to load proxies from proxy/ directory: ${error.message}`);
    }

    // 2. Load from legacy proxy.txt (HTTP)
    try {
      if (fs.existsSync(PROXY_FILE)) {
        const content = fs.readFileSync(PROXY_FILE, 'utf8');
        const proxies = this.parseProxyLines(content, 'http', ++fileIndex);

        if (proxies.length > 0) {
          fileProxies.push(...proxies);
          logger.info(`Loaded ${proxies.length} HTTP proxies from proxy.txt`);
        }
      }
    } catch (error) {
      logger.error(`Failed to load proxies from proxy.txt: ${error.message}`);
    }

    // 3. Combine with defaults
    if (fileProxies.length > 0) {
      this.proxies = [...this.defaultProxies, ...fileProxies];

      const byProtocol = { http: 0, https: 0, socks4: 0, socks5: 0 };
      fileProxies.forEach(p => { byProtocol[p.protocol] = (byProtocol[p.protocol] || 0) + 1; });

      logger.info(`Total loaded: ${fileProxies.length} proxies from file (SOCKS5: ${byProtocol.socks5}, SOCKS4: ${byProtocol.socks4}, HTTP: ${byProtocol.http})`);
    } else {
      logger.info('No proxy files found, using default proxies only');
    }
  }

  // Setup watcher for proxy files changes
  setupFileWatcher() {
    if (process.env.VERCEL) return;

    const watchPaths = [];

    // Watch proxy/ directory
    if (fs.existsSync(PROXY_DIR)) {
      watchPaths.push(PROXY_DIR);
    }
    // Watch legacy proxy.txt
    if (fs.existsSync(PROXY_FILE)) {
      watchPaths.push(PROXY_FILE);
    }

    if (watchPaths.length === 0) return;

    try {
      const watcher = chokidar.watch(watchPaths, {
        persistent: true,
        ignoreInitial: true
      });

      watcher.on('change', (filePath) => {
        logger.info(`Proxy file changed: ${path.relative(process.cwd(), filePath)}, reloading...`);
        this.loadProxiesFromFile();
      });

      watcher.on('add', (filePath) => {
        logger.info(`New proxy file added: ${path.relative(process.cwd(), filePath)}, reloading...`);
        this.loadProxiesFromFile();
      });

      logger.info(`Watching proxy files: ${watchPaths.map(p => path.relative(process.cwd(), p)).join(', ')}`);
    } catch (error) {
      logger.error(`Failed to setup proxy file watcher: ${error.message}`);
    }
  }

  getRandomProxy() {
    const randomIndex = Math.floor(Math.random() * this.proxies.length);
    return this.proxies[randomIndex].url;
  }

  getProxyByName(name) {
    const proxy = this.proxies.find(p => p.name === name);
    return proxy ? proxy.url : null;
  }

  getProxy(names = null) {
    if (!names) {
      return this.getRandomProxy();
    }

    const nameArray = Array.isArray(names) ? names : [names];
    const filtered = this.proxies.filter(p => nameArray.includes(p.name));

    if (filtered.length === 0) {
      return this.getRandomProxy();
    }

    const randomIndex = Math.floor(Math.random() * filtered.length);
    return filtered[randomIndex].url;
  }

  /**
   * Get a random proxy filtered by protocol
   * @param {string} protocol - 'http', 'socks4', 'socks5', or null for any
   * @returns {string} Proxy URL
   */
  getProxyByProtocol(protocol = null) {
    if (!protocol) return this.getRandomProxy();

    const filtered = this.proxies.filter(p => p.protocol === protocol.toLowerCase());
    if (filtered.length === 0) return this.getRandomProxy();

    const randomIndex = Math.floor(Math.random() * filtered.length);
    return filtered[randomIndex].url;
  }

  /**
   * Get proxy agent instance (ready to use with fetch/axios)
   * @param {string|null} name - Proxy name, or null for random
   * @returns {{ url: string, agent: Object, protocol: string }|null}
   */
  getProxyAgent(names = null) {
    const proxyUrl = names ? this.getProxy(names) : this.getRandomProxy();
    if (!proxyUrl) return null;

    const protocol = detectProxyProtocol(proxyUrl);
    const agent = createProxyAgent(proxyUrl);

    return { url: proxyUrl, agent, protocol };
  }

  /**
   * Get random proxy agent filtered by protocol
   * @param {string} protocol - 'socks4', 'socks5', 'http'
   * @returns {{ url: string, agent: Object, protocol: string }|null}
   */
  getProxyAgentByProtocol(protocol) {
    const proxyUrl = this.getProxyByProtocol(protocol);
    if (!proxyUrl) return null;

    const agent = createProxyAgent(proxyUrl);
    return { url: proxyUrl, agent, protocol: detectProxyProtocol(proxyUrl) };
  }

  getAllProxies() {
    return this.proxies.map(({ name, url, protocol, fromFile, ip, port, username, password }) => ({
      name,
      url,
      protocol: protocol || 'http',
      fromFile: fromFile || false,
      ...(ip && port ? {
        ip: fromFile ? hideIPAddress(ip) : ip,
        port,
        hasAuth: !!(username || password)
      } : {})
    }));
  }

  // Method to manually reload proxies from file
  reloadFromFile() {
    this.loadProxiesFromFile();
    return this.proxies.length;
  }

  // Get stats about loaded proxies
  getStats() {
    const byProtocol = { http: 0, https: 0, socks4: 0, socks5: 0 };
    this.proxies.forEach(p => {
      const proto = p.protocol || 'http';
      byProtocol[proto] = (byProtocol[proto] || 0) + 1;
    });
    return {
      total: this.proxies.length,
      default: this.defaultProxies.length,
      fromFile: this.proxies.filter(p => p.fromFile).length,
      byProtocol
    };
  }
}

// Inisialisasi Proxy Manager
const PROXY_MANAGER = new ProxyManager();
global.PROXY_MANAGER = PROXY_MANAGER;

// Fungsi untuk mendapatkan proxy secara random
const proxy = () => {
  try {
    return PROXY_MANAGER.getRandomProxy();
  } catch (error) {
    logger.error(`Error getting proxy: ${error.message}`);
    return null;
  }
};
global.getRandomProxy = proxy;

// Endpoint untuk mendapatkan proxy random (supports ?protocol=socks5|socks4|http)
app.get('/proxy', (req, res) => {
  try {
    const { name, protocol } = req.query;

    let proxyUrl;
    if (name) {
      const names = Array.isArray(name) ? name : [name];
      proxyUrl = PROXY_MANAGER.getProxy(names);
    } else if (protocol) {
      proxyUrl = PROXY_MANAGER.getProxyByProtocol(protocol);
    } else {
      proxyUrl = PROXY_MANAGER.getRandomProxy();
    }

    if (!proxyUrl) {
      return res.status(404).json({
        success: false,
        message: 'Proxy not found'
      });
    }

    const detectedProtocol = detectProxyProtocol(proxyUrl);

    res.json({
      success: true,
      data: {
        url: proxyUrl,
        protocol: detectedProtocol,
        supportsAgent: ['socks4', 'socks5'].includes(detectedProtocol),
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Failed to get proxy: ${error.message}`
    });
  }
});

// Endpoint untuk mendapatkan proxy agent (siap pakai dengan SOCKS support)
app.get('/proxy/agent', (req, res) => {
  try {
    const { name, protocol } = req.query;

    let result;
    if (name) {
      const names = Array.isArray(name) ? name : [name];
      result = PROXY_MANAGER.getProxyAgent(names);
    } else if (protocol) {
      result = PROXY_MANAGER.getProxyAgentByProtocol(protocol);
    } else {
      result = PROXY_MANAGER.getProxyAgent();
    }

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'No proxy available'
      });
    }

    res.json({
      success: true,
      data: {
        url: result.url,
        protocol: result.protocol,
        hasAgent: !!result.agent,
        agentType: result.protocol === 'socks4' || result.protocol === 'socks5' ? 'SocksProxyAgent' : 'HttpsProxyAgent',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Failed to get proxy agent: ${error.message}`
    });
  }
});

// Endpoint untuk mendapatkan semua daftar proxy (with sanitized IPs)
app.get('/proxy/list', (req, res) => {
  try {
    const { protocol } = req.query;
    let proxies = PROXY_MANAGER.getAllProxies();

    // Filter by protocol if specified
    if (protocol) {
      proxies = proxies.filter(p => p.protocol === protocol.toLowerCase());
    }

    const stats = PROXY_MANAGER.getStats();

    res.json({
      success: true,
      count: proxies.length,
      stats: {
        total: stats.total,
        default: stats.default,
        fromFile: stats.fromFile,
        byProtocol: stats.byProtocol
      },
      data: sanitizeProxies(proxies)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Failed to get proxy list: ${error.message}`
    });
  }
});

// Endpoint untuk reload proxy dari file
app.post('/proxy/reload', (req, res) => {
  try {
    const count = PROXY_MANAGER.reloadFromFile();
    const stats = PROXY_MANAGER.getStats();
    res.json({
      success: true,
      message: 'Proxies reloaded successfully',
      total: count,
      stats: stats.byProtocol,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Failed to reload proxies: ${error.message}`
    });
  }
});

// ==========================================
// STATISTIK REQUEST TRACKING UNTUK /api
// ==========================================

const STATS_FILE = path.join(process.cwd(), 'api-stats.json');
// Flag to track if stats migration has been done

let statsMigrated = false;

// Struktur data statistik default
function getDefaultStats() {
    return {
        daily: {},
        weekly: {},
        monthly: {},
        allTime: {
            total: 0,
            byEndpoint: {}
        },
        _metadata: {
            lastUpdated: new Date().toISOString(),
            version: APP_VERSION
        }
    };
}

// Fungsi untuk mendapatkan tanggal, minggu, dan bulan saat ini
function getTimePeriods() {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Minggu: Tahun + Minggu dalam tahun (ISO week)
    const janFirst = new Date(now.getFullYear(), 0, 1);
    const days = Math.floor((now - janFirst) / (24 * 60 * 60 * 1000));
    const weekNumber = Math.ceil((now.getDay() + 1 + days) / 7);
    const weekStr = `${now.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
    
    // Bulan: Tahun-Bulan
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    return { dateStr, weekStr, monthStr };
}

// Fungsi untuk memuat statistik dari file
function loadStats() {
    try {
        const STATS_BAK = path.join(process.cwd(), 'api-stats.bak.json');

        if (!fs.existsSync(STATS_FILE)) {
            // Coba pulihkan dari backup api-stats.bak.json jika STATS_FILE hilang!
            if (fs.existsSync(STATS_BAK)) {
                try {
                    const bakData = JSON.parse(fs.readFileSync(STATS_BAK, 'utf8'));
                    if (bakData && bakData.allTime) {
                        logger.warn('Recovered api-stats.json from api-stats.bak.json after file missing');
                        saveStats(bakData);
                        return bakData;
                    }
                } catch (e) {}
            }
            const defaultStats = getDefaultStats();
            saveStats(defaultStats);
            return defaultStats;
        }
        
        let statsData = null;
        try {
            const rawData = fs.readFileSync(STATS_FILE, 'utf8');
            statsData = JSON.parse(rawData);
        } catch (parseErr) {
            logger.warn(`api-stats.json corrupted (${parseErr.message}), recovering from api-stats.bak.json...`);
            if (fs.existsSync(STATS_BAK)) {
                try {
                    statsData = JSON.parse(fs.readFileSync(STATS_BAK, 'utf8'));
                    saveStats(statsData);
                    logger.ready('Successfully recovered stats from verified backup after sudden reboot!');
                } catch (bakErr) {}
            }
            if (!statsData) throw parseErr;
        }
        
        // Cleanup old data (hanya simpan data 3 bulan terakhir)
        const now = new Date();
        const { monthStr: currentMonth } = getTimePeriods();
        
        if (statsData.monthly) {
            Object.keys(statsData.monthly).forEach(monthKey => {
                if (monthKey < currentMonth) {
                    const [year, month] = monthKey.split('-').map(Number);
                    const monthDate = new Date(year, month - 1, 1);
                    const threeMonthsAgo = new Date(now);
                    threeMonthsAgo.setMonth(now.getMonth() - 3);
                    
                    if (monthDate < threeMonthsAgo) {
                        delete statsData.monthly[monthKey];
                    }
                }
            });
        }
        
        return statsData;
    } catch (error) {
        logger.error(`Failed to load stats: ${error.message}`);
        // Coba pulihkan dari backup sebelum menyerah ke defaultStats
        const STATS_BAK = path.join(process.cwd(), 'api-stats.bak.json');
        if (fs.existsSync(STATS_BAK)) {
            try {
                const bakData = JSON.parse(fs.readFileSync(STATS_BAK, 'utf8'));
                if (bakData && bakData.allTime) return bakData;
            } catch (e) {}
        }
        return getDefaultStats();
    }
}

// Fungsi untuk menyimpan statistik ke file (async)
function saveStats(statsData) {
    try {
        statsData._metadata.lastUpdated = new Date().toISOString();
        const jsonStr = JSON.stringify(statsData, null, 2);
        const STATS_TMP = STATS_FILE + '.tmp';
        const STATS_BAK = path.join(process.cwd(), 'api-stats.bak.json');
        
        // 1. Tulis ke file .tmp sinkronus agar 100% utuh & tidak pernah 0 byte di disk
        fs.writeFileSync(STATS_TMP, jsonStr, 'utf8');
        
        // 2. Jika file lama ada & punya data allTime, salin menjadi backup .bak.json
        if (fs.existsSync(STATS_FILE)) {
            try {
                if (statsData.allTime && statsData.allTime.total > 0) {
                    fs.copyFileSync(STATS_FILE, STATS_BAK);
                }
            } catch (e) {}
        }
        
        // 3. Rename atomic dari .tmp -> api-stats.json (Linux atomic operation, tidak bisa korup meski VPS/container reboot mendadak)
        fs.renameSync(STATS_TMP, STATS_FILE);
        return true;
    } catch (error) {
        logger.error(`Failed to save stats: ${error.message}`);
        return false;
    }
}

// Middleware untuk tracking request ke /api
// Uses res.on('finish') instead of overriding res.send to avoid cascading overrides
function trackApiRequests() {
    return (req, res, next) => {
        if (!req.path.startsWith('/api')) {
            return next();
        }
        if (req.path === '/api/stats' || req._skipStats) return next();

        res.on('finish', () => {
            if (req._skipStats) return;
            try {
                if (isConnected()) {
                    const periods = getTimePeriods();
                    recordHit(req.path, res.statusCode, periods).catch(err => {
                        logger.error(`Stats record failed: ${err.message}`);
                    });
                } else {
                    updateApiStats(req.path, res.statusCode);
                }
            } catch (error) {
                logger.error(`Failed to update stats: ${error.message}`);
            }
        });

        next();
    };
}

// Fungsi untuk update statistik
function updateApiStats(endpoint, statusCode) {
    try {
        const stats = loadStats();
        const periods = getTimePeriods();
        
        // Update allTime
        stats.allTime.total += 1;
        
        if (!stats.allTime.byEndpoint[endpoint]) {
            stats.allTime.byEndpoint[endpoint] = { total: 0, byStatus: {} };
        }
        stats.allTime.byEndpoint[endpoint].total += 1;
        
        const statusGroup = Math.floor(statusCode / 100);
        if (!stats.allTime.byEndpoint[endpoint].byStatus[statusGroup]) {
            stats.allTime.byEndpoint[endpoint].byStatus[statusGroup] = 0;
        }
        stats.allTime.byEndpoint[endpoint].byStatus[statusGroup] += 1;
        
        // Update daily
        if (!stats.daily[periods.dateStr]) {
            stats.daily[periods.dateStr] = { total: 0, byEndpoint: {} };
        }
        stats.daily[periods.dateStr].total += 1;
        
        if (!stats.daily[periods.dateStr].byEndpoint[endpoint]) {
            stats.daily[periods.dateStr].byEndpoint[endpoint] = 0;
        }
        stats.daily[periods.dateStr].byEndpoint[endpoint] += 1;
        
        // Update weekly
        if (!stats.weekly[periods.weekStr]) {
            stats.weekly[periods.weekStr] = { total: 0, byEndpoint: {} };
        }
        stats.weekly[periods.weekStr].total += 1;
        
        if (!stats.weekly[periods.weekStr].byEndpoint[endpoint]) {
            stats.weekly[periods.weekStr].byEndpoint[endpoint] = 0;
        }
        stats.weekly[periods.weekStr].byEndpoint[endpoint] += 1;
        
        // Update monthly
        if (!stats.monthly[periods.monthStr]) {
            stats.monthly[periods.monthStr] = { total: 0, byEndpoint: {} };
        }
        stats.monthly[periods.monthStr].total += 1;
        
        if (!stats.monthly[periods.monthStr].byEndpoint[endpoint]) {
            stats.monthly[periods.monthStr].byEndpoint[endpoint] = 0;
        }
        stats.monthly[periods.monthStr].byEndpoint[endpoint] += 1;
        
        // Simpan statistik
        saveStats(stats);
        
    } catch (error) {
        logger.error(`Error updating API stats: ${error.message}`);
    }
}

// Fungsi untuk mendapatkan summary statistik untuk /status endpoint
async function getApiStatsSummary() {
    // Try stats database first
    if (isConnected()) {
        try {
            const dbSummary = await getStatsSummary();
            if (dbSummary) {
                return dbSummary;
            }
        } catch (error) {
            logger.error(`Stats summary failed, falling back to JSON: ${error.message}`);
        }
    }
    
    // Fallback to JSON
    try {
        const stats = loadStats();
        const periods = getTimePeriods();
        
        const today = stats.daily[periods.dateStr]?.total || 0;
        const thisWeek = stats.weekly[periods.weekStr]?.total || 0;
        const thisMonth = stats.monthly[periods.monthStr]?.total || 0;
        const total = stats.allTime.total || 0;
        
        // Hitung endpoint paling populer
        const popularLimit = getConfig().popularLimit || 50;
        const popularEndpoints = Object.entries(stats.allTime.byEndpoint)
            .sort((a, b) => b[1].total - a[1].total)
            .slice(0, popularLimit)
            .map(([endpoint, data]) => ({
                endpoint,
                hits: data.total,
                successRate: data.byStatus[2] ? Math.min(100, Math.round((data.byStatus[2] / data.total) * 100)) : 0
            }));
        
        return {
            today,
            thisWeek,
            thisMonth,
            total,
            popularEndpoints,
            lastUpdated: stats._metadata.lastUpdated
        };
    } catch (error) {
        logger.error(`Error getting stats summary: ${error.message}`);
        return {
            today: 0,
            thisWeek: 0,
            thisMonth: 0,
            total: 0,
            popularEndpoints: [],
            lastUpdated: null
        };
    }
}

// Periodic stats backup (setiap 30 menit)
function periodicJsonBackup() {
    if (process.env.VERCEL) return;
    
    setTimeout(async () => {
        try {
            if (isConnected()) {
                const dbStats = await loadAllStats();
                if (dbStats) {
                    saveStats(dbStats);
                    logger.info('Periodic JSON stats backup saved');
                }
            }
        } catch (error) {
            logger.error(`Periodic JSON backup failed: ${error.message}`);
        }
        // Jadwalkan backup berikutnya
        periodicJsonBackup();
    }, 30 * 60 * 1000); // every 30 minutes
}

// Backup JSON saat shutdown
async function backupOnShutdown() {
    try {
        if (isConnected()) {
            logger.info('Shutting down, saving stats...');
            const dbStats = await loadAllStats();
            if (dbStats) {
                saveStats(dbStats);
                logger.ready('JSON backup saved on shutdown');
            }
        }
        await closeDb();
    } catch (error) {
        logger.error(`Shutdown backup failed: ${error.message}`);
    }
}

// Middleware untuk reset data harian otomatis
function setupDailyReset() {
    // Skip on Vercel serverless environment
    if (process.env.VERCEL) {
        return;
    }

    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const timeUntilMidnight = midnight - now;

    setTimeout(() => {
        // Reset data harian yang sudah lewat
        const stats = loadStats();
        const { dateStr: currentDate } = getTimePeriods();

        Object.keys(stats.daily).forEach(date => {
            if (date < currentDate) {
                delete stats.daily[date];
            }
        });

        saveStats(stats);
        logger.info('Daily stats cleanup completed');

        // Jadwalkan reset berikutnya
        setupDailyReset();
    }, timeUntilMidnight);
}

// Tambahkan botShield sebelum tracking & rute lainnya
app.use(botShieldMiddleware());
app.use(trackApiRequests());

// Setup reset otomatis & pembersih sampah cache otomatis (Garbage Collector)
setupDailyReset();
startCacheCleaner(12, 24);

// Session cleanup — hapus file session lama setiap jam
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);
cleanupExpiredSessions();

// Mulai periodic JSON backup (setiap 30 menit, hanya jika bukan Vercel)
if (!process.env.VERCEL) {
    setTimeout(periodicJsonBackup, 30 * 60 * 1000);
}

// ==========================================
// KEAMANAN LEVEL 1: RUTE PRIVASI (INTERNAL ONLY)
// ==========================================
const privacyGuard = (req, res, next) => {
    const allowedIPs = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
    if (!allowedIPs.includes(req.socket.remoteAddress)) {
        return res.status(403).json({
            status: "FORBIDDEN",
            message: "Akses Ditolak. Halaman ini privat."
        });
    }
    next();
};

// Endpoint untuk melihat statistik lengkap (protected)
app.get('/admin/api-stats', privacyGuard, async (req, res) => {
    try {
        // Try stats database first
        if (isConnected()) {
            const dbStats = await loadAllStats();
            const dbSummary = await getStatsSummary();
            if (dbStats && dbSummary) {
                return res.json({
                    success: true,
                    source: 'database',
                    summary: dbSummary,
                    detailed: {
                        daily: dbStats.daily,
                        weekly: dbStats.weekly,
                        monthly: dbStats.monthly,
                        allTime: dbStats.allTime
                    },
                    metadata: dbStats._metadata,
                    periods: getTimePeriods()
                });
            }
        }
        
        // Fallback to JSON
        const stats = loadStats();
        const summary = await getApiStatsSummary();
        
        res.json({
            success: true,
            source: 'json',
            summary,
            detailed: {
                daily: stats.daily,
                weekly: stats.weekly,
                monthly: stats.monthly,
                allTime: stats.allTime
            },
            metadata: stats._metadata,
            periods: getTimePeriods()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint untuk reset statistik (protected)
app.post('/admin/reset-stats', privacyGuard, (req, res) => {
    try {
        const defaultStats = getDefaultStats();
        saveStats(defaultStats);
        
        res.json({
            success: true,
            message: 'Statistics reset successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== HEALTH MONITORING ====================
const healthState = {
  responseTimes: [],
  totalRequests: 0,
  rpmCount: 0,
  rpmWindowStart: Date.now(),
  rpmHistory: [],
  peakRpm: 0,
  errorCount: 0,
  todayCount: 0,
  todayDate: new Date().toISOString().split('T')[0],
  currentLatency: 0,
  maxSamples: 100
};

// Reset RPM counter and store in history every minute
setInterval(() => {
  healthState.rpmHistory.push(healthState.rpmCount);
  if (healthState.rpmHistory.length > 60) healthState.rpmHistory.shift();
  if (healthState.rpmCount > healthState.peakRpm) healthState.peakRpm = healthState.rpmCount;
  healthState.rpmCount = 0;
  healthState.rpmWindowStart = Date.now();

  // Reset daily peak every hour
  if (healthState.rpmHistory.length % 60 === 0) {
    healthState.peakRpm = Math.max(...healthState.rpmHistory, 0);
  }
}, 60000);

// Reset today counter at midnight
setInterval(() => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  if (today !== healthState.todayDate) {
    healthState.todayDate = today;
    healthState.todayCount = 0;
    healthState.errorCount = 0;
  }
}, 60000);

// Latency tracking middleware — measures response time for every request
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/health' || req.path === '/api/stats' || req.path === '/visitors') return;
    const ms = Date.now() - start;
    healthState.currentLatency = ms;
    healthState.responseTimes.push(ms);
    if (healthState.responseTimes.length > healthState.maxSamples) {
      healthState.responseTimes.shift();
    }
    healthState.totalRequests++;
    healthState.rpmCount++;
    healthState.todayCount++;
    if (res.statusCode >= 400) {
      healthState.errorCount++;
    }
  });
  next();
});

// Health endpoint — real-time server metrics (BEFORE responseFormatter to avoid wrapping)
app.get('/health', (req, res) => {
  const avgLatency = healthState.responseTimes.length > 0
    ? Math.round(healthState.responseTimes.reduce((a, b) => a + b, 0) / healthState.responseTimes.length)
    : 0;
  const uptime = Math.floor((Date.now() - SERVER_START_TIME) / 1000);
  const uptimePercent = Math.min(100, Math.max(99, 100 - (uptime / 100000))).toFixed(2);
  res.json({
    status: 'online',
    latency: avgLatency,
    uptime,
    uptimePercent,
    version: APP_VERSION,
    totalRequests: healthState.totalRequests,
    rpm: healthState.rpmCount
  });
});

// Cache for systeminformation data — lightweight first, background refresh for accuracy
let sysInfoCache = { cpuUsage: 0, memTotal: 0, memUsed: 0, memUsagePercent: 0, updatedAt: 0 };
const SYSINFO_CACHE_TTL = 5000; // 5 seconds
let sysInfoRefreshing = false;

function getLightweightSysInfo() {
  const mu = process.memoryUsage();
  const totalMem = os.totalmem();
  const pct = totalMem > 0 ? Math.round((mu.rss / totalMem) * 100) : 0;
  return {
    cpuUsage: 0,
    memTotal: totalMem,
    memUsed: mu.rss || 0,
    memUsagePercent: pct > 100 ? 100 : pct
  };
}

async function refreshSysInfoInBackground() {
  if (sysInfoRefreshing) return;
  sysInfoRefreshing = true;
  try {
    const siModule = await getSI();
    const [cpu, mem] = await Promise.all([
      siModule.currentLoad(),
      siModule.mem()
    ]);
    const mu = process.memoryUsage();
    const totalMem = os.totalmem();
    const cpuUsage = Math.round(cpu.currentLoad || 0);
    let memUsed = (mem.active || mem.used || 0);
    let memTotal = mem.total || totalMem;
    let pct = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;
    sysInfoCache = {
      cpuUsage,
      memTotal,
      memUsed,
      memUsagePercent: pct > 100 ? 100 : pct,
      updatedAt: Date.now()
    };
  } catch {}
  sysInfoRefreshing = false;
}

function getCachedSysInfo() {
  const now = Date.now();
  if (now - sysInfoCache.updatedAt < SYSINFO_CACHE_TTL) {
    return sysInfoCache;
  }
  // Return lightweight data immediately, refresh in background
  const light = getLightweightSysInfo();
  if (sysInfoCache.updatedAt === 0) {
    // First ever call — store lightweight as initial cache
    sysInfoCache = { ...light, updatedAt: now };
  }
  refreshSysInfoInBackground(); // Fire-and-forget, no await
  return light;
}

// Stats endpoint — comprehensive real-time monitoring (BEFORE responseFormatter)
app.get('/api/stats', async (req, res) => {
  try {
    const uptime = Math.floor((Date.now() - SERVER_START_TIME) / 1000);
    const avgLatency = healthState.responseTimes.length > 0
      ? Math.round(healthState.responseTimes.reduce((a, b) => a + b, 0) / healthState.responseTimes.length)
      : 0;

    // Current request count for today
    let today = healthState.todayCount;
    let totalErrorCount = healthState.errorCount;
    
    // Try to get stats data for more accurate today/all-time counts
    let allTimeTotal = healthState.totalRequests;
    try {
      if (isConnected()) {
        const summary = await getStatsSummary();
        if (summary) {
          allTimeTotal = summary.total || healthState.totalRequests;
          today = summary.today || healthState.todayCount;
        }
      }
    } catch {}

    // Get cached system info (no await — synchronous cache)
    const sysInfo = getCachedSysInfo();

    // Error rate calculation
    const errorRate = today > 0 ? ((totalErrorCount / today) * 100).toFixed(2) : '0.00';

    // Count endpoint categories
    const categories = [...new Set(allEndpoints.map(e => e.category).filter(Boolean))].length;

    res.json({
      success: true,
      status: 'online',
      version: APP_VERSION,
      uptime: {
        seconds: uptime,
        formatted: formatUptime(uptime)
      },
      latency: {
        current: Math.round(healthState.currentLatency),
        average: avgLatency,
        unit: 'ms'
      },
      requests: {
        total: allTimeTotal,
        today,
        rpm: healthState.rpmCount
      },
      endpoints: {
        total: allEndpoints.length,
        categories
      },
      server: {
        memoryUsed: formatBytes(sysInfo.memUsed),
        memoryTotal: formatBytes(sysInfo.memTotal),
        memoryUsagePercent: sysInfo.memUsagePercent,
        cpuUsage: sysInfo.cpuUsage,
        platform: process.platform,
        nodeVersion: process.version
      },
      errors: {
        today: totalErrorCount,
        rate: errorRate + '%'
      },
      traffic: {
        peakRPM: healthState.peakRpm,
        currentRPM: healthState.rpmCount
      },
      timestamp: Date.now()
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      status: 'error',
      error: e.message,
      timestamp: Date.now()
    });
  }
});

app.set("trust proxy", 1);
if (process.env.NODE_ENV !== 'production') app.set("json spaces", 2);

setupMiddleware(app);
setupResponseFormatter(app);

// Maintenance Mode middleware
app.use((req, res, next) => {
  const config = getConfig();
  if (config.maintenance === true) {
    const isDocs = req.path === '/docs' || req.path.startsWith('/docs/');
    const isApi = req.path.startsWith('/api/') && !req.path.startsWith('/api/admin');
    
    if (isDocs || isApi) {
      if (req.accepts('html') && !req.path.startsWith('/api/')) {
        res.status(503);
        return res.sendFile(path.join(process.cwd(), 'public', 'maintenance.html'));
      } else {
        return res.status(503).json({
          success: false,
          status: "MAINTENANCE",
          message: "Zyyvor API is currently under maintenance. Please try again later."
        });
      }
    }
  }
  next();
});

// Visitor tracking middleware — track unique visitors on page loads
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.includes('.') && req.path !== '/visitors') {
    trackVisitor(req.ip);
  }
  next();
});

// SSRF Protection — validate all user-supplied URLs before they reach endpoint handlers
import { validateSSRFUrl, isPrivateIP } from '../utils/safeFetch.js';
import dns from 'dns';
app.use('/api/', (req, res, next) => {
  const urls = [];
  if (req.query?.url) urls.push(req.query.url);
  if (req.body?.url) urls.push(req.body.url);
  if (req.query?.image) urls.push(req.query.image);
  if (req.body?.image) urls.push(req.body.image);
  if (req.query?.avatar) urls.push(req.query.avatar);
  if (req.query?.background) urls.push(req.query.background);
  if (req.query?.pp) urls.push(req.query.pp);
  if (req.query?.ppurl) urls.push(req.query.ppurl);
  if (req.query?.avatarUrl) urls.push(req.query.avatarUrl);
  if (req.query?.source_url) urls.push(req.query.source_url);
  if (req.query?.target_url) urls.push(req.query.target_url);
  if (req.query?.profilePhoto) urls.push(req.query.profilePhoto);
  if (req.query?.mainPhoto) urls.push(req.query.mainPhoto);
  if (req.body?.ppUrl) urls.push(req.body.ppUrl);
  if (req.body?.imgUrl) urls.push(req.body.imgUrl);

  if (urls.length === 0) return next();

  for (const rawUrl of urls) {
    try {
      validateSSRFUrl(rawUrl);
    } catch (err) {
      return res.status(400).json({ status: false, message: `SSRF protection: ${err.message}` });
    }
  }

  const hostname = new URL(urls[0]).hostname;
  dns.resolve4(hostname, (err, addrs) => {
    if (err && err.code === 'ENODATA') {
      dns.resolve6(hostname, (err6, addrs6) => {
        if (err6 && err6.code !== 'ENODATA') return next();
        if (addrs6) {
          for (const ip of addrs6) {
            if (isPrivateIP(ip)) return res.status(400).json({ status: false, message: `SSRF blocked: ${hostname} → ${ip}` });
          }
        }
        next();
      });
      return;
    }
    if (err) return next();
    for (const ip of addrs) {
      if (isPrivateIP(ip)) return res.status(400).json({ status: false, message: `SSRF blocked: ${hostname} → ${ip}` });
    }
    next();
  });
});

// Visitor stats endpoint
app.get('/visitors', (req, res) => {
  res.json({ success: true, ...getVisitorStats() });
});

app.use((req, res, next) => {
  try {
    const config = getConfig();

    if (config.endpointsStatus && config.endpointsStatus[req.path]) {
      const epStatus = config.endpointsStatus[req.path];
      if (epStatus === 'offline') {
        return res.status(503).json({
          status: false,
          message: 'This endpoint is currently offline'
        });
      }
      if (epStatus === 'maintenance') {
        return res.status(503).json({
          status: false,
          message: 'This endpoint is under maintenance'
        });
      }
      if (epStatus === 'premium' || epStatus === 'vip') {
        const apiKey = req.headers['x-api-key'] || req.query.apikey || (req.body && req.body.apikey) ||
          (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);

        if (!apiKey) {
          return res.status(401).json({
            success: false,
            error: 'API key required',
            message: `This endpoint requires a ${epStatus} API key. Get one at /admin/dashboard`
          });
        }

        try {
          const keysData = loadApiKeys();
          const validKey = keysData.keys.find(k => k.key === apiKey && k.enabled);

          if (!validKey) {
            return res.status(403).json({
              success: false,
              error: 'Invalid API key',
              message: 'The provided API key is invalid or disabled'
            });
          }

          // Check if key has required role for VIP endpoints
          if (epStatus === 'vip' && validKey.role !== 'vip') {
            return res.status(403).json({
              success: false,
              error: 'VIP access required',
              message: 'This endpoint requires a VIP API key. Premium keys cannot access VIP endpoints.'
            });
          }

          // ==================== ALLOWED STATUSES CHECK ====================
          // Check if key is restricted to certain endpoint statuses
          if (Array.isArray(validKey.allowedStatuses) && validKey.allowedStatuses.length > 0) {
            if (!validKey.allowedStatuses.includes(epStatus)) {
              return res.status(403).json({
                success: false,
                error: 'Status not allowed',
                message: `This API key can only access endpoints with status: ${validKey.allowedStatuses.join(', ')}. Current endpoint status: ${epStatus}`
              });
            }
          }

          // ==================== ALLOWED ENDPOINTS CHECK ====================
          // Check if key is restricted to certain endpoints (supports wildcard *)
          if (Array.isArray(validKey.allowedEndpoints) && validKey.allowedEndpoints.length > 0) {
            const reqPath = req.path;
            const isAllowed = validKey.allowedEndpoints.some(pattern => {
              if (pattern === reqPath) return true; // Exact match
              if (pattern.endsWith('/*')) {
                // Wildcard match: "/api/am/*" matches "/api/am/send", "/api/am/bulk", etc.
                const prefix = pattern.slice(0, -1); // Remove trailing *
                return reqPath.startsWith(prefix);
              }
              if (pattern.endsWith('*')) {
                // Wildcard match without slash: "/api/am*" matches "/api/am/send"
                const prefix = pattern.slice(0, -1);
                return reqPath.startsWith(prefix);
              }
              return false;
            });

            if (!isAllowed) {
              return res.status(403).json({
                success: false,
                error: 'Endpoint not allowed',
                message: `This API key can only access: ${validKey.allowedEndpoints.join(', ')}`
              });
            }
          }

          // ==================== EXPIRATION CHECK ====================
          if (validKey.expiresAt) {
            const expDate = new Date(validKey.expiresAt);
            if (expDate.getTime() <= Date.now()) {
              // Auto-disable expired key
              validKey.enabled = false;
              saveApiKeys(keysData);
              return res.status(403).json({
                success: false,
                error: 'API key expired',
                message: `This API key expired on ${expDate.toISOString().split('T')[0]}. Contact admin for renewal.`
              });
            }
          }

          // ==================== RATE LIMIT CHECK ====================
          const rl = validKey.rateLimit || {};
          const now = Date.now();
          const today = new Date().toISOString().split('T')[0];
          let rateLimited = false;
          let retryAfter = 0;

          // Daily limit check
          if (rl.maxPerDay > 0) {
            if (!validKey.dailyUsage) validKey.dailyUsage = { date: '', count: 0 };
            if (validKey.dailyUsage.date !== today) {
              validKey.dailyUsage.date = today;
              validKey.dailyUsage.count = 0;
            }
            if (validKey.dailyUsage.count >= rl.maxPerDay) {
              rateLimited = true;
              retryAfter = Math.ceil((new Date(today + 'T23:59:59.999Z').getTime() - now) / 1000);
            }
          }

          // Minute limit check
          if (!rateLimited && rl.maxPerMinute > 0) {
            const minuteBucket = Math.floor(now / 60000);
            if (!validKey.minuteUsage) validKey.minuteUsage = { timestamp: 0, count: 0 };
            if (validKey.minuteUsage.timestamp !== minuteBucket) {
              validKey.minuteUsage.timestamp = minuteBucket;
              validKey.minuteUsage.count = 0;
            }
            if (validKey.minuteUsage.count >= rl.maxPerMinute) {
              rateLimited = true;
              retryAfter = 60 - Math.floor((now % 60000) / 1000);
            }
          }

          if (rateLimited) {
            return res.status(429).json({
              success: false,
              error: 'Rate limit exceeded',
              message: `API key rate limit exceeded. Try again in ${retryAfter} seconds`,
              retryAfter
            });
          }

          // Increment rate limit counters
          if (validKey.dailyUsage) validKey.dailyUsage.count++;
          if (validKey.minuteUsage && validKey.minuteUsage.timestamp === Math.floor(now / 60000)) validKey.minuteUsage.count++;

          validKey.usageCount++;
          validKey.lastUsed = new Date().toISOString();
          saveApiKeys(keysData);
        } catch (err) {
          return res.status(500).json({ success: false, error: 'API key validation failed' });
        }

        if (epStatus === 'premium' || epStatus === 'vip') {
          const realIp = getClientIP(req);
          let capturedBody = null;
          const origJson = res.json ? res.json.bind(res) : null;
          const origSend = res.send ? res.send.bind(res) : null;
          if (origJson) {
            res.json = (body) => { try { capturedBody = body; } catch {} return origJson(body); };
          }
          if (origSend) {
            res.send = (body) => { try { capturedBody = body; } catch {} return origSend(body); };
          }
          res.once('finish', () => {
            notifyPremiumRequest({
              path: req.path,
              ip: realIp,
              apiKey,
              method: req.method,
              statusCode: res.statusCode,
              response: capturedBody,
              status: epStatus
            });
          });
        }
      }
    }

    next();
  } catch (err) {
    next();
  }
});

let allEndpoints = [];

// Function untuk update configuration.json dengan endpoints
function updateConfigurationWithEndpoints(endpoints) {
    try {
        const config = { ...getConfig() };
        if (!config || Object.keys(config).length === 0) return;
        if (!config.endpointsStatus) config.endpointsStatus = {};
        
        let updated = false;
        endpoints.forEach(ep => {
            if (!config.endpointsStatus[ep.route]) {
                config.endpointsStatus[ep.route] = "online";
                updated = true;
            }
        });
        
        // Hapus endpoint yang tidak ada lagi
        Object.keys(config.endpointsStatus).forEach(route => {
            if (!endpoints.some(ep => ep.route === route)) {
                delete config.endpointsStatus[route];
                updated = true;
            }
        });
        
        if (updated) {
            fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 4), () => {
              reloadConfig(); // invalidate cache after write
            });
        }
    } catch (error) {
        logger.error(`Failed to update configuration: ${error.message}`);
    }
}



const initializationPromise = (async function initializeAPI() {
  try {
    logger.info("Starting server initialization...");
    logger.info("Loading API endpoints via HMR...");

     allEndpoints = (await setupHmrLoader(app, path.join(process.cwd(), "api"), { configFile: CONFIG_FILE, reloadConfig })) || [];

    const config = { ...getConfig() };
    if (config && Object.keys(config).length > 0) {
      if (!config.endpointsStatus) config.endpointsStatus = {};

      let updated = false;
      allEndpoints.forEach(ep => {
        if (!config.endpointsStatus[ep.route]) {
          config.endpointsStatus[ep.route] = "online";
          updated = true;
        }
      });

      if (updated) {
        fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 4), () => {
          reloadConfig();
        });
      }
    }

    logger.ready(`Loaded ${allEndpoints.length} endpoints (HMR enabled)`);

    // Dynamic import setupRoutes — hot-reloadable via chokidar watch on src/routes/
    async function loadRoutes() {
      const deps = {
        allEndpoints,
        TURNSTILE_SITE_KEY,
        TURNSTILE_SECRET_KEY,
        CONFIG_FILE,
        ADMIN_USERS_FILE,
        loadApiKeys,
        saveApiKeys,
        uploadDir,
        upload
      }
      try {
        const mod = await import(pathToFileURL(path.join(process.cwd(), 'src', 'routes', 'setupRoutes.js')).href + `?t=${Date.now()}`)
        mod.default(app, allEndpoints, deps)
        logger.info('Admin routes loaded')
      } catch (err) {
        logger.error(`Failed to load admin routes: ${err.message}`)
      }
    }

    function removeAdminRouteLayers() {
      const stack = app._router?.stack
      if (!stack) return
      const adminPaths = [
        '/admin/api/turnstile-config', '/admin/api/login', '/admin/api/me', '/admin/api/logout',
        '/admin/api/endpoints', '/admin/api/endpoints/status', '/admin/api/endpoints/*',
        '/admin/api/keys', '/admin/api/keys/:key',
        '/admin/api/settings', '/admin/api/users', '/admin/api/users/:username',
        '/admin/api/ips', '/admin/api/ips/unban', '/admin/api/ips/ban',
        '/admin/api/ips/whitelist', '/admin/api/ips/whitelist/:ip',
        '/admin/api/notifications/feed',
        '/admin/api/requests/stats',
        '/admin/unban',
        '/files/:filename',
        '/api/tools/upload-v3/:id'
      ]
      const adminSet = new Set(adminPaths)
      for (let i = stack.length - 1; i >= 0; i--) {
        const layer = stack[i]
        if (layer.route && adminSet.has(layer.route.path)) {
          stack.splice(i, 1)
        } else if (!layer.route && layer.handle) {
          const fnText = layer.handle.toString()
          if (fnText.includes('404.html') || fnText.includes('500.html')) {
            stack.splice(i, 1)
          }
        }
      }
    }

    loadRoutes()

    // Watch src/routes/ for hot-reload
    if (process.env.NODE_ENV !== 'production') {
      const routesDir = path.join(process.cwd(), 'src', 'routes')
      logger.info(`[HMR] Watching admin routes: ${routesDir}`)
      chokidar.watch(routesDir, {
        ignoreInitial: true,
        persistent: true,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
      }).on('change', async (filePath) => {
        if (!filePath.endsWith('.js')) return
        logger.info(`[HMR] Admin route file changed: ${path.basename(filePath)}`)
        try {
          removeAdminRouteLayers()
          await loadRoutes()
          logger.info(`[HMR] Admin route reloaded: ${path.basename(filePath)}`)
        } catch (err) {
          logger.error(`[HMR] Admin route reload failed: ${err.message}`)
        }
      })
      logger.info(`[HMR] Admin route watcher ready`)
    }

    // Initialize stats database
    initDb().then(connected => {
      if (connected) {
        logger.ready('Stats database ready');
        if (!statsMigrated) {
          statsMigrated = true;
          try {
            const stats = loadStats();
            migrateFromJson(stats);
          } catch (e) {
            logger.error(`Stats migration error: ${e.message}`);
          }
        }
      } else {
        logger.warn('Stats database not available, using JSON only');
      }
    });
    
    return allEndpoints;
  } catch (err) {
    logger.error(`Initialization failed: ${err.message}`);
    logger.error(err.stack);
    return [];
  }
})();

const SERVER_START_TIME = Date.now();

// Endpoint untuk manual trigger reload
app.post('/admin/reload-endpoints', privacyGuard, async (req, res) => {
    try {
        res.json({
            success: true,
            message: 'HMR is active - endpoints reload automatically on file changes',
            count: allEndpoints.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: `Failed: ${error.message}`
        });
    }
});

app.get('/admin/endpoints', privacyGuard, (req, res) => {
    res.json({
        count: allEndpoints.length,
        endpoints: allEndpoints.map(ep => ({
            route: ep.route,
            method: ep.method,
            description: ep.description,
            params: ep.params || []
        })),
        lastUpdate: new Date().toISOString()
    });
});

let cachedSIResult = null;
let lastSITime = 0;
let siFetchPromise = null;

app.get('/status2', async (req, res) => {
  try {
    const siModule = await getSI();
    const start = process.hrtime();
    const now = Date.now();
    
    if (now - lastSITime > 1400 || !cachedSIResult) {
      if (!siFetchPromise) {
        siFetchPromise = Promise.all([
          siModule.currentLoad(),
          siModule.mem(),
          siModule.osInfo(),
          siModule.networkInterfaces(),
          siModule.networkStats(),
          siModule.fsSize(),
          siModule.processes(),
          siModule.versions()
        ]).then(result => {
          cachedSIResult = result;
          lastSITime = Date.now();
          siFetchPromise = null;
          return result;
        }).catch(err => {
          siFetchPromise = null;
          throw err;
        });
      }
      await siFetchPromise;
    }

    const [cpu, mem, osInfo, networkInterfaces, networkStats, diskInfo, processesInfo, versions] = cachedSIResult;
    
    const diff = process.hrtime(start);
    const latency = (diff[0] * 1e9 + diff[1]) / 1e6;

    // Dapatkan statistik API
    const apiStats = await getApiStatsSummary();

    // Format uptime
    const uptimeSeconds = process.uptime();
    const uptimeHuman = formatUptime(uptimeSeconds);
    const days = (uptimeSeconds / 86400).toFixed(2);

    // Format memory untuk process
    const memoryUsage = process.memoryUsage();

    // Sanitize network interfaces (hide IPs and MACs)
    const interfaces = sanitizeNetworkInterfaces(networkInterfaces);

    // Dapatkan statistik jaringan (sanitized)
    const netStats = networkStats[0] || { rx_bytes: 0, tx_bytes: 0, rx_sec: 0, tx_sec: 0 };

    // Get hostname but sanitize if it looks like an IP
    let hostname = osInfo.hostname || os.hostname();
    // Check if hostname looks like an IP address
    const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipPattern.test(hostname)) {
      hostname = hideIPAddress(hostname);
    }

    res.status(200).json({
      statusCode: 200,
      status: "online",
      latency: `${latency.toFixed(2)}ms`,
      version: APP_VERSION,
      startTime: SERVER_START_TIME,
      cpu: {
        totalCores: cpu.cpus ? cpu.cpus.length : 0,
        physicalCores: cpu.physicalCores || 0,
        currentLoad: cpu.currentLoad || 0,
        currentLoadUser: cpu.currentLoadUser || 0,
        currentLoadSystem: cpu.currentLoadSystem || 0,
        currentLoadIdle: cpu.currentLoadIdle || 0,
        loadAverage: {
          "1min": (cpu.avgLoad || [0, 0, 0])[0]?.toFixed(2) || "0.00",
          "5min": (cpu.avgLoad || [0, 0, 0])[1]?.toFixed(2) || "0.00",
          "15min": (cpu.avgLoad || [0, 0, 0])[2]?.toFixed(2) || "0.00"
        },
        processors: cpu.cpus ? cpu.cpus.map(c => ({
          model: c.model,
          speed: c.speed ? `${c.speed} MHz` : "0 MHz",
          times: c.times
        })) : []
      },
      mem: {
        total: mem.total || 0,
        used: mem.active || mem.used || 0,
        free: mem.available || mem.free || 0,
        total_human: formatBytes(mem.total || 0),
        used_human: formatBytes(mem.active || mem.used || 0),
        free_human: formatBytes(mem.available || mem.free || 0),
        usagePercent: mem.total ? (( (mem.active || mem.used || 0) / mem.total) * 100).toFixed(2) : "0.00",
        swapTotal: mem.swaptotal || 0,
        swapUsed: mem.swapused || 0,
        swapFree: mem.swapfree || 0
      },
      os: {
        platform: osInfo.platform || process.platform,
        type: osInfo.platform || process.platform,
        release: osInfo.release || process.release?.name || '',
        distro: osInfo.distro || '',
        kernel: osInfo.kernel || '',
        arch: process.arch,
        hostname: hostname, // Sanitized hostname
        uptime: {
          seconds: uptimeSeconds,
          human: uptimeHuman,
          days: days
        }
      },
      software: {
        nodejs: process.version || '',
        npm: versions.npm || '',
        ffmpeg: versions.ffmpeg || '',
        python: versions.python || ''
      },
      network: {
        interfaces: interfaces, // Sanitized interfaces (IPs and MACs hidden)
        stats: {
          rxBytes: netStats.rx_bytes || 0,
          txBytes: netStats.tx_bytes || 0,
          rxSec: netStats.rx_sec || 0,
          txSec: netStats.tx_sec || 0
        }
      },
      disk: diskInfo.map(d => ({
        filesystem: d.fs || d.filesystem,
        size: d.size || 0,
        used: d.used || 0,
        available: d.available || 0,
        usePercent: d.use ? d.use.toFixed(2) : (d.used && d.size ? ((d.used / d.size) * 100).toFixed(2) : "0.00"),
        mount: d.mount || '',
        size_human: formatBytes(d.size || 0),
        used_human: formatBytes(d.used || 0),
        available_human: formatBytes(d.available || 0)
      })),
      processes: {
        total: processesInfo.all || 0,
        running: processesInfo.running || 0,
        blocked: processesInfo.blocked || 0,
        sleeping: (processesInfo.all || 0) - (processesInfo.running || 0) - (processesInfo.blocked || 0)
      },
      uptime: uptimeSeconds,
      uptime_human: uptimeHuman,
      memory: {
        rss: formatBytes(memoryUsage.rss || 0),
        heapTotal: formatBytes(memoryUsage.heapTotal || 0),
        heapUsed: formatBytes(memoryUsage.heapUsed || 0),
        external: formatBytes(memoryUsage.external || 0)
      },
      pid: process.pid,
      title: process.title || 'node',
      endpoints: {
        total: allEndpoints.length,
        hotReload: true
      },
      apiStats: {
        hits: {
          today: apiStats.today,
          thisWeek: apiStats.thisWeek,
          thisMonth: apiStats.thisMonth,
          allTime: apiStats.total
        },
        popularEndpoints: apiStats.popularEndpoints,
        lastUpdated: apiStats.lastUpdated
      },
      proxy: PROXY_MANAGER.getStats(),
      cache: { size: apiCache.size(), maxEntries: apiCache.maxEntries },
      // Add public IP (sanitized) if available from request
      publicIP: req.ip ? hideIPAddress(req.ip) : undefined,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ 
      statusCode: 500,
      status: "error", 
      error: e.message,
      timestamp: new Date().toISOString()
    });
  }
});


// Public API stats for stats page (charts)
app.get('/api-stats', async (req, res) => {
  try {
    const summary = await getApiStatsSummary();
    // Try to get detailed data
    let detailed = {};
    if (isConnected()) {
      const dbStats = await loadAllStats();
      if (dbStats) {
        detailed = {
          daily: dbStats.daily || {},
          weekly: dbStats.weekly || {},
          monthly: dbStats.monthly || {}
        };
      }
    }
    if (!detailed.daily || Object.keys(detailed.daily).length === 0) {
      const stats = loadStats();
      detailed = {
        daily: stats.daily || {},
        weekly: stats.weekly || {},
        monthly: stats.monthly || {}
      };
    }
    res.json({
      success: true,
      summary,
      detailed
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.use('/configuration', (req, res) => {
  try {
    // Anti-cache headers — biar browser selalu ambil data terbaru
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');

    reloadConfig(); // Force reload from disk — fs.watch is unreliable
    const configData = { ...getConfig() };
    if (configData.releases?.[0]?.version) {
      configData.release = { version: configData.releases[0].version };
      configData.version = configData.releases[0].version;
    }
    res.json(configData);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load configuration' });
  }
});

const imagesPath = path.join(process.cwd(), "src", "images");
app.use("/src/images", express.static(path.join(process.cwd(), "src", "images")));

  app.get(["/src/images/:filename", "/src/image/:filename"], (req, res) => {
    const system = path.resolve(path.join(process.cwd(), "src", "images"));
    let filename = path.basename(req.params.filename);
    if (filename === "logo.png") filename = "logo.jpg";
    const filePath = path.resolve(path.join(system, filename));
    if (!filePath.startsWith(system)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File not found or expired" });
    }
    res.sendFile(filePath);
  });

  app.get(["/logo.jpg", "/logo.png", "/logo.ico"], (req, res) => {
    let filename = req.path.substring(1);
    if (filename === "logo.png") filename = "logo.jpg";
    const filePath = path.join(process.cwd(), "src", "images", filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File not found" });
    }
    res.sendFile(filePath);
  });

app.get("/openapi.json", async (req, res) => {
    await initializationPromise;
    
    // ==========================================
    // PRIMARY BASE URL (dari request saat ini)
    // ==========================================
    const primaryUrl = `${req.protocol}://${req.get("host")}`;
    
    // ==========================================
    // ADDITIONAL SERVERS DARI CONFIGURATION.JSON (cached)
    // ==========================================
    const config = getConfig();
    let additionalServers = config.servers || [];

    // ==========================================
    // DETERMINE BASEURL FORMAT (String atau Array)
    // ==========================================
    let baseurl;

    if (additionalServers.length === 0) {
        baseurl = primaryUrl;
    } else {
        baseurl = [primaryUrl, ...additionalServers.map(s => s.url)];
    }
    
    // ==========================================
    // GENERATE ENDPOINTS (pake primary url untuk contoh)
    // ==========================================
    const endpoints = allEndpoints.map((ep) => {
        let url = primaryUrl + ep.route;
        if (ep.params && ep.params.length > 0) {
            const query = ep.params.map((p) => `${p}=YOUR_${p.toUpperCase()}`).join("&");
            url += "?" + query;
        }
        const status = (config.endpointsStatus && config.endpointsStatus[ep.route]) || 'online';
        return { ...ep, url, status };
        /*
        return {
            route: ep.route,
            method: ep.method,
            description: ep.description || '',
            params: ep.params || [],
            url: url,
            status: status
        };
        */
    });
    
    // ==========================================
    // METADATA
    // ==========================================
    const metadata = {
        totalEndpoints: endpoints.length,
        totalBaseUrls: Array.isArray(baseurl) ? baseurl.length : 1,
        hotReload: true,
        //servers: additionalServers.length > 0 ? additionalServers : undefined
    };
    
    // ==========================================
    // RESPONSE - STRUKTUR SIMPLE
    // ==========================================
    res.status(200).json({
        title: "Zyyvor API",
        description: "API Documentation",
        version: APP_VERSION,
        lastUpdate: new Date().toISOString(),
        baseurl: baseurl,
        endpoints: endpoints,
        metadata: metadata
    });
});


app.get('/stats', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'stats.html'));
});

// New /status endpoint - proxies to /status2
app.get('/status', async (req, res) => {
  try {
    // Check if client wants JSON (API) or HTML
    const acceptsHtml = req.accepts('html');
    const acceptsJson = req.accepts('json');
    
    if (acceptsHtml && !acceptsJson) {
      // Serve HTML page
      return res.sendFile(path.join(process.cwd(), 'public', 'stats.html'));
    }
    
    // Proxy to /status2 for JSON data
    const response = await fetch('http://localhost:3000/status2', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    
    if (!response.ok) {
      throw new Error(`Status2 returned ${response.status}`);
    }
    
    const data = await response.json();
    return res.json(data);
  } catch (e) {
    // Fallback: serve HTML if JSON fails
    return res.sendFile(path.join(process.cwd(), 'public', 'stats.html'));
  }
});



app.get(['/legal/privacy', '/legal/privacy-policy'], (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'legal', 'privacy-policy.html'));
});

app.get(['/legal/terms', '/legal/terms-of-service'], (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'legal', 'terms-of-service.html'));
});


const _rootReq = new Map()
app.get('/', (req, res) => {
  const now = Date.now()
  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  const isLocal = ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1'
  const last = _rootReq.get(ip) || 0
  if (now - last < (isLocal ? 30000 : 1000)) {
    return res.status(200).type('text/plain').send('OK')
  }
  _rootReq.set(ip, now)
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

app.get('/docs', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'docs.html'));
});

app.get('/request-report', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'request-report.html'));
});

app.post('/api/request-report', express.json(), async (req, res) => {
  try {
    const result = await sendReport({
      kategori: req.body.kategori,
      pesan: req.body.pesan,
      nama: req.body.nama,
      kontak: req.body.kontak,
      ip: req.ip
    })
    res.json({
      status: true,
      message: "Laporan berhasil dikirim. Terima kasih atas masukannya!",
      kategori: result.kategori,
      timestamp: Date.now()
    })
  } catch (err) {
    res.status(400).json({
      status: false,
      message: err.message
    })
  }
})

app.get('/support', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'support.html'));
});

app.get('/changelog', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'changelog.html'));
});

/* ------------------------------ halaman donasi ----------------------------- */
app.get('/donasi', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'donate.html'));
});

// Buat invoice QRIS baru
app.post('/api/donasi', express.json(), async (req, res) => {
  try {
    const { amount, name, message, username } = req.body || {};
    const record = await createDonation({ amount, name, message, username });
    res.json({
      status: true,
      message: 'QRIS berhasil dibuat. Selesaikan pembayaran sebelum QRIS kedaluwarsa.',
      data: record,
    });
  } catch (err) {
    res.status(400).json({ status: false, message: err.message });
  }
});

// Polling status pembayaran
app.get('/api/donasi/status', async (req, res) => {
  try {
    const id = req.query.id;
    if (!id) return res.status(400).json({ status: false, message: 'Parameter id wajib diisi.' });
    // Cek keberadaan dulu supaya "tidak ditemukan" jadi 404, bukan 400.
    const { getDonation } = await import('../utils/donasi.js');
    const existing = await getDonation(id);
    if (!existing) {
      return res.status(404).json({ status: false, message: 'Invoice tidak ditemukan (atau sudah kedaluwarsa).' });
    }
    const record = await checkDonationStatus(id);
    res.json({ status: true, data: record });
  } catch (err) {
    res.status(400).json({ status: false, message: err.message });
  }
});

// Ringkasan donasi untuk landing page
app.get('/api/donasi/summary', async (req, res) => {
  try {
    res.json({ status: true, data: await getDonationSummary(req.query.username) });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
});

// Render QRIS dari invoice yang tersimpan
app.get('/api/donasi/qr/:file', async (req, res) => {
  try {
    const raw = path.basename(String(req.params.file || ''), '.png');
    const { getDonation } = await import('../utils/donasi.js');
    const record = await getDonation(raw);
    if (!record?.qrString) return res.status(404).json({ status: false, message: 'QRIS tidak tersedia.' });

    const png = await QRCode.toBuffer(record.qrString, {
      type: 'png',
      width: 480,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(png);
  } catch (err) {
    res.status(400).json({ status: false, message: err.message });
  }
});

// Metadata nominal untuk integrasi frontend
app.get('/api/donasi/config', (req, res) => {
  res.json({ status: true, data: { minAmount: MIN_AMOUNT, maxAmount: MAX_AMOUNT, method: 'qris' } });
});

app.get('/sitemap.xml', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'sitemap.xml'));
  //res.send(generateSitemap());
});

app.get('/robots.txt', (req, res) => {
  res.header('Content-Type', 'application/txt');
  res.sendFile(path.join(process.cwd(), 'public', 'robots.txt'));
});

app.get('/llms.txt', (req, res) => {
  res.header('Content-Type', 'text/plain');
  res.sendFile(path.join(process.cwd(), 'public', 'llms.txt'));
});

// Admin page routes
app.get('/admin/login', (req, res) => {
  // If already logged in, redirect to dashboard
  if (req.session && req.session.adminLoggedIn === true) {
    return res.redirect('/admin/dashboard');
  }
  res.sendFile(path.join(process.cwd(), 'public', 'admin', 'login.html'));
});

app.get('/admin/dashboard', (req, res) => {
  if (req.session && req.session.adminLoggedIn === true) {
    return res.sendFile(path.join(process.cwd(), 'public', 'admin', 'dashboard.html'));
  }
  res.redirect('/admin/login');
});



// Cleanup pada exit — simpan stats sebelum shutdown
// Gunakan prependListener agar berjalan SEBELUM handler rateLimiter (yang panggil process.exit)
process.prependListener('SIGINT', async () => {
    await backupOnShutdown();
});

process.prependListener('SIGTERM', async () => {
    await backupOnShutdown();
});

process.prependListener('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err.message}`);
    // Synchronous cleanup only — jangan await async operation di sini
    try {
        if (isConnected()) {
            // Quick sync attempt to save whatever we can
            const statsPath = path.join(process.cwd(), 'api-stats.json');
            if (fs.existsSync(statsPath)) {
                // Don't overwrite, just note the crash
                logger.warn('Server crashed, periodic backup may have recent data');
            }
        }
    } catch {}
    process.exit(1);
});

// Export proxy function dan manager untuk digunakan di module lain
export { proxy, PROXY_MANAGER, createProxyAgent, detectProxyProtocol };
export default app;