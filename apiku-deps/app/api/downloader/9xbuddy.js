/**
 * PROJECT     : 9xBuddy Media Downloader
 * CREATOR     : BAWORBAWORID
 * DESCRIPTION : Universal media downloader via 9xbuddy.site — support YouTube, TikTok, Instagram, Facebook, Twitter/X, dll
 * BASE_URL    : https://9xbuddy.site
 *
 * GET  /api/downloader/9xbuddy?url=<media-url>
 * POST /api/downloader/9xbuddy -d {"url": "..."}
 */

import axios from "axios";

const SITE = "https://9xbuddy.site";
const SIG_SALT = "jv7g2_DAMNN_DUDE";
const SECRET = "SORRY_MATE_IM_NOT_GONNA_TELL_YOU";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

let _cfg = null; // cached: { apiBase, ua, appVersion, cssHash, fingerprint }

// ===================== CONFIG =====================
async function fetchConfig() {
  const res = await axios.get(SITE, {
    timeout: 30000,
    headers: { "User-Agent": UA, Accept: "text/html" },
    validateStatus: () => true,
  });
  if (res.status !== 200) throw new Error(`HTTP ${res.status} fetching ${SITE}`);
  const html = String(res.data);

  const initM = html.match(/__INIT__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
  const cssM = html.match(/\/build\/(?:assets\/)?main\.([^"]+?)\.css/);
  if (!initM || !cssM) throw new Error("__INIT__ / css hash tidak ditemukan di HTML");

  const pick = (k) => {
    const m = initM[1].match(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`) );
    if (!m) return "";
    try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
  };

  const cfg = {
    apiBase: pick("apiBase"),
    ua: pick("ua"),
    appVersion: pick("appVersion"),
    cssHash: cssM[1],
  };
  if (!cfg.apiBase || !cfg.ua || !cfg.appVersion) throw new Error("config tidak lengkap (apiBase/ua/appVersion)");

  const rev = (s) => s.split("").reverse().join("");
  const key = rev(cfg.cssHash);
  const uaRev10 = rev(cfg.ua).substr(0, 10);
  const c = `xbuddy123sudo-${cfg.appVersion}`;
  const raw = "9xbuddy.site" + key + uaRev10 + SECRET + c + cfg.appVersion;
  cfg.fingerprint = xorEncrypt(raw, key);
  return cfg;
}

// ===================== CIPHER =====================
function ordAt(s, i) {
  const n = s.charCodeAt(i);
  if (n >= 0xd800 && n <= 0xdbff) {
    const r = s.charCodeAt(i + 1);
    if (r >= 0xdc00 && r <= 0xdfff) return (n - 0xd800) * 0x400 + (r - 0xdc00) + 0x10000;
  }
  return n;
}

function encode64(str) {
  if (/([^\u0000-\u00ff])/.test(str)) throw new Error("Can't base64 encode non-ASCII characters.");
  const T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const o = [];
  let n = 0, r, i, a;
  while (n < str.length) {
    r = str.charCodeAt(n);
    a = n % 3;
    if (a === 0) o.push(T.charAt(r >> 2));
    else if (a === 1) o.push(T.charAt(((i & 3) << 4) | (r >> 4)));
    else { o.push(T.charAt(((i & 15) << 2) | (r >> 6))); o.push(T.charAt(r & 63)); }
    i = r; n++;
  }
  if (a === 0) { o.push(T.charAt((i & 3) << 4)); o.push("=="); }
  else if (a === 1) { o.push(T.charAt((i & 15) << 2)); o.push("="); }
  return o.join("");
}

function keyCharAt(key, idx) {
  return key.substr(idx % key.length - 1, 1);
}

function xorEncrypt(plain, key) {
  let out = "";
  for (let r = 0; r < plain.length; r++) {
    out += String.fromCharCode(Math.floor(ordAt(plain, r) + ordAt(keyCharAt(key, r), 0)));
  }
  return encode64(out);
}

function xorDecrypt(b64, key) {
  const raw = Buffer.from(b64, "base64").toString("binary");
  let out = "";
  for (let r = 0; r < raw.length; r++) {
    out += String.fromCharCode(Math.floor(ordAt(raw, r) - ordAt(keyCharAt(key, r), 0)));
  }
  return out;
}

// ===================== DECRYPT MEDIA URL =====================
function decryptUrl(field, token) {
  if (typeof field !== "string" || !field) return field ?? null;
  if (!/^[0-9a-fA-F]+$/.test(field) || field.length % 2 !== 0) return field;
  if (!token) return field;
  try {
    const bin = Buffer.from(field, "hex").toString("binary");
    const reversed = bin.split("").reverse().join("");
    const key = "SORRY_MATE" + "9xbuddy.site".length + _cfg.cssHash + token;
    let url = xorDecrypt(reversed, key);
    if (!/^[\x20-\x7e]+$/.test(url)) return field;
    if (url.startsWith("//")) url = "https:" + url;
    return url;
  } catch {
    return field;
  }
}

// ===================== API =====================
async function apiPost(endpoint, payload, accessToken = null) {
  const headers = {
    "x-auth-token": _cfg.fingerprint,
    "x-requested-domain": "9xbuddy.site",
    "Content-Type": "application/json; charset=UTF-8",
    "X-Requested-With": "xmlhttprequest",
    Origin: SITE,
    Referer: SITE + "/",
    "User-Agent": UA,
  };
  if (accessToken) headers["x-access-token"] = accessToken;
  const res = await axios.post(`${_cfg.apiBase}/${endpoint}`, payload, {
    timeout: 90000,
    headers,
    validateStatus: () => true,
  });
  return { status: res.status, data: res.data };
}

async function extract9xbuddy(pageUrl) {
  if (!_cfg) _cfg = await fetchConfig();

  // 1) access token
  const tok = await apiPost("token", {});
  const accessToken = tok.data?.access_token;
  if (!accessToken) throw new Error(`Token gagal: HTTP ${tok.status}`);

  // 2) extract
  const sig = xorEncrypt(encodeURIComponent(pageUrl), _cfg.fingerprint + SIG_SALT);
  const body = { url: encodeURIComponent(pageUrl), _sig: sig };
  let out = await apiPost("extract", body, accessToken);

  // auto refresh + retry jika 403 / invalid token
  if (out.status === 403 || /invalid.*(token|auth)|BLOCKED/i.test(String(out.data?.message || ""))) {
    _cfg = await fetchConfig();
    const tok2 = await apiPost("token", {});
    const at2 = tok2.data?.access_token;
    if (!at2) throw new Error(`Token retry gagal: HTTP ${tok2.status}`);
    out = await apiPost("extract", {
      url: body.url,
      _sig: xorEncrypt(encodeURIComponent(pageUrl), _cfg.fingerprint + SIG_SALT)
    }, at2);
  }

  const raw = out.data;
  if (!raw || String(raw.status) !== "1" || !raw.response) {
    throw new Error(`Extract gagal: HTTP ${out.status} — ${raw?.message || "unknown error"}`);
  }

  const data = raw.response;
  const token = data.token || "";
  const medias = (data.formats || []).map((m) => ({
    quality: m.quality,
    type: m.type || null,
    ext: m.ext || null,
    size: m.size || null,
    url: decryptUrl(m.url, token),
  }));

  return {
    title: data.title || null,
    thumbnail: data.thumbnail ? (data.thumbnail.startsWith("//") ? "https:" + data.thumbnail : data.thumbnail) : null,
    uploader: data.uploader || null,
    duration: data.duration ?? null,
    type: data.type || null,
    source: "9xbuddy",
    total: medias.length,
    medias,
  };
}

export default {
  name: "9xBuddy Downloader",
  description: "Download media dari 1000+ situs (YouTube, TikTok, Instagram, Facebook, Twitter/X, dll) via 9xbuddy.site",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL media yang ingin didownload",
      example: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    }
  },

  async run(req, res) {
    const { url } = { ...req.query, ...req.body };

    if (!url || typeof url !== "string" || !url.trim()) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'url' wajib diisi"
      });
    }

    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      return res.status(400).json({
        status: false,
        message: "URL tidak valid, harus diawali http:// atau https://"
      });
    }

    try {
      const result = await extract9xbuddy(trimmed);
      return res.json({
        status: true,
        result
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal mengekstrak media dari 9xBuddy"
      });
    }
  }
};
