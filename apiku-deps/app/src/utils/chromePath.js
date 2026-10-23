/**
 * Chrome Path Resolver
 * 
 * Mencari executable Chrome/Chromium dari berbagai sumber:
 * 1. CHROME_PATH environment variable (prioritas tertinggi)
 * 2. Bundled Chrome di src/function/chrome/ (paket project)
 * 3. System Chrome di /usr/bin/google-chrome
 * 4. Fallback: google-chrome-stable / chromium
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CANDIDATES = [
  // 1. Environment variables (CHROME_PATH dulu, CHROME_BIN untuk backward compat)
  { label: "CHROME_PATH env", check: () => process.env.CHROME_PATH || null },
  { label: "CHROME_BIN env",  check: () => process.env.CHROME_BIN  || null },

  // 2. Bundled Chrome di src/function/chrome/
  {
    label: "Bundled Chrome",
    check: () => {
      const bundled = path.resolve(
        __dirname, "..", "function", "chrome",
        "chrome", "linux-150.0.7843.0", "chrome-linux64", "chrome"
      );
      return bundled;
    },
  },

  // 2.5 Puppeteer Cache Chrome (~/.cache/puppeteer/chrome/)
  {
    label: "Puppeteer Cache Chrome",
    check: () => {
      try {
        const cacheDir = path.resolve(process.env.HOME || "/root", ".cache", "puppeteer", "chrome");
        if (fs.existsSync(cacheDir)) {
          const dirs = fs.readdirSync(cacheDir).filter(d => d.startsWith("linux-")).sort().reverse();
          for (const d of dirs) {
            const binPath = path.join(cacheDir, d, "chrome-linux64", "chrome");
            if (fs.existsSync(binPath)) return binPath;
          }
        }
      } catch (e) {}
      return null;
    },
  },

  // 3. System Chrome /usr/bin/
  { label: "System Chrome", check: () => "/usr/bin/google-chrome" },
  { label: "Chrome Stable", check: () => "/usr/bin/google-chrome-stable" },
  { label: "Chromium", check: () => "/usr/bin/chromium" },
  { label: "Chromium Browser", check: () => "/usr/bin/chromium-browser" },
];

/**
 * Get the first available Chrome executable path.
 * Priority: CHROME_PATH env > bundled (src/function/chrome/) > system paths
 * @returns {string|null} Path to Chrome executable or null if not found
 */
export function getChromePath() {
  for (const candidate of CANDIDATES) {
    const rawPath = candidate.check();
    if (!rawPath) continue;

    try {
      if (fs.existsSync(rawPath)) {
        try {
          fs.accessSync(rawPath, fs.constants.X_OK);
        } catch {
          continue;
        }
        // Also inform Puppeteer's built-in launcher
        if (!process.env.PUPPETEER_EXECUTABLE_PATH) {
          process.env.PUPPETEER_EXECUTABLE_PATH = rawPath;
        }
        return rawPath;
      }
    } catch {
      continue;
    }
  }

  // No Chrome found — caller handles null (e.g. fallback to Puppeteer bundled)
  return null;
}

/**
 * Alias untuk backward compatibility — langsung return path.
 * Cocok untuk dipanggil inline: executablePath: getChromePath()
 */
export default getChromePath;
