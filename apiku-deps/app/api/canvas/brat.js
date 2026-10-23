import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../../src/utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FONT_URL = "https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/Font/ARIALN.ttf";
const FONT_LOCAL = path.join(__dirname, "assets", "brat", "ARIALN.ttf");
const FONT_FALLBACK = path.join(__dirname, "assets", "iqc-dark", "fonts", "Inter-Regular.ttf");
const EMOJI_JSON_LOCAL = path.join(process.cwd(), "src", "assets", "emoji-apple.json");

let fontLoaded = false;
let emojiMap = null;
const emojiImageCache = new Map();

const THEMES = {
  black: { bg: "#000000", text: "#ffffff" },
  white: { bg: "#ffffff", text: "#000000" },
  green: { bg: "#8ace00", text: "#000000" }
};

const EMOJI_REGEX = /(\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji_Presentation}\uFE0F?|\p{Emoji}\uFE0F|[\u{1F1E0}-\u{1F1FF}]{2}|\p{Extended_Pictographic}\uFE0F?)/gu;

async function ensureFont() {
  if (fontLoaded) return;
  try {
    const dir = path.dirname(FONT_LOCAL);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (!fs.existsSync(FONT_LOCAL)) {
      try {
        const res = await fetch(FONT_URL);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          fs.writeFileSync(FONT_LOCAL, buf);
        }
      } catch {}
    }

    if (fs.existsSync(FONT_LOCAL)) {
      GlobalFonts.registerFromPath(FONT_LOCAL, "ArialNarrow");
    } else if (fs.existsSync(FONT_FALLBACK)) {
      GlobalFonts.registerFromPath(FONT_FALLBACK, "ArialNarrow");
    }
    fontLoaded = true;
  } catch (err) {
    logger.error(`[Brat] Failed to register font: ${err.message}`);
  }
}

function emojiToUnicode(emoji) {
  return [...emoji].map(c => c.codePointAt(0).toString(16).padStart(4, "0")).join("-");
}

async function loadEmojiMap() {
  if (emojiMap) return emojiMap;
  try {
    if (fs.existsSync(EMOJI_JSON_LOCAL)) {
      emojiMap = JSON.parse(fs.readFileSync(EMOJI_JSON_LOCAL, "utf-8"));
    } else {
      emojiMap = {};
    }
  } catch {
    emojiMap = {};
  }
  return emojiMap;
}

async function getEmojiImage(emoji) {
  if (emojiImageCache.has(emoji)) return emojiImageCache.get(emoji);
  const map = await loadEmojiMap();
  const base = emojiToUnicode(emoji);
  const variants = [
    base,
    base.replace(/-fe0f/gi, ""),
    `${base.replace(/-fe0f/gi, "")}-fe0f`,
    base.toUpperCase(),
    base.replace(/-fe0f/gi, "").toUpperCase(),
    base.replace(/-fe0f/gi, "").toUpperCase() + "-FE0F"
  ];
  let b64 = null;
  for (const v of variants) {
    if (map[v]) { b64 = map[v]; break; }
  }
  if (!b64) return null;
  try {
    const { loadImage } = await import("@napi-rs/canvas");
    const img = await loadImage(Buffer.from(b64, "base64"));
    emojiImageCache.set(emoji, img);
    return img;
  } catch {
    return null;
  }
}

async function drawAppleEmoji(ctx, emoji, x, y, size) {
  const img = await getEmojiImage(emoji);
  if (!img) { ctx.fillText(emoji, x, y); return; }
  ctx.drawImage(img, x, y, size, size);
}

function measureTextCustom(ctx, text, fontSize) {
  const parts = text.split(EMOJI_REGEX);
  let w = 0;
  for (const part of parts) {
    if (!part) continue;
    EMOJI_REGEX.lastIndex = 0;
    if (EMOJI_REGEX.test(part)) w += fontSize;
    else w += ctx.measureText(part).width;
    EMOJI_REGEX.lastIndex = 0;
  }
  return w;
}

async function drawTextWithEmojis(ctx, text, x, y, fontSize) {
  const parts = text.split(EMOJI_REGEX);
  let curX = x;
  for (const part of parts) {
    if (!part) continue;
    EMOJI_REGEX.lastIndex = 0;
    if (EMOJI_REGEX.test(part)) {
      await drawAppleEmoji(ctx, part, curX, y, fontSize);
      curX += fontSize;
    } else {
      ctx.fillText(part, curX, y);
      curX += ctx.measureText(part).width;
    }
    EMOJI_REGEX.lastIndex = 0;
  }
}

function wrapText(ctx, text, maxWidth, fontSize) {
  ctx.font = `${fontSize}px ArialNarrow`;
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? cur + " " + word : word;
    if (measureTextCustom(ctx, test, fontSize) > maxWidth && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function fitsAt(ctx, text, fontSize, maxWidth, maxHeight, lineGap) {
  const lines = wrapText(ctx, text, maxWidth, fontSize);
  const longestWord = Math.max(...text.split(" ").map(w => measureTextCustom(ctx, w, fontSize)));
  const totalHeight = lines.length * (fontSize + lineGap) - lineGap;
  return longestWord <= maxWidth && totalHeight <= maxHeight;
}

function findBestFontSize(ctx, text, maxWidth, maxHeight, lineGap) {
  let lo = 10, hi = 700, best = lo;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fitsAt(ctx, text, mid, maxWidth, maxHeight, lineGap)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

async function generateBrat({ text, theme = "white", blur = 0, mode = "left" }) {
  await ensureFont();
  await loadEmojiMap();

  const selectedTheme = THEMES[theme] || THEMES.white;
  const blurAmount = [0, 1, 2, 3].includes(blur) ? blur : 0;
  const size = 1000;
  const padding = 80;
  const lineGap = 20;
  const maxWidth = size - padding * 2;
  const maxHeight = size - padding * 2;

  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  const fontSize = findBestFontSize(ctx, text, maxWidth, maxHeight, lineGap);
  const lines = wrapText(ctx, text, maxWidth, fontSize);

  ctx.fillStyle = selectedTheme.bg;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = selectedTheme.text;
  ctx.font = `${fontSize}px ArialNarrow`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  ctx.save();
  if (blurAmount > 0) ctx.filter = `blur(${blurAmount}px)`;

  const totalTextHeight = lines.length * (fontSize + lineGap) - lineGap;
  let y = (size - totalTextHeight) / 2;

  for (const line of lines) {
    if (mode === "right") {
      const lineWidth = measureTextCustom(ctx, line, fontSize);
      const x = size - padding - lineWidth;
      await drawTextWithEmojis(ctx, line, x, y, fontSize);
    } else {
      await drawTextWithEmojis(ctx, line, padding, y, fontSize);
    }
    y += fontSize + lineGap;
  }

  ctx.restore();

  return canvas.encode("png");
}

export default {
  name: "Brat Canvas Generator",
  description: "Generate brat style text images with Apple Emoji, themes, and blur support",
  category: "Canvas",
  methods: ["GET", "POST"],
  params: ["text", "theme", "blur", "mode"],
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Text to render on canvas",
      example: "Hello World 🎨"
    },
    theme: {
      type: "string",
      required: false,
      description: "Color theme (black, white, green)",
      example: "white",
      enum: ["black", "white", "green"],
      default: "white"
    },
    blur: {
      type: "string",
      required: false,
      description: "Blur level (0-3)",
      example: "0",
      enum: ["0", "1", "2", "3"],
      default: "0"
    },
    mode: {
      type: "string",
      required: false,
      description: "Text alignment (left or right)",
      example: "left",
      enum: ["left", "right"],
      default: "left"
    }
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const data = { ...req.query, ...req.body };
      const text = data.text || data.teks || data.q || "";
      if (!text) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'text' is required"
        });
      }

      const theme = data.theme || "white";
      const blur = parseInt(data.blur) || 0;
      const mode = data.mode || "left";

      const buffer = await generateBrat({ text, theme, blur, mode });
      const duration = Date.now() - startTime;

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("X-Generated-In", `${duration}ms`);
      return res.send(buffer);
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[Brat] Error after ${duration}ms: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Failed to generate brat image"
      });
    }
  }
};
