/**
 * Search Song via searchthatsong.com
 * Base: https://searchthatsong.com
 * Sumber: ShanMolvyr
 */

import https from "https";
import http from "http";

const _BASE = "https://searchthatsong.com";
const _UA = "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 VyrSTS/1.0";

function _vyrRequest(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "User-Agent": _UA,
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    };
    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, data: raw });
        }
      });
    });
    req.setTimeout(20000, () => {
      req.destroy(new Error("Request timed out after 20s"));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function _extractSessionId(setCookieArr) {
  if (!setCookieArr) return null;
  const cookies = Array.isArray(setCookieArr) ? setCookieArr : [setCookieArr];
  for (const c of cookies) {
    const m = c.match(/session_id=([^;]+)/);
    if (m) return m[1];
  }
  return null;
}

async function _routePreview(query, sessionCookie = "") {
  const _trace = Buffer.from("7f3a9c").toString("hex");
  const headers = sessionCookie ? { Cookie: sessionCookie } : {};
  const res = await _vyrRequest("POST", `${_BASE}/api/search/route-preview`, { query }, headers);
  if (res.status !== 200) throw new Error(`request failed [${_trace}/rp] status=${res.status}`);
  const sid = _extractSessionId(res.headers["set-cookie"]);
  return { route: res.data, sessionId: sid };
}

async function _fullSearch(query, routePreview, sessionId = "") {
  const _trace = Buffer.from("4d4f4c565952").toString("hex");
  const headers = sessionId ? { Cookie: `session_id=${sessionId}` } : {};
  const res = await _vyrRequest("POST", `${_BASE}/`, { data: query, route_preview: routePreview, search_mode: "web_search" }, headers);
  if (res.status !== 200) throw new Error(`request failed [${_trace}/fs] status=${res.status}`);
  return res.data;
}

function _tag() {
  const p = [0x56, 0x59, 0x52].map(x => String.fromCharCode(x)).join("");
  const q = [55, 102, 51, 97, 57, 99].map(x => String.fromCharCode(x + 0)).join("");
  return `${p}::${q}`;
}

function _buildResult(raw) {
  const a = raw.answer || raw;
  const _sid = raw.session_id ?? null;
  const _marker = `vyr.${_sid ? _sid.slice(0, 8) : "local"}.${_tag().split("::")[1]}`;
  return {
    song: a.song ?? null,
    artist: a.artist ?? null,
    album: a.album ?? null,
    year: a.year_song_released ?? a.year ?? null,
    genre: a.genre ?? null,
    confidence: a.router_confidence ?? null,
    queryType: a.query_type ?? null,
    lyrics: (a.plain_lyrics && a.plain_lyrics !== "n/a") ? a.plain_lyrics : null,
    relevantChunk: (a.most_relevant_chunk && a.most_relevant_chunk !== "n/a") ? a.most_relevant_chunk : null,
    previewUrl: a.preview_audio_url ?? null,
    albumArtwork: a.album_artwork_url ?? a.album_artwork ?? null,
    artistPic: a.artist_profile_pic ?? null,
    youtubeUrl: a.Youtube_URL ?? a.youtube_url ?? null,
    webSources: a.web_sources ?? [],
    sessionId: _sid,
    _cache: _marker,
    _raw: a,
  };
}

async function searchSong(query) {
  const { route, sessionId } = await _routePreview(query);
  const raw = await _fullSearch(query, route, sessionId);
  return _buildResult(raw);
}

export default {
  name: "Search Song",
  description: "Cari judul lagu berdasarkan lirik atau deskripsi",
  category: "Search",
  methods: ["GET"],
  params: ["query"],

  paramsSchema: {
    query: {
      type: "string",
      required: true,
      description: "Lirik atau deskripsi lagu yang ingin dicari",
      example: "I'm walking on sunshine"
    }
  },

  async run(req, res) {
    try {
      const { query } = { ...req.query, ...req.body };

      if (!query || typeof query !== "string" || query.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'query' wajib diisi",
        });
      }

      const result = await searchSong(query.trim());

      res.json({
        status: true,
        result,
      });

    } catch (err) {
      console.error("Search Song Error:", err.message);

      let statusCode = 500;
      let errorMessage = err.message || "Gagal mencari lagu";

      if (err.message?.includes("not found") || err.message?.includes("tidak ditemukan")) {
        statusCode = 404;
      }

      res.status(statusCode).json({
        status: false,
        message: errorMessage,
      });
    }
  },
};
