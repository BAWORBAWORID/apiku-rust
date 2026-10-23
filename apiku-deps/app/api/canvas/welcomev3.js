import { createCanvas, loadImage, registerFont } from "canvas"
import { fileTypeFromBuffer } from "file-type"
import logger from "../../src/utils/logger.js"

// ==================== ASSETS HANDLING ====================
let welcomeBg = null
let defaultBg = null
let defaultAvatar = null

// Try to load assets (optional)
try {
  // Jika menggunakan package assets
  const assets = require("@putuofc/assetsku")
  if (assets?.image?.get) {
    welcomeBg = assets.image.get("WELCOME3")
    defaultBg = assets.image.get("DEFAULT_BG")
    defaultAvatar = assets.image.get("DEFAULT_AVATAR")
    logger.info("[WelcomeV3] Assets loaded from package")
  }
} catch (error) {
  // Assets package tidak tersedia, tetap bisa jalan dengan fallback
  // logger.info("[WelcomeV3] Assets package not available, using fallback")
}

// ==================== HELPER FUNCTIONS ====================
function isValidImageUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

async function loadImageWithFallback(url, fallback = null) {
  try {
    // Coba load image dari URL
    return await loadImage(url)
  } catch (error) {
    // Jika gagal, gunakan fallback jika ada
    if (fallback) {
      try {
        if (typeof fallback === 'string') {
          return await loadImage(fallback)
        } else if (fallback.buffer) {
          // Jika fallback adalah buffer
          const img = await loadImage(fallback.buffer)
          return img
        }
      } catch (fallbackError) {
        logger.warn(`[WelcomeV3] Fallback failed: ${fallbackError.message}`)
      }
    }
    
    // Buat placeholder
    return createPlaceholderImage(150, 150, "#6366f1", "?")
  }
}

function createPlaceholderImage(width, height, color, text) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext("2d")
  
  // Gradient background
  const gradient = ctx.createRadialGradient(
    width / 2, height / 2, 0,
    width / 2, height / 2, width / 2
  )
  gradient.addColorStop(0, color)
  gradient.addColorStop(1, darkenColor(color, 40))
  
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
  
  // Circle border
  ctx.beginPath()
  ctx.arc(width / 2, height / 2, Math.min(width, height) / 2 - 5, 0, Math.PI * 2)
  ctx.strokeStyle = "white"
  ctx.lineWidth = 3
  ctx.stroke()
  
  // Text
  ctx.font = "bold 60px Arial"
  ctx.fillStyle = "#ffffff"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, width / 2, height / 2)
  
  return canvas
}

function darkenColor(color, percent) {
  const num = parseInt(color.replace("#", ""), 16)
  const amt = Math.round(2.55 * percent)
  const R = (num >> 16) - amt
  const G = (num >> 8 & 0x00FF) - amt
  const B = (num & 0x0000FF) - amt
  
  return "#" + (
    0x1000000 +
    (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
    (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
    (B < 255 ? B < 1 ? 0 : B : 255)
  ).toString(16).slice(1)
}

// ==================== IMAGE GENERATION ====================
async function generateWelcomeV3Image(username, avatarUrl) {
  const canvas = createCanvas(650, 300)
  const ctx = canvas.getContext("2d")
  
  // 1. Background
  try {
    // Coba load background dari assets
    let backgroundImage
    if (welcomeBg) {
      backgroundImage = await loadImage(welcomeBg)
    } else if (defaultBg) {
      backgroundImage = await loadImage(defaultBg)
    } else {
      // Buat custom gradient background jika tidak ada assets
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
      gradient.addColorStop(0, "#1e40af")  // Blue
      gradient.addColorStop(0.5, "#7c3aed") // Purple
      gradient.addColorStop(1, "#ec4899")  // Pink
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      backgroundImage = null
    }
    
    if (backgroundImage) {
      ctx.drawImage(backgroundImage, 0, 0, canvas.width, canvas.height)
    }
  } catch (error) {
    // Fallback gradient background
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
    gradient.addColorStop(0, "#1e40af")
    gradient.addColorStop(0.5, "#7c3aed")
    gradient.addColorStop(1, "#ec4899")
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  
  // 2. Avatar
  try {
    const avatarImg = await loadImageWithFallback(avatarUrl, defaultAvatar)
    
    // Avatar circle mask
    ctx.save()
    const centerX = canvas.width / 2
    const centerY = 150
    const radius = 75
    
    // Create circle clip
    ctx.beginPath()
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()
    
    // Draw avatar
    ctx.drawImage(avatarImg, centerX - radius, centerY - radius, radius * 2, radius * 2)
    ctx.restore()
    
    // Avatar border
    ctx.beginPath()
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
    ctx.strokeStyle = "white"
    ctx.lineWidth = 5
    ctx.stroke()
    
  } catch (error) {
    logger.warn(`[WelcomeV3] Avatar error: ${error.message}`)
    // Draw placeholder circle
    const centerX = canvas.width / 2
    const centerY = 150
    const radius = 75
    
    ctx.beginPath()
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
    ctx.strokeStyle = "white"
    ctx.lineWidth = 5
    ctx.stroke()
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)"
    ctx.fill()
  }
  
  // 3. Username text
  const displayName = username.length > 15 
    ? username.substring(0, 15) + "..." 
    : username
  
  // Main username (large, bottom)
  ctx.font = "bold 45px 'Segoe UI', Arial, sans-serif"
  ctx.fillStyle = "#ffffff"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  
  // Text shadow
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)"
  ctx.shadowBlur = 10
  ctx.shadowOffsetX = 2
  ctx.shadowOffsetY = 2
  
  // Draw at bottom
  ctx.fillText(displayName, canvas.width / 2, 240)
  
  // Reset shadow
  ctx.shadowColor = "transparent"
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  
  // Welcome text
  ctx.font = "italic 24px 'Segoe UI', Arial, sans-serif"
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)"
  ctx.fillText("WELCOME", canvas.width / 2, 270)
  
  // 4. Decorative elements
  // Glow effect around avatar
  ctx.save()
  const centerX = canvas.width / 2
  const centerY = 150
  
  ctx.beginPath()
  ctx.arc(centerX, centerY, 80, 0, Math.PI * 2)
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)"
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.restore()
  
  // Particle dots
  ctx.fillStyle = "rgba(255, 255, 255, 0.3)"
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * canvas.width
    const y = Math.random() * canvas.height
    const size = Math.random() * 2 + 1
    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fill()
  }
  
  return canvas.toBuffer("image/png")
}

// ==================== MAIN API ====================
export default {
  name: "Welcome Image Generator V3",
  description: "Modern minimalist welcome image with circular avatar and gradient design",
  category: "Canvas",
  methods: ["GET", "POST"],
  
  params: ["username", "avatar"],
  
  paramsSchema: {
    username: {
      type: "string",
      required: true,
      description: "Username to display",
      example: "JohnDoe",
      minLength: 1,
      maxLength: 25
    },
    avatar: {
      type: "string",
      required: true,
      description: "Avatar image URL",
      example: "https://i.imgur.com/avatar.jpg"
    }
  },
  
  async run(req, res) {
    const startTime = Date.now()
    
    try {
      // Get parameters based on method
      let username, avatar
      
      if (req.method === 'GET') {
        username = req.query.username
        avatar = req.query.avatar
      } else {
        username = req.body?.username
        avatar = req.body?.avatar
      }
      
      // Validation
      if (!username || !avatar) {
        return res.status(400).json({
          status: false,
          message: "Parameters 'username' and 'avatar' are required",
          example: {
            GET: "/api/canvas/welcome-v3?username=John&avatar=https://example.com/avatar.jpg",
            POST: { "username": "John", "avatar": "https://example.com/avatar.jpg" }
          }
        })
      }
      
      if (username.length > 25) {
        return res.status(400).json({
          status: false,
          message: "Username must be 25 characters or less"
        })
      }
      
      if (!isValidImageUrl(avatar)) {
        return res.status(400).json({
          status: false,
          message: "Avatar must be a valid URL"
        })
      }
      
      // Log request
      const clientIp = req.ip || req.connection.remoteAddress
      logger.info(`[WelcomeV3] Generating for ${username.substring(0, 20)}... from ${clientIp}`)
      
      // Generate image
      const imageBuffer = await generateWelcomeV3Image(username.trim(), avatar)
      
      // Calculate duration
      const duration = Date.now() - startTime
      logger.info(`[WelcomeV3] Generated in ${duration}ms (${imageBuffer.length} bytes)`)
      
      // Send image response
      res.setHeader("Content-Type", "image/png")
      res.setHeader("Content-Length", imageBuffer.length)
      res.setHeader("Cache-Control", "public, max-age=3600")
      res.setHeader("X-Generated-In", `${duration}ms`)
      
      // Optional: Add download header
      if (req.query.download) {
        const filename = `welcome-${username.replace(/[^a-z0-9]/gi, '-')}-${Date.now()}.png`
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
      }
      
      return res.send(imageBuffer)
      
    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`[WelcomeV3] Error after ${duration}ms: ${error.message}`)
      
      return res.status(500).json({
        status: false,
        message: "Failed to generate welcome image",
        error: error.message,
        duration: `${duration}ms`
      })
    }
  }
}