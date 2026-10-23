import { connect } from "puppeteer-real-browser";
import fs from "fs";

const WIDTH = 1280;
const HEIGHT = 800;

const ChallengePlatform = {
  JAVASCRIPT: "non-interactive",
  MANAGED: "managed",
  INTERACTIVE: "interactive",
};

const FALLBACK_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadLines(fp) {
  try {
    return fs.readFileSync(fp, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getChromeUA() {
  const agents = loadLines("data/useragents.txt");
  return agents.length ? randomChoice(agents) : FALLBACK_UA;
}

function parseProxy(url) {
  const u = new URL(url);
  return {
    serverUrl: `${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""}`,
    username: u.username || null,
    password: u.password || null,
  };
}

function extractClearance(cookies) {
  return cookies.find((c) => c.name === "cf_clearance") || null;
}

function buildCookieString(cookies) {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function detectChallenge(page) {
  try {
    const html = await page.content();
    for (const val of Object.values(ChallengePlatform)) {
      if (html.includes(`cType: '${val}'`)) return val;
    }
    return null;
  } catch {
    return null;
  }
}

async function findCFFrame(page) {
  try {
    const frame = page.frames().find((f) => {
      try {
        return f.url().includes("challenges.cloudflare.com");
      } catch {
        return false;
      }
    });
    if (frame) return frame;
  } catch {
    /* ignore */
  }

  try {
    const el = await page.$('iframe[src*="challenges.cloudflare.com"]');
    if (el) return await el.contentFrame();
  } catch {
    /* ignore */
  }

  return null;
}

async function clickCFFrame(page, frame) {
  await sleep(1500);

  try {
    const cb = await frame.$('input[type="checkbox"]').catch(() => null);
    if (cb) {
      const box = await cb.boundingBox().catch(() => null);
      if (box) {
        await cb.click();
        return "checkbox";
      }
    }

    const label = await frame.$("label").catch(() => null);
    if (label) {
      const box = await label.boundingBox().catch(() => null);
      if (box) {
        await label.click();
        return "label";
      }
    }

    const widget = await frame.$('.cf-turnstile-content, #cf-stage, .ctp-checkbox-label').catch(() => null);
    if (widget) {
      const box = await widget.boundingBox().catch(() => null);
      if (box) {
        await widget.click();
        return "widget";
      }
    }

    const body = await frame.$("body").catch(() => null);
    if (body) {
      const box = await body.boundingBox().catch(() => null);
      if (box && box.width > 0) {
        await body.click();
        return "body";
      }
    }
  } catch (e) {}

  return null;
}

async function solveChallenge(page, timeoutSecs = 30) {
  const deadline = Date.now() + timeoutSecs * 1000;
  let attempt = 0;
  let lastClicked = 0;

  while (Date.now() < deadline) {
    attempt++;

    const cookies = await page.cookies().catch(() => []);
    if (extractClearance(cookies)) {
      return;
    }

    const platform = await detectChallenge(page);
    if (!platform) {
      return;
    }

    const frame = await findCFFrame(page);
    if (!frame) {
      await sleep(500);
      continue;
    }

    if (Date.now() - lastClicked < 5000) {
      await sleep(500);
      continue;
    }

    const result = await clickCFFrame(page, frame);
    if (result) {
      lastClicked = Date.now();
      await sleep(2500);
    } else {
      await sleep(500);
    }
  }
}

export async function solveCloudflare({
  url,
  headless = true,
  proxy = null,
  proxyFile = null,
  timeout = 30,
} = {}) {
  const proxies = proxyFile ? loadLines(proxyFile) : [];
  const chosenProxy = proxy || (proxies.length ? randomChoice(proxies) : null);
  const userAgent = getChromeUA();
  const parsed = chosenProxy ? parseProxy(chosenProxy) : null;

  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-quic",
    `--window-size=${WIDTH},${HEIGHT}`,
  ];
  if (parsed) args.push(`--proxy-server=${parsed.serverUrl}`);

  const { browser, page } = await connect({
    headless,
    args,
    turnstile: false,
    connectOption: {},
    disableXvfb: false,
    ignoreAllFlags: false,
  });

  try {
    await page.setViewport({
      width: WIDTH,
      height: HEIGHT,
    });
    await page.setUserAgent(userAgent);

    if (parsed?.username) {
      await page.authenticate({
        username: parsed.username,
        password: parsed.password,
      });
    }

    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: timeout * 1000,
      });
    } catch (e) {
      await browser.close();
      return {
        url,
        success: false,
        error: `Navigation error: ${e.message}`,
      };
    }

    await sleep(2000);

    let cookies = await page.cookies().catch(() => []);
    let clearance = extractClearance(cookies);

    if (!clearance) {
      const platform = await detectChallenge(page);

      if (!platform) {
        await browser.close();
        return {
          url,
          success: false,
          error: "No Cloudflare challenge detected",
        };
      }

      await solveChallenge(page, timeout);

      cookies = await page.cookies().catch(() => []);
      clearance = extractClearance(cookies);
    }

    const finalUA = await page.evaluate(() => navigator.userAgent).catch(() => userAgent);

    await browser.close();

    if (!clearance) {
      return {
        url,
        success: false,
        error: "Failed to obtain cf_clearance cookie",
      };
    }

    const cookieString = buildCookieString(cookies);
    const unixTimestamp = Math.floor(clearance.expires - 365 * 24 * 3600);
    const timestamp = new Date(unixTimestamp * 1000).toISOString();

    return {
      success: true,
      url,
      proxy: chosenProxy,
      user_agent: finalUA,
      cf_clearance: clearance.value,
      all_cookies: cookies,
      cookie_string: cookieString,
      unix_timestamp: unixTimestamp,
      timestamp,
      domain: clearance.domain,
    };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

export default {
  name: "Cloudflare Challenge Solver",
  description: "Solve Cloudflare challenge (managed/interactive/non-interactive) and get cf_clearance cookie",
  category: "Solve",
  methods: ["POST"],

  params: ["url", "headless", "proxy", "timeout"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "Target URL protected by Cloudflare challenge",
      example: "https://example.com",
    },
    headless: {
      type: "boolean",
      required: false,
      default: true,
      description: "Run browser in headless mode",
    },
    proxy: {
      type: "string",
      required: false,
      description: "Proxy URL (e.g., http://user:pass@ip:port)",
      example: "http://user:pass@1.2.3.4:8080",
    },
    proxyFile: {
      type: "string",
      required: false,
      description: "Path to proxy list file (one per line)",
      example: "/path/to/proxies.txt",
    },
    timeout: {
      type: "number",
      required: false,
      default: 30,
      description: "Timeout in seconds",
      example: 30,
    },
  },

  async run(req, res) {
    try {
      const { url, headless, proxy, proxyFile, timeout } = { ...req.query, ...req.body };

      if (!url) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
        });
      }

      const result = await solveCloudflare({ url, headless, proxy, proxyFile, timeout });

      return res.json({
        status: result.success,
        result: result,
      });
    } catch (e) {
      return res.status(500).json({
        status: false,
        message: e.message || "Gagal solve Cloudflare challenge",
      });
    }
  }
};