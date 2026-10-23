/**
 * CapCut Downloader v2 — via 3bic.com
 * Feature: download video CapCut (watch / template-detail / t / tv2 URLs)
 * Upstream: 3bic.com/api/download
 */
const BASE_URL = "https://3bic.com";

const HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36",
  Referer: "https://3bic.com/",
  Origin: "https://3bic.com",
};

const CAPCUT_REGEX = [
  /^https:\/\/(www\.)?capcut\.com\/watch\/\d+(.+)$/,
  /^https:\/\/(www\.)?capcut\.com\/template-detail\/\d+(.+)$/,
  /^https:\/\/(www\.)?capcut\.com\/t\/+(.+)$/,
  /^https:\/\/(www\.)?capcut\.com\/tv2\/+(.+)$/,
];

function isCapcut(url) {
  return CAPCUT_REGEX.some((regex) => regex.test(url));
}

async function scrapeCapcutDl(url) {
  if (!isCapcut(url)) {
    throw new Error(
      "URL tidak valid. Pastikan URL berasal dari CapCut (capcut.com)."
    );
  }

  const endpoint = `${BASE_URL}/api/download`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ url }),
  });

  const data = await response.json();

  if (data.code === 200) {
    const videoUrl = data.originalVideoUrl.startsWith("http")
      ? data.originalVideoUrl
      : `${BASE_URL}${data.originalVideoUrl}`;

    return {
      platform: "CapCut",
      title: data.title || "No Title",
      author: data.authorName || "Unknown",
      cover: data.coverUrl,
      downloadLink: videoUrl,
    };
  } else {
    throw new Error(
      data.message || "Gagal mengambil data video CapCut dari server."
    );
  }
}

export default {
  name: "CapCut Downloader v2",
  description: "Download video CapCut (watch, template, t, tv2)",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL CapCut (watch / template-detail / t / tv2)",
      example: "https://www.capcut.com/tv2/ZSVEwBgtH/",
      minLength: 10,
    },
  },
  async run(req, res) {
    const { url } = { ...req.query, ...req.body };
    if (!url) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'url' wajib diisi",
      });
    }

    try {
      const result = await scrapeCapcutDl(url);
      res.json({ status: true, result });
    } catch (err) {
      res.json({
        status: false,
        message: err.message || "Gagal mengambil data video CapCut",
      });
    }
  },
};
