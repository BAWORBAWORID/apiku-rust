import { createCanvas, loadImage, registerFont } from "canvas"
import { fileTypeFromBuffer } from "file-type"
import logger from "../../src/utils/logger.js"

// ==================== ASSETS HANDLING ====================
let welcomeFrame = null
let defaultBg = null
let defaultAvatar = null
let defaultFrame = null
let hasCubestFont = false

try {
  // Coba load assets package
  const assets = require("@putuofc/assetsku")
  
  // Register font jika ada
  if (assets?.font?.get) {
    const fontPath = assets.font.get("CUBESTMEDIUM")
    if (fontPath) {
      try {
        registerFont(fontPath, { family: "CubestMedium" })
        hasCubestFont = true
        logger.info("[CanvasWelcomeV2] CubestMedium font registered")
      } catch (fontError) {
        logger.warn("[CanvasWelcomeV2] Failed to register font:", fontError.message)
      }
    }
  }
  
  // Load assets images
  if (assets?.image?.get) {
    welcomeFrame = assets.image.get("WELCOME2")
    defaultBg = assets.image.get("DEFAULT_BG")
    defaultAvatar = assets.image.get("DEFAULT_AVATAR")
    defaultFrame = assets.image.get("DEFAULT_FRAME")
    
    logger.info("[CanvasWelcomeV2] Assets loaded successfully")
  }
} catch (error) {
  //logger.info("[CanvasWelcomeV2] Assets package not available, using fallback mode")
}

// ==================== HELPER FUNCTIONS ====================
const createImageResponse = (buffer, filename = null) => {
  const headers = {
    "Content-Type": "image/png",
    "Content-Length": buffer.length.toString(),
    "Cache-Control": "public, max-age=3600",
  }

  if (filename) {
    headers["Content-Disposition"] = `inline; filename="${filename}"`
  }

  return new Response(buffer, { headers })
}

function isValidImageUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false
  
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

async function loadImageWithProxy(url, fallbackAsset = null) {
  try {
    // Jika ada proxy function, gunakan
    if (typeof proxy === 'function') {
      const proxyUrl = proxy()
      if (proxyUrl) {
        return await loadImage(proxyUrl + url)
      }
    }
    return await loadImage(url)
  } catch (error) {
    logger.warn(`[CanvasWelcomeV2] Failed to load image from URL: ${url.substring(0, 50)}...`)
    
    // Gunakan fallback jika ada
    if (fallbackAsset) {
      try {
        return await loadImage(fallbackAsset)
      } catch (fallbackError) {
        logger.warn(`[CanvasWelcomeV2] Fallback also failed: ${fallbackError.message}`)
      }
    }
    
    // Buat placeholder
    return createPlaceholderImage(100, 100, "#4a5568", "X")
  }
}

function createPlaceholderImage(width, height, color, text) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext("2d")
  
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)
  
  ctx.font = "bold 40px Arial"
  ctx.fillStyle = "#ffffff"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, width / 2, height / 2)
  
  return canvas
}

// ==================== IMAGE GENERATION ====================
async function generateWelcomeV2Image(
  username,
  guildName,
  memberCount,
  avatar,
  background
) {
  const canvas = createCanvas(512, 256)
  const ctx = canvas.getContext("2d")

  // Load semua gambar secara paralel
  const imageLoadPromises = [
    loadImageWithProxy(background, defaultBg),
    welcomeFrame ? loadImage(welcomeFrame).catch(() => defaultFrame ? loadImage(defaultFrame) : null) : Promise.resolve(null),
    loadImageWithProxy(avatar, defaultAvatar)
  ]

  let [backgroundImg, frameImg, avatarImg] = await Promise.all(imageLoadPromises)

  // Jika frame tidak ada, gunakan default atau skip
  if (!frameImg && defaultFrame) {
    try {
      frameImg = await loadImage(defaultFrame)
    } catch {
      frameImg = null
    }
  }

  // 1. Draw Background
  ctx.drawImage(backgroundImg, 0, 0, canvas.width, canvas.height)

  // 2. Draw Frame Overlay (jika ada)
  if (frameImg) {
    ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height)
  }

  // 3. Draw Rotated Avatar
  ctx.save()
  ctx.translate(0, 0)
  ctx.rotate((-17 * Math.PI) / 180)
  
  // Draw avatar dengan border
  ctx.strokeStyle = "white"
  ctx.lineWidth = 3
  
  // Hitung position untuk rotated avatar
  const avatarX = -4
  const avatarY = 110
  const avatarSize = 96
  
  ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize)
  ctx.strokeRect(avatarX, avatarY, avatarSize, avatarSize)
  
  ctx.restore()

  // 4. Draw Guild Name (Center Right)
  const displayGuildName = guildName.length > 10 
    ? guildName.substring(0, 10) + "..." 
    : guildName
  
  ctx.globalAlpha = 1
  ctx.textAlign = "center"
  ctx.fillStyle = "#ffffff"
  
  // Gunakan CubestMedium jika ada, fallback ke Arial
  const guildFont = hasCubestFont ? "18px CubestMedium" : "bold 18px Arial"
  ctx.font = guildFont
  ctx.fillText(displayGuildName, 336, 158)

  // 5. Draw Member Count (Bottom Left)
  ctx.textAlign = "left"
  ctx.font = "bold 18px 'Courier New', monospace"
  const memberText = `${memberCount}${getOrdinalSuffix(memberCount)} member`
  ctx.fillText(memberText, 214, 248)

  // 6. Draw Username (Top Right)
  const displayUsername = username.length > 12
    ? username.substring(0, 12) + "..."
    : username
  
  ctx.font = "bold 24px 'Courier New', monospace"
  ctx.fillText(displayUsername, 208, 212)

  // 7. Optional: Add decorative elements jika tidak ada frame
  if (!frameImg) {
    // Add border
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)"
    ctx.lineWidth = 2
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20)
    
    // Add welcome text
    ctx.font = "bold 20px Arial"
    ctx.textAlign = "center"
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)"
    ctx.fillText("WELCOME", canvas.width / 2, 30)
  }

  return canvas.toBuffer("image/png")
}

function getOrdinalSuffix(number) {
  if (number % 100 >= 11 && number % 100 <= 13) {
    return "th"
  }
  switch (number % 10) {
    case 1: return "st"
    case 2: return "nd"
    case 3: return "rd"
    default: return "th"
  }
}

// ==================== MAIN API ====================
export default {
  name: "Welcome Image Generator V2",
  description: "Create modern welcome images with rotated avatar and clean design",
  category: "Canvas",
  methods: ["GET", "POST"],
  params: ["username", "guildName", "memberCount", "avatar", "background"],

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
      maxLength: 50
    },
    memberCount: {
      type: "number",
      required: true,
      min: 1
    },
    avatar: {
      type: "string",
      required: true
    },
    background: {
      type: "string",
      required: true
    }
  },

  async run(req, res) {
    const startTime = Date.now()
    
    try {
      const params = { ...req.query, ...req.body }
      const { 
        username, 
        guildName, 
        memberCount, 
        avatar, 
        background 
      } = params

      // Log request
      const clientIP = req.ip || req.connection.remoteAddress
      logger.info(`[WelcomeV2] Request from ${clientIP} for ${username}`)

      // Validation
      const errors = []
      
      if (!username || username.trim().length === 0) {
        errors.push("Username is required")
      } else if (username.length > 25) {
        errors.push("Username must be 25 characters or less")
      }

      if (!guildName || guildName.trim().length === 0) {
        errors.push("Guild name is required")
      } else if (guildName.length > 50) {
        errors.push("Guild name must be 50 characters or less")
      }

      const memberCountNum = parseInt(memberCount)
      if (isNaN(memberCountNum) || memberCountNum < 1) {
        errors.push("Member count must be a number greater than 0")
      }

      if (!avatar) errors.push("Avatar URL is required")
      if (!background) errors.push("Background URL is required")

      if (errors.length > 0) {
        return res.status(400).json({
          status: false,
          message: "Validation failed",
          errors: errors
        })
      }

      // Basic URL validation
      if (!isValidImageUrl(avatar)) {
        logger.warn(`[WelcomeV2] Avatar URL might be invalid: ${avatar}`)
      }
      
      if (!isValidImageUrl(background)) {
        logger.warn(`[WelcomeV2] Background URL might be invalid: ${background}`)
      }

      // Generate image
      logger.info(`[WelcomeV2] Generating V2 welcome image for ${username}...`)
      
      const imageBuffer = await generateWelcomeV2Image(
        username.trim(),
        guildName.trim(),
        memberCountNum,
        avatar,
        background
      )

      const duration = Date.now() - startTime
      logger.info(`[WelcomeV2] Image generated in ${duration}ms (${imageBuffer.length} bytes)`)

      // Return PNG image
      const filename = `welcome-v2-${username.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.png`
      //return createImageResponse(imageBuffer, filename)
      
            
      res.setHeader("Content-Type", "image/png")      
      res.setHeader("Cache-Control", "public, max-age=86400") // Opsional: Cache 1 hari
      res.send(imageBuffer)
      
    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`[WelcomeV2] Error after ${duration}ms:`, error.message)
      
      return res.status(500).json({
        status: false,
        message: "Failed to generate welcome image",
        error: error.message,
        duration: duration
      })
    }
  }
}