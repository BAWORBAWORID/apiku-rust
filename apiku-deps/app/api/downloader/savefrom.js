/**
 * SaveFrom Downloader — engine ringan (no Puppeteer)
 * Backend : savefrom.co.id → api-wh.savefrom.co.id/api/convert
 * Flow    : signature diambil dari js/link.chunk.js (sha256(sf_url+ts+SECRET)),
 *           SECRET diekstrak runtime via decoder chunk-nya sendiri (node:vm).
 * Support : TikTok, YouTube, Facebook, Instagram, dst (multi-platform).
 * Params  : url (wajib), type (vidio/audio, wajib)
 */
import vm from "node:vm";
import crypto from "node:crypto";
import logger from "../../src/utils/logger.js";

const API = "https://api-wh.savefrom.co.id/api/convert";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Fallback constants (terverifikasi aktif)
const FALLBACK_SECRET = "f798d44177a88668ccff03b58ff945f002bc6ae2eea4901ba9596e3be5367706";
const FALLBACK_TS_CONST = 1791197287300;

let cachedConfig = {
  secret: FALLBACK_SECRET,
  tsConst: FALLBACK_TS_CONST,
  lastUpdated: Date.now()
};

function parseChunk(chunkJs) {
  // 1. String array function
  const arrMatch = chunkJs.match(/function\s+(a0_0x[0-9a-f]+)\(\)\{var\s+(_0x[0-9a-f]+)=\[.*?\];\1=function\(\)\{return\s+\2;\};return\s+\1\(\);\}/);
  if (!arrMatch) throw new Error("Array function not found in chunk");
  const arrFn = arrMatch[1];
  const arrCode = arrMatch[0];

  // 2. Rotation
  const rotMatch = chunkJs.match(new RegExp(`\\(\\s*function\\s*\\(_0x[0-9a-f]+,\\s*_0x[0-9a-f]+\\)\\s*\\{[\\s\\S]*?\\}\\s*\\(\\s*${arrFn},\\s*[^\\)]+\\)\\s*\\);`));
  if (!rotMatch) throw new Error("Rotation not found in chunk");
  const rotCode = rotMatch[0];

  // 3. Decoder function
  const decMatch = chunkJs.match(/function\s+(a0_0x[0-9a-f]+)\(_0x[0-9a-f]+,\s*_0x[0-9a-f]+\)\{[\s\S]*?\}\s*,\s*\1\(_0x[0-9a-f]+,\s*_0x[0-9a-f]+\);?\}/);
  if (!decMatch) throw new Error("Decoder function not found in chunk");
  const decFn = decMatch[1];
  const decCode = decMatch[0];

  // 4. Secret & TS calculation
  const idxDate = chunkJs.indexOf("Date['now']()");
  if (idxDate === -1) throw new Error("Date['now'] marker not found in chunk");
  const idxSec = chunkJs.lastIndexOf("var _0x", idxDate);
  if (idxSec === -1) throw new Error("Secret declaration marker not found");

  const rawSnippet = chunkJs.slice(idxSec, idxDate);
  const parts = rawSnippet.split(",_0x");
  const tsExpr = parts[0].replace(/^var\s+_0x[0-9a-f]+=\s*/, "").trim();
  const secRaw = parts[1].replace(/^[0-9a-f]+=\s*/, "").trim();
  const secExpr = secRaw.replace(/_0x[0-9a-f]+\(/g, `${decFn}(`);

  const codeToRun = `
    ${arrCode}
    ${rotCode}
    ${decCode}
    var _ts_val = ${tsExpr};
    var _sec_val = (${secExpr});
  `;

  const ctx = { Date, Math, String, parseInt, RegExp, Array, decodeURIComponent };
  vm.createContext(ctx);
  vm.runInContext(codeToRun, ctx, { timeout: 5000 });

  return {
    tsConst: ctx._ts_val || FALLBACK_TS_CONST,
    secret: ctx._sec_val || FALLBACK_SECRET
  };
}

async function refreshConfig() {
  try {
    const homeHtml = await (await fetch("https://savefrom.co.id/", { headers: { "User-Agent": UA } })).text();
    const appPathMatch = homeHtml.match(/src="(\/js\/app\.js\?id=[0-9a-f]+)"/i);
    const appUrl = appPathMatch ? `https://savefrom.co.id${appPathMatch[1]}` : "https://savefrom.co.id/js/app.js";

    const appJs = await (await fetch(appUrl, { headers: { "User-Agent": UA } })).text();
    const chunkHashMatch = appJs.match(/\{54:"link\.chunk"[^}]*\.js\?ch="\+\{54:"([0-9a-f]+)"/i) 
      || appJs.match(/\{54:"([0-9a-f]+)"/i);
    if (!chunkHashMatch) throw new Error("Chunk hash not found in app.js");

    const chunkUrl = `https://savefrom.co.id/js/link.chunk.js?ch=${chunkHashMatch[1]}.js`;
    const chunkJs = await (await fetch(chunkUrl, { headers: { "User-Agent": UA } })).text();

    const parsed = parseChunk(chunkJs);
    if (parsed.secret) {
      cachedConfig = {
        secret: parsed.secret,
        tsConst: parsed.tsConst,
        lastUpdated: Date.now()
      };
      logger.info(`[SAVEFROM] Successfully updated secret: ${parsed.secret.slice(0, 10)}...`);
      return cachedConfig;
    }
  } catch (err) {
    logger.warn(`[SAVEFROM] Dynamic config refresh failed: ${err.message}. Using fallback constants.`);
  }

  return cachedConfig;
}

async function getConfig(forceRefresh = false) {
  if (forceRefresh || !cachedConfig.secret) {
    return await refreshConfig();
  }
  return cachedConfig;
}

async function savefromScrape(targetUrl, retryWithRefresh = true) {
  const config = await getConfig();
  const ts = Date.now();
  const sig = crypto.createHash("sha256").update(`${targetUrl}${ts}${config.secret}`).digest("hex");
  const body = new URLSearchParams({
    sf_url: targetUrl,
    ts: String(ts),
    _ts: String(config.tsConst),
    _tsc: "0",
    _s: sig,
  });

  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
      Origin: "https://savefrom.co.id",
      Referer: "https://savefrom.co.id/",
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/plain, */*",
    },
    body: body.toString(),
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error("Respons upstream bukan JSON"); }

  if (json.code && String(json.code).includes("invalid_request")) {
    if (retryWithRefresh) {
      logger.warn("[SAVEFROM] Signature rejected, refreshing chunk secret and retrying...");
      await refreshConfig();
      return await savefromScrape(targetUrl, false);
    }
    throw new Error("Signature ditolak upstream");
  }

  if (json.success === false || json.message) {
    throw new Error(json.message || "Upstream error");
  }

  if (!json.url || !json.url.length) {
    throw new Error("Tidak ada media ditemukan untuk URL ini");
  }

  return (json.url || []).map((u) => {
    const format = (u.type || u.ext || "unknown").toLowerCase();
    const isAudio = ["mp3", "aac", "wav", "ogg", "m4a"].includes(format);
    return {
      quality: u.subname || (isAudio ? "audio" : format),
      format,
      type: isAudio ? "audio" : "video",
      url: u.url,
      is_audio: isAudio,
    };
  });
}

export default {
  name: "SaveFrom Downloader",
  description: "Download media from TikTok, YouTube, FB, IG, etc (fast, no browser)",
  category: "Downloader",
  methods: ["GET", "POST"],

  params: ["url", "type"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "Media URL (TikTok, YouTube, FB, IG, etc)",
      default: "https://vt.tiktok.com/ZSbm6fY8P/",
      example: "https://vt.tiktok.com/ZSbm6fY8P/"
    },
    type: {
      type: "string",
      required: true,
      enum: ["vidio", "audio"],
      description: "Tipe hasil unduhan (vidio atau audio)"
    }
  },

  async run(req, res) {
    const startTime = Date.now();

    try {
      let url, type;
      if (req.method === "GET") {
        url = req.query.url;
        type = req.query.type;
      } else {
        url = req.body?.url;
        type = req.body?.type;
      }

      if (!url || typeof url !== "string") {
        return res.status(400).json({ status: false, message: "Parameter 'url' is required" });
      }
      if (!type || typeof type !== "string") {
        return res.status(400).json({ status: false, message: "Parameter 'type' is required" });
      }

      const allMedia = await savefromScrape(url);
      const isAudioReq = type.toLowerCase() === "audio";
      const filtered = allMedia.filter((m) => m.is_audio === isAudioReq);
      const finalMedia = filtered.length > 0 ? filtered : allMedia;

      const duration = `${Date.now() - startTime}ms`;

      return res.status(200).json({
        status: true,
        message: "Media berhasil diambil",
        source: url,
        requested_type: type,
        total: finalMedia.length,
        media: finalMedia,
        duration,
      });
    } catch (error) {
      logger.error(`[SAVEFROM API] Error: ${error.message}`);
      return res.status(500).json({
        status: false,
        message: error.message,
        duration: `${Date.now() - startTime}ms`,
      });
    }
  },
};
