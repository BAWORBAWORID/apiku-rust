/**
 * SaveUs AIO Downloader
 * Download video & audio dari berbagai platform (YouTube, TikTok, Instagram, dll)
 * Provider: https://www.saveus.biz.id
 *
 * GET  /api/downloader/saveus?url=https://youtu.be/xxx
 * POST /api/downloader/saveus
 */

import https from "node:https";
import { URL } from "node:url";

const BASE = "https://www.saveus.biz.id";
const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const CONCURRENCY = 3;

// Range IP residensial umum yang tidak masuk daftar datacenter
const IP_RANGES = [
  [0x01010000, 0x010101fe], // 1.1.0.0 – 1.1.1.254
  [0x08080000, 0x0808fffe], // 8.8.0.0 – 8.8.255.254
  [0x2e000000, 0x2effffff], // 46.0.0.0 – 46.255.255.254
  [0x3e000000, 0x3effffff], // 62.0.0.0 – 62.255.255.254
  [0x5e000000, 0x5effffff], // 94.0.0.0 – 94.255.255.254
  [0x77000000, 0x77ffffff], // 119.0.0.0 – 119.255.255.254
  [0x7b000000, 0x7bffffff], // 123.0.0.0 – 123.255.255.254
  [0x8c000000, 0x8cffffff], // 140.0.0.0 – 140.255.255.254
  [0x9b000000, 0x9bffffff], // 155.0.0.0 – 155.255.255.254
  [0xb9000000, 0xb9ffffff], // 185.0.0.0 – 185.255.255.254
];

function randomIp() {
  const [lo, hi] = IP_RANGES[Math.floor(Math.random() * IP_RANGES.length)];
  const ip = lo + Math.floor(Math.random() * (hi - lo + 1));
  return `${(ip >>> 24) & 0xff}.${(ip >>> 16) & 0xff}.${(ip >>> 8) & 0xff}.${ip & 0xff}`;
}

function clean(o) {
  Object.keys(o).forEach(
    (k) => (o[k] === null || o[k] === undefined || o[k] === "") && delete o[k]
  );
  return o;
}

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = opts.body ? Buffer.from(JSON.stringify(opts.body)) : null;
    const fakeIp = randomIp();
    const r = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: opts.method || "GET",
        headers: {
          "User-Agent": UA,
          Accept: opts.onLine
            ? "text/event-stream"
            : "application/json, text/plain, */*",
          "Accept-Encoding": "identity",
          "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
          Origin: BASE,
          Referer: BASE + "/",
          "X-Forwarded-For": fakeIp,
          ...(body
            ? {
                "Content-Type": "application/json",
                "Content-Length": body.length,
              }
            : {}),
          ...(opts.headers || {}),
        },
      },
      (res) => {
        if (opts.onLine) {
          let buf = "";
          res.setEncoding("utf8");
          res.on("data", (c) => {
            buf += c;
            const lines = buf.split("\n");
            buf = lines.pop();
            lines.forEach((l) => opts.onLine(l.trim()));
          });
          res.on("end", () => {
            if (buf.trim()) opts.onLine(buf.trim());
            resolve({ status: res.statusCode, headers: res.headers });
          });
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      }
    );
    r.setTimeout(opts.timeout || 90000, () =>
      r.destroy(new Error("Request timeout"))
    );
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

function cookieFrom(res) {
  return (res.headers["set-cookie"] || [])
    .map((c) => c.split(";")[0])
    .join("; ");
}

function formatDuration(value) {
  const n = Number(value);
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    !Number.isFinite(n) ||
    n < 0
  )
    return null;
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = String(Math.floor(n % 60)).padStart(2, "0");
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${s}`
    : `${m}:${s}`;
}

function labelOf(f, kind) {
  if (kind === "video") {
    return (
      f.displayName ||
      (f.height ? `${f.height}p${f.fps ? ` ${f.fps}fps` : ""}` : null) ||
      f.quality ||
      f.label ||
      "video"
    );
  }
  return f.bitrate ? `${f.bitrate}kbps` : f.label || "audio";
}

function sizeOf(f) {
  const size = Number(f.size);
  return Number.isFinite(size) && size >= 256 ? size : null;
}

async function analyze(link) {
  const res = await request(`${BASE}/api/analyze`, {
    method: "POST",
    body: { url: link },
    timeout: 120000,
  });
  if (!res.json)
    throw new Error(
      `Response bukan JSON (HTTP ${res.status}): ${(res.text || "")
        .replace(/\s+/g, " ")
        .slice(0, 200)}`
    );
  if (res.status !== 200 || !res.json.success)
    throw new Error(
      res.json.error || `Gagal menganalisis URL (HTTP ${res.status})`
    );
  return { data: res.json.data, cookie: cookieFrom(res) };
}

async function startJob(data, type, fmt, link, cookie) {
  const body = {
    url: data.url || link,
    type,
    videoId: data.videoId || null,
    _key: data._key || null,
    bitrate: fmt.bitrate || 192,
    formatId: fmt.formatId,
  };
  if (type === "video") body.quality = fmt.quality;

  const res = await request(`${BASE}/api/download/start`, {
    method: "POST",
    body,
    headers: cookie ? { Cookie: cookie } : {},
  });
  if (!res.json || res.status !== 200 || !res.json.success) {
    throw new Error(
      (res.json && res.json.error) ||
        `Gagal memulai download (HTTP ${res.status})`
    );
  }
  return res.json.jobId;
}

function waitJob(jobId, cookie) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (fn, val) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      fn(val);
    };
    const timer = setTimeout(
      () => finish(reject, new Error("Timeout nunggu proses download")),
      600000
    );

    request(
      `${BASE}/api/download/progress/${encodeURIComponent(jobId)}`,
      {
        timeout: 600000,
        headers: cookie ? { Cookie: cookie } : {},
        onLine: (line) => {
          if (!line.startsWith("data:")) return;
          let m;
          try {
            m = JSON.parse(line.slice(5).trim());
          } catch {
            return;
          }
          if (m.type === "done") finish(resolve, true);
          else if (m.type === "error")
            finish(reject, new Error(m.message || "Download gagal"));
          else if (m.type === "cancelled")
            finish(reject, new Error("Download dibatalkan server"));
        },
      }
    )
      .then(() =>
        finish(
          reject,
          new Error("Koneksi progress terputus sebelum selesai")
        )
      )
      .catch((e) => finish(reject, e));
  });
}

async function processFormat(data, type, fmt, link, cookie) {
  const item = {
    type,
    label: labelOf(fmt, type),
    formatId: fmt.formatId,
    container: fmt.container,
    height: fmt.height,
    fps: fmt.fps,
    bitrate: fmt.bitrate,
    size: sizeOf(fmt),
  };
  try {
    const jobId = await startJob(data, type, fmt, link, cookie);
    await waitJob(jobId, cookie);
    item.file_url = `${BASE}/api/download/file/${encodeURIComponent(jobId)}`;
  } catch (e) {
    item.error = e.message;
  }
  return clean(item);
}

async function runPool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker)
  );
  return results;
}

export default {
  name: "SaveUs AIO Downloader",
  description:
    "Download video & audio dari berbagai platform (YouTube, TikTok, Instagram, Facebook, dll) menggunakan provider SaveUs.",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      default: "",
      description: "URL video yang ingin diunduh (YouTube, TikTok, Instagram, dll)",
      example: "",
    },
  },

  async run(req, res) {
    try {
      const rawUrl = req.query.url || req.body?.url;
      const link =
        rawUrl && typeof rawUrl === "string" && rawUrl.trim()
          ? rawUrl.trim()
          : null;

      if (!link) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi.",
        });
      }
      if (!/^https?:\/\//i.test(link)) {
        return res.status(400).json({
          status: false,
          message: "URL tidak valid. Harus diawali https://",
        });
      }

      const { data, cookie } = await analyze(link);

      const videos = data.videoFormats || [];
      const audios = data.audioFormats || [];

      if (!videos.length && !audios.length) {
        return res.status(400).json({
          status: false,
          message: "Tidak ada format yang tersedia untuk URL ini.",
        });
      }

      const tasks = [
        ...videos.map((f) => () => processFormat(data, "video", f, link, cookie)),
        ...audios.map((f) => () => processFormat(data, "audio", f, link, cookie)),
      ];
      const results = await runPool(tasks, CONCURRENCY);

      return res.json({
        status: true,
        result: clean({
          source: link,
          title: data.title,
          author: data.author,
          platform: data.platform,
          duration: data.durationFormatted || formatDuration(data.duration),
          thumbnail: data.thumbnail || data.thumbnailFallback,
          total: results.length,
          success: results.filter((r) => r.file_url).length,
          video: results.filter((r) => r.type === "video"),
          audio: results.filter((r) => r.type === "audio"),
        }),
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses URL.",
      });
    }
  },
};
