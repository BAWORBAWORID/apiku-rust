/**
 * Ephoto 360 API - Create text effects with 62 styles from ephoto360.com
 * 
 * GET  /api/ephoto/ephoto?effect=call-of-duty-warzone&text=Hello
 * POST /api/ephoto/ephoto with JSON body { "effect": "...", "text": "...", "text2": "..." }
 * GET  /api/ephoto/ephoto/list  — Lihat daftar semua effect
 * 
 * result:
 * - Mengembalikan langsung gambar hasil efek text (image/png)
 */

import logger from "../../src/utils/logger.js";
import crypto from "crypto";

// Cache configuration
const CACHE_TTL = 3600; // 1 hour
const cache = new Map();

// ============================================================
//  EPHOTO EFFECT ENUM — 62 Effects (frozen / immutable)
//  Sumber: https://en.ephoto360.com
// ============================================================
const EphotoEffect = Object.freeze({
  // page 7
  CALL_OF_DUTY_WARZONE: "call-of-duty-warzone",
  PUBG_GLITCH_VIDEO: "pubg-glitch-video",
  FREE_LOGO_INTRO: "free-logo-intro",
  LOGO_GAMING_ASSASSIN: "logo-gaming-assassin",
  SAND_SUMMER_BEACH_576: "sand-summer-beach-576",
  ELEGANT_ROTATION_LOGO: "elegant-rotation-logo",
  MULTICOLORED_NEON_591: "multicolored-neon-591",
  LUXURY_GOLD_TEXT_594: "luxury-gold-text-594",
  SAND_SUMMER_BEACH_595: "sand-summer-beach-595",
  GRADIENT_TEXT_600: "gradient-text-600",
  BLACKPINK_LOGO_607: "blackpink-logo-607",
  VINTAGE_3D_LIGHT_BULB: "vintage-3d-light-bulb",
  PUBG_MASCOT_LOGO: "pubg-mascot-logo",
  PUBG_LOGO_CUTE: "pubg-logo-cute",

  // page 6
  CLOUDS_IN_SKY: "clouds-in-sky",
  SHIMMERING_AOV: "shimmering-aov",
  FUTURISTIC_TECHNOLOGY: "futuristic-technology",
  WATERCOLOR_TEXT_655: "watercolor-text-655",
  GLITTER_TEXT: "glitter-text",

  // page 5
  PAPER_CUT_3D: "paper-cut-3d",
  EMBROIDERY_TEXT: "embroidery-text",
  GRAFFITI_WALL: "graffiti-wall",
  CUTE_GIRL_GRAFFITI: "cute-girl-graffiti",
  CARTOON_GRAFFITI: "cartoon-graffiti",
  FOOTBALL_TEAM_LOGO: "football-team-logo",
  BEAR_LOGO_MAKER_673: "bear-logo-maker-673",
  FOGGY_GLASS: "foggy-glass",
  UNDERWATER_TEXT: "underwater-text",
  CUTE_GIRL_GAMER: "cute-girl-gamer",

  // page 4
  BEACH_TEXT_688: "beach-text-688",
  BLACK_WHITE_TEAM: "black-white-team",
  TRAVELING_BEAR: "traveling-bear",
  GLOWING_TEXT_706: "glowing-text-706",
  STAR_WARS_MASCOT: "star-wars-mascot",
  BLACKPINK_NEON_710: "blackpink-neon-710",
  BLACKPINK_STYLE_711: "blackpink-style-711",
  SIGNATURE_ARROW: "signature-arrow",
  CAPTAIN_AMERICA: "captain-america",
  ERASER_DELETING: "eraser-deleting",
  AMERICAN_FLAG_3D: "american-flag-3d",
  CHRISTMAS_SPARKLES: "christmas-sparkles",

  // page 3
  DIGITAL_GLITCH: "digital-glitch",
  NEON_GLITCH_768: "neon-glitch-768",
  PIXEL_GLITCH: "pixel-glitch",
  FROZEN_CHRISTMAS: "frozen-christmas",
  GOLDEN_CHRISTMAS: "golden-christmas",
  THOR_LOGO: "thor-logo",
  NEON_LIGHT_COLORFUL: "neon-light-colorful",
  COLORFUL_PAINT_3D: "colorful-paint-3d",
  GLOSSY_SILVER_3D: "glossy-silver-3d",
  FOIL_BALLOON: "foil-balloon",

  // page 2
  PORN_HUB_STYLE: "porn-hub-style",
  WET_GLASS: "wet-glass",

  // page 1
  PAVEMENT_TYPOGRAPHY: "pavement-typography",
  BORN_PINK_ALBUM: "born-pink-album",
  CASTLE_POP_OUT: "castle-pop-out",
  NARUTO_SHIPPUDEN: "naruto-shippuden",
  DRAGON_BALL: "dragon-ball",
  BLACKPINK_SIGNATURES: "blackpink-signatures",
  TYPOGRAPHY_MULTI_LAYER: "typography-multi-layer",
  COMIC_3D: "comic-3d",
  DEADPOOL_STYLE: "deadpool-style"
});

// ============================================================
//  EFFECTS DATABASE — Complete data for all 62 effects
// ============================================================
const EFFECTS = Object.freeze([
  // page 7 — 14 effects
  { key: EphotoEffect.CALL_OF_DUTY_WARZONE, id: "548",  title: "Create Call of Duty Warzone YouTube Banner Online",          url: "https://en.ephoto360.com/create-call-of-duty-warzone-youtube-banner-online-548.html", desc: "Call of Duty Warzone YouTube Banner" },
  { key: EphotoEffect.PORN_HUB_STYLE,        id: "549",  title: "Create PornHub style logos online free",                    url: "https://en.ephoto360.com/create-pornhub-style-logos-online-free-549.html", desc: "PornHub style logos" },
  { key: EphotoEffect.PUBG_GLITCH_VIDEO,     id: "554",  title: "Create PUBG style glitch video avatar",                    url: "https://en.ephoto360.com/create-pubg-style-glitch-video-avatar-554.html", desc: "PUBG style glitch video avatar" },
  { key: EphotoEffect.FREE_LOGO_INTRO,       id: "558",  title: "Free logo intro video maker online",                        url: "https://en.ephoto360.com/free-logo-intro-video-maker-online-558.html", desc: "Free logo intro video maker" },
  { key: EphotoEffect.LOGO_GAMING_ASSASSIN,  id: "574",  title: "Create logo team, logo gaming assassin style",              url: "https://en.ephoto360.com/create-logo-team-logo-gaming-assassin-style-574.html", desc: "Logo gaming assassin style" },
  { key: EphotoEffect.SAND_SUMMER_BEACH_576, id: "576",  title: "Write in Sand Summer Beach Online",                         url: "https://en.ephoto360.com/write-in-sand-summer-beach-online-576.html", desc: "Write in Sand Summer Beach" },
  { key: EphotoEffect.ELEGANT_ROTATION_LOGO, id: "586",  title: "Create elegant rotation logo online",                       url: "https://en.ephoto360.com/create-elegant-rotation-logo-online-586.html", desc: "Elegant rotation logo" },
  { key: EphotoEffect.WET_GLASS,             id: "589",  title: "Write text on wet glass online",                            url: "https://en.ephoto360.com/write-text-on-wet-glass-online-589.html", desc: "Write text on wet glass" },
  { key: EphotoEffect.MULTICOLORED_NEON_591, id: "591",  title: "Create multicolored neon light signatures",                 url: "https://en.ephoto360.com/create-multicolored-neon-light-signatures-591.html", desc: "Multicolored neon light signatures" },
  { key: EphotoEffect.LUXURY_GOLD_TEXT_594,  id: "594",  title: "Create a luxury gold text effect online",                   url: "https://en.ephoto360.com/create-a-luxury-gold-text-effect-online-594.html", desc: "Luxury gold text effect" },
  { key: EphotoEffect.SAND_SUMMER_BEACH_595, id: "595",  title: "Write in sand summer beach online free",                    url: "https://en.ephoto360.com/write-in-sand-summer-beach-online-free-595.html", desc: "Write in sand summer beach free" },
  { key: EphotoEffect.GRADIENT_TEXT_600,     id: "600",  title: "Create 3D gradient text effect online",                     url: "https://en.ephoto360.com/create-3d-gradient-text-effect-online-600.html", desc: "3D gradient text effect" },
  { key: EphotoEffect.BLACKPINK_LOGO_607,    id: "607",  title: "Create Blackpink logo online free",                         url: "https://en.ephoto360.com/create-blackpink-logo-online-free-607.html", desc: "Blackpink logo" },
  { key: EphotoEffect.VINTAGE_3D_LIGHT_BULB, id: "608",  title: "Create realistic vintage 3D light bulb online",             url: "https://en.ephoto360.com/create-realistic-vintage-3d-light-bulb-608.html", desc: "Vintage 3D light bulb" },

  // page 7 (continued)
  { key: EphotoEffect.PUBG_MASCOT_LOGO,      id: "612",  title: "PUBG Mascot Logo Maker for an eSports Team",                url: "https://en.ephoto360.com/pubg-mascot-logo-maker-for-an-esports-team-612.html", desc: "PUBG Mascot Logo" },
  { key: EphotoEffect.PUBG_LOGO_CUTE,        id: "617",  title: "PUBG logo maker cute character online",                     url: "https://en.ephoto360.com/pubg-logo-maker-cute-character-online-617.html", desc: "PUBG cute character logo" },

  // page 6 — 5 effects
  { key: EphotoEffect.CLOUDS_IN_SKY,         id: "619",  title: "Write text effect clouds in the sky online",               url: "https://en.ephoto360.com/write-text-effect-clouds-in-the-sky-online-619.html", desc: "Clouds in the sky text" },
  { key: EphotoEffect.SHIMMERING_AOV,        id: "643",  title: "Create beautiful shimmering AOV wallpapers full HD for mobile", url: "https://en.ephoto360.com/create-beautiful-shimmering-aov-wallpapers-full-hd-for-mobile-643.html", desc: "AOV shimmering wallpapers" },
  { key: EphotoEffect.FUTURISTIC_TECHNOLOGY, id: "648",  title: "Light text effect futuristic technology style",             url: "https://en.ephoto360.com/light-text-effect-futuristic-technology-style-648.html", desc: "Futuristic light text" },
  { key: EphotoEffect.WATERCOLOR_TEXT_655,   id: "655",  title: "Create a watercolor text effect online",                    url: "https://en.ephoto360.com/create-a-watercolor-text-effect-online-655.html", desc: "Watercolor text effect" },
  { key: EphotoEffect.GLITTER_TEXT,          id: "656",  title: "Free Glitter Text Effect Maker Online",                     url: "https://en.ephoto360.com/free-glitter-text-effect-maker-online-656.html", desc: "Glitter text effect" },

  // page 5 — 10 effects
  { key: EphotoEffect.PAPER_CUT_3D,          id: "658",  title: "Multicolor 3D paper cut style text effect",                url: "https://en.ephoto360.com/multicolor-3d-paper-cut-style-text-effect-658.html", desc: "3D paper cut style" },
  { key: EphotoEffect.EMBROIDERY_TEXT,       id: "662",  title: "Create a realistic embroidery text effect online",          url: "https://en.ephoto360.com/create-a-realistic-embroidery-text-effect-online-662.html", desc: "Embroidery text effect" },
  { key: EphotoEffect.GRAFFITI_WALL,         id: "665",  title: "Create a graffiti text effect on the wall online",          url: "https://en.ephoto360.com/create-a-graffiti-text-effect-on-the-wall-online-665.html", desc: "Graffiti on the wall" },
  { key: EphotoEffect.CUTE_GIRL_GRAFFITI,    id: "667",  title: "Cute girl painting graffiti text effect",                   url: "https://en.ephoto360.com/cute-girl-painting-graffiti-text-effect-667.html", desc: "Cute girl graffiti" },
  { key: EphotoEffect.CARTOON_GRAFFITI,      id: "668",  title: "Create a cartoon style graffiti text effect online",        url: "https://en.ephoto360.com/create-a-cartoon-style-graffiti-text-effect-online-668.html", desc: "Cartoon graffiti" },
  { key: EphotoEffect.FOOTBALL_TEAM_LOGO,    id: "671",  title: "Create football team logo online free",                     url: "https://en.ephoto360.com/create-football-team-logo-online-free-671.html", desc: "Football team logo" },
  { key: EphotoEffect.BEAR_LOGO_MAKER_673,   id: "673",  title: "Free bear logo maker online",                               url: "https://en.ephoto360.com/free-bear-logo-maker-online-673.html", desc: "Bear logo maker" },
  { key: EphotoEffect.FOGGY_GLASS,           id: "680",  title: "Handwritten text on foggy glass online",                   url: "https://en.ephoto360.com/handwritten-text-on-foggy-glass-online-680.html", desc: "Handwritten on foggy glass" },
  { key: EphotoEffect.UNDERWATER_TEXT,       id: "682",  title: "3D underwater text effect online",                          url: "https://en.ephoto360.com/3d-underwater-text-effect-online-682.html", desc: "3D underwater text" },
  { key: EphotoEffect.CUTE_GIRL_GAMER,       id: "687",  title: "Create cute girl gamer mascot logo online",                 url: "https://en.ephoto360.com/create-cute-girl-gamer-mascot-logo-online-687.html", desc: "Cute girl gamer mascot" },

  // page 4 — 12 effects
  { key: EphotoEffect.BEACH_TEXT_688,        id: "688",  title: "Create 3D text effect on the beach online",                 url: "https://en.ephoto360.com/create-3d-text-effect-on-the-beach-online-688.html", desc: "3D text on the beach" },
  { key: EphotoEffect.BLACK_WHITE_TEAM,      id: "689",  title: "Create an online team logo in black and white style",       url: "https://en.ephoto360.com/create-an-online-team-logo-in-black-and-white-style-689.html", desc: "Black & white team logo" },
  { key: EphotoEffect.TRAVELING_BEAR,        id: "701",  title: "Create funny animations of a traveling bear",               url: "https://en.ephoto360.com/create-funny-animations-of-a-traveling-bear-701.html", desc: "Traveling bear animations" },
  { key: EphotoEffect.GLOWING_TEXT_706,      id: "706",  title: "Create glowing text effects online",                        url: "https://en.ephoto360.com/create-glowing-text-effects-online-706.html", desc: "Glowing text effects" },
  { key: EphotoEffect.STAR_WARS_MASCOT,      id: "707",  title: "Create a Star Wars character mascot logo online",           url: "https://en.ephoto360.com/create-a-star-wars-character-mascot-logo-online-707.html", desc: "Star Wars mascot logo" },
  { key: EphotoEffect.BLACKPINK_NEON_710,    id: "710",  title: "Create a Blackpink neon logo text effect online",           url: "https://en.ephoto360.com/create-a-blackpink-neon-logo-text-effect-online-710.html", desc: "Blackpink neon logo" },
  { key: EphotoEffect.BLACKPINK_STYLE_711,   id: "711",  title: "Online BLACKPINK style logo maker effect",                  url: "https://en.ephoto360.com/online-blackpink-style-logo-maker-effect-711.html", desc: "Blackpink style logo" },
  { key: EphotoEffect.SIGNATURE_ARROW,       id: "714",  title: "Create multicolored signature attachment arrow effect",      url: "https://en.ephoto360.com/create-multicolored-signature-attachment-arrow-effect-714.html", desc: "Signature arrow effect" },
  { key: EphotoEffect.CAPTAIN_AMERICA,       id: "715",  title: "Create a cinematic Captain America text effect online",     url: "https://en.ephoto360.com/create-a-cinematic-captain-america-text-effect-online-715.html", desc: "Captain America text" },
  { key: EphotoEffect.ERASER_DELETING,       id: "717",  title: "Create eraser deleting text effect online",                 url: "https://en.ephoto360.com/create-eraser-deleting-text-effect-online-717.html", desc: "Eraser deleting text" },
  { key: EphotoEffect.AMERICAN_FLAG_3D,      id: "725",  title: "Free online American flag 3D text effect generator",         url: "https://en.ephoto360.com/free-online-american-flag-3d-text-effect-generator-725.html", desc: "American flag 3D text" },
  { key: EphotoEffect.CHRISTMAS_SPARKLES,    id: "727",  title: "Create sparkles 3D Christmas text effect online",           url: "https://en.ephoto360.com/create-sparkles-3d-christmas-text-effect-online-727.html", desc: "Sparkles Christmas text" },

  // page 3 — 8 effects
  { key: EphotoEffect.DIGITAL_GLITCH,        id: "767",  title: "Create digital glitch text effects online",                 url: "https://en.ephoto360.com/create-digital-glitch-text-effects-online-767.html", desc: "Digital glitch text" },
  { key: EphotoEffect.NEON_GLITCH_768,       id: "768",  title: "Create impressive neon Glitch text effects online",         url: "https://en.ephoto360.com/create-impressive-neon-glitch-text-effects-online-768.html", desc: "Neon glitch text" },
  { key: EphotoEffect.PIXEL_GLITCH,          id: "769",  title: "Create pixel Glitch text effect online",                   url: "https://en.ephoto360.com/create-pixel-glitch-text-effect-online-769.html", desc: "Pixel glitch text" },
  { key: EphotoEffect.FROZEN_CHRISTMAS,      id: "792",  title: "Create a frozen Christmas text effect online",              url: "https://en.ephoto360.com/create-a-frozen-christmas-text-effect-online-792.html", desc: "Frozen Christmas text" },
  { key: EphotoEffect.GOLDEN_CHRISTMAS,      id: "794",  title: "Christmas and New Year glittering 3D golden text effect",   url: "https://en.ephoto360.com/christmas-and-new-year-glittering-3d-golden-text-effect-794.html", desc: "Golden Christmas text" },
  { key: EphotoEffect.THOR_LOGO,             id: "796",  title: "Create Thor logo style text effects online for free",       url: "https://en.ephoto360.com/create-thor-logo-style-text-effects-online-for-free-796.html", desc: "Thor logo style" },
  { key: EphotoEffect.NEON_LIGHT_COLORFUL,   id: "797",  title: "Create colorful neon light text effects online",            url: "https://en.ephoto360.com/create-colorful-neon-light-text-effects-online-797.html", desc: "Colorful neon light" },
  { key: EphotoEffect.COLORFUL_PAINT_3D,     id: "801",  title: "Create 3D colorful paint text effect online",               url: "https://en.ephoto360.com/create-3d-colorful-paint-text-effect-online-801.html", desc: "3D colorful paint" },

  // page 2 — 4 effects
  { key: EphotoEffect.GLOSSY_SILVER_3D,      id: "802",  title: "Create glossy silver 3D text effect online",                url: "https://en.ephoto360.com/create-glossy-silver-3d-text-effect-online-802.html", desc: "Glossy silver 3D" },
  { key: EphotoEffect.FOIL_BALLOON,          id: "803",  title: "Beautiful 3D foil balloon effects for holidays and birthday", url: "https://en.ephoto360.com/beautiful-3d-foil-balloon-effects-for-holidays-and-birthday-803.html", desc: "3D foil balloon" },
  { key: EphotoEffect.NARUTO_SHIPPUDEN,      id: "808",  title: "Naruto shippuden logo style text effect online",            url: "https://en.ephoto360.com/naruto-shippuden-logo-style-text-effect-online-808.html", desc: "Naruto Shippuden logo" },
  { key: EphotoEffect.DRAGON_BALL,           id: "809",  title: "Create Dragon Ball style text effects online",              url: "https://en.ephoto360.com/create-dragon-ball-style-text-effects-online-809.html", desc: "Dragon Ball style" },

  // page 1 — 5 effects
  { key: EphotoEffect.PAVEMENT_TYPOGRAPHY,   id: "774",  title: "Create Typography text effect on pavement online",          url: "https://en.ephoto360.com/create-typography-text-effect-on-pavement-online-774.html", desc: "Typography on pavement" },
  { key: EphotoEffect.BORN_PINK_ALBUM,       id: "779",  title: "Create BLACKPINK's BORN PINK album logo online",            url: "https://en.ephoto360.com/create-blackpink-s-born-pink-album-logo-online-779.html", desc: "BLACKPINK Born Pink album" },
  { key: EphotoEffect.CASTLE_POP_OUT,        id: "786",  title: "Create a 3D castle pop out mobile photo effect",            url: "https://en.ephoto360.com/create-a-3d-castle-pop-out-mobile-photo-effect-786.html", desc: "3D castle pop out" },
  { key: EphotoEffect.BLACKPINK_SIGNATURES,  id: "810",  title: "Create a BLACKPINK style logo with members' signatures",    url: "https://en.ephoto360.com/create-a-blackpink-style-logo-with-members-signatures-810.html", desc: "Blackpink with signatures" },
  { key: EphotoEffect.TYPOGRAPHY_MULTI_LAYER,id: "811",  title: "Create online typography art effects with multiple layers",  url: "https://en.ephoto360.com/create-online-typography-art-effects-with-multiple-layers-811.html", desc: "Typography multi-layer" },
  { key: EphotoEffect.COMIC_3D,              id: "817",  title: "Create online 3D comic-style text effects",                 url: "https://en.ephoto360.com/create-online-3d-comic-style-text-effects-817.html", desc: "3D comic-style text" },
  { key: EphotoEffect.DEADPOOL_STYLE,        id: "818",  title: "Create text effects in the style of the Deadpool logo",     url: "https://en.ephoto360.com/create-text-effects-in-the-style-of-the-deadpool-logo-818.html", desc: "Deadpool logo style" }
]);

// Build convenient lookup maps from the EFFECTS array
const EFFECT_URLS = Object.freeze(
  Object.fromEntries(EFFECTS.map(e => [e.key, e.url]))
);
const EFFECT_DESCRIPTIONS = Object.freeze(
  Object.fromEntries(EFFECTS.map(e => [e.key, e.desc]))
);

// ============================================================
//  MIME TYPE DETECTION — Support image & video output
//  Detects from URL extension first, then falls back to magic bytes
// ============================================================
function detectMimeType(url, buffer) {
  // Check URL extension first
  if (url) {
    try {
      const pathname = new URL(url).pathname;
      const ext = pathname.split('.').pop()?.toLowerCase() || '';
      const extMap = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'avi': 'video/x-msvideo',
        'mov': 'video/quicktime',
        'mkv': 'video/x-matroska'
      };
      if (extMap[ext]) return extMap[ext];
    } catch {}
  }

  // Fallback: detect from buffer magic bytes
  if (!buffer || buffer.length < 4) return 'image/png';

  const b = buffer;
  // PNG: 89 50 4E 47
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  // JPEG: FF D8 FF
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  // GIF: 47 49 46
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  // WEBP: RIFF .... WEBP (check proper signature at bytes 8-11)
  if (buffer.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  // MP4: ftyp (iso4, mp42, isom, etc.)
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'video/mp4';
  // WEBM: 1A 45 DF A3
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'video/webm';

  return 'image/png';
}

// ============================================================
//  CORE FUNCTION: Generate image/video from ephoto360 effect
//  Uses Puppeteer for reliable browser-based processing
// ============================================================
async function generateEphoto(effectKey, texts) {
  const url = EFFECT_URLS[effectKey];
  if (!url) {
    throw new Error(`Effect "${effectKey}" tidak ditemukan`);
  }

  if (typeof texts === 'string') texts = [texts];

  const { default: puppeteer } = await import('puppeteer');
  const { default: axios } = await import('axios');

  logger.info(`[EPHOTO360] Launching browser for effect: ${effectKey}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Check page info
    const pageInfo = await page.evaluate(() => {
      const textInputs = document.querySelectorAll('input[name="text[]"]');
      const fileInputs = document.querySelectorAll('input[type="file"], input[name^="image"]');
      return {
        hasTextInputs: textInputs.length > 0,
        hasFileInputs: fileInputs.length > 0,
        numTextInputs: textInputs.length
      };
    });

    if (!pageInfo.hasTextInputs) {
      throw new Error('Effect ini butuh upload gambar/foto, bukan teks! Gunakan efek lain yang berbasis teks.');
    }

    if (texts.length < pageInfo.numTextInputs) {
      logger.warn(`[EPHOTO360] Effect has ${pageInfo.numTextInputs} text inputs, but only ${texts.length} provided. Empty will be sent.`);
    }

    // Fill text inputs
    await page.evaluate((vals) => {
      const inputs = document.querySelectorAll('input[name="text[]"]');
      inputs.forEach((el, i) => { if (vals[i] !== undefined) el.value = vals[i]; });
    }, texts);

    // Submit form to get form_value_input
    const formValue = await page.evaluate(async () => {
      const form = document.querySelector('form.ajax-submit') || document.querySelector('form[action*="create"]') || document.querySelector('form');
      if (!form) return null;
      const fd = new FormData(form);
      const res = await fetch(form.action || window.location.href, { method: 'POST', body: fd });
      const html = await res.text();
      const match = html.match(/name="form_value_input" value="([^"]+)"/);
      return match ? match[1] : null;
    });

    if (!formValue) {
      throw new Error('Gagal mendapatkan form_value_input. Mungkin effect ini butuh upload gambar, bukan teks.');
    }

    // Decode and parse
    const decoded = formValue
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&#92;/g, '\\\\')
      .replace(/\\\\\//g, '/');
    const parsed = JSON.parse(decoded);
    const cookieStr = (await page.cookies()).map(c => `${c.name}=${c.value}`).join('; ');
    await browser.close();

    // Create image via API
    const baseUrl = new URL(url).origin;
    const { data: result } = await axios.post(`${baseUrl}/effect/create-image`, parsed, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Cookie: cookieStr,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
      },
      timeout: 60000
    });

    if (!result.success) throw new Error('Create image failed: ' + (result.message || JSON.stringify(result)));

    // Get image URL
    const imageUrl = result.fullsize_image
      ? (result.fullsize_image.startsWith('http') ? result.fullsize_image : `${baseUrl}${result.fullsize_image}`)
      : `${parsed.build_server}/${result.image}`;

    // Download image
    const resp = await axios({ url: imageUrl, method: 'GET', responseType: 'arraybuffer', timeout: 30000 });

    logger.info(`[EPHOTO360] Success for effect: ${effectKey}, image size: ${(resp.data.length / 1024).toFixed(2)}KB`);

    return {
      buffer: Buffer.from(resp.data),
      url: imageUrl,
      effect: effectKey,
      text: texts.join(' | '),
      contentType: detectMimeType(imageUrl, Buffer.from(resp.data))
    };

  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

// ============================================================
//  Main API Handler
// ============================================================
export default {
  name: "Ephoto 360 Text Effects",
  description: "Create text effects with 62 styles — glitch, neon, Blackpink, PUBG, Naruto, and more!",
  category: "Ephoto",

  methods: ["GET", "POST"],

  params: ["effect", "text", "text2"],

  paramsSchema: {
    effect: {
      type: "string",
      required: true,
      enum: Object.values(EphotoEffect),
      description: "Nama effect ephoto360 (lihat daftar di /api/ephoto/ephoto/list)"
    },
    text: {
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 100,
      description: "Teks utama yang akan diberi effect"
    },
    text2: {
      type: "string",
      required: false,
      maxLength: 100,
      description: "Teks kedua (opsional, untuk efek yang membutuhkan 2 teks)"
    }
  },

  async run(req, res) {
    try {
      const params = req.method === 'POST' ? req.body : req.query;
      let { effect, text, text2 } = params;

      // Special case: list all effects
      if (req.path?.endsWith('/list') || effect === 'list') {
        const effectsList = EFFECTS.map(e => {
          // Determine output type based on effect characteristics
          const outputType = (e.title.match(/video|animation|glitch|intro|rotation/i) ? 'video' : 'image');
          return {
            key: e.key,
            id: e.id,
            title: e.title,
            url: e.url,
            description: e.desc,
            type: outputType
          };
        });

        return res.status(200).json({
          status: true,
          message: "Daftar effect ephoto360",
          total: effectsList.length,
          effects: effectsList,
          enum: EphotoEffect,
          types: { image: 'Gambar statis (PNG/JPEG)', video: 'Video animasi (MP4/GIF)' }
        });
      }

      if (!effect) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'effect' wajib diisi. Gunakan /api/ephoto/ephoto/list untuk melihat daftar effect",
          code: "MISSING_EFFECT",
          available_effects: Object.values(EphotoEffect)
        });
      }

      if (!text) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'text' wajib diisi",
          code: "MISSING_TEXT"
        });
      }

      // Validate effect
      const validEffects = Object.values(EphotoEffect);
      if (!validEffects.includes(effect)) {
        return res.status(400).json({
          status: false,
          message: `Effect "${effect}" tidak valid`,
          code: "INVALID_EFFECT",
          available_effects: validEffects,
          hint: "Gunakan /api/ephoto/ephoto/list untuk melihat daftar effect yang tersedia"
        });
      }

      // Validate text length
      if (text.length > 100) {
        return res.status(400).json({
          status: false,
          message: "Text terlalu panjang. Maksimal 100 karakter per teks.",
          code: "TEXT_TOO_LONG"
        });
      }
      if (text2 && text2.length > 100) {
        return res.status(400).json({
          status: false,
          message: "Text2 terlalu panjang. Maksimal 100 karakter per teks.",
          code: "TEXT2_TOO_LONG"
        });
      }

      // Build texts array
      const texts = [text];
      if (text2) texts.push(text2);

      // Check cache
      const cacheKey = `ephoto360:${crypto.createHash('md5').update(JSON.stringify({ effect, texts })).digest('hex')}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        logger.info(`[EPHOTO360] Cache hit for ${effect}`);
        res.setHeader("Content-Type", cached.contentType);
        res.setHeader("Content-Length", cached.buffer.length);
        res.setHeader("X-Cache-Hit", "true");
        res.setHeader("X-Effect", effect);
        return res.end(cached.buffer);
      }

      // Process effect
      logger.info(`[EPHOTO360] Processing request | effect=${effect} | texts="${texts.join(', ')}" | ip=${req.ip}`);

      const startTime = Date.now();
      const result = await generateEphoto(effect, texts);
      const processingTime = Date.now() - startTime;

      // Save to cache
      cache.set(cacheKey, { buffer: result.buffer, contentType: result.contentType });
      setTimeout(() => cache.delete(cacheKey), CACHE_TTL * 1000);

      logger.info(
        `[EPHOTO360] Success | ip=${req.ip} | ` +
        `effect=${effect} | ` +
        `time=${processingTime}ms | ` +
        `output_size=${(result.buffer.length / 1024).toFixed(2)}KB`
      );

      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Content-Length", result.buffer.length);
      res.setHeader("X-Processing-Time", `${processingTime}ms`);
      res.setHeader("X-Effect", effect);
      res.setHeader("X-Text", encodeURIComponent(texts.join(' | ')));
      res.setHeader("X-Image-URL", result.url);
      res.setHeader("X-Cache-Hit", "false");

      return res.end(result.buffer);

    } catch (err) {
      logger.error(`[EPHOTO360] Error | ip=${req.ip} | message=${err.message}`);

      if (err.message.includes("form_value_input") || err.message.includes("input teks")) {
        return res.status(502).json({
          status: false,
          message: "Gagal memproses gambar. Mungkin effect membutuhkan upload gambar atau sedang tidak tersedia.",
          code: "FORM_ERROR"
        });
      }

      if (err.message.includes("timeout") || err.code === "ECONNABORTED") {
        return res.status(504).json({
          status: false,
          message: "Timeout memproses gambar",
          code: "TIMEOUT"
        });
      }

      if (err.message.includes("net::") || err.message.includes("ENOTFOUND") || err.message.includes("ECONNREFUSED")) {
        return res.status(502).json({
          status: false,
          message: "Gagal terhubung ke server ephoto360",
          code: "CONNECTION_ERROR"
        });
      }

      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses efek text",
        code: "INTERNAL_ERROR"
      });
    }
  }
};

// Export for programmatic usage
export { EphotoEffect, EFFECTS, EFFECT_URLS, EFFECT_DESCRIPTIONS };
