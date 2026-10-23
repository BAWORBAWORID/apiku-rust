/**
 * Apple Music Downloader & Search — AplMate Scraper
 * Base: https://aplmate.com
 *
 * GET /api/downloader/applemusic?url=https://music.apple.com/gb/song/1867165038
 * GET /api/downloader/applemusic?query=ini+abadi
 * POST /api/downloader/applemusic -d {"url": "https://music.apple.com/..."}
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import logger from "../../src/utils/logger.js";

const BASE = "https://aplmate.com";
const UA =
  "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const COOKIE = path.join(process.env.HOME || "/tmp", ".aplmate_cookies.txt");

function curl(url, { method = "POST", form = null, saveCookie = false } = {}) {
  const args = [
    "-k",
    "-sL",
    "--compressed",
    "-X",
    method,
    "-b",
    COOKIE,
    ...(saveCookie ? ["-c", COOKIE] : []),
    "-H",
    `User-Agent: ${UA}`,
    "-H",
    `Origin: ${BASE}`,
    "-H",
    `Referer: ${BASE}/`,
    "-H",
    "X-Requested-With: XMLHttpRequest",
    "-H",
    "Accept: */*",
    "-H",
    "Accept-Language: en-US,en;q=0.9",
    "-H",
    "Sec-Fetch-Dest: empty",
    "-H",
    "Sec-Fetch-Mode: cors",
    "-H",
    "Sec-Fetch-Site: same-origin",
    "-H",
    `sec-ch-ua: "Chromium";v="120", "Not:A-Brand";v="99"`,
    "-H",
    "sec-ch-ua-mobile: ?1",
    "-H",
    'sec-ch-ua-platform: "Android"',
  ];

  if (form) {
    args.push("-H", "Content-Type: application/x-www-form-urlencoded; charset=UTF-8");
    const body = Object.entries(form)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    args.push("-d", body);
  }

  args.push(url);
  return execFileSync("curl", args, { maxBuffer: 20 * 1024 * 1024 }).toString("utf8");
}

function initCookie() {
  if (!fs.existsSync(COOKIE)) {
    execFileSync("curl", [
      "-k",
      "-s",
      "-c",
      COOKIE,
      "-o",
      "/dev/null",
      "-H",
      `User-Agent: ${UA}`,
      BASE + "/",
    ]);
  }
}

function decodeEntities(s) {
  return (s || "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "–")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function getToken(urlValue, lang = "en") {
  const raw = curl(`${BASE}/action/userverify`, {
    form: { url: urlValue, lang },
    saveCookie: true,
  });
  try {
    const json = JSON.parse(raw);
    if (json.success && json.token) return json.token;
  } catch {}
  return "";
}

function parseSearch(html) {
  const out = [];
  const blocks = html.split('<div class="mb-3 grid-container">').slice(1);

  for (const b of blocks) {
    const num = (b.match(/<span[^>]*>(\d+):<\/span>/) || [])[1];
    const info = b.match(/<div class="grid-text"><span[^>]*>([^<]+)<\/span><br>([^<]+)<\/div>/);
    const data = (b.match(/name="data" value="([^"]+)"/) || [])[1];
    const base = (b.match(/name="base" value="([^"]+)"/) || [])[1];
    const token = (b.match(/name="token" value="([^"]+)"/) || [])[1];

    let decoded = null;
    if (data) {
      try {
        decoded = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
      } catch {}
    }

    if (info && data) {
      out.push({
        no: num ? parseInt(num) : null,
        title: decodeEntities(info[1].trim()),
        artist: decodeEntities(info[2].trim()),
        album: decoded?.album || null,
        cover: decoded?.cover || null,
        duration: decoded?.duration || null,
        apple_url: decoded?.surl || base || null,
        apple_id: decoded?.id || null,
        data,
        base,
        token,
      });
    }
  }
  return out;
}

function parseDownloads(html) {
  const out = [];
  const regex =
    /<a[^>]+href="([^"]*cdndl\.aplmate\.com[^"]*)"[^>]*>[\s\S]*?<span><span>([^<]+)<\/span><\/span>/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const label = decodeEntities(m[2]).trim();
    const url = m[1].replace(/\\\//g, "/");
    if (!out.find((x) => x.label === label)) out.push({ label, url });
  }
  return out;
}

export function searchTracks(keyword) {
  initCookie();
  const token = getToken(keyword, "en");

  const raw = curl(`${BASE}/action`, {
    form: { url: keyword, lang: "en", "cf-turnstile-response": token },
    saveCookie: true,
  });

  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("Respons provider bukan format JSON");
  }
  if (json.error) throw new Error(json.message || "Gagal melakukan pencarian");

  const results = parseSearch(json.html || "");

  return {
    source: BASE + "/",
    type: "search",
    keyword,
    total: results.length,
    results: results.map((r) => ({
      no: r.no,
      title: r.title,
      artist: r.artist,
      album: r.album,
      cover: r.cover,
      duration: r.duration,
      apple_url: r.apple_url,
      apple_id: r.apple_id,
    })),
  };
}

export function downloadTrack(appleUrl) {
  initCookie();

  const token = getToken(appleUrl, "en");

  const rawSearch = curl(`${BASE}/action`, {
    form: { url: appleUrl, lang: "en", "cf-turnstile-response": token },
    saveCookie: true,
  });

  let searchJson;
  try {
    searchJson = JSON.parse(rawSearch);
  } catch {
    throw new Error("Respons provider bukan format JSON");
  }
  if (searchJson.error) throw new Error(searchJson.message || "Gagal memproses URL lagu");

  const list = parseSearch(searchJson.html || "");
  const appleId = (appleUrl.match(/song\/(\d+)/) || [])[1];
  const match = list.find((x) => x.apple_id === appleId) || list[0];
  if (!match) throw new Error("Lagu tidak ditemukan pada Apple Music");

  const rawTrack = curl(`${BASE}/action/track`, {
    form: {
      lang: "en",
      data: match.data,
      base: match.base,
      token: match.token,
    },
    saveCookie: true,
  });

  let trackJson;
  try {
    trackJson = JSON.parse(rawTrack);
  } catch {
    throw new Error("Respons download provider bukan JSON");
  }
  if (trackJson.error) throw new Error(trackJson.message || "Gagal mengambil data download");

  const downloads = parseDownloads(trackJson.data || "");

  return {
    source: appleUrl,
    type: "download",
    title: match.title,
    artist: match.artist,
    album: match.album,
    cover: match.cover,
    duration: match.duration,
    apple_id: match.apple_id,
    total_downloads: downloads.length,
    downloads,
  };
}

export default {
  name: "Apple Music Downloader",
  description:
    "Cari & unduh lagu dari Apple Music via AplMate. Masukkan URL lagu untuk download MP3 & Cover HD, atau masukkan kata kunci untuk pencarian lagu.",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url", "action"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description:
        "URL Apple Music track (misal: https://music.apple.com/gb/song/1867165038) atau judul lagu untuk dicari",
      example: "https://music.apple.com/gb/song/1867165038",
    },
    action: {
      type: "string",
      required: false,
      enum: ["download", "search"],
      description:
        "Aksi yang diinginkan: 'download' atau 'search'. Jika dikosongkan, sistem otomatis mendeteksi dari input url.",
      example: "download",
    },
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      const input = (params.url || params.query || params.q || "").trim();
      const action = (params.action || "").toLowerCase().trim();

      if (!input) {
        return res.status(400).json({
          status: false,
          message:
            "Parameter 'url' atau 'query' wajib diisi (URL Apple Music atau judul lagu)",
        });
      }

      const isAppleUrl = /https?:\/\/music\.apple\.com/i.test(input);

      if (action === "download" || (!action && isAppleUrl)) {
        logger.info(`[Apple Music] Download request: ${input}`);
        const result = downloadTrack(input);
        return res.json({
          status: true,
          ...result,
        });
      }

      logger.info(`[Apple Music] Search request: ${input}`);
      const searchResult = searchTracks(input);
      return res.json({
        status: true,
        ...searchResult,
      });
    } catch (err) {
      logger.error(`[Apple Music] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses permintaan Apple Music",
      });
    }
  },
};
