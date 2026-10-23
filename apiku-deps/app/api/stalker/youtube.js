import axios from "axios"
import * as cheerio from "cheerio"
import logger from "../../src/utils/logger.js"

const cache = new Map()
const CACHE_TTL = 10 * 60 * 1000
const CLEANUP_INTERVAL = 60 * 1000

setInterval(() => {
  const now = Date.now()
  let cleaned = 0
  for (const [key, item] of cache.entries()) {
    if (now > item.expires) {
      cache.delete(key)
      cleaned++
    }
  }
  if (cleaned > 0) {
    logger.info(`[YOUTUBE] Cleaned ${cleaned} expired cache entries`)
  }
}, CLEANUP_INTERVAL)

function getFromCache(username) {
  const key = username.toLowerCase()
  const item = cache.get(key)
  if (item && Date.now() < item.expires) {
    item.hits++
    return item
  }
  return null
}

function saveToCache(username, data) {
  const key = username.toLowerCase()
  const item = {
    data,
    expires: Date.now() + CACHE_TTL,
    created: new Date().toISOString(),
    hits: 1
  }
  cache.set(key, item)
  logger.info(`[YOUTUBE] Cache created for channel: ${username}`)
}

function generateRandomIP() {
  return `${Math.floor(Math.random() * 255) + 1}.${Math.floor(Math.random() * 255) + 1}.${Math.floor(Math.random() * 255) + 1}.${Math.floor(Math.random() * 255) + 1}`
}

function formatSubscriberCount(countText) {
  if (!countText) return "0"
  return countText.replace(/subscribers?/i, '').trim()
}

function formatVideoCount(countText) {
  if (!countText) return "0"
  return countText.replace(/videos?/i, '').trim()
}

function extractYtInitialData(html) {
  const patterns = [
    'var ytInitialData = ',
    'window["ytInitialData"] = ',
    'ytInitialData = '
  ]

  let startIndex = -1
  for (const pattern of patterns) {
    const idx = html.indexOf(pattern)
    if (idx !== -1) {
      startIndex = idx + pattern.length
      break
    }
  }

  if (startIndex === -1) return null

  const jsonStart = html.indexOf('{', startIndex)
  if (jsonStart === -1) return null

  let depth = 0
  let inString = false
  let escape = false
  let jsonEnd = -1

  for (let i = jsonStart; i < html.length; i++) {
    const char = html[i]

    if (escape) {
      escape = false
      continue
    }

    if (char === '\\' && inString) {
      escape = true
      continue
    }

    if (char === '"' && !escape) {
      inString = !inString
      continue
    }

    if (!inString) {
      if (char === '{') {
        depth++
      } else if (char === '}') {
        depth--
        if (depth === 0) {
          jsonEnd = i + 1
          break
        }
      }
    }
  }

  if (jsonEnd === -1) return null

  try {
    return JSON.parse(html.substring(jsonStart, jsonEnd))
  } catch (err) {
    logger.error(`[YOUTUBE] JSON parse error: ${err.message}`)
    return null
  }
}

function extractChannelData(parsedData, cleanUsername) {
  const channelMetadata = {
    username: null,
    name: null,
    subscriberCount: "0",
    videoCount: "0",
    avatarUrl: null,
    channelUrl: null,
    description: null,
    isVerified: false,
    joinDate: null
  }

  try {
    const pageHeader = parsedData.header?.pageHeaderRenderer?.content?.pageHeaderViewModel
    if (pageHeader) {
      channelMetadata.name =
        pageHeader.title?.dynamicTextViewModel?.text?.content ||
        pageHeader.title?.content ||
        null

      const titleStr = JSON.stringify(pageHeader.title || {})
      if (titleStr.includes("CHECK_CIRCLE_FILLED") || titleStr.includes("VERIFIED")) {
        channelMetadata.isVerified = true
      }

      const metadataRows = pageHeader.metadata?.contentMetadataViewModel?.metadataRows
      if (metadataRows && Array.isArray(metadataRows)) {
        for (const row of metadataRows) {
          for (const part of row.metadataParts || []) {
            const text = part.text?.content || ""
            const label = part.accessibilityLabel || ""

            if (text.startsWith("@")) {
              channelMetadata.username = text.replace("@", "")
            } else if (text.toLowerCase().includes("subscriber") || label.toLowerCase().includes("subscriber")) {
              channelMetadata.subscriberCount = formatSubscriberCount(text || label)
            } else if (text.toLowerCase().includes("video") || label.toLowerCase().includes("video")) {
              channelMetadata.videoCount = formatVideoCount(text || label)
            }
          }
        }
      }

      const avatarSources = pageHeader.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources
      if (avatarSources && avatarSources.length > 0) {
        channelMetadata.avatarUrl = avatarSources[avatarSources.length - 1].url
      }
    }

    const channelMeta = parsedData.metadata?.channelMetadataRenderer
    if (channelMeta) {
      if (!channelMetadata.name) {
        channelMetadata.name = channelMeta.title
      }
      if (!channelMetadata.username) {
        if (channelMeta.vanityChannelUrl) {
          const match = channelMeta.vanityChannelUrl.match(/@([^/?#]+)/)
          if (match) channelMetadata.username = match[1]
        }
      }
      channelMetadata.description = channelMetadata.description || channelMeta.description || null
      channelMetadata.channelUrl = channelMetadata.channelUrl || channelMeta.channelUrl || null
      if (channelMeta.title?.includes("✓") || channelMeta.description?.includes("verified")) {
        channelMetadata.isVerified = true
      }
      if (!channelMetadata.avatarUrl && channelMeta.avatar?.thumbnails?.length > 0) {
        channelMetadata.avatarUrl = channelMeta.avatar.thumbnails.slice(-1)[0].url
      }
    }

    const tabs = parsedData.contents?.twoColumnBrowseResultsRenderer?.tabs || []
    for (const tab of tabs) {
      const sectionList = tab.tabRenderer?.content?.sectionListRenderer?.contents || []
      for (const section of sectionList) {
        const joinedText = section.itemSectionRenderer?.contents?.[0]?.channelAboutFullMetadataRenderer?.joinedDateText?.content
        if (joinedText) {
          channelMetadata.joinDate = joinedText
          break
        }
      }
    }

    if (!channelMetadata.username) {
      channelMetadata.username = cleanUsername
    }

  } catch (error) {
    logger.error(`[YOUTUBE] Error extracting channel data: ${error.message}`)
  }

  return channelMetadata
}

function extractLatestVideos(parsedData) {
  const videoDataList = []

  try {
    const tabs = parsedData.contents?.twoColumnBrowseResultsRenderer?.tabs
    if (!tabs || tabs.length === 0) return videoDataList

    for (const tab of tabs) {
      if (videoDataList.length >= 5) break
      const sections = tab.tabRenderer?.content?.sectionListRenderer?.contents || []

      for (const section of sections) {
        if (videoDataList.length >= 5) break

        const shelf = section.itemSectionRenderer?.contents?.[0]?.shelfRenderer
        const items = shelf?.content?.horizontalListRenderer?.items ||
                      shelf?.content?.gridRenderer?.items ||
                      section.itemSectionRenderer?.contents ||
                      []

        for (const item of items) {
          if (videoDataList.length >= 5) break

          // Modern lockupViewModel
          if (item.lockupViewModel && item.lockupViewModel.contentType === "LOCKUP_CONTENT_TYPE_VIDEO") {
            const lockup = item.lockupViewModel
            const videoId = lockup.contentId
            const title = lockup.metadata?.lockupMetadataViewModel?.title?.content || "No title"
            const thumbs = lockup.contentImage?.thumbnailViewModel?.image?.sources || []
            const thumbnail = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : null

            let duration = null
            const overlays = lockup.contentImage?.thumbnailViewModel?.overlays || []
            for (const o of overlays) {
              if (o.thumbnailBottomOverlayViewModel?.badges?.[0]?.thumbnailBadgeViewModel?.text) {
                duration = o.thumbnailBottomOverlayViewModel.badges[0].thumbnailBadgeViewModel.text
                break
              }
              if (o.thumbnailOverlayTimeStatusRenderer?.text?.simpleText) {
                duration = o.thumbnailOverlayTimeStatusRenderer.text.simpleText
                break
              }
            }

            let viewCount = "0 views"
            let publishedTime = "Unknown"
            const rows = lockup.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || []
            for (const r of rows) {
              for (const p of r.metadataParts || []) {
                const text = p.text?.content || ""
                const label = p.accessibilityLabel || ""
                if (label.toLowerCase().includes("view") || text.toLowerCase().includes("view") || p.leadingIcon?.name?.includes("PLAY")) {
                  viewCount = label || text
                } else if (label.toLowerCase().includes("ago") || text.toLowerCase().includes("ago") || text.toLowerCase().includes("streamed")) {
                  publishedTime = text || label
                }
              }
            }

            videoDataList.push({
              videoId: videoId,
              title: title,
              thumbnail: thumbnail,
              publishedTime: publishedTime,
              viewCount: viewCount,
              duration: duration,
              videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
              shortUrl: `https://youtu.be/${videoId}`
            })
          }
          // GridVideoRenderer (classic format)
          else if (item.gridVideoRenderer) {
            const videoRenderer = item.gridVideoRenderer
            const videoId = videoRenderer.videoId
            const thumbs = videoRenderer.thumbnail?.thumbnails || []
            videoDataList.push({
              videoId: videoId,
              title: videoRenderer.title?.simpleText || videoRenderer.title?.runs?.[0]?.text || "No title",
              thumbnail: thumbs.length > 0 ? thumbs[thumbs.length - 1].url : null,
              publishedTime: videoRenderer.publishedTimeText?.simpleText || "Unknown",
              viewCount: videoRenderer.viewCountText?.simpleText || "0 views",
              duration: videoRenderer.thumbnailOverlays?.find(
                overlay => overlay.thumbnailOverlayTimeStatusRenderer
              )?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || null,
              videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
              shortUrl: `https://youtu.be/${videoId}`
            })
          }
          // VideoRenderer (alternative format)
          else if (item.videoRenderer) {
            const videoRenderer = item.videoRenderer
            const videoId = videoRenderer.videoId
            const thumbs = videoRenderer.thumbnail?.thumbnails || []
            videoDataList.push({
              videoId: videoId,
              title: videoRenderer.title?.runs?.[0]?.text || videoRenderer.title?.simpleText || "No title",
              thumbnail: thumbs.length > 0 ? thumbs[thumbs.length - 1].url : null,
              publishedTime: videoRenderer.publishedTimeText?.simpleText || "Unknown",
              viewCount: videoRenderer.viewCountText?.simpleText || "0 views",
              duration: videoRenderer.thumbnailOverlays?.find(
                overlay => overlay.thumbnailOverlayTimeStatusRenderer
              )?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || null,
              videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
              shortUrl: `https://youtu.be/${videoId}`
            })
          }
        }
      }
    }
  } catch (error) {
    logger.error(`[YOUTUBE] Error extracting videos: ${error.message}`)
  }

  return videoDataList
}

async function stalkYouTube(username) {
  try {
    const cleanUsername = username.replace('@', '').trim()
    const randomIP = generateRandomIP()
    const userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'

    const headers = {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0',
      'X-Forwarded-For': randomIP,
      'X-Real-IP': randomIP
    }

    logger.info(`[YOUTUBE] Fetching channel: @${cleanUsername}`)

    const res = await axios.get(
      `https://www.youtube.com/@${cleanUsername}`,
      { headers, timeout: 15000, validateStatus: () => true }
    )

    if (res.status === 404) {
      throw new Error(`YouTube channel '${username}' not found`)
    }

    if (res.status !== 200) {
      throw new Error(`YouTube returned status ${res.status}`)
    }

    const htmlContent = res.data
    if (!htmlContent) {
      throw new Error('Failed to fetch YouTube page content.')
    }

    const parsedData = extractYtInitialData(htmlContent)
    if (!parsedData) {
      throw new Error('Could not parse YouTube initial data.')
    }

    const channelData = extractChannelData(parsedData, cleanUsername)
    const latestVideos = extractLatestVideos(parsedData)

    if (!channelData.name && !channelData.username) {
      throw new Error('Channel not found or data unavailable.')
    }

    return {
      id: channelData.username,
      username: channelData.username,
      name: channelData.name || channelData.username,
      description: channelData.description || "No description",
      verified: channelData.isVerified,
      subscriberCount: channelData.subscriberCount,
      videoCount: channelData.videoCount,
      joinDate: channelData.joinDate,
      avatar: { url: channelData.avatarUrl },
      stats: {
        subscribers: channelData.subscriberCount,
        videos: channelData.videoCount
      },
      latestVideos: latestVideos,
      profileUrl: `https://www.youtube.com/@${cleanUsername}`
    }

  } catch (error) {
    logger.error(`[YOUTUBE] Stalk error: ${error.message}`)

    if (error.response?.status === 404 || error.message.includes('not found')) {
      throw new Error(`YouTube channel '${username}' not found`)
    }
    throw new Error(`Failed to fetch YouTube data: ${error.message}`)
  }
}

export default {
  name: "YouTube Stalker",
  description: "Get detailed YouTube channel profile info including latest videos",
  category: "Stalker",
  methods: ["GET", "POST"],

  params: ["username"],

  paramsSchema: {
    username: {
      type: "string",
      required: true,
      description: "YouTube channel username (with or without @)",
      example: "mrbeast",
      minLength: 1,
      maxLength: 50
    }
  },

  async run(req, res) {
    const startTime = Date.now()

    try {
      let username
      if (req.method === 'GET') {
        username = req.query.username
      } else {
        username = req.body?.username
      }

      if (!username) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'username' is required",
          example: {
            GET: "/api/stalk/youtube?username=mrbeast",
            POST: { "username": "mrbeast" }
          }
        })
      }

      if (typeof username !== 'string' || username.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Username must be a non-empty string"
        })
      }

      const cleanUsername = username.replace(/^@/, '').trim()
      const clientIp = req.ip || req.connection.remoteAddress
      logger.info(`[YOUTUBE] Request from ${clientIp} for @${cleanUsername}`)

      const cached = getFromCache(cleanUsername)
      let userData

      if (cached) {
        userData = cached.data
        logger.info(`[YOUTUBE] Serving from cache: ${cleanUsername}`)
      } else {
        userData = await stalkYouTube(cleanUsername)
        saveToCache(cleanUsername, userData)
      }

      return res.json({
        status: true,
        user: userData,
        metadata: {
          cached: !!cached,
          source: "youtube.com",
          processing_time: `${Date.now() - startTime}ms`,
          timestamp: new Date().toISOString()
        }
      })

    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`[YOUTUBE] Error after ${duration}ms: ${error.message}`)

      const statusCode = error.message.includes("not found") ? 404 :
                         error.message.includes("not exist") ? 404 :
                         error.message.includes("Channel not found") ? 404 : 500

      return res.status(statusCode).json({
        status: false,
        message: error.message,
        duration: `${duration}ms`
      })
    }
  }
}
