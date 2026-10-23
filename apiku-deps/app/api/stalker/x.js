import axios from "axios";
import JSON5 from "json5";
import logger from "../../src/utils/logger.js";

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0';
const idOf = (s) => String(s || '').match(/(\d{15,20})/)?.[1] || null;
const pick = (x) => (x && typeof x === 'object' ? x : {});

function extractRecs(str) {
  const recs = {};
  const re = /\$R\[(\d+)\]=(\{)/g;
  let m;
  while ((m = re.exec(str))) {
    const id = m[1];
    const start = m.index + m[0].indexOf('{');
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < str.length; i++) {
      const c = str[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { recs[id] = str.slice(start, i + 1); break; } }
    }
  }
  return recs;
}

function resolveGraph(raw) {
  let s = raw.replace(/\$R\[\d+\]=/g, '');
  s = s.replace(/\$R\[\d+\]/g, 'null');
  s = s.replace(/void 0/g, 'null');
  s = s.replace(/!0\b/g, 'true').replace(/!1\b/g, 'false');
  return s;
}

function makeResolver(map) {
  const memo = new Map();
  return function r(node, depth = 0) {
    if (node == null || typeof node !== 'object') return node;
    if (depth > 12) return null;
    if (node.__ref) {
      if (memo.has(node)) return memo.get(node);
      memo.set(node, null);
      const v = map[node.__ref];
      const res = v ? r(v, depth + 1) : null;
      memo.set(node, res);
      return res;
    }
    if (node.result && node.result.__ref) {
      const v = map[node.result.__ref];
      return v ? r(v, depth + 1) : node;
    }
    return node;
  };
}

function resolveRefs(map, rr, node) {
  const n = rr(node) || {};
  const out = [];
  for (const ref of (n.__refs || [])) {
    const v = rr(map[ref]);
    if (v && typeof v === 'object') out.push(v);
  }
  return out;
}

function readTweet(t, rr, map) {
  const d = rr(t.details) || t.details || {};
  const core = rr(t.core) || {};
  const ur = rr(core.user_results) || {};
  const uc = pick(rr(ur.core));
  const ul = rr(ur.legacy) || ur.legacy || {};
  const av = rr(ur.avatar) || {};
  const c = rr(t.counts) || {};
  const v = rr(t.views) || {};

  const media = [];
  const me2 = rr(t.media_entities2) || {};
  if (Array.isArray(me2.__refs)) {
    for (const ref of me2.__refs) {
      const mm = rr(map[ref]) || {};
      const vi = rr(mm.video_info) || {};
      const oi = rr(mm.original_info) || {};
      const vdefs = Array.isArray(vi.variants?.__refs)
        ? vi.variants.__refs.map((r2) => { const vv = rr(map[r2]) || {}; return { url: vv.url || vv.src || null, br: vv.bitrate || 0 }; })
        : (Array.isArray(vi.variants) ? vi.variants.map((x) => ({ url: x.url || x.src || null, br: x.bitrate || 0 })) : []);
      const mp4s = vdefs.filter((x) => x.url && x.url.includes('.mp4')).sort((a, b) => b.br - a.br);
      media.push({
        type: mm.type,
        thumbnail: mm.media_url_https || mm.media_url || null,
        video: mp4s[0]?.url || null,
        size: { width: oi.width ?? null, height: oi.height ?? null },
      });
    }
  }

  const entities = {
    urls: [],
    mentions: [],
    hashtags: [],
    cashtags: [],
  };
  const rawUrls = resolveRefs(map, rr, t.url_entities);
  entities.urls = rawUrls.map((x) => ({
    short: x.url || x.expanded_url_storage || x.expanded_url || null,
    expanded: null,
  }));
  const rawMentions = resolveRefs(map, rr, t.mention_entities);
  entities.mentions = rawMentions.map((x) => ({ username: x.mention_input || x.screen_name || null }));
  const rawHashtags = resolveRefs(map, rr, d.hashtag_entities || t.hashtag_entities);
  entities.hashtags = rawHashtags.map((x) => ({ hashtag: x.tag || x.text || null }));
  const rawCashtags = resolveRefs(map, rr, d.cashtag_entities || t.cashtag_entities);
  entities.cashtags = rawCashtags.map((x) => ({ cashtag: x.tag || x.text || null }));

  let rep = null;
  const repTo = rr(t.reply_to_results);
  if (repTo && (repTo.rest_id || repTo.id_str)) {
    const repUser = rr(t.reply_to_user_results) || {};
    const repCore = pick(rr(repUser.core));
    rep = {
      tweetId: repTo.rest_id || repTo.id_str || null,
      user: {
        id: repUser.rest_id || repUser.id_str || null,
        username: repCore.screen_name || repUser.screen_name || null,
        name: repCore.name || repUser.name || null,
      },
    };
  }

  const isBlue = ur.is_blue_verified ?? uc.is_blue_verified ?? false;
  const isVerified = ur.professional !== undefined ? !!(isBlue) : (isBlue || !!pick(ur.verified));

  const handle = uc.screen_name || ur.screen_name || ul.screen_name;
  return {
    id: t.rest_id || d.id_str || null,
    text: (d.full_text || '').replace(/\\n/g, '\n'),
    createdAt: d.created_at_ms ? new Date(d.created_at_ms).toISOString() : null,
    lang: (ul.lang) || null,
    stats: {
      likes: c.favorites ?? c.favorite_count ?? null,
      retweets: c.retweets ?? c.retweet_count ?? null,
      replies: c.replies ?? c.reply_count ?? null,
      views: v.count ?? null,
    },
    author: {
      id: ur.rest_id || ur.id_str || null,
      name: uc.name || ur.name || ul.name || null,
      username: handle,
      verified: isVerified,
      avatar: av.image_url || av.image || ur.profile_image_url_https || ul.profile_image_url_https || null,
    },
    reply: rep,
    media,
    entities,
    url: (t.rest_id || d.id_str) ? `https://x.com/${(handle || 'i')}/status/${t.rest_id || d.id_str}` : null,
    source: 'ssr',
  };
}

async function ssr(tweetId) {
  try {
    const r = await axios.get(`https://x.com/i/status/${tweetId}`, { headers: { 'User-Agent': UA }, timeout: 20000 });
    const recs = extractRecs(r.data);
    let map = null;
    for (const k of Object.keys(recs)) {
      try {
        const m = JSON5.parse(resolveGraph(recs[k]));
        if (m && typeof m === 'object' && ('client:root' in m || Object.values(m).some((v) => v && v.details?.full_text))) { map = m; break; }
      } catch (e) { /* skip */ }
    }
    if (!map) return [];
    const rr = makeResolver(map);
    const out = [];
    const seen = new Set();
    for (const val of Object.values(map)) {
      const t = rr(val) || val;
      const det = rr(t.details) || t.details;
      if (det && det.full_text) {
        const tw = readTweet(t, rr, map);
        if (tw.id && tw.text && !seen.has(tw.id)) { seen.add(tw.id); out.push(tw); }
      }
    }
    return out;
  } catch (e) {
    logger.warn(`[X Stalker SSR] Error: ${e.message}`);
    return [];
  }
}

async function synd(tweetId) {
  try {
    const { data } = await axios.get(`https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=0`, { headers: { 'User-Agent': UA }, timeout: 15000 });
    const u = data.user || {};
    const media = (data.mediaDetails || []).map((m) => ({
      type: m.type,
      thumbnail: m.media_url_https || m.media_url || null,
      video: m.video_info?.variants?.map((v) => v.url).find((x) => x.includes('.mp4')) || null,
      size: { width: m.originalInfo?.width ?? null, height: m.originalInfo?.height ?? null },
    }));
    return [{
      id: data.id_str || tweetId,
      text: data.text || '',
      createdAt: data.created_at || null,
      lang: data.lang || null,
      stats: { likes: data.favorite_count ?? null, retweets: null, replies: data.conversation_count ?? null, views: null },
      author: { id: u.id_str || null, name: u.name || null, username: u.screen_name || null, verified: u.is_blue_verified ?? false, avatar: u.profile_image_url_https || null },
      reply: null,
      media,
      entities: { urls: [], mentions: [], hashtags: [], cashtags: [] },
      url: `https://x.com/${u.screen_name || 'i'}/status/${data.id_str || tweetId}`,
      source: 'syndication',
    }];
  } catch (e) { return null; }
}

async function resolveTco(tco) {
  try {
    const r = await axios.get(tco, {
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 400,
      headers: { 'User-Agent': UA },
      timeout: 10000,
    });
    if (r.status >= 300 && r.status < 400 && r.headers.location) return r.headers.location;
    const body = String(r.data || '');
    const m = body.match(/location\.replace\("(.+?)"\)/) || body.match(/URL=(.+?)["']?>/i) || body.match(/<title>(.*?)<\/title>/i);
    if (m && m[1]) return m[1].replace(/\\\//g, '/').replace(/&/g, '&');
    return tco;
  } catch (e) { return tco; }
}

async function fillUrls(tw) {
  if (!tw.entities || !tw.entities.urls) return;
  const tcoPattern = /(https:\/\/t\.co\/\w+)/g;
  const found = [...new Set(String(tw.text || '').match(tcoPattern) || [])];
  const list = tw.entities.urls.slice();
  for (const tco of found) {
    if (!list.some((e) => e.short === tco)) list.push({ short: tco, expanded: null });
  }
  for (const u of list) { if (u.short && u.short.includes('t.co')) u.expanded = await resolveTco(u.short); }
  tw.entities.urls = list;
}

async function fetchTweet(tweetId) {
  let tweets = await ssr(tweetId);
  if (!tweets.length) {
    const s = await synd(tweetId);
    if (s) tweets = s;
  }
  if (!tweets.length) return null;

  for (const tw of tweets) if (tw.source === 'ssr') await fillUrls(tw);
  tweets.sort((a, b) => (a.id === tweetId ? -1 : b.id === tweetId ? 1 : 0));
  return tweets;
}

export default {
  name: "X (Twitter) Tweet Stalker",
  description: "Ambil detail tweet X/Twitter lengkap dengan reply, media, dan entities (SSR + Syndication fallback)",
  category: "Stalker",
  methods: ["GET", "POST"],
  params: ["id", "url"],
  paramsSchema: {
    id: { type: "string", required: false, description: "Tweet ID (15-20 digit)", example: "2085623549944005049" },
    url: { type: "string", required: false, description: "Full tweet URL", example: "https://x.com/user/status/2085623549944005049" }
  },
  async run(req, res) {
    try {
      const { id, url } = { ...req.query, ...req.body };
      const tweetId = idOf(id) || idOf(url);

      if (!tweetId) {
        return res.status(400).json({ status: false, error: "Parameter 'id' atau 'url' wajib diisi" });
      }

      const tweets = await fetchTweet(tweetId);
      if (!tweets) {
        return res.status(404).json({ status: false, error: "Tweet tidak ditemukan (deleted/private?)" });
      }

      return res.json({
        status: true,
        count: tweets.length,
        tweets
      });
    } catch (err) {
      logger.error(`[X Stalker] Error: ${err.message}`);
      return res.status(500).json({ status: false, error: err.message });
    }
  }
}