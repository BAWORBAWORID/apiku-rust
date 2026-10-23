/**
 * Reach CH VIP — WhatsApp Channel Reaction Automation & Auto-Detector
 * Fitur   : 
 *   - Auto Detect Channel: membedakan link postingan vs link profil channel.
 *   - Stalk Channel: membaca info channel jika input adalah link profil channel (nama, followers, deskripsi, avatar).
 *   - Mengirim reaksi emoji ke postingan channel WhatsApp via ReactionWA VIP Engine.
 *   - Auto Generate VIP Key saat limit harian API habis.
 *   - Multi-Emoji: mendukung hingga 5 emoji dalam satu antrean.
 *   - Sinkron & Asinkron (wait=true / wait=false).
 * 
 * GET  /api/fun/reach-ch-vip?link=<url>&emoji=<emoji>
 * POST /api/fun/reach-ch-vip -d {"link": "...", "emoji": "..."}
 */

import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import logger from '../../src/utils/logger.js';

const KEY_FILE = path.resolve(process.cwd(), 'data/key-reach.json');
const API_ENDPOINT = 'https://apiv2.reactionwa.online/api/v2/react';
const GENERATE_ENDPOINT = 'https://apiv2.reactionwa.online/api/v2/generate_key';

const POST_RE = /(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9_-]+)\/(\d+)/i;
const CHANNEL_PROFILE_RE = /(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9_-]+)\/?$/i;
const EMOJI_REGEX = /\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?/gu;

// Daftar Saluran Terlindungi (Protected Channels)
const PROTECTED_CHANNELS = new Set([]);

const VIP_PROFILES = [
  {
    vipKey: 'VIP-SYNOZG8C',
    email: 'abovezephyrax@gmail.com',
    uid: 'syNOzg8C4dfMq8CwnE0inNDNdwn1',
    domain: 'https://reactionwa.online'
  },
  {
    vipKey: 'VIP-G3FA579P',
    email: 'berrymodapk@gmail.com',
    uid: 'G3FA579Px5MLiC4zISunSqergX43',
    domain: 'https://berrymodapk.com'
  }
];

function ensureDataDir() {
  const dir = path.dirname(KEY_FILE);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }
}

function loadKey() {
  ensureDataDir();
  if (fs.existsSync(KEY_FILE)) {
    try {
      const raw = fs.readFileSync(KEY_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data && data.apiKey) {
        return data;
      }
    } catch {}
  }
  return { ...VIP_PROFILES[0] };
}

function saveKey(keyData) {
  ensureDataDir();
  try {
    fs.writeFileSync(KEY_FILE, JSON.stringify(keyData, null, 2));
  } catch (err) {
    logger.error(`[REACH-CH-VIP] Gagal menyimpan key ke ${KEY_FILE}: ${err.message}`);
  }
}

async function generateApiKey() {
  for (let i = 0; i < VIP_PROFILES.length; i++) {
    const profile = VIP_PROFILES[i];
    try {
      logger.info(`[REACH-CH-VIP] Meregenerasi VIP API Key baru menggunakan profile ${profile.vipKey}...`);

      const response = await axios.post(GENERATE_ENDPOINT, {
        vipKey: profile.vipKey,
        email: profile.email,
        domain: profile.domain,
        uid: profile.uid
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      if (response.data && response.data.success && response.data.apiKey) {
        const keyData = {
          vipKey: profile.vipKey,
          email: profile.email,
          uid: profile.uid,
          domain: profile.domain,
          apiKey: response.data.apiKey,
          updatedAt: new Date().toISOString()
        };
        saveKey(keyData);
        logger.info(`[REACH-CH-VIP] Sukses generate API Key baru: ${keyData.apiKey.slice(0, 20)}...`);
        return keyData;
      }
    } catch (err) {
      logger.warn(`[REACH-CH-VIP] Gagal generate dengan profile ${profile.vipKey}: ${err.message}`);
    }
  }

  throw new Error('Semua VIP profile gagal meregenerasi API Key baru.');
}

function shouldRegenerateKey(msg) {
  if (!msg) return false;
  const lower = String(msg).toLowerCase();
  return (
    (lower.includes('limit') && (lower.includes('harian') || lower.includes('habis') || lower.includes('api'))) ||
    lower.includes('kuota') ||
    lower.includes('depleted') ||
    lower.includes('reset besok') ||
    lower.includes('sedang sibuk') ||
    lower.includes('akses ditolak') ||
    lower.includes('whitelist') ||
    lower.includes('tidak valid') ||
    lower.includes('expired')
  );
}

function normalizeUrl(inputUrl) {
  const match = String(inputUrl || '').match(POST_RE);
  if (!match) return null;
  return `https://whatsapp.com/channel/${match[1]}/${match[2]}`;
}

function parseEmojis(inputEmoji) {
  const str = String(inputEmoji || '').trim();
  const matches = str.match(EMOJI_REGEX);
  if (!matches || matches.length === 0) return null;
  return matches.slice(0, 5).join(', ');
}

function decodeHtmlEntities(text) {
  if (!text) return text;
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x2022;/g, "•")
    .replace(/&#(\d+);/g, (_m, d) => {
      try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ""; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; }
    });
}

function extractMeta(html, property) {
  const r1 = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, "i");
  const m1 = html.match(r1);
  if (m1) return m1[1];
  const r2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, "i");
  const m2 = html.match(r2);
  if (m2) return m2[1];
  return null;
}

function parseChannelDescription(desc) {
  if (!desc) return { followers: null, followers_raw: null, cleanDescription: "" };
  const clean = decodeHtmlEntities(desc);

  const channelFormat = clean.match(/^Channel\s*•\s*([\d,.KMBkmb]+)\s*followers?\s*•\s*([\s\S]*)$/i);
  if (channelFormat) {
    const rawF = channelFormat[1].trim();
    return {
      followers_raw: `${rawF} followers`,
      followers: parseNumber(rawF),
      cleanDescription: cleanTrailingJoin(channelFormat[2].trim())
    };
  }

  const channelOnly = clean.match(/^Channel\s*•\s*([\d,.KMBkmb]+)\s*followers?\s*$/i);
  if (channelOnly) {
    const rawF = channelOnly[1].trim();
    return {
      followers_raw: `${rawF} followers`,
      followers: parseNumber(rawF),
      cleanDescription: ""
    };
  }

  const followerMatch = clean.match(/([\d,.]+)\s*followers?/i);
  if (followerMatch) {
    const rawF = followerMatch[1].trim();
    const descWithoutFollowers = clean.replace(/^[\s\S]*?\b[\d,.]+\s*followers?\s*•?\s*/i, "").trim();
    return {
      followers_raw: `${rawF} followers`,
      followers: parseNumber(rawF),
      cleanDescription: cleanTrailingJoin(descWithoutFollowers)
    };
  }

  return { followers: null, followers_raw: null, cleanDescription: cleanTrailingJoin(clean) };
}

function cleanTrailingJoin(text) {
  if (!text) return "";
  return text.replace(/\.?\s*Join\s+[\d,.KMBkmb]+\s+followers?\s+(?:to\s+|for\s+).*$/i, "").trim();
}

function parseNumber(text) {
  if (!text) return 0;
  const clean = text.replace(/,/g, "").toLowerCase();
  if (clean.includes("k")) return Math.round(parseFloat(clean) * 1000);
  if (clean.includes("m")) return Math.round(parseFloat(clean) * 1000000);
  const num = parseInt(clean);
  return isNaN(num) ? 0 : num;
}

async function stalkChannelInfo(channelUrl, customIp = null) {
  const match = channelUrl.match(CHANNEL_PROFILE_RE);
  const channelId = match ? match[1] : channelUrl.split('/').pop().split('?')[0];
  const url = `https://www.whatsapp.com/channel/${channelId}`;

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  };
  if (customIp) {
    headers["X-Forwarded-For"] = customIp;
    headers["X-Real-IP"] = customIp;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Gagal membaca info saluran WhatsApp (HTTP ${res.status})`);
  }

  const html = await res.text();
  const titleMeta = extractMeta(html, "og:title") || extractMeta(html, "twitter:title") || "";
  const avatar = extractMeta(html, "og:image") || extractMeta(html, "twitter:image") || null;
  const descMeta = extractMeta(html, "og:description") || extractMeta(html, "twitter:description") || "";
  const { followers, followers_raw, cleanDescription } = parseChannelDescription(descMeta);

  let channelName = titleMeta.replace(/ on WhatsApp$/, "").replace(/ - WhatsApp channel$/, "").trim();
  if (!channelName) channelName = channelId;

  const isVerified = html.includes('verified') || html.includes('Verified');

  return {
    channel_id: channelId,
    name: decodeHtmlEntities(channelName) || channelId,
    avatar: avatar ? decodeHtmlEntities(avatar) : null,
    description: decodeHtmlEntities(cleanDescription) || null,
    followers_raw: followers_raw || null,
    followers: followers || 0,
    verified: isVerified,
    profile_url: url
  };
}

async function sendReactionRequest(targetUrl, reactionText, keyObj) {
  const origin = keyObj.domain === '*' ? 'https://reactionwa.online' : keyObj.domain;
  const referer = origin.endsWith('/') ? origin : origin + '/';

  const response = await axios.post(API_ENDPOINT, {
    url: targetUrl,
    reaction: reactionText
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Origin': origin,
      'Referer': referer,
      'x-api-key': keyObj.apiKey,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
    },
    timeout: 45000
  });

  return response.data;
}

async function executeReaction(targetUrl, emojiString) {
  let keyData = loadKey();
  if (!keyData || !keyData.apiKey) {
    keyData = await generateApiKey();
  }

  let attempts = 0;
  const maxAttempts = VIP_PROFILES.length;
  let lastError = 'Terjadi kesalahan pada server VIP reaction';

  while (attempts < maxAttempts) {
    try {
      const result = await sendReactionRequest(targetUrl, emojiString, keyData);

      if (result && (result.success === true || result.status === 'success')) {
        const task = (result.data && result.data.task) || {};
        const vipInfo = (result.data && result.data.vip) || {};

        keyData.usage_today = result.usage_today !== undefined ? result.usage_today : (keyData.usage_today || null);
        keyData.limit = result.limit || keyData.limit || 50;
        keyData.lastUsedAt = new Date().toISOString();
        saveKey(keyData);

        return {
          status: true,
          message: result.message || 'Reaction VIP API masuk antrean.',
          data: {
            target: targetUrl,
            emojis: task.reaction_code || emojiString,
            vip_package: vipInfo.packageName || 'VIP Permanent',
            usage_today: result.usage_today || null,
            limit: result.limit || 50
          }
        };
      }

      if (result && result.error) {
        lastError = result.error;
        if (shouldRegenerateKey(lastError) && attempts < maxAttempts - 1) {
          const currIdx = VIP_PROFILES.findIndex(p => p.vipKey === keyData.vipKey);
          const nextIdx = currIdx >= 0 ? (currIdx + 1) % VIP_PROFILES.length : 0;
          logger.warn(`[REACH-CH-VIP] Error detected (${lastError}), otomatis rotasi ke profile #${nextIdx}...`);
          keyData = await generateApiKey(nextIdx);
          attempts++;
          continue;
        }
      }
    } catch (err) {
      const errData = err.response && err.response.data;
      if (errData && errData.error) {
        lastError = errData.error;
      } else {
        lastError = err.message || 'Terjadi kesalahan pada server';
      }

      if (shouldRegenerateKey(lastError) && attempts < maxAttempts - 1) {
        try {
          const currIdx = VIP_PROFILES.findIndex(p => p.vipKey === keyData.vipKey);
          const nextIdx = currIdx >= 0 ? (currIdx + 1) % VIP_PROFILES.length : 0;
          logger.warn(`[REACH-CH-VIP] Error detected (${lastError}), otomatis rotasi ke profile #${nextIdx}...`);
          keyData = await generateApiKey(nextIdx);
          attempts++;
          continue;
        } catch (genErr) {
          lastError = `Rotasi & generate key baru gagal: ${genErr.message}`;
          break;
        }
      }
    }

    attempts++;
  }

  return {
    status: false,
    error: lastError
  };
}

export default {
  name: "Reach CH VIP",
  description: "Kirim reaksi emoji otomatis ke postingan WhatsApp Channel via VIP Engine (Auto Detect Channel, Multi-Emoji, Auto Bypass Limit & Auto Key Rotation)",
  category: "Fun",
  methods: ["GET", "POST"],
  params: ["link", "emoji"],
  paramsSchema: {
    link: {
      type: "string",
      required: true,
      default: "",
      description: "Link postingan WhatsApp Channel (contoh: https://whatsapp.com/channel/0029Vb8kYQcK5cDFoQ3NAK2x/108) atau link profil channel",
      example: ""
    },
    emoji: {
      type: "string",
      required: false,
      default: "",
      description: "Emoji reaksi, bisa 1 atau beberapa emoji (contoh: 🥶, 🥵, 🔥 atau ❤️)",
      example: "❤️"
    },
    wait: {
      type: "boolean",
      required: false,
      default: true,
      description: "Tunggu hasil pemrosesan (default true). Set false untuk background mode."
    }
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const params = { ...req.query, ...req.body };
      const rawLink = String(params.link || params.url || params.channelLink || '').trim();
      const rawEmoji = params.emoji || params.emojis || '';
      const clientIp = params.ip || req?.headers?.['x-forwarded-for'] || req?.ip || null;
      const shouldWait = params.wait !== 'false' && params.wait !== false;

      if (!rawLink) {
        return res.status(400).json({
          status: false,
          time: `${Date.now() - startTime}ms`,
          error: "Parameter 'link' wajib diisi dengan link WhatsApp Channel."
        });
      }

      // 0. PROTECT: Cek apakah saluran masuk daftar dilindungi (Protected Channel)
      const extractedChannelId = (rawLink.match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i) || [])[1];
      if (extractedChannelId && PROTECTED_CHANNELS.has(extractedChannelId)) {
        logger.warn(`[REACH-CH-VIP] Akses ditolak: Saluran ${extractedChannelId} dilindungi.`);
        return res.status(403).json({
          status: false,
          time: `${Date.now() - startTime}ms`,
          error: "Saluran ini dilindungi (Protected Channel). Reaksi emoji dan reach dinonaktifkan untuk saluran ini."
        });
      }

      // 1. DETEKSI: Apakah link adalah Link Profil Channel (bukan postingan)?
      if (CHANNEL_PROFILE_RE.test(rawLink)) {
        logger.info(`[REACH-CH-VIP] Link terdeteksi sebagai PROFIL SALURAN: ${rawLink}. Membaca info saluran (Stalk CH)...`);
        
        try {
          const channelData = await stalkChannelInfo(rawLink, clientIp);
          return res.status(200).json({
            status: true,
            detected_type: "channel_profile",
            time: `${Date.now() - startTime}ms`,
            message: "Tautan terdeteksi sebagai PROFIL SALURAN WhatsApp, bukan link postingan. Reaksi emoji memerlukan link postingan spesifik (format: https://whatsapp.com/channel/<id>/<id_postingan>). Berikut informasi saluran yang terdeteksi:",
            hint: "Silakan buka saluran dan salin tautan postingan spesifik (tekan lama pesan > Bagikan / Salin Tautan) untuk mengirim reaksi emoji.",
            channel: channelData
          });
        } catch (stalkErr) {
          return res.status(400).json({
            status: false,
            detected_type: "channel_profile",
            time: `${Date.now() - startTime}ms`,
            message: "Tautan adalah profil saluran WhatsApp (bukan link postingan). Reaksi emoji memerlukan link postingan spesifik (format: https://whatsapp.com/channel/<id>/<id_postingan>).",
            error: stalkErr.message
          });
        }
      }

      // 2. DETEKSI: Apakah link adalah Link Postingan Channel yang valid?
      const normalizedUrl = normalizeUrl(rawLink);
      if (!normalizedUrl) {
        return res.status(400).json({
          status: false,
          time: `${Date.now() - startTime}ms`,
          error: "Format URL WhatsApp Channel tidak valid. Contoh: https://whatsapp.com/channel/0029VbDyL6d9RZAh3JjEM325/158"
        });
      }

      // 3. PROSES REAKSI POSTINGAN:
      const emojiString = parseEmojis(rawEmoji);
      if (!emojiString) {
        return res.status(400).json({
          status: false,
          time: `${Date.now() - startTime}ms`,
          error: 'Emoji tidak valid atau kosong. Masukkan minimal 1 emoji (contoh: "👍" atau "❤️").'
        });
      }

      logger.info(`[REACH-CH-VIP] Processing reaction [${emojiString}] -> ${normalizedUrl} (wait=${shouldWait})`);

      // Mode Asinkron / Background
      if (!shouldWait) {
        executeReaction(normalizedUrl, emojiString)
          .then(res => {
            logger.info(`[REACH-CH-VIP] Background result: ${res.status ? 'OK' : 'FAIL'} (${res.message || res.error})`);
          })
          .catch(err => {
            logger.error(`[REACH-CH-VIP] Background Error: ${err.message}`);
          });

        return res.status(200).json({
          status: true,
          time: `${Date.now() - startTime}ms`,
          message: "Reaction VIP API masuk antrean.",
          result: {
            target: normalizedUrl,
            emojis: emojiString,
            vip_package: "VIP Permanent",
            mode: "background"
          }
        });
      }

      // Mode Sinkron: Tunggu response
      const outcome = await executeReaction(normalizedUrl, emojiString);

      if (!outcome.status) {
        return res.status(500).json({
          status: false,
          time: `${Date.now() - startTime}ms`,
          error: outcome.error || "Gagal memproses reaksi ke postingan saluran."
        });
      }

      return res.status(200).json({
        status: true,
        time: `${Date.now() - startTime}ms`,
        message: outcome.message || "Reaction VIP API masuk antrean.",
        result: {
          target: normalizedUrl,
          emojis: outcome.data?.emojis || emojiString,
          vip_package: outcome.data?.vip_package || "VIP Permanent",
          usage_today: outcome.data?.usage_today || null,
          limit: outcome.data?.limit || 50
        }
      });

    } catch (err) {
      logger.error(`[REACH-CH-VIP] Internal error: ${err.message}`);
      return res.status(500).json({
        status: false,
        time: `${Date.now() - startTime}ms`,
        error: err.message || "Terjadi kesalahan internal pada server VIP reaction"
      });
    }
  }
};

export {
  executeReaction,
  stalkChannelInfo,
  normalizeUrl,
  parseEmojis,
  loadKey,
  saveKey,
  generateApiKey
};
