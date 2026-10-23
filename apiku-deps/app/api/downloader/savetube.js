import https from "https";
import { URL } from "url";

const API_BASE = "https://apis.davidcyril.name.ng/download/savetube";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const VALID_FORMATS = ["144", "240", "360", "480", "720", "1080"];
const FORMAT_MAP = { mp4: "720", webm: "720" };

const config = {
  name: "SaveTube",
  description: "Unduh video YouTube sebagai MP3 (audio) atau MP4 (video) melalui SaveTube Pro.",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url", "format"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL video YouTube (watch / youtu.be / embed)",
      example: "https://www.youtube.com/watch?v=oRkOyzQ12tM"
    },
    format: {
      type: "string",
      required: false,
      description: "Format output: mp3, atau kualitas video 144/240/360/480/720/1080. Default: mp3",
      example: "mp3"
    }
  },
  run(req, res) {
    const { url, format = "mp3" } = { ...req.query, ...req.body };
    if (!url) {
      return res.json({ status: false, message: "Parameter 'url' wajib diisi" });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.json({ status: false, message: "URL YouTube tidak valid" });
    }

    const fmt = FORMAT_MAP[format] || format;
    if (fmt !== "mp3" && !VALID_FORMATS.includes(fmt)) {
      return res.json({ status: false, message: `Format tidak didukung. Gunakan: mp3, ${VALID_FORMATS.join(", ")}` });
    }

    const apiUrl = `${API_BASE}?url=${encodeURIComponent(url)}&format=${fmt}`;
    fetchJson(apiUrl)
      .then((d) => {
        if (!d.success || !d.data) {
          return res.json({ status: false, message: d.error || d.message || "Gagal mengambil data" });
        }
        return res.json({
          status: true,
          result: {
            title: d.data.title,
            type: d.data.type,
            quality: d.data.quality,
            duration: d.data.duration,
            cover: d.data.cover,
            videoId,
            download_url: d.data.download_url
          }
        });
      })
      .catch((e) => res.json({ status: false, message: e.message }));
  }
};

function extractVideoId(input) {
  try {
    const u = new URL(input);
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0].split("?")[0];
    if (u.pathname.includes("/watch")) return u.searchParams.get("v");
    if (u.pathname.includes("/embed/")) return u.pathname.split("/embed/")[1].split("?")[0];
  } catch (_) {}
  return null;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": UA, "Accept": "application/json" } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`Invalid JSON (HTTP ${res.statusCode})`)); }
      });
    });
    req.on("error", reject);
    req.setTimeout(45000, () => { req.destroy(); reject(new Error("Request timeout")); });
  });
}

export default config;