/**
 * YouTube Downloader v5 — via y2mate.gs (etacloud.org)
 * Input: URL saja — hasil: link download MP3 + MP4 sekaligus
 */
import logger from "../../src/utils/logger.js";

const API_KEY = "e4b503d6ae10c35b1d3ee822c807d2f5";
const AUTH_URL = "https://eta.etacloud.org/api/v1/auth";
const INIT_URL = "https://eta.etacloud.org/api/v1/init";

const HEADERS = {
  "Referer": "https://y2mate.gs/",
  "Origin": "https://y2mate.gs",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
};

function extractVideoId(url) {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|live\/|shorts\/)|[?&]v=)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function getAuth() {
  const res = await fetch(`${AUTH_URL}?api_key=${API_KEY}&_=${Date.now()}`, { headers: HEADERS });
  const data = await res.json();
  if (data.err || !data.key) throw new Error("Auth failed");
  return data.key;
}

async function getConvertURL(bearerKey) {
  const res = await fetch(`${INIT_URL}?_=${Date.now()}`, {
    headers: { ...HEADERS, "Authorization": `Bearer ${bearerKey}` }
  });
  const data = await res.json();
  if (data.error && data.error !== "0") throw new Error("Init failed");
  return data.convertURL;
}

async function convert(convertURL, videoId, format) {
  const res = await fetch(`${convertURL}&v=${videoId}&f=${format}&_=${Date.now()}`, { headers: HEADERS });
  const data = await res.json();
  if (data.error && data.error !== 0) throw new Error(`Convert error: ${data.error}`);
  return data;
}

async function resolveDownload(data, videoId, format) {
  let result = data;
  if (result.redirect && result.redirectURL) {
    result = await convert(result.redirectURL, videoId, format);
  }
  return result;
}

async function waitForDownload(progressURL, downloadURL, videoId, format, title, maxRetries = 60) {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(`${progressURL}&_=${Date.now()}`, { headers: HEADERS });
    const data = await res.json();
    if (data.progress === 3 || data.progress === "3") {
      return { title: data.title || title || "YouTube Download", downloadURL: `${downloadURL}&v=${videoId}&f=${format}&r=y2mate.gs` };
    }
    if (data.error && data.error !== 0) throw new Error(`Progress error: ${data.error}`);
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error("Timeout: download tidak selesai dalam 120 detik");
}

export default {
  name: "YouTube Downloader v5",
  description: "Download YouTube via y2mate.gs — masukkan URL, dapatkan link download MP3 + MP4 sekaligus (max 720p / 30 menit)",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: { type: "string", required: true, description: "URL YouTube (youtu.be / youtube.com/watch)", example: "https://youtu.be/dQw4w9WgXcQ", minLength: 10 }
  },
  async run(req, res) {
    const { url } = { ...req.query, ...req.body };
    if (!url) return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" });

    const videoId = extractVideoId(url);
    if (!videoId) return res.status(400).json({ status: false, message: "URL YouTube tidak valid" });

    try {
      const bearerKey = await getAuth();
      const convertURL = await getConvertURL(bearerKey);

      const [mp3Res, mp4Res] = await Promise.all([
        convert(convertURL, videoId, "mp3"),
        convert(convertURL, videoId, "mp4")
      ]);

      const [mp3Data, mp4Data] = await Promise.all([
        resolveDownload(mp3Res, videoId, "mp3"),
        resolveDownload(mp4Res, videoId, "mp4")
      ]);

      const [mp3Ready, mp4Ready] = await Promise.all([
        waitForDownload(mp3Data.progressURL, mp3Data.downloadURL, videoId, "mp3", mp3Data.title),
        waitForDownload(mp4Data.progressURL, mp4Data.downloadURL, videoId, "mp4", mp4Data.title)
      ]);

      const result = {
        status: true,
        title: mp3Ready.title || mp4Ready.title,
        formats: {
          mp3: mp3Ready.downloadURL,
          mp4: mp4Ready.downloadURL
        }
      };

      return res.json(result);
    } catch (err) {
      logger.error(`[Y2MATE] ${err.message}`);
      return res.status(500).json({ status: false, message: err.message });
    }
  }
};