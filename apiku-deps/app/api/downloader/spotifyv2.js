import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import logger from "../../src/utils/logger.js";

const BASE = "https://spotisaver.net";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const FALLBACK_CONFIG = {
  endpoint: "/api/get_signature.php",
  requestToken: "4c0f61e8ca8b3d0fed1c1c2bce00e17f70cb76066c14831029ae9eb2710921e2",
  wire: {
    token_param: "ke6efef363b",
    ctx_param: "c5b9bf82cb0",
    action_param: "a32137ee70c",
    sig_header: "X-SCC9AF0BD",
    exp_header: "X-E000DDCBE",
    actions: {
      get_playlist: "xf025ca18c2",
      download_track: "x6454459f15",
      download_playlist: "xa6c19f4efa",
    },
  },
};

const jar = new CookieJar();
const client = wrapper(
  axios.create({
    jar,
    withCredentials: true,
    timeout: 20000,
    headers: { "User-Agent": UA },
  }),
);

function parseSpotifyUrl(input) {
  const url = String(input).trim();

  if (url.startsWith("spotify:")) {
    const [, type, id] = url.split(":");
    if (!type || !id) throw new Error("Format spotify URI tidak valid");
    return { id: id.split("?")[0], type };
  }

  const m = url.match(
    /open\.spotify\.com\/(?:embed\/)?(track|album|playlist|artist|episode|show)\/([a-zA-Z0-9]+)/i,
  );
  if (!m) throw new Error("URL Spotify tidak valid");
  return { id: m[2], type: m[1].toLowerCase() };
}

function extractSignatureConfig(html) {
  const idx = html.indexOf("playlistRequestSignature");
  if (idx === -1) return null;
  const eqIdx = html.indexOf("=", idx);
  if (eqIdx === -1) return null;
  const startIdx = html.indexOf("{", eqIdx);
  if (startIdx === -1) return null;

  let depth = 0;
  let endIdx = -1;
  let inString = false;
  let stringChar = "";
  let escaped = false;

  for (let i = startIdx; i < html.length; i++) {
    const c = html[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (inString) {
      if (c === stringChar) inString = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      stringChar = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }

  if (endIdx === -1) return null;

  let objStr = html.slice(startIdx, endIdx + 1);
  objStr = objStr.replace(/\/\/[^\n\r]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  try {
    const jsonStr = objStr
      .replace(/'/g, '"')
      .replace(/([{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/,\s*([}\]])/g, "$1");
    const parsed = JSON.parse(jsonStr);
    if (!parsed.wire?.token_param || !parsed.requestToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function warmUp(id, type) {
  const { data } = await client.get(`${BASE}/en/${type}/${id}`, {
    headers: { Accept: "text/html,application/xhtml+xml" },
    validateStatus: () => true,
  });

  const live = extractSignatureConfig(data);
  if (live) {
    return { config: live, source: "live" };
  }

  logger.warn(`[SpotifyV2] Gagal extract signature live, pakai fallback (requestToken bisa kedaluwarsa)`);
  return { config: FALLBACK_CONFIG, source: "fallback" };
}

async function getSignature(config, action, context) {
  const { endpoint, wire, requestToken } = config;

  const params = new URLSearchParams();
  params.set(wire.token_param, String(requestToken));
  params.set(wire.action_param, wire.actions[action]);
  params.set(wire.ctx_param, Buffer.from(JSON.stringify(context)).toString("base64"));

  const { data, status } = await client.get(`${BASE}${endpoint}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    validateStatus: () => true,
  });

  if (status !== 200 || !data?.success || !data?.token) {
    throw new Error(
      `Signature gagal (HTTP ${status}): ${JSON.stringify(data).slice(0, 180)}`,
    );
  }

  return { token: data.token, exp: data.exp };
}

async function getPlaylist(config, id, type, signature) {
  const url = `${BASE}/api/get_playlist.php?id=${encodeURIComponent(id)}&type=${encodeURIComponent(type)}&lang=en`;

  const { data, status } = await client.get(url, {
    headers: {
      Accept: "application/json",
      Referer: `${BASE}/en/${type}/${id}`,
      [config.wire.sig_header]: signature.token,
      [config.wire.exp_header]: signature.exp,
    },
    validateStatus: () => true,
  });

  if (status !== 200 || !data?.playlist_info) {
    throw new Error(`Playlist gagal (HTTP ${status}): ${JSON.stringify(data).slice(0, 180)}`);
  }

  return data;
}

function formatDuration(ms) {
  if (!ms) return "0:00";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function normalize(raw) {
  const info = raw.playlist_info || {};
  const tracks = (raw.tracks || []).map((t) => ({
    id: t.id,
    name: t.name,
    artists: t.artists || [],
    album: t.album || null,
    image: t.image?.url || null,
    duration_ms: t.duration_ms,
    duration_human: formatDuration(t.duration_ms),
    popularity: t.popularity ?? null,
    explicit: t.explicit ?? false,
    isrc: t.external_ids?.isrc || null,
    label: t.label || null,
    release_date: t.release_date || null,
    track_number: t.track_number ?? null,
    external_url: t.external_url || null,
  }));

  return {
    id: info.id,
    type: info.type,
    name: info.name,
    description: info.description || null,
    owner: info.owner || null,
    total_tracks: info.total_tracks || tracks.length,
    total_duration_ms: info.total_duration_ms || 0,
    total_duration_human: formatDuration(info.total_duration_ms || 0),
    external_url: info.external_url || null,
    images: info.images || [],
    tracks,
  };
}

async function scrapeSpotify(spotifyUrl) {
  const { id, type } = parseSpotifyUrl(spotifyUrl);

  const { config, source } = await warmUp(id, type);
  const signature = await getSignature(config, "get_playlist", { id, type, lang: "en" });
  const raw = await getPlaylist(config, id, type, signature);

  return { id, type, configSource: source, playlist: normalize(raw) };
}

export default {
  name: "Spotify Downloader v2",
  description: "Metadata & daftar track dari Spotify via SpotiSaver (ringan, tanpa browser)",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description:
        "URL Spotify (track/album/playlist/artist/episode/show) atau URI spotify:track:xxx",
      example: "https://open.spotify.com/track/6v5RJuJ9yhvaXkMXMeMZBw",
    },
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const { url } = { ...req.query, ...req.body };
      const input = typeof url === "string" ? url.trim() : "";

      if (!input) {
        return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" });
      }

      logger.info(`[SpotifyV2] Request | ip=${req.ip} | url=${input.substring(0, 60)}`);

      const data = await scrapeSpotify(input);

      logger.info(
        `[SpotifyV2] Success | type=${data.type} | tracks=${data.playlist.tracks.length}`,
      );

      return res.json({
        status: true,
        duration: `${Date.now() - startTime}ms`,
        result: data,
      });
    } catch (err) {
      logger.error(`[SpotifyV2] Error | ${err.message}`);
      const msg = err.message || "Gagal mengambil data Spotify";

      if (/tidak valid/i.test(msg)) {
        return res.status(400).json({ status: false, message: msg });
      }
      if (/signature|403/i.test(msg)) {
        return res.status(502).json({
          status: false,
          message: `${msg} — SpotiVault menolak signature (provider mungkin berubah).`,
        });
      }

      return res.status(500).json({ status: false, message: msg });
    }
  },
};
