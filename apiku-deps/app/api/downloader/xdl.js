/**
 * X (Twitter) Downloader
 * Download video, GIF, foto dari X/Twitter — tanpa login, pakai guest-token
 * Provider: x.com GraphQL (guest-token)
 *
 * GET  /api/downloader/xdl?url=https://x.com/NASA/status/xxx
 * POST /api/downloader/xdl
 *
 * Params:
 *   url  — URL tweet atau username (wajib)
 *   mode — info | profile | best | 4k | 2k | 1080p | 720p | 480p | photo | gif
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const ACTIVATE = "https://api.twitter.com/1.1/guest/activate.json";
const GQL = "https://twitter.com/i/api/graphql";
const QID_USER = "pVrmNaXcxPjisIvKtLDMEA";
const QID_TWEETS = "E3opETHurmVJflFsUBVuUQ";
const CACHE = path.join(os.tmpdir(), "xGst-guest.json");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const HDR = {
  "user-agent": UA,
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  "x-twitter-active-user": "yes",
  "x-twitter-client-language": "en",
  referer: "https://x.com/",
};

const enc = encodeURIComponent;
const QUALITIES = ["4k", "2k", "1080p", "720p", "480p"];

// ── Guest token ──────────────────────────────────────────────────────────────

async function guest(force = false) {
  if (!force) {
    try {
      const c = JSON.parse(fs.readFileSync(CACHE, "utf8"));
      if (c.when > Date.now() - 7200e3 && c.token) return c.token;
    } catch {}
  }
  const r = await fetch(ACTIVATE, {
    method: "POST",
    headers: { authorization: `Bearer ${BEARER}`, ...HDR },
  });
  if (!r.ok) throw new Error(`guest token gagal (${r.status})`);
  const j = await r.json();
  fs.writeFileSync(CACHE, JSON.stringify({ token: j.guest_token, when: Date.now() }));
  return j.guest_token;
}

const FEATS = {
  hidden_profile_subscriptions_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  highlights_tweets_tab_ui_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
};

async function gql(qid, op, vars, feats, retry = true) {
  const tok = await guest(!retry);
  let url = `${GQL}/${qid}/${op}?variables=${enc(JSON.stringify(vars))}`;
  if (feats) url += `&features=${enc(JSON.stringify(feats))}`;
  const r = await fetch(url, {
    headers: { authorization: `Bearer ${BEARER}`, "x-guest-token": tok, ...HDR },
  });
  if ((r.status === 401 || r.status === 403) && retry) {
    fs.rmSync(CACHE, { force: true });
    return gql(qid, op, vars, feats, false);
  }
  if (r.status === 404)
    throw new Error(`queryId X dirotasi (${op} → 404). Perlu update QID di file.`);
  if (!r.ok) throw new Error(`${op} HTTP ${r.status}`);
  return r.json();
}

// ── User & Timeline ──────────────────────────────────────────────────────────

async function getUser(screenName) {
  const j = await gql(
    QID_USER,
    "UserByScreenName",
    { screen_name: screenName, withSafetyModeUserFields: true },
    FEATS
  );
  const r = j?.data?.user?.result;
  if (!r) throw new Error(`user @${screenName} tidak ditemukan`);
  if (r.__typename === "UserUnavailable")
    throw new Error(`user @${screenName} suspended/private`);
  const L = r.legacy || {};
  return {
    id: r.rest_id || "",
    name: L.name || "",
    username: L.screen_name || screenName,
    bio: L.description || "",
    location: L.location || "",
    verified: Boolean(r.is_blue_verified),
    followers: L.followers_count ?? null,
    following: L.friends_count ?? null,
    statuses: L.statuses_count ?? null,
    createdAt: L.created_at || null,
    avatar: L.profile_image_url_https || "",
    url: `https://x.com/${L.screen_name || screenName}`,
  };
}

function mediaItem(m) {
  const oi = m.original_info || {};
  const base = {
    id: m.id_str || "",
    type: m.type || "photo",
    width: oi.width || null,
    height: oi.height || null,
    image: m.media_url_https || m.media_url || "",
  };
  if (m.type === "video" || m.type === "animated_gif") {
    const vi = m.video_info || {};
    const variants = (vi.variants || [])
      .filter((v) => v.url && v.bitrate)
      .map((v) => ({ url: v.url, bitrate: v.bitrate, type: v.content_type || "video/mp4" }))
      .sort((a, b) => b.bitrate - a.bitrate);
    const byB = new Map();
    for (const v of variants) if (!byB.has(v.bitrate)) byB.set(v.bitrate, v);
    const m3u8 = (vi.variants || []).find((v) => /\.m3u8/.test(v.url || ""));
    return {
      ...base,
      durationMs: vi.duration_millis || null,
      aspectRatio: oi.width && oi.height ? +(oi.width / oi.height).toFixed(4) : null,
      variants: [...byB.values()],
      hls: m3u8 ? m3u8.url : null,
    };
  }
  return base;
}

async function getTimeline(screenName, count = 40) {
  const u = await getUser(screenName);
  const j = await gql(
    QID_TWEETS,
    "UserTweets",
    {
      userId: u.id,
      count,
      includePromotedContent: false,
      withQuickPromoteEligibilityTweetFields: false,
      withVoice: false,
    },
    FEATS
  );
  const out = [];
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { for (const v of o) walk(v); return; }
    const L = o.legacy;
    if (L && typeof L.full_text === "string") {
      const media = [
        ...(L.extended_entities?.media || []),
        ...(L.entities?.media || []),
      ];
      const seen = new Set();
      const items = [];
      for (const m of media) {
        const key = m.id_str || m.media_url_https || m.media_url;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(mediaItem(m));
      }
      if (items.length) {
        out.push({
          id: L.id_str || o.rest_id || "",
          text: L.full_text,
          lang: L.lang || "",
          createdAt: L.created_at || "",
          isRetweet:
            Boolean(L.retweeted_status_result) || /^RT @/.test(L.full_text),
          engagement: {
            likes: L.favorite_count ?? null,
            retweets: L.retweet_count ?? null,
            replies: L.reply_count ?? null,
            quotes: L.quote_count ?? null,
            bookmarks: L.bookmark_count ?? null,
          },
          media: items,
        });
      }
    }
    for (const k in o) walk(o[k]);
  };
  walk(j);
  return { user: u, tweets: out };
}

async function findTweet(tweetId, screenName) {
  const tl = await getTimeline(screenName, 40);
  const hit = tl.tweets.find((t) => t.id === tweetId);
  if (hit) return { ...hit, author: tl.user };
  throw new Error(
    `Tweet ${tweetId} tidak ada di 40 tweet terbaru @${screenName}. Tweet lama memerlukan login.`
  );
}

const variantHeight = (u) =>
  Number((String(u).match(/\/avc1\/(\d+)x(\d+)\//) || [])[2]) || 0;

function pickVariant(item, want) {
  if (!item.variants?.length) return null;
  if (want === "best")
    return [...item.variants].sort((a, b) => b.bitrate - a.bitrate)[0];
  const target = /^(\d+)k$/i.test(want)
    ? Number(want.replace(/k$/i, "")) * 540
    : Number(String(want).replace("p", ""));
  return [...item.variants].sort((a, b) => {
    const da = Math.abs(variantHeight(a.url) - target);
    const db = Math.abs(variantHeight(b.url) - target);
    return da - db || b.bitrate - a.bitrate;
  })[0];
}

function slimAuthor(a) {
  return a
    ? { name: a.name, username: a.username, verified: a.verified, followers: a.followers }
    : null;
}

function fmtVariants(variants) {
  return (variants || []).map((v) => ({
    resolution: variantHeight(v.url) ? `${variantHeight(v.url)}p` : null,
    width: (String(v.url).match(/\/avc1\/(\d+)x(\d+)\//) || [])[1] || null,
    bitrate: v.bitrate,
    type: v.type,
    url: v.url,
  }));
}

// ── Export default ───────────────────────────────────────────────────────────

export default {
  name: "X (Twitter) Downloader",
  description:
    "Download video, GIF, dan foto dari X/Twitter tanpa login. Support info tweet, profil user, dan pilih resolusi (4K/1080p/720p/dst).",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url", "mode"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      default: "",
      description: "URL tweet (https://x.com/user/status/id) atau username",
      example: "",
    },
    mode: {
      type: "string",
      required: false,
      default: "info",
      description:
        "Mode: info | profile | best | 4k | 2k | 1080p | 720p | 480p | photo | gif",
      example: "info",
    },
  },

  async run(req, res) {
    try {
      const rawUrl = req.query.url || req.body?.url;
      const input = rawUrl && typeof rawUrl === "string" ? rawUrl.trim() : null;
      if (!input) {
        return res
          .status(400)
          .json({ status: false, message: "Parameter 'url' wajib diisi." });
      }

      const mode = (req.query.mode || req.body?.mode || "info").toLowerCase();
      const VALID_MODES = ["info", "profile", "best", "photo", "gif", ...QUALITIES];
      if (!VALID_MODES.includes(mode)) {
        return res.status(400).json({
          status: false,
          message: `Mode tidak valid. Pilih: ${VALID_MODES.join(", ")}`,
        });
      }

      // Deteksi username vs URL tweet
      const hasStatus = /\/status\//.test(input);
      const bareId = /^\d{10,25}$/.test(input);
      const isTweetTarget = hasStatus || bareId;

      // ── Input: username ───────────────────────────────────────────────────
      if (!isTweetTarget) {
        const username = input.startsWith("@") ? input.slice(1) : input;

        if (mode === "profile") {
          const u = await getUser(username);
          return res.json({ status: true, result: { mode: "profile", user: u } });
        }

        // timeline
        const tl = await getTimeline(username, 40);
        if (!tl.tweets.length) {
          return res.status(404).json({
            status: false,
            message: `@${username} tidak punya tweet ber-media dalam 40 tweet terbaru.`,
          });
        }
        return res.json({
          status: true,
          result: {
            mode: "timeline",
            user: tl.user,
            count: tl.tweets.length,
            tweets: tl.tweets.map((t) => ({
              id: t.id,
              url: `https://x.com/${tl.user.username}/status/${t.id}`,
              text: t.text,
              createdAt: t.createdAt,
              isRetweet: t.isRetweet,
              engagement: t.engagement,
              media: t.media.map((m) => ({
                type: m.type,
                width: m.width,
                height: m.height,
                durationMs: m.durationMs,
                variants: (m.variants || []).length,
                image: m.image,
              })),
            })),
          },
        });
      }

      // ── Input: tweet URL / ID ─────────────────────────────────────────────
      const urlMatch = input.match(
        /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,20})\/status\/(\d{6,25})/
      );
      const tweetId = urlMatch ? urlMatch[2] : bareId ? input : null;
      const who = urlMatch ? urlMatch[1] : null;

      if (!tweetId) {
        return res.status(400).json({
          status: false,
          message: "Bukan URL tweet valid. Format: https://x.com/<user>/status/<id>",
        });
      }
      if (!who) {
        return res.status(400).json({
          status: false,
          message: "Gunakan URL tweet lengkap (dengan username), bukan ID polos.",
        });
      }
      if (mode === "profile") {
        return res.status(400).json({
          status: false,
          message: "Mode 'profile' hanya untuk input username.",
        });
      }

      const t = await findTweet(tweetId, who);

      // info
      if (mode === "info") {
        const media = (t.media || []).map((m) => ({
          type: m.type,
          width: m.width,
          height: m.height,
          durationMs: m.durationMs,
          aspectRatio: m.aspectRatio,
          image: m.image,
          hls: m.hls || null,
          variants: fmtVariants(m.variants),
        }));
        return res.json({
          status: true,
          result: {
            id: t.id,
            url: `https://x.com/${t.author.username}/status/${t.id}`,
            text: t.text,
            author: slimAuthor(t.author),
            engagement: t.engagement,
            createdAt: t.createdAt,
            lang: t.lang,
            isRetweet: t.isRetweet,
            mode: "info",
            mediaCount: media.length,
            hasVideo: media.some((m) => m.type === "video" || m.type === "animated_gif"),
            hasPhoto: media.some((m) => m.type === "photo"),
            media,
          },
        });
      }

      // photo
      if (mode === "photo") {
        const pics = t.media.filter((x) => x.type === "photo");
        if (!pics.length) {
          return res
            .status(404)
            .json({ status: false, message: "Tweet ini tidak ada foto." });
        }
        return res.json({
          status: true,
          result: {
            id: t.id,
            url: `https://x.com/${t.author.username}/status/${t.id}`,
            text: t.text,
            author: slimAuthor(t.author),
            mode: "photo",
            count: pics.length,
            photos: pics.map((p) => ({ width: p.width, height: p.height, url: p.image })),
          },
        });
      }

      // gif
      if (mode === "gif") {
        const gif = t.media.find(
          (x) => x.type === "animated_gif" && x.variants?.length
        );
        if (!gif) {
          return res
            .status(404)
            .json({ status: false, message: "Tweet ini tidak ada GIF." });
        }
        const v = pickVariant(gif, "best");
        return res.json({
          status: true,
          result: {
            id: t.id,
            url: `https://x.com/${t.author.username}/status/${t.id}`,
            text: t.text,
            author: slimAuthor(t.author),
            mode: "gif",
            download_url: v.url,
            bitrate: v.bitrate,
            width: gif.width,
            height: gif.height,
          },
        });
      }

      // best / 4k / 2k / 1080p / 720p / 480p
      const vid = t.media.find(
        (x) => (x.type === "video" || x.type === "animated_gif") && x.variants?.length
      );
      if (!vid) {
        return res
          .status(404)
          .json({ status: false, message: "Tweet ini tidak ada video." });
      }
      const v = pickVariant(vid, mode);
      if (!v) {
        return res.status(404).json({
          status: false,
          message: `Tidak ada variant video untuk mode '${mode}'.`,
        });
      }
      const height = variantHeight(v.url) || vid.height;
      return res.json({
        status: true,
        result: {
          id: t.id,
          url: `https://x.com/${t.author.username}/status/${t.id}`,
          text: t.text,
          author: slimAuthor(t.author),
          engagement: t.engagement,
          createdAt: t.createdAt,
          mode: "video",
          quality: `${height}p`,
          download_url: v.url,
          bitrate: v.bitrate,
          width: vid.width,
          height: vid.height,
          durationMs: vid.durationMs,
          thumbnail: vid.image,
          hls: vid.hls || null,
          all_variants: fmtVariants(vid.variants),
        },
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses request.",
      });
    }
  },
};
