/**
 * GetDL Downloader API
 * Universal media downloader (TikTok, Douyin, Instagram, Facebook, YouTube, X, dll)
 * via getdl.space API
 *
 * GET  /api/downloader/getdl?url=<post-url>
 * POST /api/downloader/getdl -d {"url": "..."}
 */

import logger from "../../src/utils/logger.js";

const CONFIG = {
  BASE_URL: "https://getdl.space",
  TIMEOUT: 30_000,
  USER_AGENT:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

const PLATFORM_PATTERNS = {
  tiktok: /tiktok\.com/i,
  douyin: /(?:^|\/\/)(?:[\w-]+\.)*douyin\.com(?:\/|$)/i,
  instagram: /instagram\.com/i,
  facebook: /facebook\.com|fb\.watch/i,
  youtube: /youtube\.com|youtu\.be/i,
  twitter: /twitter\.com|x\.com/i,
  threads: /threads\.net/i,
  capcut: /capcut\.com/i,
  spotify: /spotify\.com/i,
  soundcloud: /soundcloud\.com/i,
  pinterest: /(?:www\.)?pinterest\.(?:com|co\.uk|ca|de|fr|jp)/i,
  bilibili: /(?:www\.)?bilibili\.tv/i,
  snapchat: /(?:www\.)?snapchat\.com/i,
  pixiv: /(?:www\.)?pixiv\.net/i,
};

const PLATFORM_NAMES = {
  tiktok: "TikTok",
  douyin: "Douyin",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  twitter: "X / Twitter",
  threads: "Threads",
  capcut: "CapCut",
  spotify: "Spotify",
  soundcloud: "SoundCloud",
  pinterest: "Pinterest",
  bilibili: "BiliBili",
  snapchat: "Snapchat",
  pixiv: "Pixiv",
};

function detectPlatform(url) {
  for (const [platform, pattern] of Object.entries(PLATFORM_PATTERNS)) {
    if (pattern.test(url)) return platform;
  }
  return "unknown";
}

const cookieJar = new Map();

function getCookieHeader() {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function saveCookies(res) {
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie")
      ? [res.headers.get("set-cookie")]
      : [];

  for (const c of setCookies) {
    const pair = c.split(";")[0];
    const idx = pair.indexOf("=");
    if (idx > 0) {
      cookieJar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }
}

async function resolveRedirect(url) {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": CONFIG.USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });
    return res.url || url;
  } catch {
    return url;
  }
}

let sessionCache = {
  sessionId: null,
  expiresAt: 0,
};

async function ensureSession(forceNew = false) {
  if (!forceNew && sessionCache.sessionId && Date.now() < sessionCache.expiresAt) {
    return sessionCache.sessionId;
  }

  // 1. Visit landing page untuk menginisialisasi cookies dasar
  const homeRes = await fetch(`${CONFIG.BASE_URL}/en`, {
    headers: {
      "User-Agent": CONFIG.USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(15000),
  });
  saveCookies(homeRes);

  // 2. Ambil sessionId dan getdl_sid cookie
  const sessionRes = await fetch(`${CONFIG.BASE_URL}/api/session`, {
    headers: {
      "User-Agent": CONFIG.USER_AGENT,
      Accept: "application/json, text/plain, */*",
      Referer: `${CONFIG.BASE_URL}/en`,
      Origin: CONFIG.BASE_URL,
      Cookie: getCookieHeader(),
    },
    signal: AbortSignal.timeout(15000),
  });
  saveCookies(sessionRes);

  const json = await sessionRes.json().catch(() => null);
  if (!sessionRes.ok || !json?.success || !json?.sessionId) {
    throw new Error(`Gagal inisialisasi session dari ${CONFIG.BASE_URL} (HTTP ${sessionRes.status})`);
  }

  sessionCache = {
    sessionId: json.sessionId,
    expiresAt: Date.now() + 30 * 60 * 1000,
  };

  return sessionCache.sessionId;
}

async function executeDownload(targetUrl) {
  let sessionId = await ensureSession();

  const makeRequest = async (url, sid) => {
    const res = await fetch(`${CONFIG.BASE_URL}/api/download`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": CONFIG.USER_AGENT,
        Accept: "application/json, text/plain, */*",
        Origin: CONFIG.BASE_URL,
        Referer: `${CONFIG.BASE_URL}/en`,
        Cookie: getCookieHeader(),
      },
      body: JSON.stringify({ url, sessionId: sid }),
      signal: AbortSignal.timeout(CONFIG.TIMEOUT),
    });
    saveCookies(res);
    const json = await res.json().catch(() => null);
    return { res, json };
  };

  let { res, json } = await makeRequest(targetUrl, sessionId);

  // Jika sesi expired di server upstream
  if (!res.ok && json?.code === "SESSION_REQUIRED") {
    sessionId = await ensureSession(true);
    const retry = await makeRequest(targetUrl, sessionId);
    res = retry.res;
    json = retry.json;
  }

  // Jika gagal dan URL berupa shortlink, coba resolve redirect
  if (!res.ok && /vt\.tiktok\.com|vm\.tiktok\.com|youtu\.be|t\.co|bit\.ly|fb\.watch/i.test(targetUrl)) {
    const resolved = await resolveRedirect(targetUrl);
    if (resolved && resolved !== targetUrl) {
      const retryResolved = await makeRequest(resolved, sessionId);
      if (retryResolved.res.ok && retryResolved.json?.success) {
        res = retryResolved.res;
        json = retryResolved.json;
      }
    }
  }

  if (!res.ok || !json?.success) {
    const errMsg = json?.error || `HTTP ${res.status}: Gagal memproses download`;
    const err = new Error(errMsg);
    err.status = res.status;
    err.code = json?.code || "FAILED";
    err.response = json;
    throw err;
  }

  return json.data || {};
}

export default {
  name: "GetDL Downloader",
  description: "Download media video/audio dari berbagai platform (YouTube, CapCut, Pinterest, TikTok, Douyin, Instagram, Facebook, X, dll) via getdl.space",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL post/video yang ingin di-download (YouTube, TikTok, Instagram, CapCut, Facebook, dll)",
      example: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    },
  },

  async run(req, res) {
    const startTime = Date.now();
    const params = { ...req.query, ...req.body };

    try {
      const url = params.url ? String(params.url).trim() : "";
      if (!url) {
        return res.status(400).json({
          status: false,
          code: 400,
          message: "Parameter 'url' wajib diisi",
        });
      }

      let parsedUrl;
      try {
        parsedUrl = new URL(url);
        if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error();
      } catch {
        return res.status(400).json({
          status: false,
          code: 400,
          message: "Parameter 'url' harus berupa URL http/https yang valid",
        });
      }

      const cleanUrl = parsedUrl.toString();
      const platform = detectPlatform(cleanUrl);

      logger.info(`[GETDL] download ${platform} <- ${cleanUrl}`);

      const data = await executeDownload(cleanUrl);

      const downloads = (data.downloads || []).map((item) => ({
        label: item.label || "Download",
        url: item.url || "",
        quality: item.quality || null,
        ext: (item.ext || "mp4").toLowerCase().replace(".", ""),
      }));

      const duration = Date.now() - startTime;
      logger.info(`[GETDL] OK ${platform} title="${data.title || ""}" downloads=${downloads.length} | ${duration}ms`);

      return res.json({
        status: true,
        platform,
        platform_name: PLATFORM_NAMES[platform] || platform,
        type: data.type || "video",
        title: data.title || "",
        thumbnail: data.thumbnail || null,
        author: {
          name: data.author?.name || "Unknown",
          username: data.author?.username || "",
          avatar: data.author?.avatar || null,
        },
        duration: data.duration || null,
        downloads,
        metadata: { processing_time: `${duration}ms` },
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[GETDL] Error: ${error.message}`);

      let customMessage = error.message || "Gagal memproses media dari link ini";
      if (error.code === "RESOLVE_FAILED" || customMessage.includes("Gagal mengambil media")) {
        customMessage = "Upstream getdl.space gagal meresolve media dari link ini (terbatas oleh firewall/WAF platform target). Jika TikTok bermasalah, gunakan endpoint /api/downloader/tiktokv6.";
      }

      return res.status(error.status && error.status >= 400 && error.status < 600 ? error.status : 502).json({
        status: false,
        code: error.code || "UPSTREAM_ERROR",
        message: customMessage,
        metadata: { processing_time: `${duration}ms` },
      });
    }
  },
};