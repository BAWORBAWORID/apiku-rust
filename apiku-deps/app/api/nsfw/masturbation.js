/**
 * NSFW Masturbation API (Direct Image Response)
 * Random image/gif from masturbation collection.
 *
 * Endpoint:
 *   GET /api/nsfw/masturbation
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JSON_PATH = path.join(__dirname, "assets", "masturbation.json");

let _cache = null;
let _cacheMtime = 0;
function getList() {
  const stat = fs.existsSync(JSON_PATH) ? fs.statSync(JSON_PATH).mtimeMs : 0;
  if (!_cache || stat !== _cacheMtime) {
    if (!fs.existsSync(JSON_PATH)) return [];
    _cache = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
    _cacheMtime = stat;
  }
  return _cache;
}

export default {
  name: "NSFW Masturbation",
  description: "Random masturbation image/gif collection (masturbation.json)",
  category: "NSFW",
  methods: ["GET"],
  params: [],

  async run(req, res) {
    try {
      const list = getList();
      if (!list || !list.length) {
        return res.status(404).json({ status: false, message: "Data masturbation kosong atau tidak ditemukan" });
      }

      const randUrl = list[Math.floor(Math.random() * list.length)];
      if (req.query?.type === "json" || req.query?.json === "true") {
        return res.json({ status: true, total: list.length, url: randUrl });
      }

      // Coba beberapa URL acak (max 5) sebelum menyerah ke fallback URL
      const candidates = [...list].sort(() => Math.random() - 0.5).slice(0, 5);
      for (let attempt = 0; attempt < candidates.length; attempt++) {
        const url = candidates[attempt];
        try {
          const resp = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            redirect: "follow"
          });

          if (!resp.ok) continue;

          const arrayBuf = await resp.arrayBuffer();
          const buffer = Buffer.from(arrayBuf);
          if (buffer.length === 0) continue;
          const contentType = resp.headers.get("content-type") || "image/jpeg";

          res.setHeader("Content-Type", contentType);
          res.setHeader("Content-Length", buffer.length);
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
          res.setHeader("Surrogate-Control", "no-store");
          res.setHeader("X-Content-Type-Options", "nosniff");
          res.setHeader("Vary", "*");

          return res.end(buffer);
        } catch {
          // coba URL berikutnya
        }
      }

      return res.json({ status: true, url: candidates[0] || randUrl, message: "Gagal memuat buffer gambar langsung, mengembalikan URL" });
    } catch (err) {
      return res.status(503).json({ status: false, message: err.message || "Service unavailable" });
    }
  }
};
