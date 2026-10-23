/**
 * YouTube Downloader v5 — via ytultra.com API
 * Input: URL YouTube — hasil: metadata + daftar format video & audio lengkap
 */

const API_BASE = "https://api.ytultra.com/ikool/youtube";
const OK_CODE = "0000";
const TIMEOUT_MS = 30_000;

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const AUDIO_EXTS = new Set(["mp3", "m4a", "aac", "opus", "ogg", "weba", "wav"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mkv", "mov", "avi", "flv", "3gp"]);

function humanSize(bytes) {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes >= 0x40000000) return `${(bytes / 0x40000000).toFixed(2)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function humanDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function extractVideoId(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;

  let u;
  try {
    u = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const known = ["youtube.com", "youtu.be", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"];
  if (!known.includes(host)) return null;

  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }

  const v = u.searchParams.get("v");
  if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;

  const m = u.pathname.match(/\/(?:embed|shorts|live|v|e)\/([A-Za-z0-9_-]{11})(?:$|[/?#])/);
  return m ? m[1] : null;
}

function parseFormat(raw) {
  const format = String(raw || "").trim();
  const ext = (format.match(/\[\s*\.?(\w{2,5})\s*\]/i) || [])[1]?.toLowerCase() || null;

  let quality = null;
  const res = format.match(/\b(\d{3,4})p\b/i);
  if (res) {
    quality = `${res[1]}p`;
  } else if (/\b4k\b/i.test(format)) {
    quality = "2160p";
  } else if (/\b2k\b/i.test(format)) {
    quality = "1440p";
  }
  return { format, ext, quality };
}

function isAudio(media) {
  if (media.ext && AUDIO_EXTS.has(media.ext)) return true;
  if (media.ext && VIDEO_EXTS.has(media.ext)) return false;
  if (media.quality) return false;
  return /\bkbps\b|audio[\s-]?only/i.test(media.format);
}

function sizeFromUrl(url) {
  const m = /[?&]clen=(\d+)/.exec(String(url || ""));
  return m ? Number(m[1]) : null;
}

function normalizeMedia(m) {
  const parsed = parseFormat(m.format);
  const size = Number.isFinite(m.fileSize) ? m.fileSize : sizeFromUrl(m.url);
  const audio = isAudio(parsed);
  return {
    url: m.url,
    format: parsed.format,
    ext: parsed.ext,
    quality: audio ? null : parsed.quality,
    size,
    sizeText: m.sizeStr || humanSize(size),
    type: audio ? "audio" : "video",
  };
}

function dedupeFormats(list) {
  const seen = new Set();
  const out = [];
  for (const m of list) {
    if (!m.url) continue;
    if (!m.format && !m.ext) continue;
    const key = m.ext && m.size != null ? `${m.ext}:${m.size}` : m.url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

function qualityValue(item) {
  if (!item.quality) return 0;
  const n = parseInt(item.quality, 10);
  return Number.isNaN(n) ? 0 : n;
}

function sortFormats(list) {
  return [...list].sort(
    (a, b) => qualityValue(b) - qualityValue(a) || (b.size || 0) - (a.size || 0)
  );
}

async function callApi(endpoint, { method = "GET", body, query } = {}) {
  const url = new URL(API_BASE + endpoint);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": UA,
        Origin: "https://www.ytultra.com",
        Referer: "https://www.ytultra.com/",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Respons API bukan JSON (HTTP ${res.status})`);
    }
    if (json.code !== OK_CODE) {
      throw new Error(`API error (code ${json.code}): ${json.msg || "unknown"}`);
    }
    return json.data ?? {};
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Request timeout");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchVideo(videoUrl) {
  const id = extractVideoId(videoUrl);
  if (!id) throw new Error("URL YouTube tidak valid");

  const data = await callApi("/download", {
    method: "POST",
    body: { url: `https://www.youtube.com/watch?v=${id}` },
  });

  const raw = Array.isArray(data.medias) ? data.medias : [];
  const all = dedupeFormats(raw.filter(Boolean).map(normalizeMedia).filter((m) => m.url));

  return {
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    title: data.title || null,
    duration: Number.isFinite(data.duration) ? data.duration : null,
    durationText: humanDuration(data.duration),
    thumbnail: data.imageUrl || null,
    videos: sortFormats(all.filter((m) => m.type === "video")),
    audios: sortFormats(all.filter((m) => m.type === "audio")),
    total: all.length,
  };
}

export default {
  name: "YouTube Downloader V5",
  description: "YouTube video & audio downloader via ytultra",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL video YouTube",
      example: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    },
  },

  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body };

      if (!url || typeof url !== "string") {
        return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" });
      }

      const id = extractVideoId(url);
      if (!id) {
        return res.status(400).json({ status: false, message: "URL YouTube tidak valid" });
      }

      const info = await fetchVideo(url);

      return res.json({
        status: true,
        result: {
          id: info.id,
          title: info.title,
          duration: info.duration,
          durationText: info.durationText,
          thumbnail: info.thumbnail,
          url: info.url,
          total: info.total,
          videos: info.videos,
          audios: info.audios,
        },
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal mengambil data video YouTube",
      });
    }
  },
};
