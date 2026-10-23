/**
 * Turnstile Solver — Playwright-based with Xvfb fallback
 * Solve Cloudflare Turnstile captcha using Playwright
 * Auto-extracts sitekey from URL if not provided
 * (ported from solver.js which was tested successfully against OnlyFans)
 *
 * GET  /api/solve/turnstile?url=https://example.com&sitekey=0x4AAAAAA...
 * POST /api/solve/turnstile
 *
 * Options:
 *   --invisible  (query param invisible=true)  Use invisible Turnstile mode
 *   --debug      (query param debug=true)      Enable debug logging
 */

import axios from "axios";
import { chromium } from "playwright";
import { spawn } from "child_process";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import logger from "../../src/utils/logger.js";

// ─── HTML Template ───────────────────────────────────────────

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Turnstile Solver</title>
    <script
      src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileCallback"
      async
      defer
    ></script>
  </head>
  <body>
    <!-- cf turnstile -->
  </body>
</html>`;

const BROWSER_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--window-position=2000,2000",
];

const FALLBACK_UA = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
];

function getRandomUA() {
  return FALLBACK_UA[Math.floor(Math.random() * FALLBACK_UA.length)];
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// ─── Xvfb ────────────────────────────────────────────────────

let _xvfbProc = null;

async function startXvfb() {
  const display = ':' + (90 + randInt(0, 9));
  return new Promise((resolve, reject) => {
    const proc = spawn('Xvfb', [display, '-screen', '0', '1366x768x24', '-ac'], { detached: true, stdio: 'ignore' });
    proc.on('error', reject);
    setTimeout(() => { _xvfbProc = proc; resolve(display) }, 1200);
  });
}

function stopXvfb() {
  if (_xvfbProc) { try { _xvfbProc.kill() } catch {} _xvfbProc = null; }
}

// ─── Sitekey extraction ──────────────────────────────────────

async function extractSitekey(url) {
  try {
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000,
    });

    const sitekeys = new Set();

    const scriptMatches = html.match(/0x[A-Za-z0-9_-]{20,}/g);
    if (scriptMatches) scriptMatches.forEach(k => sitekeys.add(k));

    const domMatches = html.match(/data-sitekey=["'](0x[A-Za-z0-9_-]{20,})["']/g);
    if (domMatches) {
      domMatches.forEach(m => {
        const key = m.match(/0x[A-Za-z0-9_-]{20,}/);
        if (key) sitekeys.add(key[0]);
      });
    }

    if (sitekeys.size > 0) return { method: 'HTML/DOM', keys: [...sitekeys] };

    const jsFiles = [...html.matchAll(/src=["']([^"']*?\.js[^"']*?)["']/g)]
      .map(m => m[1])
      .filter(src => src && !src.startsWith("data:"));

    const fullJsUrls = jsFiles
      .map(src => { try { return new URL(src, url).href; } catch { return null; } })
      .filter(Boolean)
      .slice(0, 10);

    for (const jsUrl of fullJsUrls) {
      try {
        const { data: jsContent } = await axios.get(jsUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 5000,
        });
        const jsMatches = jsContent.match(/0x[A-Za-z0-9_-]{20,}/g);
        if (jsMatches) jsMatches.forEach(k => sitekeys.add(k));
      } catch { continue; }
    }

    if (sitekeys.size > 0) return { method: 'External JS Scan', keys: [...sitekeys] };
    return { method: 'None', keys: [] };
  } catch {
    return { method: 'Error', keys: [] };
  }
}

// ─── Core solver ─────────────────────────────────────────────

async function solveTurnstileWithBrowser({ url, sitekey, invisible, debug, display, timeoutMs }) {
  const userAgent = getRandomUA();
  const args = [...BROWSER_ARGS];
  if (userAgent) args.push(`--user-agent=${userAgent}`);

  const env = display ? { ...process.env, DISPLAY: display } : process.env;

  const browser = await chromium.launch({
    headless: !display,
    args,
    env,
  });

  const context = await browser.newContext({
    userAgent,
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();
  page.setDefaultNavigationTimeout(timeoutMs);
  page.setDefaultTimeout(timeoutMs);

  const urlWithSlash = url.endsWith("/") ? url : `${url}/`;

  try {
    const turnstileDiv =
      `<div class="cf-turnstile" data-sitekey="${sitekey}"` +
      ' data-theme="light"></div>';

    const pageData = HTML_TEMPLATE.replace("<!-- cf turnstile -->", turnstileDiv);

    await page.route(urlWithSlash, (route) =>
      route.fulfill({ body: pageData, status: 200 })
    );

    if (debug) logger.info(`[TurnstileSolver] Navigating to: ${urlWithSlash}`);
    await page.goto(urlWithSlash, { waitUntil: "networkidle", timeout: timeoutMs });

    const deadline = Date.now() + timeoutMs;
    let token = null;

    while (Date.now() < deadline) {
      try {
        const turnstileCheck = await page.$eval(
          "[name=cf-turnstile-response]",
          (el) => el.value
        );

        if (turnstileCheck && turnstileCheck.length > 20) {
          token = turnstileCheck;
          break;
        }

        if (!invisible) {
          await page.evaluate(() => {
            const el = document.querySelector(".cf-turnstile");
            if (el) {
              el.style.width = "70px";
              el.style.height = "70px";
              el.style.overflow = "visible";
            }
          });
          await page.click(".cf-turnstile", { timeout: 2000 }).catch(() => {});
        }
      } catch (err) {
        if (debug) logger.info(`[TurnstileSolver] Polling attempt: ${err.message}`);
      }
      await sleep(1000);
    }

    await context.close();
    await browser.close();
    return token;
  } catch (e) {
    try { await context.close(); } catch {}
    try { await browser.close(); } catch {}
    throw e;
  }
}

async function solveTurnstile({ url, sitekey, invisible, debug, timeoutMs = 30000 }) {
  try {
    const token = await solveTurnstileWithBrowser({ url, sitekey, invisible, debug, display: null, timeoutMs });
    if (token) return token;
  } catch (e) {
    if (debug) logger.info(`[TurnstileSolver] Headless failed: ${e.message}`);
  }

  let display;
  try {
    display = await startXvfb();
    if (debug) logger.info(`[TurnstileSolver] Xvfb started on display ${display}`);
    const token = await solveTurnstileWithBrowser({ url, sitekey, invisible, debug, display, timeoutMs });
    if (token) return token;
    throw new Error('Token not found after timeout');
  } finally {
    stopXvfb();
  }
}

export { solveTurnstile };

// ─── ENDPOINT ────────────────────────────────────────────────

export default {
  name: 'Turnstile Solver',
  description: 'Solve Cloudflare Turnstile captcha via Playwright. Auto-extracts sitekey from URL if not provided.',
  category: 'Solve',
  methods: ['GET', 'POST'],
  params: ['url', 'sitekey'],

  paramsSchema: {
    url: {
      type: 'string', required: true,
      description: 'Target URL that has the Turnstile widget',
      default: 'https://onlyfans.com',
      example: 'https://onlyfans.com'
    },
    sitekey: {
      type: 'string', required: false,
      description: 'Cloudflare Turnstile sitekey (auto-extracted if not provided)',
      example: '0x4AAAAAAAxTpmbMvo7Qj6zy'
    },
    invisible: {
      type: 'boolean', required: false, default: false,
      description: 'Set to true if using invisible Turnstile mode'
    },
    debug: {
      type: 'boolean', required: false, default: false,
      description: 'Enable debug logging'
    }
  },

  async run(req, res) {
    const { url: rawUrl, sitekey: rawSitekey, invisible, debug } = { ...req.query, ...req.body };
    const start = Date.now();

    const url = rawUrl || 'https://onlyfans.com';

    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ status: false, message: "Parameter 'url' is required" });
    }

    try { new URL(url); } catch {
      return res.status(400).json({ status: false, message: "Invalid URL format" });
    }

    let sitekey = rawSitekey;
    if (!sitekey || typeof sitekey !== 'string' || !sitekey.trim()) {
      if (debug) logger.info(`[TurnstileSolver] No sitekey provided, auto-extracting from ${url}`);
      const extraction = await extractSitekey(url.trim());
      if (extraction.keys.length > 0) {
        sitekey = extraction.keys[0];
        if (debug) logger.info(`[TurnstileSolver] Auto-extracted sitekey via ${extraction.method}: ${sitekey}`);
      } else {
        return res.status(400).json({
          status: false,
          message: "Tidak ada Cloudflare Turnstile sitekey ditemukan di URL ini. Sertakan parameter 'sitekey' secara manual.",
          extractionMethod: extraction.method,
        });
      }
    }

    sitekey = sitekey.trim();
    const invisibleMode = invisible === true || invisible === 'true';
    const debugMode = debug === true || debug === 'true';

    try {
      const token = await solveTurnstile({
        url: url.trim(),
        sitekey,
        invisible: invisibleMode,
        debug: debugMode,
        timeoutMs: 35000,
      });

      if (!token) {
        return res.status(500).json({
          status: false,
          message: 'Token not found after timeout',
          result: { responseTime: `${Date.now() - start}ms` }
        });
      }

      return res.json({
        status: true,
        result: {
          site: url.trim(),
          sitekey,
          token,
          method: 'playwright',
          responseTime: `${Date.now() - start}ms`
        }
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || 'Failed to solve Turnstile',
        result: { responseTime: `${Date.now() - start}ms` }
      });
    }
  }
};
