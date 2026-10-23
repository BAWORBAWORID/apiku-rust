import https from "https";
import http from "http";
import { URL } from "url";

const BASE = "https://drakorid.co";
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function req(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const r = lib.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || "GET",
      headers: {
        "User-Agent": UA,
        Accept: opts.method === "POST" ? "application/json, */*" : "text/html,*/*;q=0.8",
        "Accept-Encoding": "identity",
        "Accept-Language": "id-ID,id;q=0.9",
        Referer: BASE,
        ...(opts.method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(opts.headers || {}),
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        return req(loc.startsWith("http") ? loc : BASE + loc, opts).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    r.on("error", reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

function parseList(html) {
  const map = new Map();
  const rx = /<a\b[^>]*href="https:\/\/drakorid\.co\/nonton\/([^"\/]+)\/?"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = rx.exec(html)) !== null) {
    const slug = m[1];
    const tag = m[0];
    const inner = m[2];
    const t1 = (tag.match(/title="([^"]+)"/i) || [])[1];
    const t2 = (inner.match(/<img[^>]*\balt="([^"]+)"/i) || [])[1];
    const t3 = inner.replace(/<[^>]+>/g, "").trim() || null;
    const poster = (inner.match(/<img[^>]*\bsrc="([^"]+)"/i) || [])[1] || null;
    const title = (t1 || t2 || t3 || "").trim();
    const prev = map.get(slug);
    if (!prev) {
      map.set(slug, { title, slug, url: `${BASE}/nonton/${slug}/`, poster });
    } else {
      if (!prev.title && title) prev.title = title;
      if (!prev.poster && poster) prev.poster = poster;
    }
  }
  return [...map.values()].filter((i) => i.title);
}

function parseDetailPage(html) {
  const get = (rx) => { const m = html.match(rx); return m ? m[1].trim() : null; };

  const title = get(/property="og:title"\s+content="([^"]+)"/i);
  const poster = get(/property="og:image"\s+content="([^"]+)"/i);
  const synopsis = get(/name="twitter:card"\s+content="([^"]+)"/i);

  const token = get(/var token\s*=\s*"([^"]+)"/);
  const link = get(/var link\s*=\s*"([^"]+)"/);
  const mId = (() => { const m = html.match(/var mId\s*=\s*(\d+)/); return m ? parseInt(m[1]) : null; })();
  const mTipe = (() => { const m = html.match(/var mTipe\s*=\s*(\d+)/); return m ? parseInt(m[1]) : null; })();

  const episodes = [];
  const epRx = /data-episode="(\d+)"\s+data-ep-label="([^"]+)"/gi;
  let em;
  const seen = new Set();
  while ((em = epRx.exec(html)) !== null) {
    const num = parseInt(em[1]);
    if (!seen.has(num)) {
      seen.add(num);
      episodes.push({ episode: num, label: em[2] });
    }
  }
  episodes.sort((a, b) => a.episode - b.episode);

  const genres = [];
  const gRx = /href="https:\/\/drakorid\.co\/kategori\/[^"]+">([^<]+)<\/a>/gi;
  let gm;
  while ((gm = gRx.exec(html)) !== null) {
    const g = gm[1].trim();
    if (g && !genres.includes(g)) genres.push(g);
  }

  return { title, poster, synopsis, genres, token, link, mId, mTipe, episodes };
}

async function getEpisodeEmbed(token, mId, link, epNumber) {
  const body = `token=${encodeURIComponent(token)}&id=${mId}&episode=${epNumber}`;
  const res = await req(`${BASE}/myapi/episode_detail.php`, {
    method: "POST",
    body,
    headers: { Referer: `${BASE}/nonton/${link}/` },
  });

  let data;
  try { data = JSON.parse(res.body); } catch { return null; }
  if (data.status !== 1) return null;

  return {
    watch_lite: `${BASE}/watch-lite/${link}/${epNumber}`,
    watch_max: `${BASE}/watch-max/${link}/${epNumber}`,
    watch_fast: `${BASE}/watch-fast/${link}/${epNumber}`,
    download_lite: `${BASE}/download-lite/${link}/${epNumber}`,
    download_fast: `${BASE}/download-fast/${link}/${epNumber}`,
    sid: data.sid || null,
    streaming_id: data.streaming || null,
    thumbnail: data.img || null,
    is_cdn: !!data.is_any_cdn,
  };
}

async function getOngoing() {
  const res = await req(`${BASE}/drama-ongoing/`);
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return { success: true, total: (parseList(res.body) || []).length, items: parseList(res.body) };
}

async function getList(page = 1) {
  const res = await req(`${BASE}/list/${page}`);
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const items = parseList(res.body);
  const hasNext = res.body.includes(`/list/${parseInt(page) + 1}`);
  return { success: true, page: parseInt(page), next_page: hasNext ? parseInt(page) + 1 : null, total: items.length, items };
}

async function getTrending() {
  const res = await req(`${BASE}/trending.html`);
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return { success: true, total: (parseList(res.body) || []).length, items: parseList(res.body) };
}

async function search(query) {
  if (!query) throw new Error("Keyword required");
  const res = await req(`${BASE}/cari.html?q=${encodeURIComponent(query)}`);
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return { success: true, query, total: (parseList(res.body) || []).length, items: parseList(res.body) };
}

async function getGenre(genre, page = 1) {
  if (!genre) throw new Error("Genre required");
  const res = await req(`${BASE}/kategori/${genre}/${page}`);
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return { success: true, genre, page: parseInt(page), total: (parseList(res.body) || []).length, items: parseList(res.body) };
}

async function getWatch(slug) {
  if (!slug) throw new Error("Slug required");
  const detailUrl = `${BASE}/nonton/${slug}/`;
  const res = await req(detailUrl);
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

  const detail = parseDetailPage(res.body);
  const episodesWithEmbed = [];
  for (const ep of detail.episodes) {
    const embed = detail.token && detail.mId
      ? await (async () => {
          const body = `token=${encodeURIComponent(detail.token)}&id=${detail.mId}&episode=${ep.episode}`;
          const res = await req(`${BASE}/myapi/episode_detail.php`, {
            method: "POST",
            body,
            headers: { Referer: `${BASE}/nonton/${detail.link || slug}/` },
          });
          let data;
          try { data = JSON.parse(res.body); } catch { return null; }
          if (data.status !== 1) return null;
          return {
            watch_lite: `${BASE}/watch-lite/${detail.link || slug}/${ep.episode}`,
            watch_max: `${BASE}/watch-max/${detail.link || slug}/${ep.episode}`,
            watch_fast: `${BASE}/watch-fast/${detail.link || slug}/${ep.episode}`,
            download_lite: `${BASE}/download-lite/${detail.link || slug}/${ep.episode}`,
            download_fast: `${BASE}/download-fast/${detail.link || slug}/${ep.episode}`,
            sid: data.sid || null,
            streaming_id: data.streaming || null,
            thumbnail: data.img || null,
            is_cdn: !!data.is_any_cdn,
          };
        })()
      : null;
    episodesWithEmbed.push({ ...ep, embed });
  }

  return {
    success: true,
    url: detailUrl,
    title: detail.title,
    poster: detail.poster,
    synopsis: detail.synopsis,
    genres: detail.genres,
    total_episodes: detail.episodes.length,
    episodes: episodesWithEmbed,
  };
}

const ACTIONS = {
  ongoing: async () => getOngoing(),
  list: async ({ page = 1 }) => getList(page),
  trending: async () => getTrending(),
  search: async ({ q }) => search(q),
  genre: async ({ genre, page = 1 }) => getGenre(genre, page),
  watch: async ({ slug }) => getWatch(slug),
};

export default {
  name: "DrakorID Scraper",
  description: "Scraper DrakorID — ongoing, list, trending, search, genre, watch (embed episode)",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action", "page", "q", "genre", "slug"],
  paramsSchema: {
    action: { type: "string", required: true, enum: ["ongoing", "list", "trending", "search", "genre", "watch"], description: "Aksi yang dijalankan" },
    page: { type: "integer", required: false, default: 1, minimum: 1, description: "Nomor halaman (untuk list/genre)" },
    q: { type: "string", required: false, description: "Keyword pencarian (untuk action=search)" },
    genre: { type: "string", required: false, description: "Slug genre (untuk action=genre)", example: "crime" },
    slug: { type: "string", required: false, description: "Slug drama (untuk action=watch)", example: "between-steps-2026" },
  },
  async run(req, res) {
    try {
      const { action, ...params } = { ...req.query, ...req.body };
      if (!action || !ACTIONS[action]) {
        return res.status(400).json({
          success: false,
          error: "Parameter 'action' wajib diisi",
          valid_actions: Object.keys(ACTIONS),
        });
      }
      const data = await ACTIONS[action](params);
      res.json(data);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  },
};