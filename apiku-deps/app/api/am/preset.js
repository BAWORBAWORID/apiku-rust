/**
 * Alight Motion (AM) Preset Finder via TikTok URL
 * Base: https://amfinder.web.id
 *
 * GET  /api/am/preset?url=https://www.tiktok.com/@tiktok/video/7106594312292453675
 * POST /api/am/preset -d {"url": "https://vt.tiktok.com/..."}
 */

import http from "node:http";
import https from "node:https";
import axios from "axios";
import FormData from "form-data";
import logger from "../../src/utils/logger.js";

const BASE = "https://amfinder.web.id";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function get(url, options, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 10) return reject(new Error("Terlalu banyak redirect"));
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, options, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const location = res.headers.location;
        if (!location) return reject(new Error("Redirect tanpa Location header"));
        res.resume();
        const next = location.startsWith("http") ? location : new URL(location, url).href;
        return resolve(get(next, options, redirectCount + 1));
      }
      resolve(res);
    });
    req.on("error", reject);
    req.setTimeout(35000, () => {
      req.destroy();
      reject(new Error("Koneksi timeout ke upstream AMFinder"));
    });
  });
}

async function uploadUguu(buffer, filename) {
  const form = new FormData();
  form.append("files[]", buffer, { filename });
  const res = await axios.post("https://uguu.se/upload.php", form, {
    headers: { ...form.getHeaders(), "User-Agent": UA },
    timeout: 30000,
    maxBodyLength: Infinity,
    proxy: false,
  });
  const url = res.data?.files?.[0]?.url;
  if (!url) throw new Error("Upload Uguu gagal: " + JSON.stringify(res.data));
  return url;
}

export function findPresets(tiktokUrl) {
  return new Promise(async (resolve, reject) => {
    const endpoint = `${BASE}/api/find?url=${encodeURIComponent(tiktokUrl)}`;
    const options = {
      headers: {
        "User-Agent": UA,
        Accept: "text/event-stream",
        Referer: `${BASE}/`,
        Origin: BASE,
        "Cache-Control": "no-cache",
      },
    };

    try {
      const res = await get(endpoint, options);
      if (res.statusCode !== 200) {
        return reject(new Error(`Upstream AMFinder HTTP ${res.statusCode}`));
      }

      let buffer = "";
      let lastEvent = "";

      res.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            lastEvent = line.slice(7).trim();
            continue;
          }
          if (line.startsWith("data: ")) {
            const raw = line.slice(6).trim();
            if (lastEvent !== "result") continue;
            try {
              const json = JSON.parse(raw);
              res.destroy();
              resolve(json);
            } catch {
              reject(new Error("Gagal mengurai respons JSON dari upstream"));
            }
          }
        }
      });

      res.on("end", () => reject(new Error("Stream selesai tanpa hasil result")));
      res.on("error", reject);
    } catch (err) {
      reject(err);
    }
  });
}

export default {
  name: "AlightMotion Preset Finder",
  description:
    "Cari link preset Alight Motion (5MB/XML) dari link video TikTok — mengecek deskripsi, bio, link-in-bio, dan komentar video",
  category: "AlightMotion",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description:
        "URL video TikTok (contoh: https://vt.tiktok.com/... atau https://www.tiktok.com/@user/video/...)",
      example: "https://www.tiktok.com/@tiktok/video/7106594312292453675",
    },
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body };
    const inputUrl = (params.url || params.link || "").trim();

    if (!inputUrl) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'url' wajib diisi (URL video TikTok)",
      });
    }

    if (!/tiktok\.com/i.test(inputUrl)) {
      return res.status(400).json({
        status: false,
        message: "URL tidak valid. Masukkan URL video TikTok yang benar.",
      });
    }

    logger.info(`[AM Preset] Mencari preset untuk URL: ${inputUrl}`);

    try {
      const data = await findPresets(inputUrl);

      let videoNoWm = null;
      const targetVideoUrl = data?.video?.playUrlNoWm || data?.video?.playUrl;
      if (targetVideoUrl) {
        try {
          const buf = await axios
            .get(targetVideoUrl, {
              responseType: "arraybuffer",
              timeout: 30000,
              headers: { "User-Agent": UA },
            })
            .then((r) => Buffer.from(r.data));
          videoNoWm = await uploadUguu(buf, `tiktok_${data.video?.id || Date.now()}.mp4`);
        } catch {
          videoNoWm = targetVideoUrl;
        }
      }

      return res.json({
        status: true,
        found: Boolean(data.found),
        message: data.message || (data.found ? "Preset ditemukan" : "Preset tidak ditemukan"),
        author: data.author,
        videoUrl: data.videoUrl,
        video: videoNoWm,
        presets: data.presetLinks ?? [],
        otherLinks: data.otherLinks ?? [],
        description: data.video?.description?.trim(),
        stats: data.video?.stats,
        cover: data.video?.cover,
        authorDetail: data.authorDetail,
        checked: data.checked,
      });
    } catch (err) {
      logger.error(`[AM Preset] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses pencarian preset Alight Motion",
      });
    }
  },
};
