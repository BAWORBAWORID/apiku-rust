/**
 * FONT CONVERTER API
 * Convert text to various font styles
 * 
 * @route {GET|POST} /api/tools/font
 * @param {string} style - Font style (bold, italic, script, full, smallcaps, rounded, squared)
 * @param {string} text - Text to convert (required)
 * 
 * @example
 * GET /api/tools/font?style=bold&text=Hello%20World
 * POST /api/tools/font -d {"style": "bold", "text": "Hello World"}
 */

import logger from "../../src/utils/logger.js"
import crypto from "crypto"

// ==================== CONFIGURATION ====================
const FONT_CONFIG = {
  MAX_TEXT_LENGTH: 1000,
  ALLOWED_STYLES: ['bold', 'italic', 'script', 'full', 'smallcaps', 'rounded', 'squared']
}

// ==================== FONT MAPPINGS ====================
const FONTS = {
  bold: {
    a: '𝗮', b: '𝗯', c: '𝗰', d: '𝗱', e: '𝗲', f: '𝗳', g: '𝗴', h: '𝗵', i: '𝗶', j: '𝗷', k: '𝗸', l: '𝗹', m: '𝗺', n: '𝗻', o: '𝗼', p: '𝗽', q: '𝗾', r: '𝗿', s: '𝘀', t: '𝘁', u: '𝘂', v: '𝘃', w: '𝘄', x: '𝘅', y: '𝘆', z: '𝘇',
    A: '𝗔', B: '𝗕', C: '𝗖', D: '𝗗', E: '𝗘', F: '𝗙', G: '𝗚', H: '𝗛', I: '𝗜', J: '𝗝', K: '𝗞', L: '𝗟', M: '𝗠', N: '𝗡', O: '𝗢', P: '𝗣', Q: '𝗤', R: '𝗥', S: '𝗦', T: '𝗧', U: '𝗨', V: '𝗩', W: '𝗪', X: '𝗫', Y: '𝗬', Z: '𝗭',
    0: '𝟬', 1: '𝟭', 2: '𝟮', 3: '𝟯', 4: '𝟰', 5: '𝟱', 6: '𝟲', 7: '𝟳', 8: '𝟴', 9: '𝟵'
  },
  italic: {
    a: '𝘢', b: '𝘣', c: '𝘤', d: '𝘥', e: '𝘦', f: '𝘧', g: '𝘨', h: '𝘩', i: '𝘪', j: '𝘫', k: '𝘬', l: '𝘭', m: '𝘮', n: '𝘯', o: '𝘰', p: '𝘱', q: '𝘲', r: '𝘳', s: '𝘴', t: '𝘵', u: '𝘶', v: '𝘷', w: '𝘸', x: '𝘹', y: '𝘺', z: '𝘻',
    A: '𝘈', B: '𝘉', C: '𝘊', D: '𝘋', E: '𝘌', F: '𝘍', G: '𝘎', H: '𝘏', I: '𝘐', J: '𝘑', K: '𝘒', L: '𝘓', M: '𝘔', N: '𝘕', O: '𝘖', P: '𝘗', Q: '𝘘', R: '𝘙', S: '𝘚', T: '𝘛', U: '𝘜', V: '𝘝', W: '𝘞', X: '𝘟', Y: '𝘠', Z: '𝘡'
  },
  script: {
    a: '𝓪', b: '𝓫', c: '𝓬', d: '𝓭', e: '𝓮', f: '𝓯', g: '𝓰', h: '𝓱', i: '𝓲', j: '𝓳', k: '𝓴', l: '𝓵', m: '𝓶', n: '𝓷', o: '𝓸', p: '𝓹', q: '𝓺', r: '𝓻', s: '𝓼', t: '𝓽', u: '𝓾', v: '𝓿', w: '𝔀', x: '𝔁', y: '𝔂', z: '𝔃',
    A: '𝓐', B: '𝓑', C: '𝓒', D: '𝓓', E: '𝓔', F: '𝓕', G: '𝓖', H: '𝓗', I: '𝓘', J: '𝓙', K: '𝓚', L: '𝓛', M: '𝓜', N: '𝓝', O: '𝓞', P: '𝓟', Q: '𝓠', R: '𝓡', S: '𝓢', T: '𝓣', U: '𝓤', V: '𝓥', W: '𝓦', X: '𝓧', Y: '𝓨', Z: '𝓩'
  },
  full: {
    a: 'ａ', b: 'ｂ', c: 'ｃ', d: 'ｄ', e: 'ｅ', f: 'ｆ', g: 'ｇ', h: 'ｈ', i: 'ｉ', j: 'ｊ', k: 'ｋ', l: 'ｌ', m: 'ｍ', n: 'ｎ', o: 'ｏ', p: 'ｐ', q: 'ｑ', r: 'ｒ', s: 'ｓ', t: 'ｔ', u: 'ｕ', v: 'ｖ', w: 'ｗ', x: 'ｘ', y: 'ｙ', z: 'ｚ',
    A: 'Ａ', B: 'Ｂ', C: 'Ｃ', D: 'Ｄ', E: 'Ｅ', F: 'Ｆ', G: 'Ｇ', H: 'Ｈ', I: 'Ｉ', J: 'Ｊ', K: 'Ｋ', L: 'Ｌ', M: 'Ｍ', N: 'Ｎ', O: 'Ｏ', P: 'Ｐ', Q: 'Ｑ', R: 'Ｒ', S: 'Ｓ', T: 'Ｔ', U: 'Ｕ', V: 'Ｖ', W: 'Ｗ', X: 'Ｘ', Y: 'Ｙ', Z: 'Ｚ',
    0: '０', 1: '１', 2: '２', 3: '３', 4: '４', 5: '５', 6: '６', 7: '７', 8: '８', 9: '９', ' ': '　'
  },
  smallcaps: {
    a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ',
    A: 'ᴀ', B: 'ʙ', C: 'ᴄ', D: 'ᴅ', E: 'ᴇ', F: 'ꜰ', G: 'ɢ', H: 'ʜ', I: 'ɪ', J: 'ᴊ', K: 'ᴋ', L: 'ʟ', M: 'ᴍ', N: 'ɴ', O: 'ᴏ', P: 'ᴘ', Q: 'ǫ', R: 'ʀ', S: 'ꜱ', T: 'ᴛ', U: 'ᴜ', V: 'ᴠ', W: 'ᴡ', X: 'x', Y: 'ʏ', Z: 'ᴢ',
    0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹'
  },
  rounded: {
    a: '🅐', b: '🅑', c: '🅒', d: '🅓', e: '🅔', f: '🅕', g: '🅖', h: '🅗', i: '🅘', j: '🅙', k: '🅚', l: '🅛', m: '🅜', n: '🅝', o: '🅞', p: '🅟', q: '🅠', r: '🅡', s: '🅢', t: '🅣', u: '🅤', v: '🅥', w: '🅦', x: '🅧', y: '🅨', z: '🅩',
    A: '🅐', B: '🅑', C: '🅒', D: '🅓', E: '🅔', F: '🅕', G: '🅖', H: '🅗', I: '🅘', J: '🅙', K: '🅚', L: '🅛', M: '🅜', N: '🅝', O: '🅞', P: '🅟', Q: '🅠', R: '🅡', S: '🅢', T: '🅣', U: '🅤', V: '🅥', W: '🅦', X: '🅧', Y: '🅨', Z: '🅩',
    0: '⓿', 1: '❶', 2: '❷', 3: '❸', 4: '❹', 5: '❺', 6: '❻', 7: '❼', 8: '❽', 9: '❾'
  },
  squared: {
    a: 'ﾑ', b: '乃', c: 'ᄃ', d: 'り', e: '乇', f: 'ｷ', g: 'ム', h: 'ん', i: 'ﾉ', j: 'ﾌ', k: 'ズ', l: 'ﾚ', m: 'ﾶ', n: '刀', o: 'の', p: 'ｱ', q: 'ゐ', r: '尺', s: '丂', t: 'ｲ', u: 'ひ', v: '√', w: 'W', x: 'ﾒ', y: 'ﾘ', z: '乙',
    A: 'ﾑ', B: '乃', C: 'ᄃ', D: 'り', E: '乇', F: 'ｷ', G: 'ム', H: 'ん', I: 'ﾉ', J: 'ﾌ', K: 'ズ', L: 'ﾚ', M: 'ﾶ', N: '刀', O: 'の', P: 'ｱ', Q: 'ゐ', R: '尺', S: '丂', T: 'ｲ', U: 'ひ', V: '√', W: 'W', X: 'ﾒ', Y: 'ﾘ', Z: '乙',
    0: '０', 1: '１', 2: '２', 3: '３', 4: '４', 5: '５', 6: '６', 7: '７', 8: '８', 9: '９', ' ': '　'
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
 * Validate font request parameters
 * @param {Object} params - Request parameters
 * @returns {Object} { isValid: boolean, errors: string[], cleaned: Object }
 */
const validateRequest = (params) => {
  const errors = []
  const cleaned = {}
  
  // Validate style
  let style = params.style || 'bold'
  style = style.toLowerCase()
  
  if (!FONT_CONFIG.ALLOWED_STYLES.includes(style)) {
    errors.push(`Invalid style. Allowed: ${FONT_CONFIG.ALLOWED_STYLES.join(', ')}`)
  } else {
    cleaned.style = style
  }
  
  // Validate text
  let text = params.text || params.q || ''
  
  if (typeof text === 'string') {
    text = cleanText(text)
  } else {
    text = ''
  }
  
  if (!text) {
    errors.push('Parameter "text" is required')
  } else if (text.length > FONT_CONFIG.MAX_TEXT_LENGTH) {
    errors.push(`Text too long. Maximum ${FONT_CONFIG.MAX_TEXT_LENGTH} characters`)
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
 * Convert text to selected font style
 * @param {string} text - Original text
 * @param {string} style - Font style
 * @returns {string} Converted text
 */
const convertText = (text, style) => {
  const fontMap = FONTS[style]
  if (!fontMap) return text
  
  return text.split('').map(char => {
    // Check if character exists in font map
    if (fontMap[char]) return fontMap[char]
    
    // Check lowercase version
    const lowerChar = char.toLowerCase()
    if (fontMap[lowerChar]) return fontMap[lowerChar]
    
    // Return original if no mapping found
    return char
  }).join('')
}

// ==================== MAIN API HANDLER ====================

export default {
  name: "Font Converter",
  description: "Convert text to various font styles",
  category: "Tools",
  
  methods: ["GET", "POST"],
  
  params: ["style", "text"],
  
  paramsSchema: {
    style: {
      type: "string",
      required: false,
      description: "Font style",
      example: "bold",
      enum: FONT_CONFIG.ALLOWED_STYLES,
      default: "bold"
    },
    text: {
      type: "string",
      required: true,
      description: "Text to convert",
      example: "Hello World",
      minLength: 1,
      maxLength: FONT_CONFIG.MAX_TEXT_LENGTH
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
          style: req.query.style,
          text: req.query.text || req.query.q
        }
      } else {
        params = {
          style: req.body?.style,
          text: req.body?.text || req.body?.q
        }
      }
      
      // ========== 2. VALIDATE INPUT ==========
      const validation = validateRequest(params)
      
      if (!validation.isValid) {
        logger.warn(`[FontConverter:${requestId}] Validation failed: ${validation.errors.join(', ')}`)
        
        return res.status(400).json({
          success: false,
          message: "Invalid parameters",
          errors: validation.errors,
          example: {
            GET: "/api/tools/font?style=bold&text=Hello%20World",
            POST: { style: "bold", text: "Hello World" }
          },
          allowed: {
            styles: FONT_CONFIG.ALLOWED_STYLES,
            maxTextLength: FONT_CONFIG.MAX_TEXT_LENGTH
          }
        })
      }
      
      const { style, text } = validation.cleaned
      
      // ========== 3. LOG REQUEST ==========
      const clientIp = req.headers['x-forwarded-for'] || 
                      req.ip || 
                      req.connection?.remoteAddress || 
                      'unknown'
      
      logger.info(`[FontConverter:${requestId}] Request from ${clientIp} | Style: ${style} | Text: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`)
      
      // ========== 4. CONVERT TEXT ==========
      const converted = convertText(text, style)
      
      // ========== 5. CALCULATE DURATION ==========
      const duration = Date.now() - startTime
      
      // ========== 6. SEND RESPONSE ==========
      return res.status(200).json({
        success: true,
        message: "Text converted successfully",
        requestId: requestId,
        duration: `${duration}ms`,
        data: {
          original: text,
          style: style,
          converted: converted,
          length: converted.length
        }
      })
      
    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`[FontConverter:${requestId}] Error after ${duration}ms: ${error.message}\n${error.stack}`)
      
      return res.status(500).json({
        success: false,
        message: "Failed to convert text",
        error: process.env.NODE_ENV === 'development' ? error.message : "Internal server error",
        requestId: requestId
      })
    }
  }
}