/**
 * TEXTPRO CANVAS API
 * Generate text effects from textpro.me — 81 efek typography keren!
 * 
 * @route {GET|POST} /api/canvas/textpro
 * @param {string} effect - Nama efek (enum dari semua efek tersedia)
 * @param {string} text - Teks utama (required)
 * @param {string} text2 - Teks kedua (required)
 * @param {string} format - Output format: png, jpeg, webp (default: png)
 * @param {boolean} download - Force download (optional)
 * 
 * @example
 * GET /api/canvas/textpro?effect=neon-light&text=HALO&text2=DUA
 * GET /api/canvas/textpro?effect=3d-gold&text=ATAS&text2=BAWAH
 * GET /api/canvas/textpro?effect=avengers&text=AVENGERS&text2=ENDGAME
 * GET /api/canvas/textpro?effect=fire&text=API&text2=DUA&format=webp&download=true
 */

import { createRequire } from 'module';
import logger from "../../src/utils/logger.js";
import crypto from "crypto";

const require = createRequire(import.meta.url);
const textpro = require('../../src/function/textpro.cjs');

// ==================== EFFECTS DATABASE ====================
// Sumber: https://textpro.me — 81 efek text (tested working)
// params: 1 = single text, 2 = dual text

const EFFECTS = {
  // ─── 3D EFFECTS (31 efek) ───
  "3d-blood": {
    url: "https://textpro.me/3d-blood-text-effect-online-1073.html",
    params: 2,
    desc: "3D Blood Text Effect",
    category: "3D"
  },
  "3d-blue": {
    url: "https://textpro.me/3d-blue-text-effect-online-1093.html",
    params: 1,
    desc: "3D Blue Text Effect",
    category: "3D"
  },
  "3d-box": {
    url: "https://textpro.me/3d-box-text-effect-online-880.html",
    params: 1,
    desc: "3D Box Text Effect",
    category: "3D"
  },
  "3d-christmas": {
    url: "https://textpro.me/3d-christmas-text-effect-by-name-1055.html",
    params: 1,
    desc: "3D Christmas Text Effect",
    category: "3D"
  },
  "3d-chrome": {
    url: "https://textpro.me/3d-chrome-text-effect-online-1085.html",
    params: 1,
    desc: "3D Chrome Text Effect",
    category: "3D"
  },
  "3d-deep-sea": {
    url: "https://textpro.me/3d-deep-sea-text-effect-online-1020.html",
    params: 1,
    desc: "3D Deep Sea Text Effect",
    category: "3D"
  },
  "3d-diamond": {
    url: "https://textpro.me/3d-diamond-text-effect-online-1078.html",
    params: 2,
    desc: "3D Diamond Text Effect",
    category: "3D"
  },
  "3d-emerald": {
    url: "https://textpro.me/3d-emerald-text-effect-online-1079.html",
    params: 2,
    desc: "3D Emerald Text Effect",
    category: "3D"
  },
  "3d-fire": {
    url: "https://textpro.me/3d-fire-text-effect-online-1072.html",
    params: 2,
    desc: "3D Fire Text Effect",
    category: "3D"
  },
  "3d-glass": {
    url: "https://textpro.me/3d-glass-text-effect-online-1069.html",
    params: 2,
    desc: "3D Glass Text Effect",
    category: "3D"
  },
  "3d-glossy": {
    url: "https://textpro.me/3d-glossy-text-effect-online-1086.html",
    params: 1,
    desc: "3D Glossy Text Effect",
    category: "3D"
  },
  "3d-glowing": {
    url: "https://textpro.me/3d-glowing-text-effect-online-1029.html",
    params: 1,
    desc: "3D Glowing Text Effect",
    category: "3D"
  },
  "3d-gold": {
    url: "https://textpro.me/3d-gold-text-effect-online-1076.html",
    params: 2,
    desc: "3D Gold Text Effect",
    category: "3D"
  },
  "3d-ice": {
    url: "https://textpro.me/3d-ice-text-effect-online-1074.html",
    params: 2,
    desc: "3D Ice Text Effect",
    category: "3D"
  },
  "3d-light": {
    url: "https://textpro.me/3d-light-text-effect-online-1066.html",
    params: 2,
    desc: "3D Light Text Effect",
    category: "3D"
  },
  "3d-luxury-gold": {
    url: "https://textpro.me/3d-luxury-gold-text-effect-online-1003.html",
    params: 1,
    desc: "3D Luxury Gold Text Effect",
    category: "3D"
  },
  "3d-metal": {
    url: "https://textpro.me/3d-metal-text-effect-online-1061.html",
    params: 2,
    desc: "3D Metal Text Effect",
    category: "3D"
  },
  "3d-pool": {
    url: "https://textpro.me/3d-pool-text-effect-online-1071.html",
    params: 2,
    desc: "3D Pool Text Effect",
    category: "3D"
  },
  "3d-purple": {
    url: "https://textpro.me/3d-purple-text-effect-online-1091.html",
    params: 1,
    desc: "3D Purple Text Effect",
    category: "3D"
  },
  "3d-rainbow": {
    url: "https://textpro.me/3d-rainbow-text-effect-online-1087.html",
    params: 1,
    desc: "3D Rainbow Text Effect",
    category: "3D"
  },
  "3d-red": {
    url: "https://textpro.me/3d-red-text-effect-online-1094.html",
    params: 1,
    desc: "3D Red Text Effect",
    category: "3D"
  },
  "3d-ruby": {
    url: "https://textpro.me/3d-ruby-text-effect-online-1080.html",
    params: 2,
    desc: "3D Ruby Text Effect",
    category: "3D"
  },
  "3d-sapphire": {
    url: "https://textpro.me/3d-sapphire-text-effect-online-1081.html",
    params: 2,
    desc: "3D Sapphire Text Effect",
    category: "3D"
  },
  "3d-shadow": {
    url: "https://textpro.me/3d-shadow-text-effect-online-1063.html",
    params: 2,
    desc: "3D Shadow Text Effect",
    category: "3D"
  },
  "3d-silver": {
    url: "https://textpro.me/3d-silver-text-effect-online-1077.html",
    params: 2,
    desc: "3D Silver Text Effect",
    category: "3D"
  },
  "3d-smoke": {
    url: "https://textpro.me/3d-smoke-text-effect-online-1075.html",
    params: 2,
    desc: "3D Smoke Text Effect",
    category: "3D"
  },
  "3d-space": {
    url: "https://textpro.me/3d-space-text-effect-online-1067.html",
    params: 2,
    desc: "3D Space Text Effect",
    category: "3D"
  },
  "3d-sparkle": {
    url: "https://textpro.me/3d-sparkle-text-effect-online-1090.html",
    params: 1,
    desc: "3D Sparkle Text Effect",
    category: "3D"
  },
  "3d-stone": {
    url: "https://textpro.me/3d-stone-text-effect-online-1082.html",
    params: 2,
    desc: "3D Stone Text Effect",
    category: "3D"
  },
  "3d-valentine": {
    url: "https://textpro.me/3d-valentine-text-effect-online-1089.html",
    params: 1,
    desc: "3D Valentine Text Effect",
    category: "3D"
  },
  "3d-water": {
    url: "https://textpro.me/3d-water-text-effect-online-1070.html",
    params: 2,
    desc: "3D Water Text Effect",
    category: "3D"
  },
  "3d-water-pipe": {
    url: "https://textpro.me/3d-water-pipe-text-effect-online-1088.html",
    params: 1,
    desc: "3D Water Pipe Text Effect",
    category: "3D"
  },
  "3d-yellow": {
    url: "https://textpro.me/3d-yellow-text-effect-online-1095.html",
    params: 1,
    desc: "3D Yellow Text Effect",
    category: "3D"
  },

  // ─── GLOW & NEON EFFECTS (5 efek) ───
  "blue-glow": {
    url: "https://textpro.me/blue-glow-text-effect-online-984.html",
    params: 1,
    desc: "Blue Glow Text Effect",
    category: "Glow"
  },
  "neon-light": {
    url: "https://textpro.me/neon-light-text-effect-online-882.html",
    params: 1,
    desc: "Neon Light Text Effect",
    category: "Glow"
  },
  "purple-glow": {
    url: "https://textpro.me/purple-glow-text-effect-online-986.html",
    params: 1,
    desc: "Purple Glow Text Effect",
    category: "Glow"
  },
  "red-glow": {
    url: "https://textpro.me/red-glow-text-effect-online-987.html",
    params: 1,
    desc: "Red Glow Text Effect",
    category: "Glow"
  },
  "yellow-glow": {
    url: "https://textpro.me/yellow-glow-text-effect-online-988.html",
    params: 1,
    desc: "Yellow Glow Text Effect",
    category: "Glow"
  },

  // ─── LOGO & BRAND EFFECTS (10 efek) ───
  "american-flag": {
    url: "https://textpro.me/create-american-flag-text-effect-online-1040.html",
    params: 2,
    desc: "American Flag Text Effect",
    category: "Logo"
  },
  "avengers": {
    url: "https://textpro.me/create-avengers-logo-style-text-effect-online-970.html",
    params: 2,
    desc: "Avengers Logo Style",
    category: "Logo"
  },
  "blackpink": {
    url: "https://textpro.me/create-blackpink-logo-style-online-1001.html",
    params: 1,
    desc: "Blackpink Logo Style",
    category: "Logo"
  },
  "captain-america": {
    url: "https://textpro.me/create-captain-america-text-effect-online-1024.html",
    params: 2,
    desc: "Captain America Text Effect",
    category: "Logo"
  },
  "iron-man": {
    url: "https://textpro.me/create-iron-man-text-effect-online-1025.html",
    params: 2,
    desc: "Iron Man Text Effect",
    category: "Logo"
  },
  "joker-logo": {
    url: "https://textpro.me/create-logo-joker-online-934.html",
    params: 2,
    desc: "Joker Logo Style",
    category: "Logo"
  },
  "logo-wolf": {
    url: "https://textpro.me/create-logo-wolf-online-936.html",
    params: 2,
    desc: "Logo Wolf Style",
    category: "Logo"
  },
  "spiderman": {
    url: "https://textpro.me/create-spiderman-logo-style-text-effect-online-939.html",
    params: 2,
    desc: "Spiderman Logo Style",
    category: "Logo"
  },
  "wanted-poster": {
    url: "https://textpro.me/create-wanted-poster-text-effect-online-936.html",
    params: 2,
    desc: "Wanted Poster Style",
    category: "Logo"
  },
  "bear-logo": {
    url: "https://textpro.me/online-black-and-white-bear-mascot-logo-creation-1012.html",
    params: 1,
    desc: "Black & White Bear Mascot Logo",
    category: "Logo"
  },

  // ─── GLITCH EFFECTS (1 efek) ───
  "glitch": {
    url: "https://textpro.me/create-impressive-glitch-text-effects-online-1027.html",
    params: 1,
    desc: "Glitch Text Effect",
    category: "Glitch"
  },

  // ─── HORROR & DARK EFFECTS (3 efek) ───
  "green-horror": {
    url: "https://textpro.me/create-green-horror-style-text-effect-online-1036.html",
    params: 1,
    desc: "Green Horror Style",
    category: "Horror"
  },
  "horror": {
    url: "https://textpro.me/create-horror-text-effect-online-1096.html",
    params: 1,
    desc: "Horror Text Effect",
    category: "Horror"
  },
  "magma": {
    url: "https://textpro.me/create-a-magma-hot-text-effect-online-1030.html",
    params: 1,
    desc: "Magma Hot Text Effect",
    category: "Horror"
  },

  // ─── NATURE & ELEMENTS (12 efek) ───
  "cloud": {
    url: "https://textpro.me/cloud-text-effect-online-1043.html",
    params: 1,
    desc: "Cloud Text Effect",
    category: "Nature"
  },
  "fire": {
    url: "https://textpro.me/fire-text-effect-online-1042.html",
    params: 1,
    desc: "Fire Text Effect",
    category: "Nature"
  },
  "ice-cold": {
    url: "https://textpro.me/ice-cold-text-effect-online-1053.html",
    params: 1,
    desc: "Ice Cold Text Effect",
    category: "Nature"
  },
  "lava": {
    url: "https://textpro.me/lava-text-effect-online-1052.html",
    params: 1,
    desc: "Lava Text Effect",
    category: "Nature"
  },
  "lightning": {
    url: "https://textpro.me/lightning-text-effect-online-1049.html",
    params: 1,
    desc: "Lightning Text Effect",
    category: "Nature"
  },
  "realistic-cloud": {
    url: "https://textpro.me/realistic-cloud-text-effect-online-1038.html",
    params: 2,
    desc: "Realistic Cloud Text Effect",
    category: "Nature"
  },
  "sand-writing": {
    url: "https://textpro.me/sand-writing-text-effect-online-1051.html",
    params: 1,
    desc: "Sand Writing Text Effect",
    category: "Nature"
  },
  "snow": {
    url: "https://textpro.me/snow-text-effect-online-1056.html",
    params: 1,
    desc: "Snow Text Effect",
    category: "Nature"
  },
  "stone": {
    url: "https://textpro.me/stone-text-effect-online-1057.html",
    params: 1,
    desc: "Stone Text Effect",
    category: "Nature"
  },
  "thunder": {
    url: "https://textpro.me/online-thunder-text-effect-generator-1031.html",
    params: 1,
    desc: "Thunder Text Effect",
    category: "Nature"
  },
  "water-drop": {
    url: "https://textpro.me/water-drop-text-effect-online-1050.html",
    params: 1,
    desc: "Water Drop Text Effect",
    category: "Nature"
  },
  "wood": {
    url: "https://textpro.me/wood-text-effect-online-857.html",
    params: 1,
    desc: "Wood Text Effect",
    category: "Nature"
  },

  // ─── TEXT STYLES (13 efek) ───
  "break-wall": {
    url: "https://textpro.me/break-wall-text-effect-online-1047.html",
    params: 1,
    desc: "Break Wall Text Effect",
    category: "TextStyle"
  },
  "chrome": {
    url: "https://textpro.me/chrome-text-effect-online-975.html",
    params: 1,
    desc: "Chrome Text Effect",
    category: "TextStyle"
  },
  "cyber": {
    url: "https://textpro.me/cyber-text-effect-online-1035.html",
    params: 1,
    desc: "Cyber Text Effect",
    category: "TextStyle"
  },
  "emboss": {
    url: "https://textpro.me/emboss-text-effect-online-902.html",
    params: 1,
    desc: "Emboss Text Effect",
    category: "TextStyle"
  },
  "glossy": {
    url: "https://textpro.me/glossy-text-effect-online-1041.html",
    params: 1,
    desc: "Glossy Text Effect",
    category: "TextStyle"
  },
  "holographic": {
    url: "https://textpro.me/holographic-text-effect-online-1060.html",
    params: 1,
    desc: "Holographic Text Effect",
    category: "TextStyle"
  },
  "pencil-sketch": {
    url: "https://textpro.me/create-a-sketch-text-effect-online-1044.html",
    params: 1,
    desc: "Pencil Sketch Text Effect",
    category: "TextStyle"
  },
  "shadow": {
    url: "https://textpro.me/shadow-text-effect-online-884.html",
    params: 1,
    desc: "Shadow Text Effect",
    category: "TextStyle"
  },
  "sliding": {
    url: "https://textpro.me/sliding-text-effect-online-903.html",
    params: 1,
    desc: "Sliding Text Effect",
    category: "TextStyle"
  },
  "toxic": {
    url: "https://textpro.me/toxic-text-effect-online-1054.html",
    params: 1,
    desc: "Toxic Text Effect",
    category: "TextStyle"
  },

  // ─── FOOD & FUN (5 efek) ───
  "berry": {
    url: "https://textpro.me/create-berry-text-effect-online-free-1033.html",
    params: 1,
    desc: "Berry Text Effect",
    category: "Fun"
  },
  "chocolate-cake": {
    url: "https://textpro.me/chocolate-cake-text-effect-890.html",
    params: 1,
    desc: "Chocolate Cake Text Effect",
    category: "Fun"
  },
  "pink-candy": {
    url: "https://textpro.me/pink-candy-text-effect-online-1048.html",
    params: 1,
    desc: "Pink Candy Text Effect",
    category: "Fun"
  },
  "strawberry": {
    url: "https://textpro.me/strawberry-text-effect-online-889.html",
    params: 1,
    desc: "Strawberry Text Effect",
    category: "Fun"
  },
  "3d-orange-juice": {
    url: "https://textpro.me/create-a-3d-orange-juice-text-effect-online-1084.html",
    params: 1,
    desc: "3D Orange Juice Text Effect",
    category: "Fun"
  },

  // ─── SEASONAL (4 efek) ───
  "christmas-tree": {
    url: "https://textpro.me/christmas-tree-text-effect-online-1058.html",
    params: 2,
    desc: "Christmas Tree Text Effect",
    category: "Seasonal"
  },

  // ─── SPECIAL EFFECTS (1 efek) ───
  "neon-3d": {
    url: "https://textpro.me/create-3d-neon-light-text-effect-online-1028.html",
    params: 1,
    desc: "3D Neon Light Text Effect",
    category: "Special"
  }
};

// ==================== CONFIGURATION ====================
const CONFIG = {
  MAX_TEXT_LENGTH: 200,
  ALLOWED_FORMATS: ['png', 'jpeg', 'jpg', 'webp'],
  DEFAULT_FORMAT: 'png',
  CACHE_TTL: 3600,
  RATE_LIMIT: {
    WINDOW: 60 * 1000,
    MAX: 20
  }
};

// Simple in-memory cache
const cache = new Map();

// ==================== VALIDATION ====================
function validateRequest(params) {
  const errors = [];
  const cleaned = {};

  // Validate effect
  const effect = (params.effect || '').toLowerCase().replace(/\s+/g, '-').trim();
  if (!effect) {
    errors.push('Parameter "effect" is required');
  } else if (!EFFECTS[effect]) {
    const availableEffects = Object.keys(EFFECTS);
    errors.push(`Invalid effect "${effect}". Available: ${availableEffects.length} effects`);
    // Don't return yet, we want to show available effects
  } else {
    cleaned.effect = effect;
  }

  // Validate text
  let text = params.text || '';
  if (typeof text === 'string') {
    text = text.trim();
  } else {
    text = '';
  }
  if (!text) {
    errors.push('Parameter "text" is required');
  } else if (text.length > CONFIG.MAX_TEXT_LENGTH) {
    errors.push(`Text too long. Maximum ${CONFIG.MAX_TEXT_LENGTH} characters`);
  } else {
    cleaned.text = text;
  }

  // Validate text2 (required)
  let text2 = params.text2 || '';
  if (typeof text2 === 'string') {
    text2 = text2.trim();
  } else {
    text2 = '';
  }
  if (!text2) {
    errors.push('Parameter "text2" is required');
  } else if (text2.length > CONFIG.MAX_TEXT_LENGTH) {
    errors.push(`Text2 too long. Maximum ${CONFIG.MAX_TEXT_LENGTH} characters`);
  } else {
    cleaned.text2 = text2;
  }

  // Validate format
  let format = params.format || CONFIG.DEFAULT_FORMAT;
  format = format.toLowerCase();
  if (!CONFIG.ALLOWED_FORMATS.includes(format)) {
    errors.push(`Invalid format. Allowed: ${CONFIG.ALLOWED_FORMATS.join(', ')}`);
  } else {
    cleaned.format = format;
  }

  // Download flag
  cleaned.download = params.download === 'true' || params.download === true || params.download === '1';

  return { isValid: errors.length === 0, errors, cleaned };
}

// ==================== GENERATE CACHE KEY ====================
function generateCacheKey(params) {
  const data = {
    effect: params.effect,
    text: params.text,
    text2: params.text2 || '',
    format: params.format || 'png'
  };
  return `textpro:${crypto.createHash('md5').update(JSON.stringify(data)).digest('hex')}`;
}

// ==================== HELPER: Get effects grouped by category ====================
function getEffectsByCategory() {
  const grouped = {};
  for (const [key, val] of Object.entries(EFFECTS)) {
    const cat = val.category || 'Other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({ key, ...val });
  }
  return grouped;
}

// ==================== MAIN API HANDLER ====================
export default {
  name: "TextPro Effects Generator",
  description: "Generate 81 stunning text effects — 3D, neon, glow, logo, glitch, horror, nature, and more!",
  category: "Ephoto",
  
  methods: ["GET", "POST"],
  
  params: ["effect", "text", "text2", "format", "download"],
  
  paramsSchema: {
    effect: {
      type: "string",
      required: true,
      description: "Nama efek text (dari 81 efek tersedia)",
      example: "neon-light",
      enum: Object.keys(EFFECTS)
    },
    text: {
      type: "string",
      required: true,
      description: "Teks utama yang akan diberi efek",
      example: "HALO",
      minLength: 1,
      maxLength: CONFIG.MAX_TEXT_LENGTH
    },
    text2: {
      type: "string",
      required: true,
      description: "Teks kedua (wajib diisi)",
      example: "DUA",
      minLength: 1,
      maxLength: CONFIG.MAX_TEXT_LENGTH
    },
    format: {
      type: "string",
      required: false,
      description: "Output image format",
      example: "png",
      enum: CONFIG.ALLOWED_FORMATS,
      default: "png"
    }
  },
  
  async run(req, res) {
    const startTime = Date.now();
    const requestId = crypto.randomBytes(4).toString('hex');
    
    try {
      // ========== 1. EXTRACT PARAMETERS ==========
      let params = {};
      
      if (req.method === 'GET') {
        params = {
          effect: req.query.effect,
          text: req.query.text,
          text2: req.query.text2,
          format: req.query.format,
          download: req.query.download
        };
      } else {
        params = {
          effect: req.body?.effect,
          text: req.body?.text,
          text2: req.body?.text2,
          format: req.body?.format,
          download: req.body?.download
        };
      }
      
      // ========== 2. VALIDATE INPUT ==========
      const validation = validateRequest(params);
      
      if (!validation.isValid) {
        const effectsByCategory = getEffectsByCategory();
        
        return res.status(400).json({
          success: false,
          message: "Invalid parameters",
          errors: validation.errors,
          usage: {
            GET: "/api/canvas/textpro?effect=neon-light&text=HALO&text2=DUA",
            POST: { effect: "neon-light", text: "HALO", text2: "DUA" }
          },
          availableEffects: {
            total: Object.keys(EFFECTS).length,
            byCategory: effectsByCategory
          },
          allowedFormats: CONFIG.ALLOWED_FORMATS,
          maxTextLength: CONFIG.MAX_TEXT_LENGTH
        });
      }
      
      const { effect, text, text2, format, download } = validation.cleaned;
      const effectConfig = EFFECTS[effect];
      
      // ========== 3. LOG REQUEST ==========
      const clientIp = req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress || 'unknown';
      logger.info(`[TextPro:${requestId}] Request from ${clientIp} | Effect: ${effect} | Text: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"${text2 ? ` | Text2: "${text2}"` : ''}`);
      
      // ========== 4. CHECK CACHE ==========
      const cacheKey = generateCacheKey({ effect, text, text2, format });
      let imageBuffer = cache.get(cacheKey);
      let fromCache = false;
      
      if (imageBuffer) {
        fromCache = true;
        logger.info(`[TextPro:${requestId}] Cache hit`);
      } else {
        // ========== 5. GENERATE IMAGE VIA SCRAPER ==========
        logger.info(`[TextPro:${requestId}] Generating "${effect}" effect...`);
        
        // Prepare text array based on effect params
        const textArray = effectConfig.params === 2 && text2 ? [text, text2] : [text];
        
        // Call the textpro scraper
        imageBuffer = await textpro(effectConfig.url, textArray);
        
        // Store in cache
        cache.set(cacheKey, imageBuffer);
        setTimeout(() => cache.delete(cacheKey), CONFIG.CACHE_TTL * 1000);
        
        logger.info(`[TextPro:${requestId}] Image generated | Size: ${(imageBuffer.length / 1024).toFixed(2)}KB`);
      }
      
      // ========== 6. CALCULATE DURATION ==========
      const duration = Date.now() - startTime;
      
      // ========== 7. SEND RESPONSE ==========
      const mimeType = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
      
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Length", imageBuffer.length);
      res.setHeader("X-Generated-In", `${duration}ms`);
      res.setHeader("X-Request-ID", requestId);
      res.setHeader("X-Cache-Hit", fromCache ? 'true' : 'false');
      res.setHeader("X-Effect", effect);
      res.setHeader("X-Effect-Desc", effectConfig.desc);
      res.setHeader("X-Effect-Category", effectConfig.category);
      
      if (download) {
        const filename = `textpro-${effect}-${Date.now()}.${format}`;
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      }
      
      return res.send(imageBuffer);
      
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[TextPro:${requestId}] Error after ${duration}ms: ${error.message}`);
      
      if (res.headersSent) {
        return res.end();
      }
      
      // Check for specific scraper errors
      let statusCode = 500;
      let errorMessage = "Failed to generate text effect";
      
      if (error.message.includes('timeout') || error.message.includes('Timeout')) {
        statusCode = 504;
        errorMessage = "Scraper timeout - TextPro server may be slow";
      } else if (error.message.includes('Failed to generate image')) {
        statusCode = 502;
        errorMessage = "TextPro server failed to generate the image";
      } else if (error.message.includes('Invalid URL')) {
        statusCode = 400;
        errorMessage = "Invalid effect configuration";
      } else if (error.message.includes('net::ERR_CONNECTION_REFUSED') || error.message.includes('ENOTFOUND')) {
        statusCode = 502;
        errorMessage = "Cannot connect to TextPro server - it may be down";
      } else if (error.message.includes('ECONNREFUSED') || error.message.includes('ECONNRESET')) {
        statusCode = 502;
        errorMessage = "Connection refused by TextPro server";
      }
      
      return res.status(statusCode).json({
        success: false,
        message: errorMessage,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        effect: validation?.cleaned?.effect || params.effect,
        requestId,
        duration: `${duration}ms`,
        tips: [
          "Coba dengan effect yang berbeda",
          "Pastikan text tidak terlalu pendek",
          "Semua efek memerlukan 2 teks (text & text2) — keduanya wajib diisi",
          "Coba lagi dalam beberapa detik - TextPro server mungkin sibuk"
        ]
      });
    }
  },
  
  /**
   * Get available effects list
   */
  getEffectsList() {
    return {
      total: Object.keys(EFFECTS).length,
      byCategory: getEffectsByCategory()
    };
  },
  
  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: cache.size,
      keys: Array.from(cache.keys()),
      ttl: CONFIG.CACHE_TTL
    };
  },
  
  /**
   * Clear cache
   */
  clearCache() {
    cache.clear();
    logger.info('[TextPro] Cache cleared');
    return { success: true, message: 'Cache cleared' };
  }
};

// ==================== STANDALONE FUNCTION ====================
/**
 * Generate textpro effect directly (for programmatic usage)
 * @param {string} effect - Effect name
 * @param {string} text - Primary text
 * @param {string} text2 - Secondary text (required)
 * @returns {Promise<Buffer>} Image buffer
 */
export const createTextProEffect = async (effect, text, text2) => {
  const key = effect.toLowerCase().replace(/\s+/g, '-').trim();
  const config = EFFECTS[key];
  
  if (!config) {
    throw new Error(`Unknown effect: "${effect}". Available: ${Object.keys(EFFECTS).length} effects`);
  }
  
  const textArray = config.params === 2 && text2 ? [text, text2] : [text];
  return await textpro(config.url, textArray);
};

/**
 * Get list of all available effects
 * @returns {Object} Effects grouped by category
 */
export const getEffects = () => {
  return {
    total: Object.keys(EFFECTS).length,
    byCategory: getEffectsByCategory()
  };
};
