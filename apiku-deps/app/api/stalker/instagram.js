/**
 * Instagram Profile & Analytics Stalker API
 * GET/POST /api/stalker/instagram?username=techskyfi
 */

import fs from "node:fs";
import puppeteer from "puppeteer";
import logger from "../../src/utils/logger.js";
import { getChromePath } from "../../src/utils/chromePath.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
const BASE = "https://instashadow.com";
const CF_MAX_ATTEMPTS = 5;
const CF_WAIT_MS = 9000;
const DATA_WAIT_MS = 40000;

/* ===============================
   IN-MEMORY CACHE (1 JAM)
=============================== */
const cache = new Map();
const pendingRequests = new Map();
const CACHE_TTL = 60 * 60 * 1000;
const CLEANUP_INTERVAL = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, item] of cache.entries()) {
    if (now > item.expires) {
      cache.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.info(`[INSTAGRAM STALKER] Cleaned ${cleaned} expired cache entries`);
  }
}, CLEANUP_INTERVAL);

function getFromCache(username) {
  const item = cache.get(username.toLowerCase());
  if (item && Date.now() < item.expires) {
    item.hits++;
    return item;
  }
  return null;
}

function saveToCache(username, data) {
  const key = username.toLowerCase();
  cache.set(key, {
    data,
    expires: Date.now() + CACHE_TTL,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + CACHE_TTL).toISOString(),
    hits: 1,
  });
  logger.info(`[INSTAGRAM STALKER] Cache created for @${username}`);
}

/* ===============================
   HELPERS
=============================== */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChromeBinary() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  try {
    return getChromePath();
  } catch {
    return null;
  }
}

export function cleanUsername(input) {
  if (!input) return "";
  let u = String(input).trim();
  u = u.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "");
  u = u.replace(/^@+/, "");
  u = u.replace(/[?#].*$/, "");
  u = u.replace(/\/+$/, "");
  return u.toLowerCase();
}

export function decodeMediaUrl(rawToken) {
  if (!rawToken) return null;
  const reversed = String(rawToken).split("").reverse().join("");
  return `${BASE}/media?id=${encodeURIComponent(reversed)}`;
}

/**
 * Ubah angka ringkas InstaShadow ("12.4k", "1.2M", "890") menjadi angka.
 * Number("12.4k") menghasilkan NaN, jadi harus diparse manual.
 */
export function parseCount(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  const raw = String(value).trim().replace(/\s/g, "");
  const match = raw.match(/^([\d.]+)\s*([kmb])?/i);
  if (!match) return 0;

  const base = parseFloat(match[1]);
  if (!Number.isFinite(base)) return 0;

  const suffix = (match[2] || "").toLowerCase();
  const multiplier = suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : suffix === "b" ? 1e9 : 1;
  return Math.round(base * multiplier);
}

const DAYS = ["", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

/* ===============================
   INSTASHADOW SCRAPER CORE
=============================== */
async function scrapeInstaShadow(username) {
  const targetUser = cleanUsername(username);
  if (!targetUser) throw new Error("Username Instagram tidak valid");

  const executablePath = findChromeBinary();

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: executablePath || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1366,900",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

    let rawData = null;
    let lastAnalyticsBody = null;

    page.on("response", async (res) => {
      const url = res.url();
      if (!url.includes("/api/analytics") || res.request().method() !== "POST") return;
      try {
        const text = await res.text();
        lastAnalyticsBody = text;
        const json = JSON.parse(text);
        if (json && (json.u || json.er)) rawData = json;
      } catch {
        /* abaikan body non-JSON */
      }
    });

    const targetUrl = `${BASE}/analytics?username=${encodeURIComponent(targetUser)}`;

    // Cloudflare interstitial bersifat intermiten; coba berulang sampai lolos.
    let cleared = false;
    for (let attempt = 1; attempt <= CF_MAX_ATTEMPTS; attempt++) {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
      await sleep(CF_WAIT_MS);
      const title = await page.title();
      if (!/just a moment/i.test(title) && !/checking/i.test(title)) {
        cleared = true;
        logger.info(`[INSTAGRAM STALKER] Cloudflare cleared @${targetUser} (attempt ${attempt})`);
        break;
      }
      logger.info(`[INSTAGRAM STALKER] Cloudflare challenge @${targetUser} (attempt ${attempt})`);
    }

    if (!cleared) {
      throw new Error("Cloudflare challenge tidak berhasil dilewati.");
    }

    // Halaman tidak otomatis melakukan pencarian; jalankan form-nya.
    await page.waitForSelector("#searchInput", { timeout: 20000 });
    await page.click("#searchInput", { clickCount: 3 });
    await page.type("#searchInput", targetUser, { delay: 60 });
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((x) =>
        /search/i.test(x.innerText || ""),
      );
      if (btn) btn.click();
    });

    const dataStart = Date.now();
    while (!rawData && Date.now() - dataStart < DATA_WAIT_MS) {
      await sleep(1200);
    }

    if (!rawData || !rawData.u) {
      const pageError = await page.evaluate(() => {
        const el =
          document.getElementById("searchError") ||
          document.querySelector(".error-message");
        return el ? el.textContent.trim() : "";
      });
      if (pageError) throw new Error(`InstaShadow: ${pageError}`);

      const turnstileLen = await page.evaluate(() => {
        const el = document.querySelector("[name=cf-turnstile-response]");
        return el ? String(el.value || "").length : 0;
      });

      throw new Error(
        turnstileLen === 0
          ? "Turnstile belum solved — InstaShadow menolak tanpa token yang valid."
          : `Gagal mengambil data analytics. Server membalas: ${
              lastAnalyticsBody ? lastAnalyticsBody.slice(0, 80) : "kosong"
            }`,
      );
    }

    const u = rawData.u || {};

    const profile = {
      id: u.id || "",
      username: u.u || targetUser,
      fullName: u.fn || "",
      category: u.c || "",
      biography: u.b || "",
      avatarUrl: decodeMediaUrl(u.pp || u.hpp || ""),
      instagramUrl: `https://www.instagram.com/${u.u || targetUser}`,
      postsCount: parseCount(u.mc),
      followersCount: parseCount(u.frc),
      followersCountRaw: u.frc ?? null,
      followingCount: parseCount(u.fgc),
      country: u.co || null,
      isVerified: Boolean(u.iv),
      isPrivate: Boolean(u.ip),
      bioLinks: Array.isArray(u.bl)
        ? u.bl.map((item) => ({
            title: item.title || "",
            url: item.url || "",
            linkType: item.link_type || null,
          }))
        : [],
      relatedAccounts: Array.isArray(u.r)
        ? u.r.map((r) => ({
            id: r.id || "",
            username: r.u || "",
            fullName: r.fn || "",
            avatarUrl: decodeMediaUrl(r.pp || r.hpp || ""),
            isVerified: Boolean(r.iv),
            isPrivate: Boolean(r.ip),
          }))
        : [],
    };

    const metrics = {
      engagementRate: `${rawData.er || 0}%`,
      authenticityScore: `${100 - Number(rawData.ff || 0)}%`,
      fakeFollowersPercentage: Number(rawData.ff || 0),
      averageLikes: String(rawData.al || "0"),
      averageComments: String(rawData.ac || "0"),
      averageReach: String(rawData.av || "0"),
      changesFromLastMonth: {
        engagementRate: `${rawData.per || 0}%`,
        likes: `${rawData.pal || 0}%`,
        comments: `${rawData.pac || 0}%`,
        reach: `${rawData.pav || 0}%`,
      },
    };

    const demographics = {
      gender: {
        followers: rawData.fr
          ? {
              female: rawData.fr.f !== undefined ? `${rawData.fr.f}%` : null,
              male: rawData.fr.m !== undefined ? `${rawData.fr.m}%` : null,
              others: rawData.fr.o !== undefined ? `${rawData.fr.o}%` : null,
            }
          : null,
        following: rawData.f
          ? {
              female: rawData.f.f !== undefined ? `${rawData.f.f}%` : null,
              male: rawData.f.m !== undefined ? `${rawData.f.m}%` : null,
              others: rawData.f.o !== undefined ? `${rawData.f.o}%` : null,
            }
          : null,
      },
      accountType: {
        followers: rawData.frt
          ? {
              public: rawData.frt.p !== undefined ? `${rawData.frt.p}%` : null,
              private: rawData.frt.pr !== undefined ? `${rawData.frt.pr}%` : null,
              verified: rawData.frt.v !== undefined ? `${rawData.frt.v}%` : null,
            }
          : null,
        following: rawData.ft
          ? {
              public: rawData.ft.p !== undefined ? `${rawData.ft.p}%` : null,
              private: rawData.ft.pr !== undefined ? `${rawData.ft.pr}%` : null,
              verified: rawData.ft.v !== undefined ? `${rawData.ft.v}%` : null,
            }
          : null,
      },
      followerCountries: rawData.fc || {},
      likerCountries: rawData.flc || {},
      followerAccountAge: rawData.fa || {},
      activeLikerAccountAge: rawData.fla || {},
    };

    const content = {
      averageWords: rawData.cw || 0,
      averageChars: rawData.cl || 0,
      topHashtags: rawData.h || [],
      bestTimeToPost: {
        peakDay: DAYS[rawData.pw] || rawData.pw || null,
        peakHour: rawData.mp !== undefined ? `${rawData.mp}:00` : null,
      },
      postHeatmap: rawData.pm || {},
      engagementHeatmap: rawData.em || {},
    };

    const growthHistory = Array.isArray(rawData.hd)
      ? rawData.hd.map((h) => ({
          date: h.d,
          followers: Number(h.fr || 0),
          following: Number(h.f || 0),
          posts: Number(h.p || 0),
        }))
      : [];

    const posts = Array.isArray(rawData.p)
      ? rawData.p.map((post) => ({
          id: post.id,
          shortcode: post.co,
          url: post.co ? `https://www.instagram.com/p/${post.co}/` : null,
          thumbnailUrl: decodeMediaUrl(post.iu || post.hiu || ""),
          likes: Number(post.lc || 0),
          comments: Number(post.cc || 0),
          views: Number(post.vc || 0),
          caption: post.c || "",
          hashtags: post.h || [],
          postedAt: post.pd ? new Date(Number(post.pd) * 1000).toISOString() : null,
        }))
      : [];

    const reels = Array.isArray(rawData.r)
      ? rawData.r.map((reel) => ({
          id: reel.id,
          shortcode: reel.co,
          url: reel.co ? `https://www.instagram.com/reel/${reel.co}/` : null,
          videoMediaUrl: decodeMediaUrl(reel.vu || reel.vhu || ""),
          thumbnailUrl: decodeMediaUrl(reel.iu || reel.hu || ""),
          likes: Number(reel.lc || 0),
          comments: Number(reel.cc || 0),
          views: Number(reel.vc || 0),
          postedAt: reel.pd ? new Date(Number(reel.pd) * 1000).toISOString() : null,
        }))
      : [];

    return { profile, metrics, demographics, content, growthHistory, posts, reels };
  } finally {
    await browser.close().catch(() => {});
  }
}

/* ===============================
   ENDPOINT EXPORT (APIKU)
=============================== */
export default {
  name: "Instagram Stalker",
  description:
    "Stalker & Analitik profil Instagram lengkap (Followers, Reach, Demografi, Engagement, Posts & Reels)",
  category: "Stalker",
  methods: ["GET", "POST"],
  params: ["username"],

  paramsSchema: {
    username: {
      type: "string",
      required: true,
      default: "@techskyfi",
      description:
        "Username Instagram (bebas menggunakan @tag, username langsung, atau link profil)",
    },
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const params = { ...req.query, ...req.body };
      const rawUser = params.username || params.user || params.target;

      if (!rawUser || typeof rawUser !== "string" || rawUser.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'username' wajib diisi (contoh: @techskyfi)",
        });
      }

      const cleanUser = cleanUsername(rawUser);
      if (!cleanUser) {
        return res.status(400).json({ status: false, message: "Format username Instagram tidak valid" });
      }

      const cached = getFromCache(cleanUser);
      if (cached) {
        logger.info(`[INSTAGRAM STALKER] Cache hit @${cleanUser} (#${cached.hits})`);
        return res.json({
          status: true,
          cached: true,
          cacheExpiresAt: cached.expiresAt,
          cacheHits: cached.hits,
          duration: `${Date.now() - startTime}ms`,
          result: cached.data,
        });
      }

      let promise = pendingRequests.get(cleanUser);
      if (!promise) {
        promise = scrapeInstaShadow(cleanUser)
          .then((data) => {
            saveToCache(cleanUser, data);
            pendingRequests.delete(cleanUser);
            return data;
          })
          .catch((err) => {
            pendingRequests.delete(cleanUser);
            throw err;
          });
        pendingRequests.set(cleanUser, promise);
      }

      const data = await promise;

      return res.json({
        status: true,
        cached: false,
        cacheExpiresAt: new Date(Date.now() + CACHE_TTL).toISOString(),
        duration: `${Date.now() - startTime}ms`,
        result: data,
      });
    } catch (err) {
      logger.error(`[INSTAGRAM STALKER ERROR]: ${err.message}`);
      const msg = err.message || "Gagal memproses stalking Instagram";
      const is404 = /tidak ditemukan|not found|private/i.test(msg);
      const isCaptcha = /turnstile|cloudflare/i.test(msg);
      return res.status(is404 ? 404 : isCaptcha ? 503 : 500).json({
        status: false,
        message: msg,
        duration: `${Date.now() - startTime}ms`,
      });
    }
  },
};
