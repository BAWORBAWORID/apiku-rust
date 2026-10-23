/**
 * Roblox Stalker + Rolimon's Multi-Entity Scraper
 * Source: rolimons.com + roblox.com APIs
 * Features: user profile, items/limiteds, games, groups, players
 */
import axios from "axios";
import logger from "../../src/utils/logger.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15";
const HEADERS = {
  "User-Agent": UA,
  "Accept": "text/html,application/json,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.rolimons.com/"
};

// ── Cache ──
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, item] of cache.entries()) {
    if (now > item.expires) cache.delete(key);
  }
}, 60_000);

function getCached(key) {
  const item = cache.get(key);
  if (item && Date.now() < item.expires) return item.data;
  return null;
}
function setCache(key, data) {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL });
}

// ── Fetch helpers ──
async function fetchJson(url, opts = {}) {
  const res = await axios.get(url, {
    headers: { ...HEADERS, ...opts.headers },
    timeout: opts.timeout || 15_000,
    ...opts
  });
  return res.data;
}

async function fetchHtml(url) {
  const res = await axios.get(url, {
    headers: { ...HEADERS, ...opts },
    timeout: 15_000
  });
  return res.data;
}

function sanitize(obj, fallback = "") {
  if (obj === null || obj === undefined) return fallback;
  if (Array.isArray(obj)) return obj.map(i => sanitize(i, fallback));
  if (typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) {
        if (k.endsWith("_count") || k.endsWith("_score") || k.endsWith("_id") || k.endsWith("_price") || k === "rap" || k === "value" || k === "rank" || k === "playing" || k === "visits" || k === "favorites" || k === "upvotes" || k === "downvotes") {
          out[k] = 0;
        } else if (k.startsWith("is_") || k.startsWith("has_") || k === "premium" || k === "privacy_enabled") {
          out[k] = false;
        } else if (Array.isArray(v)) {
          out[k] = [];
        } else if (typeof v === "object") {
          out[k] = {};
        } else {
          out[k] = "";
        }
      } else {
        out[k] = sanitize(v, fallback);
      }
    }
    return out;
  }
  return obj;
}

// ══════════════════════════════════════════
// 1. USER / PLAYER
// ══════════════════════════════════════════

async function getUserId(username) {
  const res = await axios.post("https://users.roblox.com/v1/usernames/users", {
    usernames: [username],
    excludeBannedUsers: false
  });
  return res.data?.data?.[0]?.id || null;
}

async function getUserProfile(userId) {
  const [basic, friends, followers, followings, headshot] = await Promise.allSettled([
    axios.get(`https://users.roblox.com/v1/users/${userId}`),
    axios.get(`https://friends.roblox.com/v1/users/${userId}/friends/count`),
    axios.get(`https://friends.roblox.com/v1/users/${userId}/followers/count`),
    axios.get(`https://friends.roblox.com/v1/users/${userId}/followings/count`).catch(() => ({ data: { count: 0 } })),
    axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`)
  ]);
  const b = basic.status === "fulfilled" ? basic.value.data : {};
  const f = friends.status === "fulfilled" ? friends.value.data : {};
  const fl = followers.status === "fulfilled" ? followers.value.data : {};
  const fo = followings.status === "fulfilled" ? followings.value.data : {};
  const h = headshot.status === "fulfilled" ? (headshot.value.data?.data || []) : [];
  return {
    user_id: userId,
    username: b.name || "",
    display_name: b.displayName || "",
    description: b.description || "",
    avatar_url: h[0]?.imageUrl || `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=150&height=150&format=png`,
    created: b.created || "",
    is_banned: b.isBanned || false,
    has_verified_badge: b.hasVerifiedBadge || false,
    friends_count: f.count || 0,
    followers_count: fl.count || 0,
    followings_count: fo.count || 0,
    roblox_url: `https://www.roblox.com/users/${userId}/profile`
  };
}

async function searchPlayers(query, limit = 20) {
  const cleanQ = String(query || "").trim().substring(0, 22);
  if (!cleanQ) throw new Error("Query wajib diisi");
  const data = await fetchJson(`https://api.rolimons.com/players/v1/playersearch?searchstring=${encodeURIComponent(cleanQ)}`);
  if (!data?.success) return { query: cleanQ, total_found: 0, players: [] };
  const players = (data.players || []).map(p => ({
    player_id: p[0] || 0,
    username: p[1] || "",
    avatar_url: `https://www.roblox.com/headshot-thumbnail/image?userId=${p[0]}&width=150&height=150&format=png`,
    url: `https://www.rolimons.com/player/${p[0]}`
  }));
  return sanitize({ query: cleanQ, total_found: players.length, players: players.slice(0, limit) });
}

async function getPlayerDetail(playerId) {
  const pid = String(playerId).trim();
  if (!pid || !/^\d+$/.test(pid)) throw new Error("Player ID harus numeric");
  const [roliInfoRes, roliAssetsRes, robloxUserRes, robloxHeadshotRes] = await Promise.allSettled([
    fetchJson(`https://api.rolimons.com/players/v1/playerinfo/${pid}`),
    fetchJson(`https://api.rolimons.com/players/v1/playerassets/${pid}`),
    fetchJson(`https://users.roblox.com/v1/users/${pid}`),
    fetchJson(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${pid}&size=150x150&format=Png&isCircular=false`)
  ]);
  const ri = roliInfoRes.status === "fulfilled" ? roliInfoRes.value : {};
  const ra = roliAssetsRes.status === "fulfilled" ? roliAssetsRes.value : {};
  const ru = robloxUserRes.status === "fulfilled" ? robloxUserRes.value : {};
  const rh = robloxHeadshotRes.status === "fulfilled" ? (robloxHeadshotRes.value.data || []) : [];
  const avatarUrl = rh.length > 0 ? rh[0].imageUrl : `https://www.roblox.com/headshot-thumbnail/image?userId=${pid}&width=150&height=150&format=png`;
  const collectibles = ra.playerAssets ? Object.entries(ra.playerAssets).map(([aid, uaidList]) => ({
    asset_id: parseInt(aid, 10) || 0,
    copies_owned: Array.isArray(uaidList) ? uaidList.length : 1,
    item_url: `https://www.rolimons.com/item/${aid}`
  })) : [];
  return sanitize({
    player_id: parseInt(pid, 10),
    username: ru.name || ri.name || `User_${pid}`,
    display_name: ru.displayName || ru.name || "",
    description: ru.description || "",
    avatar_url: avatarUrl,
    url: `https://www.rolimons.com/player/${pid}`,
    roblox_url: `https://www.roblox.com/users/${pid}/profile`,
    created: ru.created || "",
    is_banned: ru.isBanned || ri.terminated || false,
    has_verified_badge: ru.hasVerifiedBadge || ra.playerVerified || false,
    premium: ri.premium || ra.premium || false,
    value: ri.value || 0,
    rap: ri.rap || 0,
    rank: ri.rank || 0,
    last_online: ri.last_online ? new Date(ri.last_online * 1000).toISOString() : "",
    last_location: ri.last_location || ra.lastLocation || "Offline",
    is_online: ra.isOnline || false,
    collectibles_count: collectibles.length,
    collectibles_sample: collectibles.slice(0, 15)
  });
}

// ══════════════════════════════════════════
// 2. ITEMS / LIMITEDS
// ══════════════════════════════════════════

const DEMAND_LABELS = { "-1": "None", "0": "Terrible", "1": "Low", "2": "Normal", "3": "High", "4": "Amazing" };
const TREND_LABELS = { "-1": "None", "0": "Lowering", "1": "Unstable", "2": "Stable", "3": "Raising", "4": "Fluctuating" };

let itemsCache = null;
let itemsCacheTime = 0;

async function getItemsData() {
  if (itemsCache && (Date.now() - itemsCacheTime < CACHE_TTL)) return itemsCache;
  const [details, thumbs] = await Promise.all([
    fetchJson("https://api.rolimons.com/items/v3/itemdetails"),
    fetchJson("https://api.rolimons.com/itemthumbs/v2/thumbssm").catch(() => ({}))
  ]);
  itemsCache = { details, thumbs };
  itemsCacheTime = Date.now();
  return itemsCache;
}

async function searchItems(query, limit = 20) {
  const { details, thumbs } = await getItemsData();
  const q = String(query || "").toLowerCase().trim();
  const assets = details.assets || {};
  const bundles = details.bundles || {};
  const tA = thumbs.assets || {};
  const tB = thumbs.bundles || {};
  const matches = [];
  const check = (id, data, isBundle = false) => {
    const name = data[0] || "";
    const acronym = data[1] || "";
    if (!q || name.toLowerCase().includes(q) || acronym.toLowerCase().includes(q) || id === q) {
      matches.push({
        item_id: parseInt(id, 10),
        item_type: isBundle ? "bundle" : "asset",
        name, acronym: acronym || "",
        rap: data[2] || 0,
        value: data[3] === -1 ? (data[4] || data[2] || 0) : data[3],
        default_value: data[4] || data[2] || 0,
        demand: DEMAND_LABELS[String(data[5])] || "None",
        trend: TREND_LABELS[String(data[6])] || "None",
        is_projected: data[7] === 1,
        is_hyped: data[8] === 1,
        is_rare: data[9] === 1,
        thumbnail_url: isBundle ? (tB[id] || "") : (tA[id] || ""),
        url: `https://www.rolimons.com/${isBundle ? "bundle" : "item"}/${id}`
      });
    }
  };
  for (const [id, data] of Object.entries(assets)) check(id, data, false);
  for (const [id, data] of Object.entries(bundles)) check(id, data, true);
  matches.sort((a, b) => (b.value || b.rap) - (a.value || a.rap));
  return sanitize({ query: q, total_found: matches.length, items: matches.slice(0, limit) });
}

async function getItemDetail(itemId) {
  const id = String(itemId).trim();
  if (!id || !/^\d+$/.test(id)) throw new Error("Item ID harus numeric");
  const { details, thumbs } = await getItemsData();
  const isBundle = !!(details.bundles && details.bundles[id]);
  const rawItem = (details.assets && details.assets[id]) || (details.bundles && details.bundles[id]);
  const [economyRes, htmlRes] = await Promise.allSettled([
    fetchJson(`https://economy.roblox.com/v2/assets/${id}/details`),
    fetchHtml(`https://www.rolimons.com/${isBundle ? "bundle" : "item"}/${id}`)
  ]);
  const economy = economyRes.status === "fulfilled" ? economyRes.value : {};
  const cDetails = economy.CollectiblesItemDetails || {};
  let htmlData = {};
  if (htmlRes.status === "fulfilled") {
    const html = htmlRes.value;
    const dm = html.match(/var\s+item_details_data\s*=\s*(\{[\s\S]*?\});/);
    if (dm) try { htmlData = JSON.parse(dm[1]); } catch {}
    const cm = html.match(/var\s+all_copies_data_count\s*=\s*(\d+);/);
    if (cm) htmlData.all_copies_count = parseInt(cm[1], 10);
  }
  const thumb = isBundle ? (thumbs.bundles?.[id] || "") : (thumbs.assets?.[id] || "");
  return sanitize({
    item_id: parseInt(id, 10),
    name: economy.Name || htmlData.item_name || (rawItem ? rawItem[0] : `Item ${id}`),
    acronym: rawItem?.[1] || "",
    description: economy.Description || htmlData.description || "",
    item_type: isBundle ? "bundle" : "asset",
    rap: rawItem ? rawItem[2] : (htmlData.rap || 0),
    value: rawItem ? (rawItem[3] === -1 ? (rawItem[4] || rawItem[2] || 0) : rawItem[3]) : (htmlData.value || 0),
    lowest_resale_price: cDetails.CollectibleLowestResalePrice || economy.PriceInRobux || 0,
    original_price: economy.PriceInRobux || 0,
    total_quantity: cDetails.TotalQuantity || htmlData.all_copies_count || 0,
    creator: economy.Creator ? {
      id: economy.Creator.Id || 0,
      name: economy.Creator.Name || "Roblox",
      type: economy.Creator.CreatorType || "User"
    } : { id: 1, name: "Roblox", type: "User" },
    demand: rawItem ? (DEMAND_LABELS[String(rawItem[5])] || "None") : "None",
    trend: rawItem ? (TREND_LABELS[String(rawItem[6])] || "None") : "None",
    is_projected: rawItem ? rawItem[7] === 1 : false,
    is_hyped: rawItem ? rawItem[8] === 1 : false,
    is_rare: rawItem ? rawItem[9] === 1 : false,
    created: economy.Created || "",
    updated: economy.Updated || "",
    thumbnail_url: thumb,
    url: `https://www.rolimons.com/${isBundle ? "bundle" : "item"}/${id}`,
    roblox_url: `https://www.roblox.com/catalog/${id}`
  });
}

// ══════════════════════════════════════════
// 3. GAMES
// ══════════════════════════════════════════

let gamesCache = null;
let gamesCacheTime = 0;

async function getGamesData() {
  if (gamesCache && (Date.now() - gamesCacheTime < CACHE_TTL)) return gamesCache;
  gamesCache = await fetchJson("https://api.rolimons.com/games/v1/gamelist");
  gamesCacheTime = Date.now();
  return gamesCache;
}

async function searchGames(query, limit = 20) {
  const data = await getGamesData();
  const q = String(query || "").toLowerCase().trim();
  const gamesObj = data.games || {};
  const matches = [];
  for (const [id, info] of Object.entries(gamesObj)) {
    const name = info[0] || "";
    if (!q || name.toLowerCase().includes(q) || id === q) {
      matches.push({
        place_id: parseInt(id, 10),
        name,
        playing_count: info[1] || 0,
        icon_url: info[2] || "",
        url: `https://www.rolimons.com/game/${id}`
      });
    }
  }
  matches.sort((a, b) => b.playing_count - a.playing_count);
  return sanitize({ query: q, total_found: matches.length, games: matches.slice(0, limit) });
}

async function getGameDetail(placeId) {
  const pid = String(placeId).trim();
  if (!pid || !/^\d+$/.test(pid)) throw new Error("Place ID harus numeric");
  let universeId = null;
  try {
    const uniRes = await fetchJson(`https://apis.roblox.com/universes/v1/places/${pid}/universe`);
    universeId = uniRes.universeId;
  } catch {}
  const [roliRes, universeRes, votesRes, favsRes] = await Promise.allSettled([
    fetchHtml(`https://www.rolimons.com/game/${pid}`),
    universeId ? fetchJson(`https://games.roblox.com/v1/games?universeIds=${universeId}`) : Promise.reject(),
    universeId ? fetchJson(`https://games.roblox.com/v1/games/${universeId}/votes`) : Promise.reject(),
    universeId ? fetchJson(`https://games.roblox.com/v1/games/${universeId}/favorites/count`) : Promise.reject()
  ]);
  let rolimonsStats = {};
  let gameTitle = "";
  if (roliRes.status === "fulfilled") {
    const html = roliRes.value;
    const tm = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (tm) gameTitle = tm[1].replace(/<[^>]+>/g, "").trim();
    const sr = /<div[^>]*class="[^"]*(?:stat|profile)[^"]*"[^>]*>[\s\S]*?<div[^>]*class="[^"]*header[^"]*"[^>]*>([\s\S]*?)<\/div>[\s\S]*?<div[^>]*class="[^"]*data[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let m;
    while ((m = sr.exec(html)) !== null) {
      const k = m[1].replace(/<[^>]+>/g, "").trim().toLowerCase().replace(/\s+/g, "_");
      const v = m[2].replace(/<[^>]+>/g, "").trim();
      if (k && v && !rolimonsStats[k]) rolimonsStats[k] = v;
    }
  }
  const uData = universeRes.status === "fulfilled" && universeRes.value?.data?.[0] ? universeRes.value.data[0] : {};
  const vData = votesRes.status === "fulfilled" ? votesRes.value : {};
  const fData = favsRes.status === "fulfilled" ? favsRes.value : {};
  const upvotes = vData.upVotes ?? (rolimonsStats.upvotes ? parseInt(rolimonsStats.upvotes.replace(/,/g, ""), 10) : 0);
  const downvotes = vData.downVotes ?? (rolimonsStats.downvotes ? parseInt(rolimonsStats.downvotes.replace(/,/g, ""), 10) : 0);
  return sanitize({
    place_id: parseInt(pid, 10),
    universe_id: universeId || 0,
    name: uData.name || gameTitle || `Place ${pid}`,
    description: uData.description || "",
    url: `https://www.rolimons.com/game/${pid}`,
    roblox_url: `https://www.roblox.com/games/${pid}`,
    creator: uData.creator ? { id: uData.creator.id || 0, name: uData.creator.name || "", type: uData.creator.type || "User" } : { id: 0, name: rolimonsStats.created_by || "Unknown", type: "User" },
    playing: uData.playing ?? 0,
    visits: uData.visits ?? 0,
    favorites: fData.favoritesCount ?? 0,
    upvotes, downvotes,
    rating: (upvotes + downvotes > 0) ? `${((upvotes / (upvotes + downvotes)) * 100).toFixed(2)}%` : "0%",
    max_players: uData.maxPlayers ?? 0,
    genre: uData.genre || rolimonsStats.genre || "All",
    created: uData.created || rolimonsStats.created || "",
    updated: uData.updated || rolimonsStats.game_updated || ""
  });
}

// ══════════════════════════════════════════
// 4. GROUPS
// ══════════════════════════════════════════

async function searchGroups(query, limit = 30) {
  const cleanQ = String(query || "").trim().substring(0, 25);
  if (!cleanQ) throw new Error("Query wajib diisi");
  const data = await fetchJson(`https://api.rolimons.com/groups/v1/groupsearch?searchstring=${encodeURIComponent(cleanQ)}`);
  if (!data?.success) return { query: cleanQ, total_found: 0, groups: [] };
  const groups = (data.groups || []).map(g => ({
    group_id: g[0] || 0,
    name: g[1] || "",
    member_count: g[5] || 0,
    is_public: g[3] === 1,
    is_locked: g[4] === 1,
    url: `https://www.rolimons.com/group/${g[0]}`
  }));
  return sanitize({ query: cleanQ, total_found: groups.length, groups: groups.slice(0, limit) });
}

async function getGroupDetail(groupId) {
  const gid = String(groupId).trim();
  if (!gid || !/^\d+$/.test(gid)) throw new Error("Group ID harus numeric");
  const [roliInfoRes, robloxInfoRes, robloxRolesRes, robloxGamesRes, robloxIconRes] = await Promise.allSettled([
    fetchHtml(`https://www.rolimons.com/group/${gid}`),
    fetchJson(`https://groups.roblox.com/v1/groups/${gid}`),
    fetchJson(`https://groups.roblox.com/v1/groups/${gid}/roles`),
    fetchJson(`https://games.roblox.com/v2/groups/${gid}/games?accessFilter=All&sortOrder=Asc&limit=25`),
    fetchJson(`https://thumbnails.roblox.com/v1/groups/icons?groupIds=${gid}&size=420x420&format=Png&isCircular=false`)
  ]);
  let rolimonsTracking = {};
  if (roliInfoRes.status === "fulfilled") {
    const html = roliInfoRes.value;
    const sr = /<div[^>]*class="[^"]*top_profile_stat_header[^"]*"[^>]*>([\s\S]*?)<\/div>[\s\S]*?<(?:div|a)[^>]*class="[^"]*top_profile_stat_data[^"]*"[^>]*>([\s\S]*?)<\/(?:div|a)>/gi;
    let m;
    while ((m = sr.exec(html)) !== null) {
      const k = m[1].replace(/<[^>]+>/g, "").trim().toLowerCase().replace(/\s+/g, "_");
      const v = m[2].replace(/<[^>]+>/g, "").trim();
      if (k && v && !rolimonsTracking[k]) rolimonsTracking[k] = v;
    }
  }
  const ri = robloxInfoRes.status === "fulfilled" ? robloxInfoRes.value : {};
  const roles = robloxRolesRes.status === "fulfilled" ? (robloxInfoRes.value?.roles || robloxRolesRes.value?.roles || []) : (robloxRolesRes.value?.roles || []);
  const games = robloxGamesRes.status === "fulfilled" ? (robloxGamesRes.value?.data || []) : [];
  const icon = robloxIconRes.status === "fulfilled" ? (robloxIconRes.value?.data || []) : [];
  const owner = ri.owner ? {
    user_id: ri.owner.userId || 0,
    username: ri.owner.username || "",
    display_name: ri.owner.displayName || ""
  } : { user_id: 0, username: rolimonsTracking.owned_by || "Unknown", display_name: "" };
  return sanitize({
    group_id: parseInt(gid, 10),
    name: ri.name || `Group ${gid}`,
    description: ri.description || "",
    icon_url: icon.length > 0 ? icon[0].imageUrl : "",
    url: `https://www.rolimons.com/group/${gid}`,
    roblox_url: `https://www.roblox.com/groups/${gid}`,
    member_count: ri.memberCount ?? 0,
    is_locked: ri.isLocked || false,
    public_entry_allowed: ri.publicEntryAllowed ?? (rolimonsTracking.access === "Public"),
    has_verified_badge: ri.hasVerifiedBadge || false,
    owner,
    rolimons_tracking: rolimonsTracking,
    roles_count: roles.length,
    roles: roles.map(r => ({ id: r.id || 0, name: r.name || "", rank: r.rank || 0, member_count: r.memberCount || 0 })),
    games_count: games.length,
    games: games.map(g => ({
      universe_id: g.id || 0,
      name: g.name || "",
      root_place_id: g.rootPlace?.id || 0,
      game_url: g.rootPlace ? `https://www.rolimons.com/game/${g.rootPlace.id}` : ""
    }))
  });
}

// ══════════════════════════════════════════
// EXPORT ENDPOINT
// ══════════════════════════════════════════

export default {
  name: "Roblox Stalker",
  description: "Stalk & search Roblox users, limited items, games, and groups",
  category: "Stalker",
  methods: ["GET", "POST"],
  params: ["action"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      description: "Action to perform",
      example: "user",
      enum: [
        "user", "search-player", "player-detail",
        "search-item", "item-detail",
        "search-game", "game-detail",
        "search-group", "group-detail"
      ]
    },
    query: { type: "string", required: false, description: "Search query", example: "Builderman" },
    id: { type: "string", required: false, description: "Numeric ID (userId, itemId, placeId, groupId)", example: "3056" },
    limit: { type: "number", required: false, description: "Max results (default 20)", example: 10 }
  },

  async run(req, res) {
    const { action, query, id, limit } = { ...req.query, ...req.body };

    if (!action) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'action' wajib diisi",
        available_actions: {
          "user": "Stalk user by username (Roblox API)",
          "search-player": "Search players (Rolimon's)",
          "player-detail": "Player detail + collectibles (Rolimon's + Roblox)",
          "search-item": "Search limited items (Rolimon's)",
          "item-detail": "Limited item detail — RAP, value, demand (Rolimon's + Economy)",
          "search-game": "Search games (Rolimon's)",
          "game-detail": "Game detail — playing, visits, rating (Rolimon's + Roblox)",
          "search-group": "Search groups (Rolimon's)",
          "group-detail": "Group detail — members, roles, games (Rolimon's + Roblox)"
        }
      });
    }

    try {
      let result;
      switch (action) {
        // ── User (original stalker) ──
        case "user": {
          const username = query || id;
          if (!username) return res.status(400).json({ status: false, message: "Parameter 'query' (username) wajib diisi" });
          const ck = `user:${username.toLowerCase()}`;
          const cached = getCached(ck);
          if (cached) return res.json({ status: true, source: "cache", action, result: cached });
          const userId = await getUserId(username);
          if (!userId) return res.status(404).json({ status: false, message: `User '${username}' tidak ditemukan` });
          result = await getUserProfile(userId);
          setCache(ck, result);
          break;
        }

        // ── Players ──
        case "search-player": {
          if (!query) return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi" });
          result = await searchPlayers(query, parseInt(limit) || 20);
          break;
        }
        case "player-detail": {
          if (!id) return res.status(400).json({ status: false, message: "Parameter 'id' (playerId) wajib diisi" });
          result = await getPlayerDetail(id);
          break;
        }

        // ── Items/Limiteds ──
        case "search-item": {
          result = await searchItems(query || "", parseInt(limit) || 20);
          break;
        }
        case "item-detail": {
          if (!id) return res.status(400).json({ status: false, message: "Parameter 'id' (itemId) wajib diisi" });
          result = await getItemDetail(id);
          break;
        }

        // ── Games ──
        case "search-game": {
          result = await searchGames(query || "", parseInt(limit) || 20);
          break;
        }
        case "game-detail": {
          if (!id) return res.status(400).json({ status: false, message: "Parameter 'id' (placeId) wajib diisi" });
          result = await getGameDetail(id);
          break;
        }

        // ── Groups ──
        case "search-group": {
          if (!query) return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi" });
          result = await searchGroups(query, parseInt(limit) || 30);
          break;
        }
        case "group-detail": {
          if (!id) return res.status(400).json({ status: false, message: "Parameter 'id' (groupId) wajib diisi" });
          result = await getGroupDetail(id);
          break;
        }

        default:
          return res.status(400).json({
            status: false,
            message: `Action '${action}' tidak valid`,
            available_actions: ["user", "search-player", "player-detail", "search-item", "item-detail", "search-game", "game-detail", "search-group", "group-detail"]
          });
      }
      return res.json({ status: true, action, result });
    } catch (err) {
      logger.error(`[RobloxStalker] ${action} error: ${err.message}`);
      return res.status(500).json({ status: false, message: err.message || "Internal server error" });
    }
  }
};
