import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import logger from "../../src/utils/logger.js";
import { uploadToCloudStorage } from "../../src/utils/cloudStorage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXPIRY_DB = path.join(process.cwd(), "data", "uploaderv3.json");
const activeTimers = new Map();

if (!fs.existsSync(path.dirname(EXPIRY_DB))) fs.mkdirSync(path.dirname(EXPIRY_DB), { recursive: true });
if (!fs.existsSync(EXPIRY_DB)) fs.writeFileSync(EXPIRY_DB, "[]");

const CDN_LIST = [
  {
    name: "cloudstorage",
    upload: async (buffer, filename) => {
      return await uploadToCloudStorage(buffer, filename);
    }
  },
  {
    name: "poners",
    upload: async (buffer, filename) => {
      const { fileTypeFromBuffer } = await import("file-type");
      const type = await fileTypeFromBuffer(buffer);
      const mime = type?.mime || "application/octet-stream";
      const blob = new Blob([buffer], { type: mime });
      const form = new FormData();
      form.append("files[]", blob, filename);
      const res = await fetch("https://pone.rs/upload", {
        method: "POST",
        body: form,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        },
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw new Error(`poners HTTP ${res.status}`);
      const json = await res.json();
      const url = json?.files?.[0]?.url;
      if (!url) throw new Error("poners: no url in response");
      return url;
    }
  },
  {
    name: "nekohime",
    upload: async (buffer, filename) => {
      const { fileTypeFromBuffer } = await import("file-type");
      const type = await fileTypeFromBuffer(buffer);
      const ext = type?.ext || "jpg";
      const blob = new Blob([buffer], { type: type?.mime || "image/jpeg" });
      const form = new FormData();
      form.append("file", blob, `${filename}.${ext}`);
      const res = await fetch("https://cdn.nekohime.site/upload", {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw new Error(`nekohime HTTP ${res.status}`);
      const json = await res.json();
      const url = json.files?.[0]?.url || json.data?.url || json.url;
      if (!url) throw new Error("nekohime: no url in response");
      return url;
    }
  },
  {
    name: "phototourl",
    upload: async (buffer, filename) => {
      const { fileTypeFromBuffer } = await import("file-type");
      const type = await fileTypeFromBuffer(buffer);
      const mime = type?.mime || "image/jpeg";
      // PhotoToURL (phototourl.com) only accepts images: png/jpeg/webp/gif
      if (!mime.startsWith("image/")) throw new Error("phototourl: only image files supported");
      const ext = type?.ext || "jpg";
      const blob = new Blob([buffer], { type: mime });
      const form = new FormData();
      form.append("file", blob, `${filename}.${ext}`);
      const res = await fetch("https://phototourl.com/api/upload", {
        method: "POST",
        body: form,
        headers: {
          Accept: "application/json",
          Origin: "https://phototourl.com",
          Referer: "https://phototourl.com/"
        },
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw new Error(`phototourl HTTP ${res.status}`);
      const json = await res.json();
      const url = json?.url || json?.data?.url;
      if (!url) throw new Error("phototourl: no url in response");
      return url;
    }
  },
  {
    name: "zasscdn",
    upload: async (buffer, filename) => {
      const { fileTypeFromBuffer } = await import("file-type");
      const type = await fileTypeFromBuffer(buffer);
      const ext = type?.ext || "jpg";
      const blob = new Blob([buffer], { type: type?.mime || "image/jpeg" });
      const form = new FormData();
      form.append("file", blob, `${filename}.${ext}`);
      const res = await fetch("https://cdn.zass.in/upload", {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw new Error(`zasscdn HTTP ${res.status}`);
      const json = await res.json();
      if (!json.success || !json.url) throw new Error("zasscdn: upload failed");
      return json.url;
    }
  },
  {
    name: "aceimg",
    upload: async (buffer, filename) => {
      const { fileTypeFromBuffer } = await import("file-type");
      const type = await fileTypeFromBuffer(buffer);
      const mime = type?.mime || (buffer[0] === 0x89 && buffer[1] === 0x50 ? "image/png" : "image/jpeg");
      const ext = type?.ext || path.extname(filename).replace(".", "") || "jpg";
      const blob = new Blob([buffer], { type: mime });
      const form = new FormData();
      form.append("file", blob, `${filename}`);
      const visitorId = crypto.randomUUID();
      const res = await fetch(`https://api.aceimg.com/api/upload?visitorId=${encodeURIComponent(visitorId)}`, {
        method: "POST",
        body: form,
        headers: { Origin: "https://aceimg.com", Referer: "https://aceimg.com/" },
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw new Error(`aceimg HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.status || !json?.link) throw new Error(json?.error || "aceimg: upload failed");
      const f = new URL(json.link).searchParams.get("f");
      if (!f) throw new Error("aceimg: no f param");
      return `https://cdn.aceimg.com/${f}`;
    }
  },
  {
    name: "zippyshare",
    upload: async (buffer, filename) => {
      const { default: mime } = await import("mime-types");
      const mimeType = mime.lookup(filename) || "application/octet-stream";
      const homeRes = await fetch("https://zippyshare.day/", {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        signal: AbortSignal.timeout(20000)
      });
      if (!homeRes.ok) throw new Error(`zippyshare home HTTP ${homeRes.status}`);
      const html = await homeRes.text();
      const rawCookies = homeRes.headers.getSetCookie ? homeRes.headers.getSetCookie() : [homeRes.headers.get("set-cookie")].filter(Boolean);
      const cookies = rawCookies.map(c => c.split(";")[0]).join("; ");
      const csrf = (html.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i) || [])[1];
      if (!csrf) throw new Error("zippyshare: no csrf token");

      const presignRes = await fetch("https://zippyshare.day/upload/presign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-TOKEN": csrf,
          "X-Requested-With": "XMLHttpRequest",
          "Referer": "https://zippyshare.day/",
          "Cookie": cookies,
          "User-Agent": "Mozilla/5.0"
        },
        body: JSON.stringify({ filename, size: buffer.length, mime: mimeType, password: "", upload_auto_delete: 0, folder_id: null }),
        signal: AbortSignal.timeout(30000)
      });
      if (!presignRes.ok) throw new Error(`zippyshare presign HTTP ${presignRes.status}`);
      const presignData = await presignRes.json();
      if (!presignData?.presigned_url) throw new Error("zippyshare: no presigned_url");

      const r2Res = await fetch(presignData.presigned_url, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: buffer,
        signal: AbortSignal.timeout(60000)
      });
      if (!r2Res.ok && r2Res.status !== 200 && r2Res.status !== 204) throw new Error(`zippyshare R2 HTTP ${r2Res.status}`);

      const compRes = await fetch("https://zippyshare.day/upload/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-TOKEN": csrf,
          "X-Requested-With": "XMLHttpRequest",
          "Referer": "https://zippyshare.day/",
          "Cookie": cookies,
          "User-Agent": "Mozilla/5.0"
        },
        body: JSON.stringify({ token: presignData.token, mime: mimeType }),
        signal: AbortSignal.timeout(30000)
      });
      if (!compRes.ok) throw new Error(`zippyshare complete HTTP ${compRes.status}`);
      const compData = await compRes.json();
      if (!compData?.download_link) throw new Error("zippyshare: no download_link");

      // Dapatkan direct CDN download URL
      const downloadId = compData.download_link.split("/")[3];
      const dlRes = await fetch(`https://zippyshare.day/${downloadId}/download/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-TOKEN": csrf,
          "X-Requested-With": "XMLHttpRequest",
          "Referer": compData.download_link,
          "Cookie": cookies,
          "User-Agent": "Mozilla/5.0"
        },
        signal: AbortSignal.timeout(20000)
      });
      if (dlRes.ok) {
        const dlData = await dlRes.json();
        if (dlData?.download_link) {
          const headRes = await fetch(dlData.download_link, {
            method: "HEAD",
            redirect: "manual",
            headers: { "User-Agent": "Mozilla/5.0", "Referer": compData.download_link, "Cookie": cookies },
            signal: AbortSignal.timeout(15000)
          });
          if (headRes.status >= 300 && headRes.status < 400 && headRes.headers.get("location")) {
            return headRes.headers.get("location");
          }
          return dlData.download_link;
        }
      }

      return compData.download_link;
    }
  },
];

function readDb() {
  try {
    const raw = fs.readFileSync(EXPIRY_DB, "utf-8").trim();
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function writeDb(entries) {
  try {
    fs.writeFileSync(EXPIRY_DB, JSON.stringify(entries, null, 2));
  } catch (e) {
    logger.error(`[UPLOADV3] Failed to write db: ${e.message}`);
  }
}

function generateId() {
  return crypto.randomBytes(8).toString("hex");
}

function calculateExpiry(exp, unit = "menit") {
  const num = parseInt(exp) || 5;
  const multipliers = {
    menit: 60000,
    jam: 3600000,
    hari: 86400000,
    minggu: 604800000,
    bulan: 2592000000,
    tahun: 31536000000
  };
  return Math.min(num * (multipliers[unit.toLowerCase()] || multipliers.menit), multipliers.tahun);
}

function formatExpiry(ms) {
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d} hari`;
  if (h > 0) return `${h} jam`;
  if (m > 0) return `${m} menit`;
  return `${s} detik`;
}

function formatFileSize(bytes) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function loadPendingDeletions() {
  try {
    const entries = readDb();
    const now = Date.now();
    let restored = 0, expired = 0;

    for (const entry of entries) {
      const remaining = new Date(entry.expiresAt).getTime() - now;
      if (remaining <= 0) {
        expired++;
      } else {
        const timerId = setTimeout(() => {
          activeTimers.delete(entry.id);
          const db = readDb().filter(e => e.id !== entry.id);
          writeDb(db);
          logger.info(`[UPLOADV3] Entry expired | id=${entry.id}`);
        }, remaining);
        activeTimers.set(entry.id, timerId);
        restored++;
      }
    }

    const valid = readDb().filter(e => new Date(e.expiresAt).getTime() > Date.now());
    writeDb(valid);

    if (restored > 0 || expired > 0) {
      logger.info(`[UPLOADV3] Startup recovery | restored=${restored} | cleaned=${expired}`);
    }
  } catch (e) {
    logger.error(`[UPLOADV3] Startup recovery failed: ${e.message}`);
  }
}

export default {
  name: "Upload V3 (Multi CDN)",
  description: "Upload file to multiple CDNs with fallback. Files served by ID with auto-expiry.",
  category: "Tools",
  methods: ["POST"],
  params: ["file", "cdn", "exp", "unit"],
  paramsSchema: {
    file: {
      type: "file",
      required: true,
      description: "File to upload (image, video, audio, etc)"
    },
    cdn: {
      type: "string",
      required: false,
      enum: ["all", "poners", "cloudstorage", "nekohime", "phototourl", "zasscdn", "aceimg", "zippyshare"],
      default: "all",
      description: "Target CDN (pilih 'zippyshare', 'cloudstorage', 'poners', dll, atau 'all' untuk multi-CDN fallback)"
    },
    exp: {
      type: "number",
      required: false,
      default: 5,
      description: "Expiry duration value",
      example: "10"
    },
    unit: {
      type: "string",
      required: false,
      enum: ["menit", "jam", "hari", "minggu", "bulan", "tahun"],
      default: "menit",
      description: "Expiry duration unit"
    }
  },

  async run(req, res) {
    const { default: multer } = await import("multer");
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 }
    });

    upload.single("file")(req, res, async (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ status: false, message: "File too large (max 50MB)" });
        }
        return res.status(400).json({ status: false, message: err.message || "Upload error" });
      }

      if (!req.file) {
        return res.status(400).json({ status: false, message: "No file uploaded (field: 'file')" });
      }

      const startTime = Date.now();

      try {
        const buffer = req.file.buffer;
        const { fileTypeFromBuffer } = await import("file-type");
        const type = await fileTypeFromBuffer(buffer);
        const ext = type?.ext || "bin";
        const filename = crypto.randomBytes(8).toString("hex") + "." + ext;

        const selectedCdn = (req.body?.cdn || req.query?.cdn || "").toLowerCase().trim();
        const targets = selectedCdn && selectedCdn !== "all" && CDN_LIST.some(c => c.name === selectedCdn)
          ? CDN_LIST.filter(c => c.name === selectedCdn)
          : CDN_LIST;

        const urls = [];
        let lastError = null;

        for (const cdn of targets) {
          try {
            const url = await cdn.upload(buffer, filename);
            urls.push({ cdn: cdn.name, url });
            logger.info(`[UPLOADV3] Upload success | cdn=${cdn.name} | id=${filename} | size=${req.file.size}`);
          } catch (e) {
            lastError = e;
            logger.warn(`[UPLOADV3] CDN failed | cdn=${cdn.name} | error=${e.message}`);
          }
        }

        if (urls.length === 0) {
          return res.status(500).json({
            status: false,
            message: "All CDNs failed",
            error: lastError?.message
          });
        }

        const exp = req.body?.exp || req.query?.exp || "5";
        const unit = req.body?.unit || req.query?.unit || "menit";
        const TTL = calculateExpiry(exp, unit);
        const expiresAt = new Date(Date.now() + TTL).toISOString();

        const entry = {
          id: filename,
          originalName: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
          urls,
          expiresAt,
          createdAt: new Date().toISOString()
        };

        const db = readDb();
        db.push(entry);
        writeDb(db);

        const timerId = setTimeout(() => {
          activeTimers.delete(filename);
          const updated = readDb().filter(e => e.id !== filename);
          writeDb(updated);
          logger.info(`[UPLOADV3] Entry expired | id=${filename}`);
        }, TTL);
        activeTimers.set(filename, timerId);

        const host = req.get("x-forwarded-host") || req.get("host") || "";
        const isLocal = !host || host.includes("localhost") || host.includes("127.0.0.1");
        const baseUrl = isLocal ? "https://api.zyvor.my.id" : `${req.get("x-forwarded-proto") || "https"}://${host}`;

        const duration = Date.now() - startTime;

        return res.json({
          status: true,
          tool: "uploadv3",
          result: {
            id: filename,
            url: `${baseUrl}/files/${filename}`,
            filename,
            original_name: req.file.originalname,
            size: req.file.size,
            size_formatted: formatFileSize(req.file.size),
            mimetype: req.file.mimetype,
            cdns: urls,
            expires_in: TTL,
            expires_in_formatted: formatExpiry(TTL),
            expires_at: expiresAt
          },
          timestamp: Date.now()
        });
      } catch (e) {
        logger.error(`[UPLOADV3] Error: ${e.message}`);
        return res.status(500).json({ status: false, message: e.message || "Upload failed" });
      }
    });
  }
};

export function getFileById(id) {
  const db = readDb();
  const entry = db.find(e => e.id === id);
  if (!entry) return null;
  if (new Date(entry.expiresAt).getTime() <= Date.now()) return null;
  return entry;
}
