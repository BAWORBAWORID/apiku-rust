import { createCanvas, loadImage } from "canvas"
import axios from "axios"
import { fileTypeFromBuffer } from "file-type"
import logger from "../../src/utils/logger.js"

// ==================== ROBOX API SERVICE ====================
class RobloxAPIService {
  async getUserId(username) {
    try {
      const response = await axios.post("https://users.roblox.com/v1/usernames/users", {
        usernames: [username],
        excludeBannedUsers: false
      })
      
      if (response.data?.data?.[0]?.id) {
        return response.data.data[0].id
      }
      return null
    } catch (error) {
      logger.error(`[RobloxAPI] Failed to get user ID: ${error.message}`)
      return null
    }
  }

  async getFullProfile(userId) {
    try {
      const [basic, friends, followers, headshot] = await Promise.all([
        axios.get(`https://users.roblox.com/v1/users/${userId}`),
        axios.get(`https://friends.roblox.com/v1/users/${userId}/friends/count`),
        axios.get(`https://friends.roblox.com/v1/users/${userId}/followers/count`),
        axios.get(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=720x720&format=Png&isCircular=false`)
      ])
      
      return {
        success: true,
        data: {
          displayName: basic.data.displayName,
          username: basic.data.name,
          description: basic.data.description || "No description provided.",
          created: basic.data.created,
          friendsCount: friends.data.count || 0,
          followersCount: followers.data.count || 0,
          avatarUrl: headshot.data.data[0]?.imageUrl || null,
          isBanned: basic.data.isBanned || false,
          hasVerifiedBadge: basic.data.hasVerifiedBadge || false,
          userId: userId
        }
      }
    } catch (error) {
      logger.error(`[RobloxAPI] Failed to get full profile: ${error.message}`)
      return {
        success: false,
        error: error.message
      }
    }
  }

  async getUserProfile(username) {
    try {
      logger.info(`[RobloxAPI] Looking up user: ${username}`)
      
      const userId = await this.getUserId(username)
      if (!userId) {
        return {
          success: false,
          error: "User not found"
        }
      }
      
      logger.info(`[RobloxAPI] Found user ID: ${userId}`)
      return await this.getFullProfile(userId)
    } catch (error) {
      return {
        success: false,
        error: error.message
      }
    }
  }
}

// Initialize API service
const robloxAPI = new RobloxAPIService()

// ==================== HELPER FUNCTIONS ====================
async function loadImageWithFallback(url, fallbackUrl = null) {
  try {
    // Coba load image dari URL
    return await loadImage(url)
  } catch (error) {
    // Jika gagal, coba fallback URL
    if (fallbackUrl) {
      try {
        return await loadImage(fallbackUrl)
      } catch (fallbackError) {
        logger.warn(`[RobloxCanvas] Fallback image failed: ${fallbackError.message}`)
      }
    }
    
    // Buat placeholder avatar
    return createPlaceholderAvatar()
  }
}

function createPlaceholderAvatar() {
  const canvas = createCanvas(460, 460)
  const ctx = canvas.getContext("2d")
  
  // Gradient background (Roblox blue theme)
  const gradient = ctx.createLinearGradient(0, 0, 460, 460)
  gradient.addColorStop(0, "#00a2ff")
  gradient.addColorStop(1, "#0066cc")
  
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 460, 460)
  
  // Roblox "R" logo
  ctx.font = "bold 200px Arial"
  ctx.fillStyle = "#ffffff"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText("R", 230, 230)
  
  // Border
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)"
  ctx.lineWidth = 5
  ctx.strokeRect(10, 10, 440, 440)
  
  return canvas
}

function formatDate(dateString) {
  try {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  } catch (error) {
    return "Unknown date"
  }
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ')
  let lines = []
  let currentLine = ''
  
  for (let word of words) {
    const testLine = currentLine + word + ' '
    const metrics = ctx.measureText(testLine)
    
    if (metrics.width > maxWidth && currentLine !== '') {
      lines.push({ text: currentLine.trim(), y: y })
      currentLine = word + ' '
      y += lineHeight
    } else {
      currentLine = testLine
    }
  }
  
  if (currentLine.trim() !== '') {
    lines.push({ text: currentLine.trim(), y: y })
  }
  
  return lines
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength - 3) + "..."
}

// ==================== CANVAS GENERATOR ====================
async function generateRobloxProfileCanvas(profileData) {
  const canvas = createCanvas(1000, 500)
  const ctx = canvas.getContext("2d")
  
  // 1. Background Gradient (Roblox Dark Theme)
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
  gradient.addColorStop(0, '#0d0e11')
  gradient.addColorStop(1, '#1c1e23')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  
  // 2. Decorative Elements
  // Side panel
  ctx.fillStyle = 'rgba(255, 255, 255, 0.02)'
  ctx.beginPath()
  ctx.moveTo(600, 0)
  ctx.lineTo(canvas.width, 0)
  ctx.lineTo(canvas.width, canvas.height)
  ctx.lineTo(400, canvas.height)
  ctx.fill()
  
  // Glow effect
  ctx.beginPath()
  ctx.arc(150, 250, 200, 0, Math.PI * 2)
  const glowGradient = ctx.createRadialGradient(150, 250, 0, 150, 250, 200)
  glowGradient.addColorStop(0, 'rgba(0, 162, 255, 0.1)')
  glowGradient.addColorStop(1, 'rgba(0, 162, 255, 0)')
  ctx.fillStyle = glowGradient
  ctx.fill()
  
  // 3. Avatar
  try {
    const avatarUrl = profileData.avatarUrl || `https://www.roblox.com/headshot-thumbnail/image?userId=${profileData.userId}&width=420&height=420&format=png`
    const avatarImg = await loadImageWithFallback(avatarUrl, `https://www.roblox.com/headshot-thumbnail/image?userId=${profileData.userId}&width=150&height=150&format=png`)
    
    // Avatar shadow
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
    ctx.shadowBlur = 30
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
    
    // Avatar frame with rounded corners
    const avatarX = 40
    const avatarY = 20
    const avatarSize = 460
    const cornerRadius = 25
    
    // Draw rounded rectangle for avatar
    ctx.beginPath()
    ctx.moveTo(avatarX + cornerRadius, avatarY)
    ctx.lineTo(avatarX + avatarSize - cornerRadius, avatarY)
    ctx.quadraticCurveTo(avatarX + avatarSize, avatarY, avatarX + avatarSize, avatarY + cornerRadius)
    ctx.lineTo(avatarX + avatarSize, avatarY + avatarSize - cornerRadius)
    ctx.quadraticCurveTo(avatarX + avatarSize, avatarY + avatarSize, avatarX + avatarSize - cornerRadius, avatarY + avatarSize)
    ctx.lineTo(avatarX + cornerRadius, avatarY + avatarSize)
    ctx.quadraticCurveTo(avatarX, avatarY + avatarSize, avatarX, avatarY + avatarSize - cornerRadius)
    ctx.lineTo(avatarX, avatarY + cornerRadius)
    ctx.quadraticCurveTo(avatarX, avatarY, avatarX + cornerRadius, avatarY)
    ctx.closePath()
    
    // Clip and draw avatar
    ctx.clip()
    ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize)
    ctx.restore()
    
    // Avatar border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
    ctx.lineWidth = 3
    ctx.strokeRect(avatarX + 5, avatarY + 5, avatarSize - 10, avatarSize - 10)
    
  } catch (error) {
    logger.warn(`[RobloxCanvas] Avatar error: ${error.message}`)
    // Draw placeholder
    const placeholder = createPlaceholderAvatar()
    ctx.drawImage(placeholder, 40, 20)
  }
  
  // 4. Profile Information
  const contentX = 520
  let currentY = 80
  
  // Display Name (with verified badge if available)
  ctx.font = "bold 56px 'Segoe UI', Arial, sans-serif"
  ctx.fillStyle = "#ffffff"
  ctx.textAlign = "left"
  
  const displayName = truncateText(profileData.displayName, 20)
  ctx.fillText(displayName, contentX, currentY)
  
  // Add verified badge emoji if verified
  if (profileData.hasVerifiedBadge) {
    const nameWidth = ctx.measureText(displayName).width
    ctx.font = "36px 'Segoe UI', Arial, sans-serif"
    ctx.fillText("✓", contentX + nameWidth + 15, currentY - 10)
    
    // Verified badge tooltip (subtle)
    ctx.font = "12px 'Segoe UI', Arial, sans-serif"
    ctx.fillStyle = "#00a2ff"
    ctx.fillText("Verified", contentX + nameWidth + 40, currentY - 10)
  }
  
  // Username
  currentY += 50
  ctx.font = "28px 'Segoe UI', Arial, sans-serif"
  ctx.fillStyle = "#999999"
  ctx.fillText(`@${profileData.username}`, contentX, currentY)
  
  // User ID
  ctx.font = "14px 'Segoe UI Mono', monospace"
  ctx.fillStyle = "#666666"
  ctx.fillText(`ID: ${profileData.userId}`, contentX, currentY + 25)
  
  // 5. Statistics Box
  currentY = 350
  const statBoxWidth = 180
  const statBoxHeight = 80
  
  // Friends box
  ctx.fillStyle = 'rgba(0, 162, 255, 0.1)'
  ctx.fillRect(contentX, currentY, statBoxWidth, statBoxHeight)
  ctx.strokeStyle = 'rgba(0, 162, 255, 0.3)'
  ctx.lineWidth = 2
  ctx.strokeRect(contentX, currentY, statBoxWidth, statBoxHeight)
  
  // Friends count
  ctx.font = "bold 38px 'Segoe UI', Arial, sans-serif"
  ctx.fillStyle = "#ffffff"
  ctx.textAlign = "center"
  ctx.fillText(profileData.friendsCount.toLocaleString(), contentX + statBoxWidth / 2, currentY + 45)
  
  // Friends label
  ctx.font = "16px 'Segoe UI', Arial, sans-serif"
  ctx.fillStyle = "#888888"
  ctx.fillText("FRIENDS", contentX + statBoxWidth / 2, currentY + 70)
  
  // Followers box
  const followersX = contentX + statBoxWidth + 30
  ctx.fillStyle = 'rgba(255, 107, 107, 0.1)'
  ctx.fillRect(followersX, currentY, statBoxWidth, statBoxHeight)
  ctx.strokeStyle = 'rgba(255, 107, 107, 0.3)'
  ctx.strokeRect(followersX, currentY, statBoxWidth, statBoxHeight)
  
  // Followers count
  ctx.font = "bold 38px 'Segoe UI', Arial, sans-serif"
  ctx.fillStyle = "#ffffff"
  ctx.fillText(profileData.followersCount.toLocaleString(), followersX + statBoxWidth / 2, currentY + 45)
  
  // Followers label
  ctx.font = "16px 'Segoe UI', Arial, sans-serif"
  ctx.fillStyle = "#888888"
  ctx.fillText("FOLLOWERS", followersX + statBoxWidth / 2, currentY + 70)
  
  // 6. Bio/Description
  ctx.textAlign = "left"
  currentY = 150
  const bioMaxWidth = 450
  
  ctx.font = "20px 'Segoe UI', Arial, sans-serif"
  ctx.fillStyle = "#bbbbbb"
  
  // Bio title
  ctx.fillText("ABOUT", contentX, currentY)
  
  // Bio content
  currentY += 30
  ctx.font = "italic 16px 'Segoe UI', Arial, sans-serif"
  ctx.fillStyle = "#cccccc"
  
  const bioLines = wrapText(ctx, profileData.description, contentX, currentY, bioMaxWidth, 22)
  bioLines.forEach(line => {
    ctx.fillText(line.text, contentX, line.y)
  })
  
  // 7. Join Date
  currentY = 460
  ctx.font = "15px 'Segoe UI', Arial, sans-serif"
  ctx.fillStyle = "#666666"
  
  const joinDate = formatDate(profileData.created)
  ctx.fillText(`Joined Roblox • ${joinDate}`, contentX, currentY)
  
  // 8. Roblox Branding
  ctx.font = "bold 24px 'Segoe UI', Arial, sans-serif"
  ctx.fillStyle = "rgba(255, 255, 255, 0.1)"
  ctx.textAlign = "right"
  ctx.fillText("ROBLOX", canvas.width - 30, canvas.height - 20)
  
  // 9. Account status
  if (profileData.isBanned) {
    ctx.font = "bold 20px 'Segoe UI', Arial, sans-serif"
    ctx.fillStyle = "#ff6b6b"
    ctx.textAlign = "center"
    ctx.fillText("ACCOUNT BANNED", canvas.width / 2, 40)
  }
  
  // 10. Decorative particles
  const particleColors = ['#00a2ff', '#ff6b6b', '#4ecdc4', '#ffe66d', '#9d7cff']
  for (let i = 0; i < 15; i++) {
    const x = Math.random() * (canvas.width - 500) + 500
    const y = Math.random() * 300 + 100
    const size = Math.random() * 4 + 1
    const color = particleColors[Math.floor(Math.random() * particleColors.length)]
    
    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fillStyle = color + "40"
    ctx.fill()
  }
  
  return canvas.toBuffer("image/png")
}

// ==================== MAIN API ====================
export default {
  name: "Roblox Profile Generator",
  description: "Generate Roblox profile card automatically from username",
  category: "Canvas",
  methods: ["GET", "POST"],
  
  params: ["username"],
  
  paramsSchema: {
    username: {
      type: "string",
      required: true,
      description: "Roblox username",
      example: "Builderman",
      minLength: 3,
      maxLength: 20
    }
  },
  
  async run(req, res) {
    const startTime = Date.now()
    
    try {
      // Get username parameter
      let username
      
      if (req.method === 'GET') {
        username = req.query.username
      } else {
        username = req.body?.username
      }
      
      // Validation
      if (!username || username.trim() === '') {
        return res.status(400).json({
          status: false,
          message: "Parameter 'username' is required",
          example: {
            GET: "/api/canvas/roblox?username=Builderman",
            POST: { "username": "Builderman" }
          }
        })
      }
      
      const cleanUsername = username.trim()
      
      if (cleanUsername.length < 3 || cleanUsername.length > 20) {
        return res.status(400).json({
          status: false,
          message: "Username must be between 3 and 20 characters"
        })
      }
      
      // Log request
      const clientIp = req.ip || req.connection.remoteAddress
      logger.info(`[RobloxCanvas] Generating profile for ${cleanUsername} from ${clientIp}`)
      
      // Step 1: Get user data from Roblox API
      logger.info(`[RobloxCanvas] Fetching Roblox profile for ${cleanUsername}...`)
      const profileResponse = await robloxAPI.getUserProfile(cleanUsername)
      
      if (!profileResponse.success) {
        logger.warn(`[RobloxCanvas] Failed to fetch profile for ${cleanUsername}: ${profileResponse.error}`)
        
        return res.status(404).json({
          status: false,
          message: profileResponse.error === "User not found" 
            ? `Roblox user '${cleanUsername}' not found`
            : `Failed to fetch Roblox profile: ${profileResponse.error}`,
          suggestion: "Make sure the username is correct and exists on Roblox"
        })
      }
      
      const profileData = profileResponse.data
      logger.info(`[RobloxCanvas] Profile data fetched: ${profileData.displayName} (@${profileData.username})`)
      
      // Step 2: Generate canvas
      logger.info(`[RobloxCanvas] Generating image for ${cleanUsername}...`)
      const imageBuffer = await generateRobloxProfileCanvas(profileData)
      
      // Calculate duration
      const duration = Date.now() - startTime
      logger.info(`[RobloxCanvas] Generated in ${duration}ms (${imageBuffer.length} bytes)`)
      
      // Send image response
      res.setHeader("Content-Type", "image/png")
      res.setHeader("Content-Length", imageBuffer.length)
      res.setHeader("Cache-Control", "public, max-age=86400") // Cache 1 day
      res.setHeader("X-Generated-In", `${duration}ms`)
      res.setHeader("X-Roblox-User-ID", profileData.userId)
      res.setHeader("X-Roblox-Username", profileData.username)
      res.setHeader("X-Roblox-Display-Name", profileData.displayName)
      
      // Optional: Add download header
      if (req.query.download) {
        const filename = `roblox-${profileData.username}-${Date.now()}.png`
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
      }
      
      return res.send(imageBuffer)
      
    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`[RobloxCanvas] Error after ${duration}ms: ${error.message}`)
      
      return res.status(500).json({
        status: false,
        message: "Failed to generate Roblox profile card",
        error: error.message,
        duration: `${duration}ms`
      })
    }
  }
}