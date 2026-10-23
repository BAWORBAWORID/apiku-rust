/**
 * Terabox Downloader — langsung dari dm.terabox.app (share/list API)
 * Flow:
 *  1. GET https://dm.terabox.app/sharing/link?surl=<surl> -> extract jsToken (regex fn%28%22(...)%22%29)
 *  2. GET https://dm.terabox.app/share/list?app_id=250528&jsToken=...&shorturl=...&root=1
 *  3. Parse list file (metadata + thumbnail)
 *
 * GET  /api/downloader/terabox?url=https://terabox.app/s/1HSEb8PZRUE7Z1Tvd3ZtT0g
 * POST /api/downloader/terabox  (JSON: { url })
 * Supports: https://terabox.app/s/xxx, https://terabox.app/wap/share/filelist?surl=xxx
 */

import fs from "fs";

const COOKIE = "ndus=YuLuQdPpeHuiMGEQDXpWDu6K2P4-xInj8YGEzswD";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36";
const COOKIE_FILE = new URL("../../data/terabox-cookie.json", import.meta.url).pathname;

function loadCookie() {
  if (fs.existsSync(COOKIE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf8"));
      if (data?.ndus) return `ndus=${data.ndus}`;
    } catch {}
  }
  return COOKIE;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function cleanFiles(list) {
  return (list || [])
    .filter((f) => f.isdir !== "1")
    .map((f) => ({
      name: f.server_filename || null,
      size: f.size ? Number(f.size) : null,
      size_formatted: f.size ? formatBytes(Number(f.size)) : null,
      md5: f.md5 || null,
      path: f.path || null,
      width: f.width || null,
      height: f.height || null,
      duration: f.duration ? Number(f.duration) : null,
      thumbnails: f.thumbs
        ? {
            small: f.thumbs.url1 || null,
            medium: f.thumbs.url2 || null,
            large: f.thumbs.url3 || null,
            icon: f.thumbs.icon || null,
          }
        : null,
    }));
}

function extractSurl(url) {
  const str = String(url).trim();
  // Try /s/ format first
  const sMatch = str.split("/s/")[1]?.split(/[?#]/)[0];
  if (sMatch) return sMatch;
  // Try ?surl= query parameter
  const surlMatch = str.match(/[?&]surl=([^&]+)/);
  if (surlMatch) return surlMatch[1];
  // Fallback: use whole string
  return str;
}

async function getShareList(url) {
  const surl = extractSurl(url);
  const short_url = surl.startsWith("1") ? surl.slice(1) : surl;
  const cookie = loadCookie();

  const first = await fetch(`https://dm.terabox.app/sharing/link?surl=${surl}`, {
    headers: { "User-Agent": UA, Cookie: cookie },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  const html = await first.text();

  const match = html.match(/fn%28%22(.*?)%22%29/);
  if (!match) {
    throw new Error("jsToken tidak ditemukan — link tidak valid atau cookie expired");
  }
  const jsToken = match[1];

  const params = new URLSearchParams({
    app_id: "250528",
    jsToken,
    site_referer: "https://www.terabox.app/",
    shorturl: short_url,
    root: "1",
  });

  const api = await fetch(`https://dm.terabox.app/share/list?${params.toString()}`, {
    headers: {
      Host: "dm.terabox.app",
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://www.terabox.com/",
      Cookie: cookie,
      Connection: "keep-alive",
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!api.ok) throw new Error(`Terabox API error: ${api.status}`);
  const json = await api.json();
  if (json.errno !== 0) throw new Error(`Terabox API error errno=${json.errno} (${json.errmsg || "unknown"})`);

  const files = json.list || [];
  const dirs = files.filter(f => f.isdir === "1");
  const clean = cleanFiles(files);

  return {
    surl,
    short_url,
    jsToken,
    uk: json.uk || null,
    shareid: json.shareid || null,
    total: files.length,
    dirs: dirs.length,
    files: clean.length,
    list: clean,
  };
}

export default {
  name: "Terabox Downloader",
  description: "Download file dari Terabox (via share/list API)",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: { type: "string", required: true, description: "Terabox share URL", example: "https://terabox.app/s/1HSEb8PZRUE7Z1Tvd3ZtT0g" }
  },
  async run(req, res) {
    const { url } = { ...req.query, ...req.body };

    if (!url || !String(url).includes("terabox")) {
      return res.status(400).json({ status: false, error: "URL Terabox tidak valid" });
    }

    try {
      const result = await getShareList(url);
      return res.json({
        status: true,
        input: url,
        ...result,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      return res.status(500).json({ status: false, message: e.message, timestamp: new Date().toISOString() });
    }
  }
};
