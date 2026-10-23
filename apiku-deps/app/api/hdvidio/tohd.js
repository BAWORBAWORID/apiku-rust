/**
 * HD VIDEO PROCESSOR API
 * Enhance video quality with custom FPS and settings
 * 
 * @route {POST} /api/tools/hd-video
 * @param {file} video - Video file to process (multipart/form-data) (required)
 * @param {number} fps - Custom FPS (1-240) (optional, default: 30)
 * @param {string} resolution - Target resolution (480p, 720p, 1080p, 1440p, 4k, 8k) (optional, default: 1080p)
 * @param {number} quality - Quality level 1-100 (optional, default: 90)
 * @param {string} enhance - Apply image enhancement (yes/no) (optional, default: yes)
 * @param {string} denoise - Apply denoising (yes/no) (optional, default: no)
 * @param {string} stabilize - Apply video stabilization (yes/no) (optional, default: no)
 * @param {string} format - Output format (mp4, webm, gif) (optional, default: mp4)
 * 
 * @example
 * POST /api/tools/hd-video
 * FormData: { 
 *   video: [file], 
 *   fps: 60, 
 *   resolution: "1080p", 
 *   enhance: "yes",
 *   denoise: "no",
 *   stabilize: "no",
 *   quality: 95,
 *   format: "mp4"
 * }
 */

import ffmpeg from 'fluent-ffmpeg'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import logger from '../../src/utils/logger.js'
import crypto from 'crypto'
import Busboy from 'busboy'
import { promisify } from 'util'

const unlinkAsync = promisify(fs.unlink)

// ==================== CONFIGURATION ====================
const HD_VIDEO_CONFIG = {
  MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB
  ALLOWED_EXTENSIONS: ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v', '.3gp'],
  ALLOWED_MIME_TYPES: [
    'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 
    'video/webm', 'video/x-flv', 'video/x-ms-wmv', 'video/m4v', 'video/3gpp'
  ],
  RESOLUTIONS: {
    '480p': { width: 854, height: 480 },
    '720p': { width: 1280, height: 720 },
    '1080p': { width: 1920, height: 1080 },
    '1440p': { width: 2560, height: 1440 },
    '4k': { width: 3840, height: 2160 },
    '8k': { width: 7680, height: 4320 }
  },
  QUALITY_PRESETS: {
    'low': { crf: 28, preset: 'fast' },
    'medium': { crf: 23, preset: 'medium' },
    'high': { crf: 18, preset: 'slow' },
    'veryhigh': { crf: 16, preset: 'veryslow' }
  },
  BOOLEAN_ENUM: ['yes', 'no'],
  FPS_RANGE: { min: 1, max: 240 },
  QUALITY_RANGE: { min: 1, max: 100 },
  FORMAT_ENUM: ['mp4', 'webm', 'gif'],
  MAX_DURATION: 300, // 5 minutes max duration
  TEMP_DIR: '/tmp/hd-video-processor'
}

// Ensure temp directory exists
if (!fs.existsSync(HD_VIDEO_CONFIG.TEMP_DIR)) {
  fs.mkdirSync(HD_VIDEO_CONFIG.TEMP_DIR, { recursive: true })
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Validate file extension
 * @param {string} filename - Original filename
 * @returns {boolean} Is valid extension
 */
const isValidExtension = (filename) => {
  const ext = path.extname(filename).toLowerCase()
  return HD_VIDEO_CONFIG.ALLOWED_EXTENSIONS.includes(ext)
}

/**
 * Validate mime type
 * @param {string} mimeType - File mime type
 * @returns {boolean} Is valid mime type
 */
const isValidMimeType = (mimeType) => {
  return HD_VIDEO_CONFIG.ALLOWED_MIME_TYPES.includes(mimeType)
}

/**
 * Convert yes/no to boolean
 * @param {string} value - yes/no value
 * @param {boolean} defaultValue - Default value if invalid
 * @returns {boolean} Boolean value
 */
const toBoolean = (value, defaultValue = true) => {
  if (value === 'yes') return true
  if (value === 'no') return false
  return defaultValue
}

/**
 * Validate request parameters with defaults and enums
 * @param {Object} params - Request parameters
 * @returns {Object} Validation result
 */
const validateParams = (params) => {
  const errors = []
  const cleaned = {
    // Default values
    fps: 30,
    resolution: '1080p',
    quality: 90,
    enhance: true,
    denoise: false,
    stabilize: false,
    format: 'mp4'
  }
  
  // Validate FPS
  if (params.fps !== undefined) {
    let fps = parseInt(params.fps)
    if (isNaN(fps) || fps < HD_VIDEO_CONFIG.FPS_RANGE.min || fps > HD_VIDEO_CONFIG.FPS_RANGE.max) {
      errors.push(`FPS must be between ${HD_VIDEO_CONFIG.FPS_RANGE.min} and ${HD_VIDEO_CONFIG.FPS_RANGE.max}`)
    } else {
      cleaned.fps = fps
    }
  }
  
  // Validate resolution (enum)
  if (params.resolution !== undefined) {
    if (!HD_VIDEO_CONFIG.RESOLUTIONS[params.resolution]) {
      errors.push(`Invalid resolution. Allowed: ${Object.keys(HD_VIDEO_CONFIG.RESOLUTIONS).join(', ')}`)
    } else {
      cleaned.resolution = params.resolution
    }
  }
  
  // Validate quality
  if (params.quality !== undefined) {
    let quality = parseInt(params.quality)
    if (isNaN(quality) || quality < HD_VIDEO_CONFIG.QUALITY_RANGE.min || quality > HD_VIDEO_CONFIG.QUALITY_RANGE.max) {
      errors.push(`Quality must be between ${HD_VIDEO_CONFIG.QUALITY_RANGE.min} and ${HD_VIDEO_CONFIG.QUALITY_RANGE.max}`)
    } else {
      cleaned.quality = quality
    }
  }
  
  // Validate enhance (enum: yes/no)
  if (params.enhance !== undefined) {
    if (!HD_VIDEO_CONFIG.BOOLEAN_ENUM.includes(params.enhance)) {
      errors.push(`Enhance must be 'yes' or 'no'`)
    } else {
      cleaned.enhance = toBoolean(params.enhance, true)
    }
  }
  
  // Validate denoise (enum: yes/no)
  if (params.denoise !== undefined) {
    if (!HD_VIDEO_CONFIG.BOOLEAN_ENUM.includes(params.denoise)) {
      errors.push(`Denoise must be 'yes' or 'no'`)
    } else {
      cleaned.denoise = toBoolean(params.denoise, false)
    }
  }
  
  // Validate stabilize (enum: yes/no)
  if (params.stabilize !== undefined) {
    if (!HD_VIDEO_CONFIG.BOOLEAN_ENUM.includes(params.stabilize)) {
      errors.push(`Stabilize must be 'yes' or 'no'`)
    } else {
      cleaned.stabilize = toBoolean(params.stabilize, false)
    }
  }
  
  // Validate format (enum)
  if (params.format !== undefined) {
    if (!HD_VIDEO_CONFIG.FORMAT_ENUM.includes(params.format)) {
      errors.push(`Invalid format. Allowed: ${HD_VIDEO_CONFIG.FORMAT_ENUM.join(', ')}`)
    } else {
      cleaned.format = params.format
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    cleaned
  }
}

/**
 * Get quality preset based on numeric quality
 * @param {number} quality - Quality value (1-100)
 * @returns {Object} FFmpeg quality settings
 */
const getQualitySettings = (quality) => {
  if (quality >= 90) return HD_VIDEO_CONFIG.QUALITY_PRESETS.veryhigh
  if (quality >= 70) return HD_VIDEO_CONFIG.QUALITY_PRESETS.high
  if (quality >= 40) return HD_VIDEO_CONFIG.QUALITY_PRESETS.medium
  return HD_VIDEO_CONFIG.QUALITY_PRESETS.low
}

/**
 * Build FFmpeg filters based on options
 * @param {Object} options - Processing options
 * @returns {Array} FFmpeg filter chain
 */
const buildFilters = (options) => {
  const filters = []
  
  // Resolution scaling
  const targetRes = HD_VIDEO_CONFIG.RESOLUTIONS[options.resolution]
  filters.push(`scale=${targetRes.width}:${targetRes.height}:flags=lanczos`)
  
  // FPS adjustment
  filters.push(`fps=${options.fps}`)
  
  // Image enhancement
  if (options.enhance) {
    // Sharpening
    filters.push('unsharp=5:5:1.0:5:5:1.0')
    // Contrast, brightness, saturation adjustment
    filters.push('eq=contrast=1.1:brightness=0.05:saturation=1.1')
  }
  
  // Denoising
  if (options.denoise) {
    // High quality denoise
    filters.push('hqdn3d=4:3:6:4.5')
  }
  
  // Stabilization (simplified)
  if (options.stabilize) {
    filters.push('deshake')
  }
  
  return filters
}

/**
 * Process video with FFmpeg
 * @param {string} inputPath - Input video path
 * @param {string} outputPath - Output video path
 * @param {Object} options - Processing options
 * @returns {Promise} Promise that resolves when processing is complete
 */
const processVideo = (inputPath, outputPath, options) => {
  return new Promise((resolve, reject) => {
    const filters = buildFilters(options)
    const quality = getQualitySettings(options.quality)
    
    let command = ffmpeg(inputPath)
    
    // Apply video filters
    if (filters.length > 0) {
      command = command.videoFilters(filters.join(','))
    }
    
    // Set output format
    if (options.format === 'gif') {
      command = command
        .format('gif')
        .outputOptions('-loop', '0')
    } else {
      const codec = options.format === 'webm' ? 'libvpx-vp9' : 'libx264'
      command = command
        .videoCodec(codec)
        .outputOptions('-crf', quality.crf.toString())
        .outputOptions('-preset', quality.preset)
        .outputOptions('-pix_fmt', 'yuv420p')
    }
    
    // Audio settings (skip for GIF)
    if (options.format !== 'gif') {
      command = command
        .audioCodec('aac')
        .audioBitrate(192)
    }
    
    command
      .on('start', (cmd) => {
        logger.info(`[HDVideo] FFmpeg started: ${cmd}`)
      })
      .on('progress', (progress) => {
        logger.debug(`[HDVideo] Processing: ${progress.percent}% done`)
      })
      .on('end', () => {
        logger.info(`[HDVideo] Processing completed: ${outputPath}`)
        resolve()
      })
      .on('error', (err) => {
        logger.error(`[HDVideo] FFmpeg error: ${err.message}`)
        reject(err)
      })
      .save(outputPath)
  })
}

/**
 * Clean up temporary files
 * @param {Array<string>} files - Array of file paths to delete
 */
const cleanup = async (files) => {
  for (const file of files) {
    try {
      if (file && fs.existsSync(file)) {
        await unlinkAsync(file)
        logger.debug(`[HDVideo] Cleaned up: ${file}`)
      }
    } catch (err) {
      logger.error(`[HDVideo] Cleanup error: ${err.message}`)
    }
  }
}

// ==================== MAIN API HANDLER ====================

export default {
  name: "HD Video Processor",
  description: "Enhance video quality with custom FPS, resolution, and filters",
  category: "HD Video",
  
  methods: ["POST"],
  
  params: ["video", "fps", "resolution", "quality", "enhance", "denoise", "stabilize", "format"],
  
  paramsSchema: {
    video: {
      type: "file",
      required: true,
      description: "Video file to process"
    },
    fps: {
      type: "number",
      required: false,
      description: "Custom FPS (1-240)",
      example: 60,
      default: 30,
      min: 1,
      max: 240
    },
    resolution: {
      type: "string",
      required: false,
      description: "Target resolution",
      example: "1080p",
      enum: Object.keys(HD_VIDEO_CONFIG.RESOLUTIONS),
      default: "1080p"
    },
    quality: {
      type: "number",
      required: false,
      description: "Quality level (1-100)",
      example: 95,
      default: 90,
      min: 1,
      max: 100
    },
    enhance: {
      type: "string",
      required: false,
      description: "Apply image enhancement",
      example: "yes",
      enum: ["yes", "no"],
      default: "yes"
    },
    denoise: {
      type: "string",
      required: false,
      description: "Apply denoising",
      example: "no",
      enum: ["yes", "no"],
      default: "no"
    },
    stabilize: {
      type: "string",
      required: false,
      description: "Apply video stabilization",
      example: "no",
      enum: ["yes", "no"],
      default: "no"
    },
    format: {
      type: "string",
      required: false,
      description: "Output format",
      example: "mp4",
      enum: ["mp4", "webm", "gif"],
      default: "mp4"
    }
  },
  
  /**
   * Main request handler
   */
  async run(req, res) {
    const startTime = Date.now()
    const requestId = crypto.randomBytes(4).toString('hex')
    const filesToCleanup = []
    
    try {
      // ========== 1. CHECK METHOD ==========
      if (req.method !== 'POST') {
        return res.status(405).json({
          success: false,
          message: "Method not allowed. Use POST."
        })
      }
      
      // ========== 2. PARSE MULTIPART FORM ==========
      const busboy = Busboy({ headers: req.headers, limits: { fileSize: HD_VIDEO_CONFIG.MAX_FILE_SIZE } })
      
      let formFields = {}
      let videoFile = null
      let videoFilename = null
      let videoMimeType = null
      
      const formPromise = new Promise((resolve, reject) => {
        busboy.on('file', (fieldname, file, info) => {
          if (fieldname !== 'video') {
            file.resume()
            return
          }
          
          const { filename, mimeType } = info
          
          // Validate file type
          if (!isValidExtension(filename) || !isValidMimeType(mimeType)) {
            file.resume()
            reject(new Error('Invalid file type. Only video files are allowed.'))
            return
          }
          
          videoFilename = filename
          videoMimeType = mimeType
          
          // Save file to temp directory
          const tempFilePath = path.join(HD_VIDEO_CONFIG.TEMP_DIR, `${uuidv4()}_${filename}`)
          filesToCleanup.push(tempFilePath)
          
          const writeStream = fs.createWriteStream(tempFilePath)
          file.pipe(writeStream)
          
          writeStream.on('finish', () => {
            videoFile = tempFilePath
          })
          
          writeStream.on('error', reject)
        })
        
        busboy.on('field', (fieldname, val) => {
          formFields[fieldname] = val
        })
        
        busboy.on('error', reject)
        
        busboy.on('close', () => {
          if (!videoFile) {
            reject(new Error('No video file uploaded'))
          } else {
            resolve()
          }
        })
        
        req.pipe(busboy)
      })
      
      await formPromise
      
      // ========== 3. VALIDATE PARAMETERS ==========
      const validation = validateParams(formFields)
      
      if (!validation.isValid) {
        await cleanup(filesToCleanup)
        
        return res.status(400).json({
          success: false,
          message: "Invalid parameters",
          errors: validation.errors,
          requestId: requestId,
          schema: {
            fps: { type: "number", min: 1, max: 240, default: 30 },
            resolution: { enum: Object.keys(HD_VIDEO_CONFIG.RESOLUTIONS), default: "1080p" },
            quality: { type: "number", min: 1, max: 100, default: 90 },
            enhance: { enum: ["yes", "no"], default: "yes" },
            denoise: { enum: ["yes", "no"], default: "no" },
            stabilize: { enum: ["yes", "no"], default: "no" },
            format: { enum: ["mp4", "webm", "gif"], default: "mp4" }
          }
        })
      }
      
      const options = validation.cleaned
      
      // ========== 4. LOG REQUEST ==========
      const clientIp = req.headers['x-forwarded-for'] || req.ip || 'unknown'
      
      logger.info(`[HDVideo:${requestId}] Request from ${clientIp} | File: ${videoFilename} | Options: ${JSON.stringify({
        fps: options.fps,
        resolution: options.resolution,
        quality: options.quality,
        enhance: options.enhance ? 'yes' : 'no',
        denoise: options.denoise ? 'yes' : 'no',
        stabilize: options.stabilize ? 'yes' : 'no',
        format: options.format
      })}`)
      
      // ========== 5. PROCESS VIDEO ==========
      const outputFilename = `${uuidv4()}_processed.${options.format}`
      const outputPath = path.join(HD_VIDEO_CONFIG.TEMP_DIR, outputFilename)
      filesToCleanup.push(outputPath)
      
      logger.info(`[HDVideo:${requestId}] Processing video...`)
      
      await processVideo(videoFile, outputPath, options)
      
      // ========== 6. READ PROCESSED VIDEO ==========
      const stats = fs.statSync(outputPath)
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2)
      
      logger.info(`[HDVideo:${requestId}] Processing complete | Size: ${fileSizeMB}MB`)
      
      // ========== 7. STREAM RESPONSE ==========
      const mimeTypes = {
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'gif': 'image/gif'
      }
      
      res.setHeader('Content-Type', mimeTypes[options.format])
      res.setHeader('Content-Disposition', `attachment; filename="hd_${videoFilename.replace(/\.[^/.]+$/, '')}.${options.format}"`)
      res.setHeader('X-Request-ID', requestId)
      res.setHeader('X-Processing-Time', `${Date.now() - startTime}ms`)
      res.setHeader('X-File-Size', `${fileSizeMB}MB`)
      res.setHeader('X-Video-Options', JSON.stringify({
        fps: options.fps,
        resolution: options.resolution,
        quality: options.quality,
        enhance: options.enhance ? 'yes' : 'no',
        denoise: options.denoise ? 'yes' : 'no',
        stabilize: options.stabilize ? 'yes' : 'no',
        format: options.format
      }))
      
      // Stream file and cleanup after
      const readStream = fs.createReadStream(outputPath)
      
      readStream.on('error', (err) => {
        logger.error(`[HDVideo:${requestId}] Stream error: ${err.message}`)
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: "Error streaming video",
            requestId: requestId
          })
        }
      })
      
      readStream.on('end', async () => {
        logger.info(`[HDVideo:${requestId}] Video sent successfully`)
        await cleanup(filesToCleanup)
      })
      
      readStream.pipe(res)
      
    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`[HDVideo:${requestId}] Error after ${duration}ms: ${error.message}\n${error.stack}`)
      
      await cleanup(filesToCleanup)
      
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message: "Failed to process video",
          error: process.env.NODE_ENV === 'development' ? error.message : "Internal server error",
          requestId: requestId
        })
      }
    }
  }
}