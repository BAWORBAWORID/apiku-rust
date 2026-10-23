import { createCanvas, loadImage, registerFont } from "canvas"
import { fileTypeFromBuffer } from "file-type"
import logger from "../../src/utils/logger.js"

// Coba load assets, tapi optional
let assets = null
try {
  assets = require("@putuofc/assetsku")
  if (assets && assets.font && assets.font.get) {
    const fontPath = assets.font.get("THEBOLDFONT")
    if (fontPath) {
      registerFont(fontPath, { family: "Bold" })
      logger.info("[CanvasWelcome] Font registered successfully")
    }
  }
} catch (error) {
  //logger.warn("[CanvasWelcome] Assets package not found, using fallbacks")
}

// Function untuk create image response
const createImageResponse = (buffer, filename = null) => {
  const headers = {
    "Content-Type": "image/jpeg",
    "Content-Length": buffer.length.toString(),
    "Cache-Control": "public, max-age=3600",
  }

  if (filename) {
    headers["Content-Disposition"] = `inline; filename="${filename}"`
  }

  return new Response(buffer, { headers })
}

// Helper functions
function isValidImageUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false
  
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.toLowerCase()
    const validExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ""]
    // Allow URLs without extensions (might be CDN with parameters)
    if (path === "" || path === "/") return true
    return validExtensions.some((ext) => path.endsWith(ext))
  } catch {
    return false
  }
}

async function loadImageWithProxy(url) {
  try {
    // Coba load langsung dulu
    return await loadImage(url)
  } catch (error) {
    logger.warn(`[CanvasWelcome] Failed to load image: ${url}, error: ${error.message}`)
    // Fallback: coba decode sebagai base64 atau data URL
    if (url.startsWith('data:')) {
      return await loadImage(url)
    }
    throw new Error(`Failed to load image: ${error.message}`)
  }
}

async function generateWelcomeImage(
  username,
  guildName,
  guildIcon,
  memberCount,
  avatar,
  background,
  quality = 80
) {
  const canvas = createCanvas(1024, 450)
  const ctx = canvas.getContext("2d")

  // Default colors
  const colorUsername = "#ffffff"
  const colorMemberCount = "#ffffff"
  const colorMessage = "#ffffff"
  const colorAvatar = "#ffffff"
  const colorBackground = "#000000"
  const textMemberCount = "- {count}th member !"
  
  // Draw background
  if (background) {
    try {
      const bg = await loadImageWithProxy(background)
      ctx.drawImage(bg, 0, 0, canvas.width, canvas.height)
    } catch (error) {
      logger.warn("[CanvasWelcome] Using solid color background")
      ctx.fillStyle = colorBackground
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
  } else {
    ctx.fillStyle = colorBackground
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  // Draw overlay/assent if available
  if (assets && assets.image && assets.image.get) {
    try {
      const assent = assets.image.get("WELCOME")
      if (assent) {
        const overlay = await loadImage(assent)
        ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height)
      }
    } catch (error) {
      // Ignore overlay error
    }
  }

  // Set font - try Bold font first, fallback to sans-serif
  const fontFamily = "'Bold', sans-serif"
  
  // Draw username
  ctx.globalAlpha = 1
  ctx.font = `45px ${fontFamily}`
  ctx.textAlign = "center"
  ctx.fillStyle = colorUsername
  
  // Truncate username if too long
  const displayUsername = username.length > 20 ? username.substring(0, 17) + "..." : username
  ctx.fillText(displayUsername, canvas.width - 890, canvas.height - 60)

  // Draw member count
  ctx.fillStyle = colorMemberCount
  ctx.font = `22px ${fontFamily}`
  const countText = textMemberCount.replace(/{count}/g, memberCount.toString())
  ctx.fillText(countText, 90, canvas.height - 15)

  // Draw guild name
  ctx.globalAlpha = 1
  ctx.font = `45px ${fontFamily}`
  ctx.textAlign = "center"
  ctx.fillStyle = colorMessage
  const displayGuildName = guildName.length > 13 ? guildName.substring(0, 10) + "..." : guildName
  ctx.fillText(displayGuildName, canvas.width - 225, canvas.height - 44)

  // Draw avatar circle
  if (avatar) {
    try {
      ctx.save()
      ctx.beginPath()
      ctx.lineWidth = 10
      ctx.strokeStyle = colorAvatar
      ctx.arc(180, 160, 110, 0, Math.PI * 2, true)
      ctx.stroke()
      ctx.closePath()
      ctx.clip()
      const av = await loadImageWithProxy(avatar)
      ctx.drawImage(av, 45, 40, 270, 270)
      ctx.restore()
    } catch (error) {
      logger.warn("[CanvasWelcome] Failed to draw avatar, using placeholder")
      // Draw placeholder circle
      ctx.save()
      ctx.beginPath()
      ctx.lineWidth = 10
      ctx.strokeStyle = colorAvatar
      ctx.arc(180, 160, 110, 0, Math.PI * 2, true)
      ctx.stroke()
      ctx.closePath()
      ctx.fillStyle = "#333333"
      ctx.fill()
      ctx.restore()
    }
  } else {
    // Draw placeholder if no avatar
    ctx.save()
    ctx.beginPath()
    ctx.lineWidth = 10
    ctx.strokeStyle = colorAvatar
    ctx.arc(180, 160, 110, 0, Math.PI * 2, true)
    ctx.stroke()
    ctx.closePath()
    ctx.fillStyle = "#333333"
    ctx.fill()
    ctx.restore()
  }

  // Draw guild icon circle
  if (guildIcon) {
    try {
      ctx.save()
      ctx.beginPath()
      ctx.lineWidth = 10
      ctx.strokeStyle = colorAvatar
      ctx.arc(canvas.width - 150, canvas.height - 200, 80, 0, Math.PI * 2, true)
      ctx.stroke()
      ctx.closePath()
      ctx.clip()
      const guildIco = await loadImageWithProxy(guildIcon)
      ctx.drawImage(guildIco, canvas.width - 230, canvas.height - 280, 160, 160)
      ctx.restore()
    } catch (error) {
      logger.warn("[CanvasWelcome] Failed to draw guild icon, using placeholder")
      // Draw placeholder circle
      ctx.save()
      ctx.beginPath()
      ctx.lineWidth = 10
      ctx.strokeStyle = colorAvatar
      ctx.arc(canvas.width - 150, canvas.height - 200, 80, 0, Math.PI * 2, true)
      ctx.stroke()
      ctx.closePath()
      ctx.fillStyle = "#333333"
      ctx.fill()
      ctx.restore()
    }
  } else {
    // Draw placeholder if no guild icon
    ctx.save()
    ctx.beginPath()
    ctx.lineWidth = 10
    ctx.strokeStyle = colorAvatar
    ctx.arc(canvas.width - 150, canvas.height - 200, 80, 0, Math.PI * 2, true)
    ctx.stroke()
    ctx.closePath()
    ctx.fillStyle = "#333333"
    ctx.fill()
    ctx.restore()
  }

  // Convert quality (1-100) to canvas format (0-1)
  const canvasQuality = Math.min(100, Math.max(1, quality)) / 100
  
  return canvas.toBuffer("image/jpeg", { quality: canvasQuality })
}

// Main API Endpoint
export default {
  name: "Welcome Image Generator V1",
  description: "Generate Discord-style welcome images with custom avatars, guild icons, and backgrounds",
  category: "Canvas",
  methods: ["GET", "POST"],
  params: ["username", "guildName", "guildIcon", "memberCount", "avatar", "background", "quality"],

  paramsSchema: {
    username: {
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 25
    },
    guildName: {
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 30
    },
    guildIcon: {
      type: "string",
      required: true
    },
    memberCount: {
      type: "number",
      required: true,
      min: 0
    },
    avatar: {
      type: "string",
      required: true
    },
    background: {
      type: "string",
      required: true
    },
    quality: {
      type: "number",
      required: false,
      min: 1,
      max: 100,
      default: 80
    }
  },

  async run(req, res) {
    try {
      const { 
        username, 
        guildName, 
        guildIcon, 
        memberCount, 
        avatar, 
        background, 
        quality = 80 
      } = { ...req.query, ...req.body }

      // Log request
      const clientIP = req.ip || req.connection.remoteAddress
      logger.info(`[WelcomeV1] Request from ${clientIP}: ${username || 'unknown'} joining ${guildName || 'unknown guild'}`)

      // Validation
      if (!username || typeof username !== 'string' || username.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'username' is required and must be a non-empty string"
        })
      }

      if (username.length > 25) {
        return res.status(400).json({
          status: false,
          message: "Username must be 25 characters or less"
        })
      }

      if (!guildName || typeof guildName !== 'string' || guildName.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'guildName' is required and must be a non-empty string"
        })
      }

      if (guildName.length > 30) {
        return res.status(400).json({
          status: false,
          message: "Guild name must be 30 characters or less"
        })
      }

      // Validate member count
      const memberCountNum = parseInt(memberCount)
      if (isNaN(memberCountNum) || memberCountNum < 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'memberCount' must be a valid positive number"
        })
      }

      // Validate required image URLs
      const requiredImages = { guildIcon, avatar, background }
      for (const [key, url] of Object.entries(requiredImages)) {
        if (!url || typeof url !== 'string') {
          return res.status(400).json({
            status: false,
            message: `Parameter '${key}' is required`
          })
        }

        if (!isValidImageUrl(url)) {
          logger.warn(`[WelcomeV1] Invalid ${key} URL: ${url}`)
          // Continue anyway, let loadImage handle the error
        }
      }

      // Validate quality
      let qualityNum = parseInt(quality) || 80
      qualityNum = Math.max(1, Math.min(100, qualityNum))

      // Generate image
      logger.info(`[WelcomeV1] Generating welcome image for ${username}`)
      
      const imageBuffer = await generateWelcomeImage(
        username.trim(),
        guildName.trim(),
        guildIcon,
        memberCountNum,
        avatar,
        background,
        qualityNum
      )

      logger.info(`[WelcomeV1] Image generated successfully: ${imageBuffer.length} bytes`)
      
      res.setHeader("Content-Type", "image/png")      
      res.setHeader("Cache-Control", "public, max-age=86400") // Opsional: Cache 1 hari
      res.send(imageBuffer)
      // Return image directly
      //return createImageResponse(imageBuffer, `welcome-${username}-${Date.now()}.jpg`)
      
    } catch (error) {
      logger.error(`[WelcomeV1] Error: ${error.message}`, { 
        ip: req.ip,
        url: req.url 
      })

      return res.status(500).json({
        status: false,
        message: error.message || "Failed to generate welcome image",
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    }
  }
}