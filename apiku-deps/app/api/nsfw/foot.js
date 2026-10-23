/**
 * NSFW Foot API (Direct Image Response)
 * Random image/gif from foot collection.
 *
 * Endpoint:
 *   GET /api/nsfw/foot
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JSON_PATH = path.join(__dirname, "assets", "foot.json");

let _cache = null;
function getList() {
  if (!_cache) {
    if (!fs.existsSync(JSON_PATH)) return [];
    _cache = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
  }
  return _cache;
}

export default {
  name: "NSFW Foot",
  description: "Random foot image/gif collection (foot.json)",
  category: "NSFW",
  methods: ["GET"],
  params: [],

  async run(req, res) {
    try {
      const list = getList();
      if (!list || !list.length) {
        return res.status(404).json({ status: false, message: "Data foot kosong atau tidak ditemukan" });
      }

      const randUrl = list[Math.floor(Math.random() * list.length)];
      if (req.query?.type === "json" || req.query?.json === "true") {
        return res.json({ status: true, total: list.length, url: randUrl });
      }

      const resp = await fetch(randUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });

      if (!resp.ok) {
        return res.json({ status: true, url: randUrl, message: "Gagal memuat buffer gambar langsung, mengembalikan URL" });
      }

      const arrayBuf = await resp.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
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
    } catch (err) {
      return res.status(503).json({ status: false, message: err.message || "Service unavailable" });
    }
  }
};
