import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import fs from "fs";
import path from "path";
import axios from "axios";
import { fileURLToPath } from "url";
import logger from "../../src/utils/logger.js";

// ==================== ASSET & FONT PATHS (Offline-First) ====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.join(__dirname, "assets", "fakenote");
const POPPINS_FONT_PATH = path.join(__dirname, "assets", "fakenotif", "Poppins-Regular.ttf");
const POPPINS_ALT_PATH = path.join(__dirname, "assets", "faketweet", "Poppins-Regular.ttf");
const LOCAL_BG_PATH = path.join(ASSETS_DIR, "bg.jpg");
const REMOTE_BG_URL = "https://raw.githubusercontent.com/RIFKIror/Assest/refs/heads/main/img/IMG-20260716-WA0412.jpg";

let fontsLoaded = false;
function registerOfflineFonts() {
  if (fontsLoaded) return;
  try {
    if (fs.existsSync(POPPINS_FONT_PATH)) {
      GlobalFonts.registerFromPath(POPPINS_FONT_PATH, "Poppins");
    } else if (fs.existsSync(POPPINS_ALT_PATH)) {
      GlobalFonts.registerFromPath(POPPINS_ALT_PATH, "Poppins");
    } else {
      logger.warn("[FakeNote] Poppins font not found offline, text rendering may use system default font.");
    }
    fontsLoaded = true;
  } catch (err) {
    logger.error(`[FakeNote] Failed to register Poppins font: ${err.message}`);
  }
}

// ==================== TEXT WRAPPER ====================
function wrapText(ctx, text, maxWidth, maxLines = 5) {
  let fontSize = 40;
  let lines = [];
  while (fontSize >= 28) {
    ctx.font = `${fontSize}px Poppins`;
    const safeWidth = maxWidth - 100;
    const words = text.trim().split(/\s+/);
    lines = [];
    let line = "";
    for (const word of words) {
      const testLine = line ? line + " " + word : word;
      if (ctx.measureText(testLine).width <= safeWidth) {
        line = testLine;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }

    if (line) lines.push(line);
    if (lines.length <= maxLines) break;
    fontSize -= 2;
  }

  return {
    lines,
    fontSize
  };
}

// ==================== AVATAR LOADER (WITH FALLBACK) ====================
async function loadAvatarImage(avatarUrl, name) {
  if (avatarUrl && typeof avatarUrl === "string" && avatarUrl.startsWith("http")) {
    try {
      const resp = await axios.get(avatarUrl, {
        responseType: "arraybuffer",
        timeout: 8000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      });
      return await loadImage(Buffer.from(resp.data));
    } catch (err) {
      logger.warn(`[FakeNote] Failed loading remote avatar (${avatarUrl}): ${err.message}. Using fallback avatar.`);
    }
  }

  // Fallback: create a sleek placeholder avatar canvas
  const canvas = createCanvas(340, 340);
  const ctx = canvas.getContext("2d");
  
  // Dark gradient circle
  const grad = ctx.createLinearGradient(0, 0, 340, 340);
  grad.addColorStop(0, "#1e293b");
  grad.addColorStop(1, "#0f172a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 340, 340);

  // First letter of name
  const cleanName = (name || "U").replace(/^@/, "");
  const initial = (cleanName.charAt(0) || "U").toUpperCase();
  ctx.font = "bold 130px Poppins";
  ctx.fillStyle = "#f8fafc";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initial, 170, 170);

  return canvas;
}

// ==================== BACKGROUND LOADER ====================
async function loadBackgroundImage() {
  if (fs.existsSync(LOCAL_BG_PATH)) {
    try {
      return await loadImage(LOCAL_BG_PATH);
    } catch (err) {
      logger.warn(`[FakeNote] Failed loading local bg.jpg: ${err.message}. Fetching remote...`);
    }
  }
  try {
    const resp = await axios.get(REMOTE_BG_URL, { responseType: "arraybuffer", timeout: 10000 });
    // Cache for next time
    if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
    fs.writeFileSync(LOCAL_BG_PATH, Buffer.from(resp.data));
    return await loadImage(Buffer.from(resp.data));
  } catch (err) {
    throw new Error("Failed to load background template for Fake Note: " + err.message);
  }
}

// ==================== MAIN GENERATOR ====================
async function generateFakeNote({ name, message, avatar }) {
  registerOfflineFonts();

  const [bg, pp] = await Promise.all([
    loadBackgroundImage(),
    loadAvatarImage(avatar, name)
  ]);

  const canvas = createCanvas(bg.width, bg.height);
  const ctx = canvas.getContext("2d");

  // Draw background template
  ctx.drawImage(bg, 0, 0);

  // Draw circular profile picture
  const avatarX = 195;
  const avatarY = 407;
  const avatarSize = 340;
  ctx.save();
  ctx.beginPath();
  ctx.arc(
    avatarX + avatarSize / 2,
    avatarY + avatarSize / 2,
    avatarSize / 2,
    0,
    Math.PI * 2
  );
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(pp, avatarX, avatarY, avatarSize, avatarSize);
  ctx.restore();

  // Draw speech bubble message text
  const bubbleX = 0;
  const bubbleY = 70;
  const bubbleWidth = 750;
  const bubbleHeight = 350;
  const padding = 40;
  const maxWidth = bubbleWidth - padding * 2;

  const { lines, fontSize } = wrapText(ctx, message || "jadilah manusia berkualitas", maxWidth, 5);

  ctx.font = `${fontSize}px Poppins`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lineHeight = fontSize + 12;
  const totalHeight = lines.length * lineHeight;
  let y = bubbleY + (bubbleHeight - totalHeight) / 2 + lineHeight / 2;

  for (const line of lines) {
    ctx.fillText(line, bubbleX + bubbleWidth / 2, y);
    y += lineHeight;
  }

  // Draw username label below avatar
  ctx.font = "38px Poppins";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText(name || "@username", avatarX + avatarSize / 2, avatarY + avatarSize + 55);

  return canvas.toBuffer("image/png");
}

// ==================== OPENAPI & HANDLER ====================
export default {
  name: "Fake Note Message Canvas",
  description: "Generate a realistic Instagram/WhatsApp Note speech bubble meme graphic with circular avatar and custom text",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["name", "message", "avatar"],
  paramsSchema: {
    name: {
      type: "string",
      required: true,
      description: "Nama atau username pengirim (misal: @kyynhz)",
      example: "@kyynhz"
    },
    message: {
      type: "string",
      required: true,
      description: "Isi teks pesan Note di dalam speech bubble",
      example: "jadilah manusia berkualitas, tidak menindas untuk menjadi teratas"
    },
    avatar: {
      type: "string",
      required: false,
      description: "URL gambar foto profil (opsional, jika kosong menggunakan fallback foto huruf awal)",
      example: "https://uploader.zenzxz.dpdns.org/uploads/1772884412595.jpeg"
    }
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const data = { ...req.query, ...req.body };
      const name = data.name || data.username || "@kyynhz";
      const message = data.message || data.text || data.chat || "jadilah manusia berkualitas, tidak menindas untuk menjadi teratas";
      const avatar = data.avatar || data.ppurl || data.profile || "";

      const buffer = await generateFakeNote({ name, message, avatar });
      const duration = Date.now() - startTime;

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("X-Generated-In", `${duration}ms`);
      res.setHeader("X-FakeNote-Name", encodeURIComponent(name));
      res.setHeader("X-FakeNote-Message", encodeURIComponent(message));
      return res.send(buffer);
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[FakeNote] Error after ${duration}ms: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Failed generating Fake Note canvas image"
      });
    }
  }
};
