/**
 * Stalk WhatsApp Channel
 * Scrape public WhatsApp Channel profile info
 * 
 * GET  /api/stalker/whatsapp?channel=0029Vb7bAFaCXC3E44TGgK3B
 * POST /api/stalker/whatsapp -d {"channel": "0029Vb7bAFaCXC3E44TGgK3B"}
 */

import https from "https"
import logger from "../../src/utils/logger.js"

/* ================================
   HELPERS
================================ */
function fetchHTML(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 15000, headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }}, (res) => {
        let data = ""
        res.on("data", (chunk) => (data += chunk))
        res.on("end", () => resolve(data))
      })
      .on("error", (err) => reject(err))
      .on("timeout", function () {
        this.destroy()
        reject(new Error("Request timeout"))
      })
  })
}

function extractMeta(html, property) {
  const regex1 = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i"
  )
  const match1 = html.match(regex1)
  if (match1) return match1[1]

  const regex2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    "i"
  )
  const match2 = html.match(regex2)
  if (match2) return match2[1]

  return null
}

function decodeHtmlEntities(text) {
  if (!text) return text
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_match, dec) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10))
      } catch {
        return ""
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16))
      } catch {
        return ""
      }
    })
}

function cleanTrailingJoin(text) {
  if (!text) return ""
  return text.replace(/\.?\s*Join\s+[\d,.KMBkmb]+\s+followers?\s+(?:to\s+|for\s+).*$/i, "").trim()
}

function parseDescription(desc) {
  if (!desc) return { followers: null, cleanDescription: "" }

  const clean = decodeHtmlEntities(desc)

  // "Channel • X followers • description"
  const channelFormat = clean.match(/^Channel\s*•\s*([\d,.KMBkmb]+)\s*followers?\s*•\s*([\s\S]*)$/i)
  if (channelFormat) {
    return {
      followers: channelFormat[1].trim(),
      cleanDescription: cleanTrailingJoin(channelFormat[2].trim()),
    }
  }

  // "Channel • X followers"
  const channelOnly = clean.match(/^Channel\s*•\s*([\d,.KMBkmb]+)\s*followers?\s*$/i)
  if (channelOnly) {
    return {
      followers: channelOnly[1].trim(),
      cleanDescription: "",
    }
  }

  // fallback: contains "X followers"
  const followerMatch = clean.match(/([\d,.]+)\s*followers?/i)
  if (followerMatch) {
    const descWithoutFollowers = clean.replace(/^[\s\S]*?\b[\d,.]+\s*followers?\s*•?\s*/i, "").trim()
    return {
      followers: followerMatch[1],
      cleanDescription: cleanTrailingJoin(descWithoutFollowers),
    }
  }

  return { followers: null, cleanDescription: cleanTrailingJoin(clean) }
}

function parseNumber(text) {
  if (!text) return 0
  const clean = text.replace(/,/g, "").toLowerCase()
  if (clean.includes("k")) return Math.round(parseFloat(clean) * 1000)
  if (clean.includes("m")) return Math.round(parseFloat(clean) * 1000000)
  const num = parseInt(clean)
  return isNaN(num) ? 0 : num
}

/* ================================
   MAIN: STALK WHATSAPP CHANNEL
================================ */
async function stalkWhatsApp(inputData) {
  const raw = String(inputData).trim().split("?")[0];
  const isGroup = raw.includes("chat.whatsapp.com");
  let id = "";
  let url = "";

  if (isGroup) {
    id = raw.replace(/^https?:\/\/(?:www\.)?chat\.whatsapp\.com\//, "").replace(/\/+$/, "").trim();
    url = `https://chat.whatsapp.com/${id}`;
  } else {
    id = raw
      .replace(/^https?:\/\/(?:www\.)?whatsapp\.com\/channel\//, "")
      .replace(/^https?:\/\/whatsapp\.com\/channel\//, "")
      .replace(/\/+$/, "")
      .trim();
    url = `https://www.whatsapp.com/channel/${id}`;
  }

  logger.info(`[WHATSAPP] Fetching: ${url}`)

  const html = await fetchHTML(url)

  // Title
  const titleMeta = extractMeta(html, "og:title") ||
    extractMeta(html, "twitter:title") || ""

  // Avatar
  const avatar = extractMeta(html, "og:image") ||
    extractMeta(html, "twitter:image") || null

  if (isGroup) {
    const groupName = titleMeta.trim() || id;
    return {
      type: "group",
      id: id,
      group_id: id,
      name: decodeHtmlEntities(groupName),
      group_name: decodeHtmlEntities(groupName),
      avatar: avatar ? decodeHtmlEntities(avatar) : null,
      profile_url: url
    }
  }

  // Description (for Channels only)
  const descMeta = extractMeta(html, "og:description") ||
    extractMeta(html, "twitter:description") || ""
  const { followers, cleanDescription } = parseDescription(descMeta)

  // Channel name dari title
  let channelName = titleMeta
    .replace(/ on WhatsApp$/, "")
    .trim()

  if (!channelName) channelName = id

  // Verified badge
  const isVerified = html.includes('verified') || html.includes('Verified')

  return {
    type: "channel",
    id: id,
    channel_id: id,
    name: decodeHtmlEntities(channelName) || id,
    channel_name: decodeHtmlEntities(channelName) || id,
    avatar: avatar ? decodeHtmlEntities(avatar) : null,
    description: decodeHtmlEntities(cleanDescription) || null,
    followers_raw: followers || null,
    followers: followers ? parseNumber(followers) : 0,
    verified: isVerified,
    profile_url: url
  }
}

/* ================================
   MAIN API
================================ */
export default {
  name: "WhatsApp Stalker",
  description: "Stalk informasi WhatsApp Channel & WhatsApp Group melalui link",
  category: "Stalker",
  methods: ["GET", "POST"],

  params: ["link"],

  paramsSchema: {
    link: {
      type: "string",
      required: true,
      default: "https://chat.whatsapp.com/KfTAZgFu9mtA1U8vZejXaD",
      description: "Link WhatsApp Channel (whatsapp.com/channel/xxx) atau WhatsApp Group (chat.whatsapp.com/xxx)",
      example: "https://chat.whatsapp.com/KfTAZgFu9mtA1U8vZejXaD",
      minLength: 1
    }
  },

  async run(req, res) {
    const startTime = Date.now()

    try {
      const { link, url } = { ...req.query, ...req.body };
      const input = link ?? url;

      if (!input || typeof input !== "string" || !input.trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'link' wajib diisi (URL Channel atau URL Group)",
          example: {
            group: "/api/stalker/whatsapp?link=https://chat.whatsapp.com/KfTAZgFu9mtA1U8vZejXaD",
            channel: "/api/stalker/whatsapp?link=https://www.whatsapp.com/channel/0029Vb7bAFaCXC3E44TGgK3B"
          }
        })
      }

      logger.info(`[WHATSAPP] Request for: ${input.substring(0, 50)}`)

      const result = await stalkWhatsApp(input.trim())

      const duration = Date.now() - startTime
      logger.info(`[WHATSAPP] Success | time: ${duration}ms`)

      return res.json({
        status: true,
        result,
        metadata: {
          processing_time: `${duration}ms`
        }
      })

    } catch (error) {
      const duration = Date.now() - startTime
      const statusCode = error.message.includes("timeout") ? 504 : 500

      return res.status(statusCode).json({
        status: false,
        message: error.message || "Failed to fetch WhatsApp Channel data",
        metadata: {
          processing_time: `${duration}ms`
        }
      })
    }
  }
}
