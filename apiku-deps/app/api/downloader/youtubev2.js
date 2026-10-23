import axios from "axios";
import logger from "../../src/utils/logger.js";

async function parseVidsSave(url) {
  const parseUrl = "https://api.vidssave.com/api/contentsite_api/media/parse";
  const params = new URLSearchParams({
    auth: "20250901majwlqo",
    domain: "api-ak.vidssave.com",
    origin: "cache",
    link: url,
  });

  logger.info(`[VIDSSAVE] Querying API for: ${url}`);

  const { data } = await axios.post(parseUrl, params.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    timeout: 15000,
  });

  if (data.status !== 1 || data.status_code !== "success" || !data.data) {
    throw new Error(data.msg || "Gagal memproses link video.");
  }

  const mediaData = data.data;

  const results = (mediaData.resources || []).map((item) => ({
    quality: item.quality,
    format: item.format,
    type: item.type,
    size: item.size,
    size_formatted: (item.size / (1024 * 1024)).toFixed(2) + " MB",
    download_url: item.download_url,
  }));

  return {
    title: mediaData.title || "YouTube Video",
    duration: mediaData.duration || 0,
    thumbnail: mediaData.thumbnail || "",
    downloads: results,
  };
}

export default {
  name: "YouTube Downloader (VidsSave)",
  description: "Download video YouTube ke MP3/MP4.",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL video YouTube yang ingin di-download",
      example: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    },
  },

  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body };

      if (!url || typeof url !== "string" || url.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
        });
      }

      const cleanUrl = url.trim();

      const result = await parseVidsSave(cleanUrl);

      res.json({
        status: true,
        result,
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error(`YouTube Downloader Error: ${err.message}`);
      res.status(500).json({
        status: false,
        message: err.message || "Gagal mengunduh video YouTube",
        timestamp: Date.now(),
      });
    }
  },
};
