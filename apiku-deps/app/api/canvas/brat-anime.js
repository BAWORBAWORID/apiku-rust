/**
 * BRAT ANIME CANVAS API
 * Generate brat style anime text images
 * 
 * @route {GET|POST} /api/canvas/brat-anime
 * @param {string} text - Text to render (required)
 * 
 * @example
 * GET /api/canvas/brat-anime?text=Hello%20World
 * POST /api/canvas/brat-anime -d {"text": "Hello World"}
 */

import { createCanvas } from "canvas"
import logger from "../../src/utils/logger.js"
import crypto from "crypto"
import axios from "axios"
import Jimp from "jimp"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

// ESM __dirname — points to api/canvas/ folder
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// Local fallback path (auto-resolved relative to this file)
const LOCAL_BG_PATH = path.join(__dirname, "assets", "wftnwc.jpg")

// ==================== CONFIGURATION ====================
const BRAT_ANIME_CONFIG = {
  MAX_TEXT_LENGTH: 500,
  // Anime background configuration
  ANIME_BG: {
    URL: "https://files.catbox.moe/wftnwc.jpg",
    TEXT_POSITION: {
      x: 243,
      y: 750,
      maxWidth: 600
    }
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Clean and normalize text
 * @param {string} text - Input text
 * @returns {string} Cleaned text
 */
const cleanText = (text) => {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Validate BRAT Anime request parameters
 * @param {Object} params - Request parameters
 * @returns {Object} { isValid: boolean, errors: string[], cleaned: Object }
 */
const validateRequest = (params) => {
  const errors = []
  const cleaned = {}
  
  // Validate text
  let text = params.text || params.q || ''
  
  if (typeof text === 'string') {
    text = cleanText(text)
  } else {
    text = ''
  }
  
  if (!text) {
    errors.push('Parameter "text" is required')
  } else if (text.length > BRAT_ANIME_CONFIG.MAX_TEXT_LENGTH) {
    errors.push(`Text too long. Maximum ${BRAT_ANIME_CONFIG.MAX_TEXT_LENGTH} characters`)
  } else {
    cleaned.text = text
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    cleaned
  }
}

/**
 * Load anime background image (network-primary → local-asset fallback).
 * @returns {Promise<Buffer>} JPEG buffer.
 */
const downloadAnimeBackground = async () => {
  try {
    const response = await axios({
      url: BRAT_ANIME_CONFIG.ANIME_BG.URL,
      responseType: "arraybuffer",
      timeout: 10000
    })
    return Buffer.from(response.data)
  } catch (error) {
    if (fs.existsSync(LOCAL_BG_PATH)) {
      logger.warn(`[BratAnime] Remote failed (${error.message}); using local fallback ${LOCAL_BG_PATH}`)
      return fs.readFileSync(LOCAL_BG_PATH)
    }
    logger.error(`[BratAnime] Failed to download background (remote err: ${error.message}; local fallback missing at ${LOCAL_BG_PATH})`)
    throw new Error("Failed to download anime background")
  }
}

/**
 * Generate brat anime image using Jimp
 * @param {string} text - Text to render
 * @returns {Promise<Buffer>} Image buffer (JPEG format)
 */
const generateBratAnimeJimp = async (text) => {
  const bgBuffer = await downloadAnimeBackground()
  const image = await Jimp.read(bgBuffer)
  const font = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK)
  const { x, y, maxWidth } = BRAT_ANIME_CONFIG.ANIME_BG.TEXT_POSITION

  image.print(
    font, x, y,
    { text, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER, alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE },
    maxWidth
  )

  return image.quality(90).getBufferAsync(Jimp.MIME_JPEG)
}

/**
 * Generate brat anime image (canvas version as fallback)
 * @param {string} text - Text to render
 * @returns {Canvas} Canvas object
 */
const generateBratAnimeCanvas = (text) => {
  const canvasSize = 1080
  const padding = 90

  // Create canvas
  const canvas = createCanvas(canvasSize, canvasSize)
  const ctx = canvas.getContext("2d")

  // Anime-style gradient background
  const gradient = ctx.createLinearGradient(0, 0, 0, canvasSize)
  gradient.addColorStop(0, "#ff9a9e")
  gradient.addColorStop(0.5, "#fad0c4")
  gradient.addColorStop(1, "#fbc2eb")
  
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvasSize, canvasSize)

  // Add sparkles
  ctx.fillStyle = "rgba(255, 255, 255, 0.3)"
  for (let i = 0; i < 20; i++) {
    ctx.beginPath()
    ctx.arc(
      Math.random() * canvasSize,
      Math.random() * canvasSize,
      Math.random() * 5 + 2,
      0,
      Math.PI * 2
    )
    ctx.fill()
  }

  // Text styling
  ctx.fillStyle = "#4a0e4e"
  ctx.font = 'bold 48px "Comic Sans MS", "Chalkboard SE", Arial, sans-serif'
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  
  // Add shadow
  ctx.shadowColor = "rgba(255, 182, 193, 0.8)"
  ctx.shadowBlur = 10
  ctx.shadowOffsetX = 3
  ctx.shadowOffsetY = 3

  // Draw text in center
  ctx.fillText(text, canvasSize / 2, canvasSize / 2)

  return canvas
}

/**
 * Convert canvas to JPEG buffer
 * @param {Canvas} canvas - Canvas instance
 * @returns {Buffer} JPEG buffer
 */
const canvasToBuffer = (canvas) => {
  return canvas.toBuffer('image/jpeg', { 
    quality: 0.9,
    progressive: true 
  })
}

// ==================== MAIN API HANDLER ====================

export default {
  name: "Brat Anime Generator",
  description: "Generate brat style anime text images (JPEG format)",
  category: "Canvas",
  
  methods: ["GET", "POST"],
  
  params: ["text"],
  
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Text to render on image",
      example: "Hello World",
      minLength: 1,
      maxLength: BRAT_ANIME_CONFIG.MAX_TEXT_LENGTH
    }
  },
  
  /**
   * Main request handler
   */
  async run(req, res) {
    const startTime = Date.now()
    const requestId = crypto.randomBytes(4).toString('hex')
    
    try {
      // ========== 1. EXTRACT PARAMETERS ==========
      let params = {}
      
      if (req.method === 'GET') {
        params = {
          text: req.query.text || req.query.q
        }
      } else {
        params = {
          text: req.body?.text || req.body?.q
        }
      }
      
      // ========== 2. VALIDATE INPUT ==========
      const validation = validateRequest(params)
      
      if (!validation.isValid) {
        logger.warn(`[BratAnime:${requestId}] Validation failed: ${validation.errors.join(', ')}`)
        
        return res.status(400).json({
          success: false,
          message: "Invalid parameters",
          errors: validation.errors,
          example: {
            GET: "/api/canvas/brat-anime?text=Hello%20World",
            POST: { text: "Hello World" }
          },
          maxTextLength: BRAT_ANIME_CONFIG.MAX_TEXT_LENGTH
        })
      }
      
      const { text } = validation.cleaned
      
      // ========== 3. LOG REQUEST ==========
      const clientIp = req.headers['x-forwarded-for'] || 
                      req.ip || 
                      req.connection?.remoteAddress || 
                      'unknown'
      
      logger.info(`[BratAnime:${requestId}] Request from ${clientIp} | Text: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`)
      
      // ========== 4. GENERATE OUTPUT ==========
      logger.info(`[BratAnime:${requestId}] Generating JPEG image...`)
      
      let outputBuffer
      
      // Try Jimp first, fallback to canvas
      try {
        outputBuffer = await generateBratAnimeJimp(text)
      } catch (error) {
        logger.warn(`[BratAnime:${requestId}] Jimp failed, using canvas: ${error.message}`)
        const canvas = generateBratAnimeCanvas(text)
        outputBuffer = canvasToBuffer(canvas)
      }
      
      logger.info(`[BratAnime:${requestId}] Generated | Size: ${(outputBuffer.length / 1024).toFixed(2)}KB`)
      
      // ========== 5. CALCULATE DURATION ==========
      const duration = Date.now() - startTime
      
      // ========== 6. SEND RESPONSE ==========
      res.setHeader("Content-Type", "image/jpeg")
      res.setHeader("Content-Length", outputBuffer.length)
      res.setHeader("X-Generated-In", `${duration}ms`)
      res.setHeader("X-Request-ID", requestId)
      res.setHeader("X-Brat-Text-Length", text.length)
      
      return res.send(outputBuffer)
      
    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`[BratAnime:${requestId}] Error after ${duration}ms: ${error.message}\n${error.stack}`)
      
      if (res.headersSent) {
        return res.end()
      }
      
      return res.status(500).json({
        success: false,
        message: "Failed to generate brat anime image",
        error: process.env.NODE_ENV === 'development' ? error.message : "Internal server error",
        requestId: requestId
      })
    }
  }
}