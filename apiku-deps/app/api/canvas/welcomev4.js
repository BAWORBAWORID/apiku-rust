import { createCanvas, loadImage } from "canvas"
import { fileTypeFromBuffer } from "file-type"
import logger from "../../src/utils/logger.js"
import multer from "multer"
import { Buffer } from "buffer"
import axios from "axios"

// ==================== MULTER CONFIG ====================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 2
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true)
    } else {
      cb(new Error('Only image files are allowed'), false)
    }
  }
})

// ==================== HELPER FUNCTIONS ====================
function isValidImageUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

async function isValidImageBuffer(buffer) {
  try {
    const type = await fileTypeFromBuffer(buffer)
    return type && [
      'image/png',
      'image/jpeg', 
      'image/jpg',
      'image/webp',
      'image/gif'
    ].includes(type.mime)
  } catch {
    return false
  }
}

function applyRoundedCorners(ctx, x, y, width, height, radius) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  ctx.lineTo(x + radius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

function truncateText(text, maxLength = 20) {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength - 3) + '...'
}

// ==================== IMAGE GENERATION ====================
async function generateWelcomeV4Image(username, avatarBuffer, backgroundBuffer) {
  // Create canvas
  const canvas = createCanvas(800, 300)
  const ctx = canvas.getContext("2d")
  
  // 1. Load and draw background
  let backgroundImg
  try {
    backgroundImg = await loadImage(backgroundBuffer)
  } catch (error) {
    logger.warn(`[WelcomeV4] Background load failed: ${error.message}`)
    // Fallback gradient background
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
    gradient.addColorStop(0, "#2d3748") // Dark gray
    gradient.addColorStop(0.5, "#4a5568") // Medium gray
    gradient.addColorStop(1, "#1a202c") // Darker gray
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    backgroundImg = null
  }
  
  if (backgroundImg) {
    // Draw background with overlay
    ctx.drawImage(backgroundImg, 0, 0, canvas.width, canvas.height)
    
    // Dark overlay for better text readability
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  
  // 2. Draw main container with rounded corners
  const containerX = 50
  const containerY = 50
  const containerWidth = canvas.width - 100
  const containerHeight = canvas.height - 100
  
  // Container background (glass morphism effect)
  ctx.fillStyle = "rgba(42, 46, 53, 0.7)" // Semi-transparent dark
  applyRoundedCorners(ctx, containerX, containerY, containerWidth, containerHeight, 25)
  ctx.fill()
  
  // Container border
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)"
  ctx.lineWidth = 2
  applyRoundedCorners(ctx, containerX, containerY, containerWidth, containerHeight, 25)
  ctx.stroke()
  
  // 3. Draw username as main text (BIG and at the front)
  const usernameText = truncateText(username, 25)
  
  // Username text with glow effect
  ctx.save()
  ctx.shadowColor = "rgba(0, 0, 0, 0.8)"
  ctx.shadowBlur = 15
  ctx.shadowOffsetX = 3
  ctx.shadowOffsetY = 3
  
  // Main username text (BIG and centered)
  ctx.font = "bold 64px 'Segoe UI', Arial, sans-serif"
  ctx.fillStyle = "#ffffff"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  
  const usernameY = canvas.height / 2 - 30
  ctx.fillText(usernameText, canvas.width / 2, usernameY)
  
  // Reset shadow for other elements
  ctx.restore()
  
  // 4. Draw "WELCOME" text below username
  ctx.font = "italic 32px 'Segoe UI', Arial, sans-serif"
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)"
  ctx.textAlign = "center"
  ctx.fillText("WELCOME TO OUR COMMUNITY", canvas.width / 2, usernameY + 60)
  
  // 5. Load and draw avatar (smaller, placed at bottom right corner)
  let avatarImg
  try {
    avatarImg = await loadImage(avatarBuffer)
  } catch (error) {
    logger.warn(`[WelcomeV4] Avatar load failed: ${error.message}`)
    // Create placeholder avatar
    const placeholderCanvas = createCanvas(100, 100)
    const placeholderCtx = placeholderCanvas.getContext("2d")
    
    // Gradient background
    const gradient = placeholderCtx.createRadialGradient(50, 50, 0, 50, 50, 50)
    gradient.addColorStop(0, "#4299e1")
    gradient.addColorStop(1, "#2b6cb0")
    placeholderCtx.fillStyle = gradient
    placeholderCtx.fillRect(0, 0, 100, 100)
    
    // Circle
    placeholderCtx.beginPath()
    placeholderCtx.arc(50, 50, 45, 0, Math.PI * 2)
    placeholderCtx.strokeStyle = "white"
    placeholderCtx.lineWidth = 3
    placeholderCtx.stroke()
    
    // First letter of username
    const firstLetter = username.charAt(0).toUpperCase()
    placeholderCtx.font = "bold 40px Arial"
    placeholderCtx.fillStyle = "white"
    placeholderCtx.textAlign = "center"
    placeholderCtx.textBaseline = "middle"
    placeholderCtx.fillText(firstLetter, 50, 50)
    
    avatarImg = placeholderCanvas
  }
  
  // Draw avatar in bottom right corner (smaller size)
  const avatarSize = 80
  const avatarX = canvas.width - avatarSize - 80
  const avatarY = canvas.height - avatarSize - 80
  
  // Avatar circle
  ctx.save()
  ctx.beginPath()
  ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  
  ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize)
  ctx.restore()
  
  // Avatar border
  ctx.beginPath()
  ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2)
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 3
  ctx.stroke()
  
  // 6. Decorative elements
  // Glow effect behind username
  ctx.save()
  ctx.beginPath()
  ctx.arc(canvas.width / 2, usernameY, 180, 0, Math.PI * 2)
  const glowGradient = ctx.createRadialGradient(
    canvas.width / 2, usernameY, 0,
    canvas.width / 2, usernameY, 180
  )
  glowGradient.addColorStop(0, "rgba(66, 153, 225, 0.3)")
  glowGradient.addColorStop(1, "rgba(66, 153, 225, 0)")
  ctx.fillStyle = glowGradient
  ctx.fill()
  ctx.restore()
  
  // Decorative particles
  ctx.fillStyle = "rgba(255, 255, 255, 0.2)"
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * canvas.width
    const y = Math.random() * canvas.height
    const size = Math.random() * 4 + 1
    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fill()
  }
  
  // Bottom decorative line
  ctx.beginPath()
  ctx.moveTo(canvas.width / 2 - 150, canvas.height - 40)
  ctx.lineTo(canvas.width / 2 + 150, canvas.height - 40)
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)"
  ctx.lineWidth = 2
  ctx.stroke()
  
  return canvas.toBuffer("image/png")
}

// ==================== MAIN API ====================
export default {
  name: "Welcome Image Generator V4",
  description: "Modern welcome banner with big username text and decorative avatar",
  category: "Canvas",
  methods: ["GET", "POST"],
  
  params: ["username", "avatar", "background"],
  
  paramsSchema: {
    username: {
      type: "string",
      required: true,
      description: "Username to display prominently",
      example: "JohnDoe",
      minLength: 1,
      maxLength: 50
    },
    avatar: {
      type: "string",
      required: true,
      description: "Avatar image URL",
      example: "https://i.imgur.com/avatar.jpg"
    },
    background: {
      type: "string",
      required: true,
      description: "Background image URL",
      example: "https://i.imgur.com/background.jpg"
    }
  },
  
  async run(req, res) {
    // Handle POST multipart/form-data
    if (req.method === 'POST' && req.headers['content-type']?.includes('multipart/form-data')) {
      return new Promise((resolve) => {
        upload.fields([
          { name: 'avatar', maxCount: 1 },
          { name: 'background', maxCount: 1 }
        ])(req, res, async (err) => {
          if (err) {
            return resolve(res.status(400).json({
              status: false,
              message: err.message
            }))
          }
          
          try {
            const { username } = req.body
            const avatarFile = req.files?.avatar?.[0]
            const backgroundFile = req.files?.background?.[0]
            
            // Validation
            if (!username || !avatarFile || !backgroundFile) {
              return resolve(res.status(400).json({
                status: false,
                message: "All fields are required: username, avatar, and background"
              }))
            }
            
            // Validate image buffers
            const isAvatarValid = await isValidImageBuffer(avatarFile.buffer)
            const isBackgroundValid = await isValidImageBuffer(backgroundFile.buffer)
            
            if (!isAvatarValid || !isBackgroundValid) {
              return resolve(res.status(400).json({
                status: false,
                message: "Invalid image files. Supported: PNG, JPEG, JPG, WEBP, GIF"
              }))
            }
            
            // Generate image
            const imageBuffer = await generateWelcomeV4Image(
              username,
              avatarFile.buffer,
              backgroundFile.buffer
            )
            
            // Send response
            res.setHeader("Content-Type", "image/png")
            res.setHeader("Cache-Control", "public, max-age=3600")
            res.setHeader("X-Generated-For", username.substring(0, 20))
            return resolve(res.send(imageBuffer))
            
          } catch (error) {
            logger.error(`[WelcomeV4] POST Error: ${error.message}`)
            return resolve(res.status(500).json({
              status: false,
              message: error.message
            }))
          }
        })
      })
    }
    
    // Handle GET and POST JSON
    try {
      // Get parameters
      let username, avatar, background
      
      if (req.method === 'GET') {
        username = req.query.username
        avatar = req.query.avatar
        background = req.query.background
      } else {
        username = req.body?.username
        avatar = req.body?.avatar
        background = req.body?.background
      }
      
      // Validation
      if (!username || !avatar || !background) {
        return res.status(400).json({
          status: false,
          message: "Parameters 'username', 'avatar', and 'background' are required",
          example: {
            GET: "/api/canvas/welcome-v4?username=John&avatar=URL&background=URL",
            POST: { "username": "John", "avatar": "URL", "background": "URL" }
          }
        })
      }
      
      if (username.length > 50) {
        return res.status(400).json({
          status: false,
          message: "Username must be 50 characters or less"
        })
      }
      
      if (!isValidImageUrl(avatar) || !isValidImageUrl(background)) {
        return res.status(400).json({
          status: false,
          message: "Avatar and background must be valid image URLs",
          suggestion: "Use image URLs ending with .jpg, .png, .gif, .webp"
        })
      }
      
      // Log request
      const clientIp = req.ip || req.connection.remoteAddress
      logger.info(`[WelcomeV4] Request from ${clientIp} for user: ${username}`)
      
      // Fetch images from URLs
      const [avatarResponse, backgroundResponse] = await Promise.all([
        axios.get(avatar, { 
          responseType: 'arraybuffer', 
          timeout: 10000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        }).catch(error => {
          logger.warn(`[WelcomeV4] Failed to fetch avatar: ${error.message}`)
          return null
        }),
        axios.get(background, { 
          responseType: 'arraybuffer', 
          timeout: 10000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        }).catch(error => {
          logger.warn(`[WelcomeV4] Failed to fetch background: ${error.message}`)
          return null
        })
      ])
      
      if (!avatarResponse || !backgroundResponse) {
        return res.status(400).json({
          status: false,
          message: "Failed to download avatar or background images"
        })
      }
      
      // Convert to buffers
      const avatarBuffer = Buffer.from(avatarResponse.data)
      const backgroundBuffer = Buffer.from(backgroundResponse.data)
      
      // Validate buffers
      const isAvatarValid = await isValidImageBuffer(avatarBuffer)
      const isBackgroundValid = await isValidImageBuffer(backgroundBuffer)
      
      if (!isAvatarValid || !isBackgroundValid) {
        return res.status(400).json({
          status: false,
          message: "Invalid image format from URLs"
        })
      }
      
      // Generate image
      const startTime = Date.now()
      const imageBuffer = await generateWelcomeV4Image(username, avatarBuffer, backgroundBuffer)
      const duration = Date.now() - startTime
      
      logger.info(`[WelcomeV4] Generated in ${duration}ms for ${username}`)
      
      // Send response
      res.setHeader("Content-Type", "image/png")
      res.setHeader("Content-Length", imageBuffer.length)
      res.setHeader("Cache-Control", "public, max-age=3600")
      res.setHeader("X-Generated-In", `${duration}ms`)
      
      // Optional download
      if (req.query.download) {
        const safeUsername = username.replace(/[^a-z0-9]/gi, '-').toLowerCase()
        const filename = `welcome-${safeUsername}-${Date.now()}.png`
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
      }
      
      return res.send(imageBuffer)
      
    } catch (error) {
      logger.error(`[WelcomeV4] Error: ${error.message}`)
      
      return res.status(500).json({
        status: false,
        message: "Failed to generate welcome image",
        error: error.message
      })
    }
  }
}