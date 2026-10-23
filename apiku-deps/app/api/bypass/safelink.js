import { createRequire } from "module";
import axios from "axios";

const require = createRequire(import.meta.url);
const cloudscraper = require("cloudscraper");

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
const BASE = "https://lokerwfh.net";

function randomStr(len) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function parseAds(html) {
  const m = html.match(/const ads = JSON\.parse\('(.+?)'\);/s);
  if (!m) return null;
  const decoded = m[1]
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, "/")
    .replace(/\\\\/g, "\\");
  return JSON.parse(decoded);
}

async function getParams(url) {
  const html = await cloudscraper.get(url);

  const ray_id    = html.match(/name="ray_id"\s+value="([^"]+)"/)?.[1];
  const alias     = html.match(/name="alias"\s+value="([^"]+)"/)?.[1];
  const actionUrl = html.match(/action="([^"]+)"/)?.[1] || `${BASE}/redirect.php`;

  if (!ray_id || !alias) throw new Error("Failed to get ray_id/alias from HTML");

  return { ray_id, alias, actionUrl };
}

async function bypass(url) {
  const { ray_id, alias, actionUrl } = await getParams(url);

  const redir = await axios.get(`${actionUrl}?ray_id=${ray_id}&alias=${alias}`, {
    responseType: "text",
    transformResponse: [d => d],
    validateStatus: () => true,
    maxRedirects: 0,
    headers: { "User-Agent": UA }
  });

  const cookie   = (redir.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");
  const location = redir.headers["location"];
  if (!location) throw new Error("No location from redirect.php");

  const artikelUrl = location.startsWith("http") ? location : `${BASE}${location}`;
  const artikel = await axios.get(artikelUrl, {
    responseType: "text",
    transformResponse: [d => d],
    maxRedirects: 5,
    headers: { "User-Agent": UA, Cookie: cookie, Referer: "https://sfl.gl/" }
  });

  const ads = parseAds(String(artikel.data));
  if (!ads) throw new Error("ads object not found");

  const api = axios.create({
    baseURL: BASE,
    headers: {
      "User-Agent": UA,
      Cookie: cookie,
      Referer: artikelUrl,
      Origin: BASE,
      "Content-Type": "application/json"
    }
  });

  await api.post("/api/session");
  await api.post("/api/verify", { _a: 0, captcha: null, passcode: null });
  await new Promise(r => setTimeout(r, 4000));

  const key  = Math.floor(Math.random() * 1000);
  const size = `${(1366 + key) * 2}.${(768 + key) * 2}`;
  const go   = await api.post(
    "/api/go",
    { key, size, _dvc: "a1b2c3d4" },
    { headers: { "Idempotency-Key": randomStr(32) } }
  );

  const goUrl = go.data?.url;
  if (!goUrl) throw new Error("No url from /api/go");

  const fullUrl = goUrl.startsWith("http") ? goUrl : `${BASE}${goUrl}`;
  const ready = await axios.get(fullUrl, {
    responseType: "text",
    transformResponse: [d => d],
    maxRedirects: 5,
    headers: { "User-Agent": UA, Cookie: cookie }
  });

  const m = String(ready.data).match(/window\.location\.href\s*=\s*["']([^"']+)["']/);
  if (!m) throw new Error("Final URL not found in ready/go");

  return m[1].replace(/\\\//g, "/");
}

export default {
  name: "Bypass Safelinku",
  description: "Bypass shortlink sfl.gl / safelinku dan dapatkan URL tujuan aslinya.",
  category: "Bypass",
  methods: ["GET", "POST"],
  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL sfl.gl / safelinku yang ingin di-bypass",
      example: "https://sfl.gl/xxxxxx",
      default: "https://sfl.gl/xxxxxx"
    }
  },

  async run(req, res) {
    const { url } = { ...req.query, ...req.body };

    if (!url || typeof url !== "string" || !url.trim()) {
      return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" });
    }

    try { new URL(url); } catch {
      return res.status(400).json({ status: false, message: "Format URL tidak valid" });
    }

    const start = Date.now();

    try {
      const result = await bypass(url.trim());
      return res.json({
        status: true,
        result: {
          originalUrl: url.trim(),
          bypassedUrl: result,
          responseTime: `${Date.now() - start}ms`
        }
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal bypass safelinku",
        result: { responseTime: `${Date.now() - start}ms` }
      });
    }
  }
};
