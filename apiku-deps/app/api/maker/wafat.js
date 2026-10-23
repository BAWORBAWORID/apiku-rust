/**
 * FAKE WAFAT (Death Certificate) CANVAS
 * 
 * Generate sertifikat wafat palsu dengan foto bulat, nama, dan range tahun.
 * Pattern mengikuti api/maker/fake-wa.js: @napi-rs/canvas + GlobalFonts
 * dengan font lokal di api/maker/assets/wafat/WafatFont.ttf.
 *
 * @route {GET|POST} /api/maker/wafat
 *
 * @param {string} fotourl - URL foto orang (akan di-crop jadi lingkaran)
 * @param {string} nama    - Nama orang yang wafat
 * @param {string} lahir   - Tahun lahir (4 digit, misal 1995)
 * @param {string} wafat   - Tahun wafat (4 digit, misal 2026)
 *
 * @example
 * GET /api/maker/wafat?fotourl=https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg&nama=Cukii%20Dijilat&lahir=1995&wafat=2026
 * POST /api/maker/wafat -d {"fotourl":"...","nama":"...","lahir":"1995","wafat":"2026"}
 *
 * Category: Maker
 */

import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../../src/utils/logger.js";

// ==================== ASSET PATHS (offline-first, per-endpoint) ====================
// Template + font cached locally at api/maker/assets/wafat/. Migration removed
// the upstream fetch path (`uploader.zenzxz.dpdns.org`) so the endpoint is
// resilient if that host goes down.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.join(__dirname, "assets", "wafat");
const FONT_PATH = path.join(ASSETS_DIR, "WafatFont.ttf");
const TEMPLATE_PATH = path.join(ASSETS_DIR, "template.jpeg");
const FONT_FAMILY = "WafatFont";
// Network fallback URL for loadTemplateBuffer() — used only when the local
// template is missing/broken so the endpoint stays self-healing.
const TEMPLATE_URL = "https://uploader.zenzxz.dpdns.org/uploads/1776848882042.jpeg";

// ==================== TEMPLATE PATH (moved up) ====================
// See top-of-file PATHS section. The old FONT_DIR / FONT_DOWNLOAD_URL / inline
// TEMPLATE_URL constants have been replaced: assets are now files on disk next
// to this endpoint (api/maker/assets/wafat/).

// ==================== VALIDATION LIMITS ====================
const MAX_URL_LENGTH = 2048;
const MAX_NAMA_LENGTH = 100;
const FETCH_TIMEOUT_MS = 15000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB cap (anti-OOM)

// SSRF blocklist: tolak host loopback / cloud metadata / RFC1918 private / IPv6-mapped IPv4
const BLOCKED_HOST_RE = /^(localhost|127\.|::1|::ffff:0?0?0?0?:|::ffff:10\.|::ffff:127\.|::ffff:169\.254\.|::ffff:172\.(1[6-9]|2\d|3[01])\.|::ffff:192\.168\.|0\.0\.0\.0|169\.254\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fc[0-9a-f]{2}:|fe80:)/i;

// Magic bytes untuk image formats yang didukung @napi-rs/canvas
const IMAGE_SIGNATURES = [
  { ext: "png", sig: [0x89, 0x50, 0x4e, 0x47] },
  { ext: "jpg", sig: [0xff, 0xd8, 0xff] },
  { ext: "gif", sig: [0x47, 0x49, 0x46] },
  { ext: "webp", sig: [0x52, 0x49, 0x46, 0x46] } // RIFF header
];
function looksLikeImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return false;
  return IMAGE_SIGNATURES.some((s) =>
    s.sig.every((b, i) => buf[i] === b)
  );
}

// ==================== FONT INIT (offline-first) ====================

/**
 * Hard fail kalau font belum ada secara lokal. Font sudah di-migrate ke
 * api/maker/assets/wafat/WafatFont.ttf, jadi ini seharusnya selalu ada di runtime.
 */
function ensureFontRegistered() {
  if (!fs.existsSync(FONT_PATH)) {
    throw new Error(
      `Font missing: ${FONT_PATH}. Place WafatFont.ttf in api/maker/assets/wafat/.`
    );
  }
  // Register (idempotent — double register aman di @napi-rs/canvas)
  try {
    GlobalFonts.registerFromPath(FONT_PATH, FONT_FAMILY);
  } catch (e) {
    logger.warn(`[FakeWafat] Font register error (non-fatal): ${e.message}`);
  }
}

// Best-effort bootstrap register saat module-load kalau font sudah ada
try {
  if (fs.existsSync(FONT_PATH)) {
    GlobalFonts.registerFromPath(FONT_PATH, FONT_FAMILY);
  }
} catch (e) {
  // Defer ke runtime
}

// ==================== HELPERS ====================

function ensurePublicHost(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("URL tidak valid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Protocol harus http atau https");
  }
  if (BLOCKED_HOST_RE.test(parsed.hostname)) {
    throw new Error(`Host '${parsed.hostname}' diblokir (loopback/private)`);
  }
  return parsed;
}

async function fetchBuffer(url) {
  const parsed = ensurePublicHost(url);
  const res = await fetch(parsed.toString(), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "manual" // anti-SSRF via public domain → internal redirect
  });
  if (res.status >= 300 && res.status < 400) {
    throw new Error("Redirect tidak diizinkan (kemungkinan indikasi SSRF)");
  }
  if (!res.ok) {
    throw new Error(`Fetch failed: HTTP ${res.status} ${res.statusText}`);
  }
  // Content-Length preflight (jika server mengirim header)
  const declaredLen = Number(res.headers.get("content-length") || 0);
  if (declaredLen > MAX_IMAGE_BYTES) {
    throw new Error(
      `Resource terlalu besar (${declaredLen} bytes > ${MAX_IMAGE_BYTES} bytes)`
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error(
      `Resource terlalu besar setelah fetch (${buf.length} bytes > ${MAX_IMAGE_BYTES} bytes)`
    );
  }
  return buf;
}

/**
 * Gambar image di-clipped ke lingkaran (untuk foto wafat).
 */
function drawCircleImage(ctx, img, cx, cy, size) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  ctx.restore();
}

/**
 * Load template image with local-first priority.
 * Reads from TEMPLATE_PATH on disk if available + valid (magic-byte check);
 * otherwise fetches TEMPLATE_URL via the SSRF-guarded fetchBuffer, and opportunistically
 * caches the response so future calls survive upstream / URL expiry.
 */
async function loadTemplateBuffer() {
  if (fs.existsSync(TEMPLATE_PATH)) {
    try {
      const buf = await fs.promises.readFile(TEMPLATE_PATH);
      if (looksLikeImage(buf)) {
        logger.info(`[FakeWafat] Template loaded from local cache: ${TEMPLATE_PATH}`);
        return buf;
      }
      logger.warn(`[FakeWafat] Local template has invalid magic bytes — falling back to network`);
    } catch (e) {
      logger.warn(`[FakeWafat] Local template read failed: ${e.message} — falling back to network`);
    }
  }
  logger.info(`[FakeWafat] Local template missing — fetching ${TEMPLATE_URL}`);
  const buf = await fetchBuffer(TEMPLATE_URL);
  // Opportunistic cache: write fetched bytes back to TEMPLATE_PATH for next run
  try {
    fs.mkdirSync(path.dirname(TEMPLATE_PATH), { recursive: true });
    await fs.promises.writeFile(TEMPLATE_PATH, buf);
    logger.info(`[FakeWafat] Cached fetched template to ${TEMPLATE_PATH}`);
  } catch (e) {
    logger.warn(`[FakeWafat] Could not cache template locally: ${e.message}`);
  }
  return buf;
}

// ==================== CORE GENERATION ====================

async function generateWafat({ fotourl, nama, lahir, wafat }) {
  ensureFontRegistered();

  // Template: local-first + remote-fallback (offline-resilient, opportunistic cache by loadTemplateBuffer)
  const bgBuffer = await loadTemplateBuffer();
  const bg = await loadImage(bgBuffer);

  // fotourl masih user-supplied → wajib SSRF guard + magic byte validation
  const personBuffer = await fetchBuffer(fotourl);
  if (!looksLikeImage(personBuffer)) {
    throw new Error(
      "fotourl tidak mengembalikan gambar valid (PNG/JPG/GIF/WebP diperlukan)"
    );
  }

  const person = await loadImage(personBuffer);

  const canvas = createCanvas(bg.width, bg.height);
  const ctx = canvas.getContext("2d");

  ctx.drawImage(bg, 0, 0, bg.width, bg.height);

  const centerX = bg.width / 2;
  const fotoSize = 575;
  drawCircleImage(ctx, person, centerX, 1210, fotoSize);

  ctx.fillStyle = "#462F29";
  ctx.textAlign = "center";

  // Nama (center, font 60px WafatFont, y=1740)
  ctx.font = `60px "${FONT_FAMILY}"`;
  ctx.fillText(nama, centerX, 1740);

  // Range tahun (midpoint 1800-1830, font 40px WafatFont)
  const rangeTahun = `${lahir} - ${wafat}`;
  ctx.font = `40px "${FONT_FAMILY}"`;
  ctx.fillText(rangeTahun, centerX, (1800 + 1830) / 2);

  // @napi-rs/canvas menerima format name saja (tanpa "image/" prefix)
  return await canvas.encode("png");
}

// ==================== API HANDLER ====================

export default {
  name: "Fake Wafat",
  description:
    "Generate fake death certificate image dengan foto, nama, dan tahun lahir/wafat",
  category: "Maker",
  methods: ["GET"],

  params: ["fotourl", "nama", "lahir", "wafat"],

  paramsSchema: {
    fotourl: {
      type: "string",
      required: true,
      description: "URL foto orang (akan di-crop jadi lingkaran)",
      example:
        "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
      maxLength: MAX_URL_LENGTH
    },
    nama: {
      type: "string",
      required: true,
      description: "Nama orang yang wafat",
      example: "Cukii Dijilat",
      minLength: 1,
      maxLength: MAX_NAMA_LENGTH
    },
    lahir: {
      type: "string",
      required: true,
      description: "Tahun lahir (4 digit)",
      example: "1995",
      minLength: 4,
      maxLength: 4
    },
    wafat: {
      type: "string",
      required: true,
      description: "Tahun wafat (4 digit)",
      example: "2026",
      minLength: 4,
      maxLength: 4
    }
  },

  async run(req, res) {
    const startTime = Date.now();

    try {
      // ========== 1. EXTRACT & VALIDATE ==========
      const params = { ...req.query, ...req.body };
      const fotourl =
        typeof params.fotourl === "string" ? params.fotourl.trim() : "";
      const nama =
        typeof params.nama === "string" ? params.nama.trim() : "";
      const lahir =
        typeof params.lahir === "string" ? params.lahir.trim() : "";
      const wafat =
        typeof params.wafat === "string" ? params.wafat.trim() : "";

      // Validasi presence
      if (!fotourl) {
        return res
          .status(400)
          .json({ status: false, message: "Parameter 'fotourl' wajib diisi" });
      }
      if (fotourl.length > MAX_URL_LENGTH) {
        return res.status(400).json({
          status: false,
          message: `Parameter 'fotourl' melebihi panjang maksimum (${MAX_URL_LENGTH} karakter)`
        });
      }
      if (!/^https?:\/\//i.test(fotourl)) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'fotourl' harus berupa URL valid (http/https)"
        });
      }

      // SSRF guard: tolak host internal/loopback/cloud-metadata
      try {
        ensurePublicHost(fotourl);
      } catch (ssrfErr) {
        return res.status(400).json({
          status: false,
          message: `fotourl tidak diizinkan: ${ssrfErr.message}`
        });
      }
      if (!nama || nama.length < 1) {
        return res
          .status(400)
          .json({ status: false, message: "Parameter 'nama' wajib diisi" });
      }
      if (nama.length > MAX_NAMA_LENGTH) {
        return res.status(400).json({
          status: false,
          message: `Parameter 'nama' melebihi panjang maksimum (${MAX_NAMA_LENGTH} karakter)`
        });
      }
      if (!/^\d{4}$/.test(lahir)) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'lahir' harus tahun 4-digit, contoh: 1995"
        });
      }
      if (!/^\d{4}$/.test(wafat)) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'wafat' harus tahun 4-digit, contoh: 2026"
        });
      }
      if (parseInt(wafat, 10) < parseInt(lahir, 10)) {
        return res.status(400).json({
          status: false,
          message: "Tahun 'wafat' tidak boleh lebih kecil dari tahun 'lahir'"
        });
      }

      // ========== 2. LOG ==========
      logger.info(
        `[FakeWafat] Generating certificate | ip=${req.ip} | name="${nama}" | range=${lahir}-${wafat}`
      );

      // ========== 3. GENERATE ==========
      const buffer = await generateWafat({ fotourl, nama, lahir, wafat });

      // ========== 4. RESPOND ==========
      const duration = Date.now() - startTime;
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("X-Generated-In", `${duration}ms`);
      res.setHeader("X-Wafat-Name", nama);
      res.setHeader("X-Wafat-Range", `${lahir}-${wafat}`);
      res.setHeader("X-Wafat-Template", TEMPLATE_PATH);

      return res.send(buffer);
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[FakeWafat] Error after ${duration}ms: ${err.message}`);

      if (res.headersSent) {
        return res.end();
      }

      // Classify upstream-derived errors ke HTTP status code yang sesuai
      let status = 500;
      const msg = err.message || "";
      if (
        msg.includes("diblokir") ||
        msg.includes("URL tidak valid") ||
        msg.includes("Protocol harus")
      ) {
        status = 400; // SSRF / param invalid
      } else if (
        msg.includes("tidak mengembalikan gambar valid") ||
        msg.includes("magic bytes")
      ) {
        status = 422; // fotourl upstream responded tapi format unprocessable
      } else if (msg.includes("Template missing") || msg.includes("Font missing")) {
        status = 500; // operator misconfiguration (lokal asset hilang)
      } else if (
        msg.includes("Fetch failed") ||
        msg.includes("timeout") ||
        msg.includes("Redirect") ||
        msg.includes("Resource terlalu besar")
      ) {
        status = 502; // bad gateway — upstream fetch issue
      }

      return res.status(status).json({
        status: false,
        message: err.message || "Failed to generate fake wafat image"
      });
    }
  }
};
