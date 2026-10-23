import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import fs from "fs";
import path from "path";
import os from "os";
import axios from "axios";
import { fileURLToPath } from "url";
import { safeFetch } from "../../src/utils/safeFetch.js";
import logger from "../../src/utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.join(__dirname, "assets", "fakecall-ios");
const FONTS_DIR = path.join(__dirname, "assets", "fakenotifwa");

// ==================== FONT REGISTRATION ====================
let fontsLoaded = false;
function registerFonts() {
  if (fontsLoaded) return;
  const fonts = [
    { path: path.join(FONTS_DIR, "RobotoBold.ttf"), name: "RobotoBold" },
    { path: path.join(FONTS_DIR, "RobotoRegular.ttf"), name: "RobotoRegular" },
  ];
  for (const f of fonts) {
    if (fs.existsSync(f.path)) {
      try { GlobalFonts.registerFromPath(f.path, f.name); } catch {}
    }
  }
  fontsLoaded = true;
}

// ==================== APPLE EMOJI ====================
let appleEmojiMap = null;
const emojiImageCache = new Map();
const EMOJI_REGEX = /(\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji_Presentation}\uFE0F?|\p{Emoji}\uFE0F|[\u{1F1E0}-\u{1F1FF}]{2}|\p{Extended_Pictographic}\uFE0F?)/gu;

function emojiToUnicode(emoji) {
  return [...emoji].map(c => c.codePointAt(0).toString(16).padStart(4, '0')).join('-');
}

function loadAppleEmojiMap() {
  if (appleEmojiMap) return appleEmojiMap;
  const localJson = path.join(process.cwd(), "src", "assets", "emoji-apple.json");
  if (fs.existsSync(localJson)) {
    try {
      appleEmojiMap = JSON.parse(fs.readFileSync(localJson, "utf-8"));
    } catch { appleEmojiMap = {}; }
  } else { appleEmojiMap = {}; }
  return appleEmojiMap;
}

async function getEmojiImage(emoji) {
  if (emojiImageCache.has(emoji)) return emojiImageCache.get(emoji);
  const map = loadAppleEmojiMap();
  const base = emojiToUnicode(emoji);
  const variants = [
    base, base.replace(/-fe0f/gi, ''), `${base.replace(/-fe0f/gi, '')}-fe0f`,
    base.toUpperCase(), base.replace(/-fe0f/gi, '').toUpperCase(),
    base.replace(/-fe0f/gi, '').toUpperCase() + '-FE0F'
  ];
  let b64 = null;
  for (const v of variants) { if (map[v]) { b64 = map[v]; break; } }
  if (!b64) { emojiImageCache.set(emoji, null); return null; }
  try {
    const img = await loadImage(Buffer.from(b64, "base64"));
    emojiImageCache.set(emoji, img);
    return img;
  } catch { emojiImageCache.set(emoji, null); return null; }
}

function parseTextAndEmojis(textStr) {
  const tokens = [];
  const chars = [...textStr];
  let currentText = "";
  for (let i = 0; i < chars.length; i++) {
    if (/\p{Emoji_Presentation}|\p{Extended_Pictographic}/u.test(chars[i])) {
      if (currentText) { tokens.push({ type: 'text', value: currentText }); currentText = ""; }
      let emojiVal = chars[i];
      if (chars[i + 1] === '\uFE0F') { emojiVal += chars[i + 1]; i++; }
      tokens.push({ type: 'emoji', value: emojiVal });
    } else { currentText += chars[i]; }
  }
  if (currentText) tokens.push({ type: 'text', value: currentText });
  return tokens;
}

function measureTextCustom(ctx, tokens, fontSize) {
  let w = 0;
  for (const t of tokens) { w += t.type === 'emoji' ? fontSize * 1.05 : ctx.measureText(t.value).width; }
  return w;
}

async function drawTextWithEmojisCenter(ctx, textStr, yPos, fontSize, fontString, canvasWidth) {
  ctx.font = fontString;
  ctx.textBaseline = 'top';
  const tokens = parseTextAndEmojis(textStr);
  const totalWidth = measureTextCustom(ctx, tokens, fontSize);
  let currentX = (canvasWidth / 2) - (totalWidth / 2);
  for (const token of tokens) {
    if (token.type === 'emoji') {
      const emojiSize = fontSize * 1.05;
      const img = await getEmojiImage(token.value);
      if (img) { ctx.drawImage(img, currentX, yPos + (fontSize - emojiSize) / 2, emojiSize, emojiSize); }
      else { ctx.fillText(token.value, currentX, yPos); }
      currentX += emojiSize;
    } else {
      ctx.fillText(token.value, currentX, yPos);
      currentX += ctx.measureText(token.value).width;
    }
  }
}

// ==================== MAIN GENERATOR ====================
async function generateFakeCalliOS({ avatarUrl, name, duration }) {
  registerFonts();

  const templatePath = path.join(ASSETS_DIR, "template.png");
  if (!fs.existsSync(templatePath)) throw new Error("Template image missing");

  const [bgImg, avatarImg] = await Promise.all([
    loadImage(templatePath),
    (async () => {
      if (avatarUrl && avatarUrl.startsWith("http")) {
        const tmpFile = path.join(os.tmpdir(), `fcavatar_${Date.now()}.png`);
        try {
          const result = await safeFetch(avatarUrl, { timeout: 10000 });
          fs.writeFileSync(tmpFile, result.buffer);
          const img = await loadImage(tmpFile);
          return img;
        } catch {} finally {
          try { fs.unlinkSync(tmpFile); } catch {}
        }
      }
      return null;
    })()
  ]);

  const canvas = createCanvas(bgImg.width, bgImg.height);
  const ctx = canvas.getContext("2d");

  ctx.drawImage(bgImg, 0, 0, canvas.width, bgImg.height);

  if (avatarImg) {
    const ppX = canvas.width / 2;
    const ppY = canvas.height * 0.50;
    const ppRadius = canvas.width * 0.22;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ppX, ppY, ppRadius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatarImg, ppX - ppRadius, ppY - ppRadius, ppRadius * 2, ppRadius * 2);
    ctx.restore();
  }

  const namaY = 75;
  const namaSize = 42;
  const angkaY = 133;
  const angkaSize = 35;

  ctx.fillStyle = '#FFFFFF';
  await drawTextWithEmojisCenter(ctx, name || "Unknown", namaY, namaSize, `700 ${namaSize}px "RobotoBold", sans-serif`, canvas.width);

  ctx.fillStyle = '#C5C5C5';
  await drawTextWithEmojisCenter(ctx, duration || "00:00", angkaY, angkaSize, `400 ${angkaSize}px "RobotoRegular", sans-serif`, canvas.width);

  return canvas.toBuffer("image/png");
}

// ==================== ENDPOINT ====================
export default {
  name: "Fake Call iOS",
  description: "Generate gambar fake call iOS (WhatsApp style) dengan nama kontak, durasi, dan foto avatar",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["name", "duration", "avatar"],
  paramsSchema: {
    name: {
      type: "string",
      required: true,
      description: "Nama kontak pada layar call (mendukung Apple Emoji)",
      example: "my heart ❤️",
      minLength: 1,
      maxLength: 50
    },
    duration: {
      type: "string",
      required: false,
      description: "Durasi call (format: MM:SS atau HH:MM:SS)",
      example: "01:00:39",
      default: "00:00"
    },
    avatar: {
      type: "string",
      required: false,
      description: "URL foto profil kontak (akan ditampilkan bulat)",
      example: "https://example.com/avatar.jpg"
    }
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const data = { ...req.query, ...req.body };
      const name = data.name || data.nama || "Unknown";
      const duration = data.duration || data.durasi || "00:00";
      const avatar = data.avatar || data.pp || data.ppurl || "";

      const buffer = await generateFakeCalliOS({ avatarUrl: avatar, name, duration });
      const durationMs = Date.now() - startTime;

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("X-Generated-In", `${durationMs}ms`);
      return res.send(buffer);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      logger.error(`[FakeCalliOS] Error after ${durationMs}ms: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal membuat gambar fake call iOS"
      });
    }
  }
};
