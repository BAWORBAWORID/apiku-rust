/**
 * Session & Cache Garbage Collector (Auto-TTL Cleanup)
 * Sweeps temporary AI session files and stale cache JSONs older than maxAgeHours
 * to prevent disk/inode bloat from long-running operations.
 */

import fs from "fs";
import path from "path";
import os from "os";
import logger from "./logger.js";

const CACHE_DIRS = [
  path.join(os.homedir(), ".gemini", "cache"),
  path.join(process.cwd(), "temp"),
  path.join(process.cwd(), ".gemini", "cache")
];

export function cleanExpiredCache(maxAgeHours = 24) {
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const now = Date.now();
  let totalCleaned = 0;

  for (const dir of CACHE_DIRS) {
    if (!fs.existsSync(dir)) continue;

    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        try {
          const stats = fs.statSync(fullPath);
          if (stats.isFile() && (now - stats.mtimeMs > maxAgeMs)) {
            fs.unlinkSync(fullPath);
            totalCleaned++;
          }
        } catch {}
      }
    } catch (e) {
      logger.warn(`[CacheCleaner] Error reading directory ${dir}: ${e.message}`);
    }
  }

  if (totalCleaned > 0) {
    logger.info(`[CacheCleaner] Swept and removed ${totalCleaned} stale cache/session files (> ${maxAgeHours}h old).`);
  }
  return totalCleaned;
}

export function startCacheCleaner(intervalHours = 12, maxAgeHours = 24) {
  // Run an initial sweep 1 minute after startup
  setTimeout(() => {
    cleanExpiredCache(maxAgeHours);
  }, 60 * 1000);

  // Periodic interval
  setInterval(() => {
    cleanExpiredCache(maxAgeHours);
  }, intervalHours * 60 * 60 * 1000);

  logger.info(`[CacheCleaner] Background garbage collector scheduled every ${intervalHours}h.`);
}

export default startCacheCleaner;
