import { createCanvas, loadImage, registerFont } from "canvas";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../../src/utils/logger.js";
import https from "https";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.join(__dirname, "assets", "ttqc");

const TEMPLATE_PATH = path.join(ASSETS_DIR, "template.png");

const fontCandidates = [
  { path: path.join(ASSETS_DIR, "PlusJakartaSans-Regular.ttf"), family: "Plus Jakarta Sans" },
  { path: path.join(ASSETS_DIR, "PlusJakartaSans-Medium.ttf"), family: "Plus Jakarta Sans", weight: "500" },
  { path: path.join(ASSETS_DIR, "PlusJakartaSans-Bold.ttf"), family: "Plus Jakarta Sans", weight: "bold" },
  { path: path.join(ASSETS_DIR, "fa-solid-900.ttf"), family: "Font Awesome 6 Free", weight: "900" }
];

let fontsLoaded = false;
try {
  for (const font of fontCandidates) {
    if (fs.existsSync(font.path)) {
      registerFont(font.path, { family: font.family, weight: font.weight });
    }
  }
  fontsLoaded = true;
} catch (err) {
  logger.error(`[TTQC] Failed to register fonts: ${err.message}`);
}

const MENU_ICONS = [
  { unicode: '\uf3e5', text: 'Balas',           color: '#000000' },
  { unicode: '\uf064', text: 'Teruskan',         color: '#000000' },
  { unicode: '\uf0c5', text: 'Salin',            color: '#000000' },
  { unicode: '\uf1ab', text: 'Terjemahkan',      color: '#000000' },
  { unicode: '\uf2ed', text: 'Hapus untuk saya', color: '#000000' },
  { unicode: '\uf024', text: 'Laporkan',         color: '#ea4335' },
];

const config = {
  topPPX: 183, topPPY: 83, topPPRadius: 42,
  topNameX: 250, topNameY: 82, topNameSize: 34,
  chatPPX: 75, chatPPRadius: 38,
  textX: 175, textY: 962,
  bubbleWidth: 520, textSize: 30,
  bubbleBgColor: '#ffffff', textColor: '#161823',
};

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} → ${url}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function loadImageSmart(src) {
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return loadImage(await fetchBuffer(src));
  }
  return loadImage(src);
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/(\s+)/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if (!word) continue;
    if (word.trim() === '' && currentLine === '') continue;

    const testLine = currentLine + word;
    if (ctx.measureText(testLine).width > maxWidth) {
      if (currentLine !== '') {
        lines.push(currentLine.trimEnd());
        currentLine = word.trimStart();
      } else {
        lines.push(testLine);
        currentLine = '';
      }
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine.trim()) {
    lines.push(currentLine.trimEnd());
  }
  return lines;
}

function drawRoundedRect(ctx, x, y, w, h, r, fill, stroke = null, shadow = false) {
  ctx.save();
  if (shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.05)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 12;
  }
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  ctx.restore();
}

function drawCircleImage(ctx, img, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}

export default {
  name: "Tiktok Quote Chat",
  description: "Generate a Tiktok Quote Chat meme image",
  category: "Maker",
  methods: ["GET"],
  params: ["username", "text", "avatar"],
  paramsSchema: {
    username: {
      type: "string",
      required: true,
      description: "Nama user Tiktok",
      example: "Ditzzx"
    },
    text: {
      type: "string",
      required: true,
      description: "Isi chat quote",
      example: "Just friend kok cemburu 😂😂"
    },
    avatar: {
      type: "string",
      required: false,
      description: "URL Avatar image (opsional)",
      default: "https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/6b71d84a580f385bd7ee36402df5341ead4770a0/Image/artworks-gWLRE6HyPH3DgVMG-ZFFxtg-t500x500.jpg"
    }
  },

  async run(req, res) {
    const { username, text, avatar } = { ...req.query, ...req.body };

    if (!username) return res.status(400).json({ status: false, message: "Parameter 'username' wajib diisi" });
    if (!text) return res.status(400).json({ status: false, message: "Parameter 'text' wajib diisi" });

    const USERNAME = String(username);
    const CHAT_TEXT = String(text);
    const AVATAR_SRC = avatar || 'https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/6b71d84a580f385bd7ee36402df5341ead4770a0/Image/artworks-gWLRE6HyPH3DgVMG-ZFFxtg-t500x500.jpg';

    const startTime = Date.now();

    try {
      if (!fs.existsSync(TEMPLATE_PATH)) {
        throw new Error("Template missing. Place template.png in api/maker/assets/ttqc/.");
      }

      const templateBuffer = await fs.promises.readFile(TEMPLATE_PATH);
      const templateImage = await loadImage(templateBuffer);
      const avatarImage = await loadImageSmart(AVATAR_SRC);

      const canvas = createCanvas(1080 * 2, 2280 * 2);
      const ctx = canvas.getContext('2d');

      ctx.scale(2, 2);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.clearRect(0, 0, 1080, 2280);
      ctx.drawImage(templateImage, 0, 0, 1080, 2280);

      drawCircleImage(ctx, avatarImage, config.topPPX, config.topPPY, config.topPPRadius);

      ctx.font = `bold ${config.topNameSize}px 'Plus Jakarta Sans', sans-serif`;
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(USERNAME, config.topNameX, config.topNameY);

      ctx.font = `500 ${config.textSize}px 'Plus Jakarta Sans', sans-serif`;
      
      const lines = wrapText(ctx, CHAT_TEXT, config.bubbleWidth - 52);
      const lineH = config.textSize * 1.45;

      let maxW = 0;
      for (const l of lines) {
        const w = ctx.measureText(l).width;
        if (w > maxW) maxW = w;
      }

      const padX = 30, padY = 24;
      const bubbleW = Math.max(maxW + padX * 2, 180);
      const bubbleH = lines.length * lineH + padY * 2;
      const bubbleX = config.textX - padX;
      const bubbleY = config.textY - padY;

      drawCircleImage(ctx, avatarImage, config.chatPPX, bubbleY + bubbleH / 2, config.chatPPRadius);
      drawRoundedRect(ctx, bubbleX, bubbleY, bubbleW, bubbleH, 35, config.bubbleBgColor);

      ctx.fillStyle = config.textColor;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      lines.forEach((line, i) => {
        const lineY = config.textY + i * lineH + config.textSize / 2;
        ctx.fillText(line, config.textX, lineY);
      });

      const menuX = 90, menuY = bubbleY + bubbleH + 28;
      drawRoundedRect(ctx, menuX, menuY, 565, 580, 40, '#ffffff', 'rgba(0,0,0,0.02)', true);

      const itemH = 90, iconX = menuX + 60, labelX = menuX + 130;
      MENU_ICONS.forEach((item, i) => {
        const cy = menuY + 25 + i * itemH + itemH / 2;
        ctx.fillStyle = item.color;
        ctx.font = `900 34px 'Font Awesome 6 Free'`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.unicode, iconX, cy);
        ctx.font = `500 34px 'Plus Jakarta Sans'`;
        ctx.textAlign = 'left';
        ctx.fillText(item.text, labelX, cy);
      });

      ctx.restore();

      const buffer = canvas.toBuffer("image/png");
      const duration = Date.now() - startTime;
      
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("X-Generated-In", `${duration}ms`);
      return res.send(buffer);

    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[TTQC] Generation failed after ${duration}ms: ${err.message}`);

      return res.status(500).json({
        status: false,
        message: err.message || "Failed to generate tiktok quote chat image"
      });
    }
  }
};
