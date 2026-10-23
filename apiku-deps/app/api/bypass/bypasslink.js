/**
 * Bypass Link API
 * 
 * Bypass shortlink services seperti sf.gl, sub2unlock, linkvertise, dll (tidak mendukung TinyURL).
 * Menggunakan bypass.tools API dengan Cloudflare Turnstile bypass solver via puppeteer-real-browser.
 * 
 * GET  /api/bypass/bypasslink?url=https://linkvertise.com/...
 * POST /api/bypass/bypasslink
 * Body: { "url": "https://linkvertise.com/..." }
 */

import crypto from "crypto";
import { connect } from "puppeteer-real-browser";

const BYPASS_TOOLS = "https://bypass.tools";
const COOKIE_TTL = 15 * 60 * 1000; // 15 menit cache

let cachedCF = {
  cookies: "",
  userAgent: "",
  timestamp: 0,
};

let refreshPromise = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchCFCookies() {
  const { browser, page } = await connect({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1366,768"],
    turnstile: true,
    disableXvfb: false,
    connectOption: {},
  });

  try {
    await page.goto(BYPASS_TOOLS, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(4000);

    const cookies = await page.cookies();
    const userAgent = await page.evaluate(() => navigator.userAgent);
    await browser.close();

    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    cachedCF = {
      cookies: cookieStr,
      userAgent: userAgent || "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      timestamp: Date.now(),
    };
    return cachedCF;
  } catch (err) {
    try { await browser.close(); } catch {}
    throw err;
  }
}

async function getValidCFCookies(force = false) {
  const isExpired = Date.now() - cachedCF.timestamp > COOKIE_TTL;
  if (!force && cachedCF.cookies && !isExpired) {
    return cachedCF;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = fetchCFCookies().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

async function resolveBypass(targetUrl, androidId) {
  let cfData = await getValidCFCookies();

  const deviceId = crypto
    .createHash("sha256")
    .update(`bypasstools:${androidId || crypto.randomBytes(16).toString("hex")}`)
    .digest("hex");

  const sendRequest = async (currentCF) => {
    const initRes = await fetch(`${BYPASS_TOOLS}/api/mobile/init`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": currentCF.userAgent,
        "Cookie": currentCF.cookies,
      },
      body: JSON.stringify({
        deviceId,
        platform: "android",
        appVersion: "1.0.0",
      }),
    });

    if (!initRes.ok) {
      throw new Error(`Init session failed: HTTP ${initRes.status}`);
    }

    const initData = await initRes.json();
    const sessionToken = initData.sessionToken;

    if (!sessionToken) {
      throw new Error("Failed to acquire session token from bypass.tools");
    }

    const bypassRes = await fetch(`${BYPASS_TOOLS}/api/mobile/bypass`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionToken}`,
        "X-Device-ID": deviceId,
        "User-Agent": currentCF.userAgent,
        "Cookie": currentCF.cookies,
      },
      body: JSON.stringify({
        url: targetUrl,
        forceRefresh: false,
      }),
    });

    const bypassData = await bypassRes.json();
    if (!bypassRes.ok) {
      throw new Error(bypassData.message || `Bypass failed: HTTP ${bypassRes.status}`);
    }

    if (!bypassData.result) {
      throw new Error("Empty result returned from bypass.tools");
    }

    return bypassData.result;
  };

  try {
    return await sendRequest(cfData);
  } catch (err) {
    // Jika gagal kemungkinan cookies expired, coba refresh sekali lagi
    if (err.message.includes("502") || err.message.includes("403") || err.message.includes("Init session failed")) {
      cfData = await getValidCFCookies(true);
      return await sendRequest(cfData);
    }
    throw err;
  }
}

export default {
  name: "Bypass Link",
  description: "Bypass shortlink services (sf.gl, sub2unlock, linkvertise, dll; tidak mendukung TinyURL) via bypass.tools with Cloudflare solver",
  category: "Bypass",
  methods: ["GET", "POST"],
  params: ["url", "androidId"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL shortlink yang ingin di-bypass (sf.gl, linkvertise, dll - tidak mendukung TinyURL)",
      example: "https://linkvertise.com/546946/mYoUbm5Ro7gU?o=sharing",
    },
    androidId: {
      type: "string",
      required: false,
      description: "Android device ID (opsional, auto-generate random jika tidak diisi)",
      example: "a1b2c3d4e5f6a7b8",
    },
  },

  async run(req, res) {
    const startTime = Date.now();

    try {
      const params = { ...req.query, ...req.body };
      const { url, androidId } = params;

      if (!url) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
          example: {
            get: "/api/bypass/bypasslink?url=https://linkvertise.com/546946/mYoUbm5Ro7gU?o=sharing",
            post: { url: "https://linkvertise.com/546946/mYoUbm5Ro7gU?o=sharing" },
          },
        });
      }

      try {
        new URL(url);
      } catch {
        return res.status(400).json({
          status: false,
          message: "Format URL tidak valid",
        });
      }

      if (url.toLowerCase().includes("tinyurl.com")) {
        return res.status(400).json({
          status: false,
          message: "Layanan ini tidak mendukung bypass shortlink TinyURL (https://tinyurl.com/...)",
        });
      }

      const bypassedUrl = await resolveBypass(url.trim(), androidId);
      const responseTime = `${Date.now() - startTime}ms`;

      return res.json({
        status: true,
        result: {
          originalUrl: url.trim(),
          bypassedUrl,
          responseTime,
        },
      });
    } catch (err) {
      const responseTime = `${Date.now() - startTime}ms`;

      return res.status(500).json({
        status: false,
        message: err.message || "Failed to bypass URL",
        result: {
          responseTime,
        },
      });
    }
  },
};
