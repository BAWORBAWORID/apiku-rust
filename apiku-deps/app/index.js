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
import os from "os";
import { exec } from "child_process";
import https from "https";
import path from "path";
import { pathToFileURL } from "url";
import express from "express";
import logger from './src/utils/logger.js';
import { closeDb } from './src/utils/apiStatsDb.js';
import { getChromePath } from './src/utils/chromePath.js';
import { loadPendingDeletions } from './api/tools/upload.js';

// Create a wrapper Express app that acts as a hot-swap router
const app = express();
let currentAppRouter = null;
let isLoadingApp = false;

// Forward all requests to the current active app router
app.use((req, res, next) => {
  if (currentAppRouter) {
    return currentAppRouter(req, res, next);
  }
  
  // If reloading or first boot, wait briefly
  let attempts = 0;
  const interval = setInterval(() => {
    attempts++;
    if (currentAppRouter) {
      clearInterval(interval);
      return currentAppRouter(req, res, next);
    }
    if (attempts >= 50) { // 5 seconds timeout
      clearInterval(interval);
      res.status(503).json({ success: false, error: "Server is initializing, try again in a few seconds." });
    }
  }, 100);
});

// Function to hot-swap the main app engine from src/app/index.js
async function hotSwapApp() {
  if (isLoadingApp) return;
  isLoadingApp = true;
  const time = new Date().toLocaleTimeString();
  try {
    logger.info(`[HMR] Loading main app engine...`);
    const appPath = path.resolve("./src/app/index.js");
    const appUrl = pathToFileURL(appPath).href;
    
    // Dynamic import with cache buster
    const mod = await import(`${appUrl}?update=${Date.now()}`);
    currentAppRouter = mod.default;
    logger.ready(`[HMR] Main app engine hot-swapped successfully!`);
  } catch (err) {
    logger.error(`[HMR] Failed to hot-swap main app engine: ${err.message}`);
    console.error(err);
  } finally {
    isLoadingApp = false;
  }
}

// Initial load
await hotSwapApp();

// The endpoint/source HMR loader owns development watchers. Re-importing the
// whole app here would duplicate timers, file watchers, and middleware state.
// Pre-warm Chrome path detection — sets PUPPETEER_EXECUTABLE_PATH early
const chromePath = getChromePath();
if (chromePath) {
  logger.info(`Chrome resolved: ${chromePath}`);
}

/**
 * Server port number from environment variables or default fallback
 * Pterodactyl biasanya menggunakan environment variable SERVER_PORT
 * @constant {number}
 * @default 3000
 */
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;

/**
 * Fetches the public IP address from an external service
 * @function getPublicIP
 * @returns {Promise<string|null>} Public IP address or null if failed
 */
function getPublicIP() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.ipify.org',
      path: '/',
      method: 'GET',
      timeout: 5000
    };

    const req = https.get(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200 && data) {
          resolve(data.trim());
        } else {
          resolve(null);
        }
      });
    });

    req.on('error', () => {
      resolve(null);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.end();
  });
}

/**
 * Starts the Express server and logs startup information including network interfaces
 * @function
 * @listens Express.Application#listen
 * 
 * @description
 * This module is the main entry point that starts the Express server.
 * It performs the following operations on startup:
 * 1. Starts the server on the specified PORT
 * 2. Logs successful server initialization
 * 3. Displays local and network access URLs
 * 4. Displays public IP address if available
 * 5. Handles network interface detection gracefully
 * 
 * @example
 * // Server startup output example:
 * // 
 * // [READY] Server started successfully
 * // [INFO] Local: http://localhost:3000
 * // [INFO] Network: http://192.168.1.100:3000
 * // [INFO] Public: http://123.456.789.0:3000
 * // [INFO] Ready for connections
 * // 
 */
const server = app.listen(PORT, async () => {
  console.log("");

  /**
   * Log server startup success message
   * @event logger#ready
   */
  logger.ready(`Server started successfully`);

  if (!process.env.SESSION_SECRET) {
    logger.warn(`⚠ SESSION_SECRET not set — using random ephemeral secret (sessions won't survive restarts)`);
  }

  // 🗑️ Auto-cleanup expired uploaded files from data/exp.json
  try {
    loadPendingDeletions();
  } catch (e) {
    logger.error(`[Startup] Expiry cleanup failed: ${e.message}`);
  }

  // 🗑️ Auto-cleanup expired upload-v3 entries from data/uploaderv3.json
  try {
    const { loadPendingDeletions: loadV3 } = await import('./api/tools/upload-v3.js');
    loadV3();
  } catch (e) {
    logger.error(`[Startup] UploadV3 cleanup failed: ${e.message}`);
  }

  /**
   * Log local access URL
   * @event logger#info
   */
  logger.info(`Local: http://localhost:${PORT}`);

  try {
    /**
     * Retrieve network interface information from the operating system
     * @type {Object.<string, os.NetworkInterfaceInfo[]>}
     */
    const nets = os.networkInterfaces();

    /**
     * Object to store filtered IPv4 network addresses
     * @type {Object.<string, string[]>}
     */
    const results = {};

    /**
     * Iterate through all network interfaces to find external IPv4 addresses
     * @loop
     * @description Filters out internal interfaces and IPv6 addresses
     */
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === "IPv4" && !net.internal) {
          if (!results[name]) results[name] = [];
          results[name].push(net.address);
        }
      }
    }

    /**
     * Log all detected external network addresses for remote access
     * @loop
     * @description Logs each network interface address that can be used for remote access
     */
    for (const [, addresses] of Object.entries(results)) {
      for (const addr of addresses) {
        /**
         * Log network access URL for each external IP address
         * @event logger#info
         */
        logger.info(`Network: http://${addr}:${PORT}`);
      }
    }

    /**
     * Try to get and display public IP address
     * This is useful for servers behind NAT or running on cloud/VPS
     */
    logger.info("Fetching public IP address...");
    const publicIP = await getPublicIP();
    
    if (publicIP) {
      /**
       * Log public access URL
       * @event logger#info
       */
      logger.info(`Public: http://${publicIP}:${PORT}`);
      
      if (process.env.SERVER_PORT && process.env.PORT && process.env.SERVER_PORT !== process.env.PORT) {
        logger.info(`Public (alt port): http://${publicIP}:${process.env.PORT}`);
      }
    } else {
      logger.warn("Could not fetch public IP address");
    }

    /**
     * Additional Pterodactyl specific information
     */
    if (process.env.SERVER_PORT) {
      logger.info(`Pterodactyl: Using port ${process.env.SERVER_PORT} (SERVER_PORT)`);
    }
    
    if (process.env.PTERODACTYL) {
      logger.info("Running on Pterodactyl panel");
    }

  } catch (error) {
    /**
     * Handle errors during network interface detection gracefully
     * @event logger#warn
     * @param {Error} error - The error encountered during network detection
     */
    logger.warn(`Cannot detect network interfaces: ${error.message}`);
  }

  /**
   * Log server readiness for accepting connections
   * @event logger#info
   */
  logger.info("Ready for connections");

  console.log("");

  // Graceful shutdown handlers
  const gracefulShutdown = async (signal) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    try {
      await closeDb();
      logger.info('Stats saved to disk');
    } catch (err) {
      logger.error(`Error during shutdown: ${err.message}`);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
});

/**
 * Global Error Handlers
 * Mencegah server mati (restart) jika ada error sistem yang tidak tertangkap
 */
process.on('uncaughtException', (err) => {
  logger.error(`[CRITICAL] Uncaught Exception: ${err.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`[CRITICAL] Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.warn(`Port ${PORT} is already in use. Trying to kill the process...`);
    const killCmd = process.platform === 'win32'
      ? `FOR /F "tokens=5" %P IN ('netstat -aon ^| findstr :${PORT}') DO taskkill /F /PID %P`
      : `lsof -ti:${PORT} | xargs kill -9`;

    exec(killCmd, (error) => {
      if (error) {
        logger.error(`Failed to kill process on port ${PORT}. Please manually kill it.`);
        if (process.platform === 'win32') {
          logger.error(`Run: netstat -ano | findstr :${PORT} and then taskkill /F /PID <PID>`);
        } else {
          logger.error(`Run: lsof -ti:${PORT} | xargs kill -9`);
        }
        process.exit(1);
      } else {
        logger.info(`Process on port ${PORT} killed. Please restart the server.`);
        process.exit(0);
      }
    });
  } else {
    logger.error(`Server error: ${err.message}`);
    process.exit(1);
  }
});

/**
 * Export the Express application instance for testing or module reuse
 * @type {express.Application}
 */
export default app;