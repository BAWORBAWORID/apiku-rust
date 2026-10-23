import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import fs from "fs";
import path from "path";
import axios from "axios";
import { fileURLToPath } from "url";
import logger from "../../src/utils/logger.js";

// ==================== ASSET PATHS (offline-first) ====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.join(__dirname, "assets", "fakenotifwa");

// ==================== FONT REGISTRATION (offline-first) ====================
let fontsLoaded = false;
function registerOfflineFonts() {
  if (fontsLoaded) return;
  const fonts = [
    { path: path.join(ASSETS_DIR, "RobotoBold.ttf"), name: "RobotoBold" },
    { path: path.join(ASSETS_DIR, "RobotoRegular.ttf"), name: "RobotoRegular" },
    { path: path.join(ASSETS_DIR, "SanFrancisco.ttf"), name: "SanFrancisco" }
  ];
  for (const font of fonts) {
    if (fs.existsSync(font.path)) {
      try {
        GlobalFonts.registerFromPath(font.path, font.name);
      } catch (err) {
        logger.error(`[FakeNotifWA] Failed to register font ${font.name}: ${err.message}`);
      }
    }
  }
  fontsLoaded = true;
}

// ==================== APPLE EMOJI LOADER & CACHE ====================
let appleEmojiMap = null;
const emojiImageCache = new Map();
const EMOJI_REGEX = /(\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji_Presentation}\uFE0F?|\p{Emoji}\uFE0F|[\u{1F1E0}-\u{1F1FF}]{2}|\p{Extended_Pictographic}\uFE0F?)/gu;

function emojiToUnicode(emoji) {
  return [...emoji].map(c => c.codePointAt(0).toString(16).padStart(4, '0')).join('-');
}

function loadAppleEmojiMapOffline() {
  if (appleEmojiMap) return appleEmojiMap;
  const localJson = path.join(process.cwd(), "src", "assets", "emoji-apple.json");
  if (fs.existsSync(localJson)) {
    try {
      const raw = fs.readFileSync(localJson, "utf-8");
      appleEmojiMap = JSON.parse(raw);
    } catch (err) {
      logger.error(`[FakeNotifWA] Failed parsing emoji-apple.json: ${err.message}`);
      appleEmojiMap = {};
    }
  } else {
    appleEmojiMap = {};
  }
  return appleEmojiMap;
}

async function getEmojiImage(emoji) {
  if (emojiImageCache.has(emoji)) return emojiImageCache.get(emoji);
  const map = loadAppleEmojiMapOffline();
  const base = emojiToUnicode(emoji);
  const variants = [
    base,
    base.replace(/-fe0f/gi, ''),
    `${base.replace(/-fe0f/gi, '')}-fe0f`,
    base.toUpperCase(),
    base.replace(/-fe0f/gi, '').toUpperCase(),
    base.replace(/-fe0f/gi, '').toUpperCase() + '-FE0F'
  ];
  let b64 = null;
  for (const v of variants) {
    if (map[v]) { b64 = map[v]; break; }
  }
  if (!b64) {
    emojiImageCache.set(emoji, null);
    return null;
  }
  try {
    const buf = Buffer.from(b64, "base64");
    const img = await loadImage(buf);
    emojiImageCache.set(emoji, img);
    return img;
  } catch (err) {
    emojiImageCache.set(emoji, null);
    return null;
  }
}

async function drawAppleEmoji(ctx, emoji, x, y, size) {
  const img = await getEmojiImage(emoji);
  if (!img) {
    ctx.fillText(emoji, x, y);
    return;
  }
  ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
}

function drawcircleimg(ctx, img, x, y, size) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, x, y, size, size);
  ctx.restore();
}

async function drawTextWithEmojis(ctx, text, x, y, fontSize, fontString) {
  ctx.font = fontString;
  const parts = text.split(EMOJI_REGEX);
  let currentX = x;
  for (const part of parts) {
    if (!part) continue;
    EMOJI_REGEX.lastIndex = 0;
    if (EMOJI_REGEX.test(part)) {
      const emojiSize = fontSize * 1.05;
      const emojiCX = currentX + emojiSize / 2;
      const emojiCY = y + (fontSize / 2);
      await drawAppleEmoji(ctx, part, emojiCX, emojiCY, emojiSize);
      currentX += emojiSize;
    } else {
      ctx.fillText(part, currentX, y);
      currentX += ctx.measureText(part).width;
    }
    EMOJI_REGEX.lastIndex = 0;
  }
}

// ==================== MAIN GENERATOR logic ====================
async function generateFakeNotifWA({ ppurl, username, chat, tanggal, jam }) {
  registerOfflineFonts();

  const bgPath = path.join(ASSETS_DIR, "bg.png");
  const waIconPath = path.join(ASSETS_DIR, "wa_icon.jpeg");

  if (!fs.existsSync(bgPath) || !fs.existsSync(waIconPath)) {
    throw new Error("Local background or WhatsApp icon asset missing in " + ASSETS_DIR);
  }

  const bgBuf = fs.readFileSync(bgPath);
  const waIconBuf = fs.readFileSync(waIconPath);

  let ppBuf = waIconBuf;
  if (ppurl && typeof ppurl === "string" && ppurl.startsWith("http")) {
    try {
      const res = await axios.get(ppurl, { responseType: "arraybuffer", timeout: 8000 });
      ppBuf = Buffer.from(res.data);
    } catch (err) {
      logger.warn(`[FakeNotifWA] Failed fetching ppurl ${ppurl}, using default icon`);
    }
  }

  const [bg, ppImg, waImg] = await Promise.all([
    loadImage(bgBuf),
    loadImage(ppBuf),
    loadImage(waIconBuf)
  ]);

  const canvas = createCanvas(bg.width, bg.height);
  const ctx = canvas.getContext("2d");

  ctx.drawImage(bg, 0, 0, bg.width, bg.height);

  const tanggalBesar = tanggal || "Senin, 6 Maret";
  const tanggalY = 120;
  ctx.font = '36px "SanFrancisco", sans-serif';
  ctx.fillStyle = "#C5C5C5";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(tanggalBesar, bg.width / 2, tanggalY);

  const jamBesar = jam || "6.39";
  const jamY = 170;
  ctx.font = '160px "SanFrancisco", sans-serif';
  ctx.fillStyle = "#C5C5C5";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(jamBesar, bg.width / 2, jamY);

  const ppSize = 77;
  const ppX = 39;
  const ppY = 909;
  drawcircleimg(ctx, ppImg, ppX, ppY, ppSize);

  const waIconSize = 24;
  const waIconX = ppX + ppSize - waIconSize + 2;
  const waIconY = ppY + ppSize - waIconSize + 2;
  drawcircleimg(ctx, waImg, waIconX, waIconY, waIconSize);

  const usernameX = 135;
  const usernameY = 913;
  const usernameFontSize = 26;
  ctx.fillStyle = "#FFFFFF";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  await drawTextWithEmojis(ctx, username || "Zyvor", usernameX, usernameY, usernameFontSize, 'bold 26px "RobotoBold", sans-serif');

  const chatX = 135;
  const chatY = 952;
  const chatFontSize = 22;
  ctx.fillStyle = "#FFFFFF";
  ctx.textBaseline = "top";
  await drawTextWithEmojis(ctx, chat || "Haii sayangg udah makan belumm? 🥺", chatX, chatY, chatFontSize, '22px "RobotoRegular", sans-serif');

  return canvas.toBuffer("image/png");
}

// ==================== OPENAPI & HANDLER ====================
export default {
  name: "Fake Whatsapp Lockscreen Notif (ZenzzXD)",
  description: "Generate a realistic Lockscreen WhatsApp notification meme with circular profile photo, Apple Emojis inline, custom date and time",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["username", "chat", "ppurl", "tanggal", "jam"],
  paramsSchema: {
    username: {
      type: "string",
      required: true,
      description: "Nama pengirim pesan WhatsApp",
      example: "Zyvor"
    },
    chat: {
      type: "string",
      required: true,
      description: "Isi pesan WhatsApp (mendukung Apple Emoji inline)",
      example: "Haii sayangg udah makan belumm? 🥺"
    },
    ppurl: {
      type: "string",
      required: false,
      description: "URL foto profil pengirim (opsional)",
      example: "https://uploader.zenzxz.dpdns.org/uploads/1772884412595.jpeg"
    },
    tanggal: {
      type: "string",
      required: false,
      description: "Teks tanggal pada lockscreen",
      example: "Senin, 6 Maret"
    },
    jam: {
      type: "string",
      required: false,
      description: "Teks jam pada lockscreen",
      example: "6.39"
    }
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const data = { ...req.query, ...req.body };
      const username = data.username || data.name || "Zyvor";
      const chat = data.chat || data.message || "Haii sayangg udah makan belumm? 🥺";
      const ppurl = data.ppurl || data.avatar || "";
      const tanggal = data.tanggal || "Senin, 6 Maret";
      const jam = data.jam || "6.39";

      const buffer = await generateFakeNotifWA({ ppurl, username, chat, tanggal, jam });
      const duration = Date.now() - startTime;

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("X-Generated-In", `${duration}ms`);
      res.setHeader("X-FakeNotifWA-Username", encodeURIComponent(username));
      res.setHeader("X-FakeNotifWA-Chat", encodeURIComponent(chat));
      return res.send(buffer);
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[FakeNotifWA] Error after ${duration}ms: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Failed generating lockscreen WhatsApp notification image"
      });
    }
  }
};
