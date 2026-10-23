import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createCanvas, loadImage, registerFont } from "canvas";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_DIR = path.join(__dirname, "assets", "quotes-anime");
const FONT1_PATH = path.join(ASSETS_DIR, "Poppins-Regular.ttf");
const FONT2_PATH = path.join(ASSETS_DIR, "PatrickHand-Regular.ttf");

const FONT1_NAME = "QuotePoppins";
const FONT2_NAME = "QuotePatrick";

if (fs.existsSync(FONT1_PATH)) {
  try { registerFont(FONT1_PATH, { family: FONT1_NAME }); } catch (e) {}
}
if (fs.existsSync(FONT2_PATH)) {
  try { registerFont(FONT2_PATH, { family: FONT2_NAME }); } catch (e) {}
}

const FONTS = [FONT1_NAME, FONT2_NAME];

// Canvas disamakan dengan versi awal (1254x1254)
const CANVAS_SIZE = { width: 1254, height: 1254 };

// Background: key = angka 1-8, "file" = nama file lokal di ASSETS_DIR
const BACKGROUNDS = {
  l: { name: "L", file: "l.png", textZone: { x: 775, y: 56, w: 456, h: 1102 }, usernameZone: { x: 890, y: 1167, w: 228, h: 50 }, usernameFontSize: 28 },
  gojo: { name: "Gojo", file: "gojo.png", textZone: { x: 755, y: 68, w: 466, h: 1027 }, usernameZone: { x: 863, y: 1108, w: 249, h: 50 }, usernameFontSize: 28 },
  yuji: { name: "Yuji", file: "yuji.png", textZone: { x: 35, y: 68, w: 466, h: 1027 }, usernameZone: { x: 133, y: 1108, w: 249, h: 50 }, usernameFontSize: 28 },
  denji: { name: "Denji", file: "denji.png", textZone: { x: 655, y: 68, w: 512, h: 1083 }, usernameZone: { x: 795, y: 1152, w: 249, h: 50 }, usernameFontSize: 28 },
  thorfin: { name: "Thorfinn", file: "thorfin.png", textZone: { x: 65, y: 54, w: 489, h: 992 }, usernameZone: { x: 162, y: 1042, w: 249, h: 50 }, usernameFontSize: 28 },
  naruto: { name: "Naruto", file: "naruto.png", textZone: { x: 40, y: 56, w: 481, h: 1065 }, usernameZone: { x: 170, y: 1126, w: 228, h: 50 }, usernameFontSize: 28 },
  light: { name: "Light", file: "light.png", textZone: { x: 38, y: 56, w: 493, h: 941 }, usernameZone: { x: 170, y: 1025, w: 228, h: 50 }, usernameFontSize: 28 },
  higuruma: { name: "Higuruma", file: "higuruma.png", textZone: { x: 755, y: 68, w: 424, h: 920 }, usernameZone: { x: 840, y: 993, w: 249, h: 50 }, usernameFontSize: 28 }
};

const BG_ENUMS = Object.keys(BACKGROUNDS); // ["1","2",...,"8"]

function wrapText(ctx, text, maxWidth) {
  const words = text.trim().split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const testLine = line ? line + " " + word : word;
    if (ctx.measureText(testLine).width > maxWidth) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export default {
  name: "Quotes Anime",
  description: "Generate gambar quote anime dengan teks & username manual, background pilihan (1-8)",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["text", "username", "background"],
  paramsSchema: {
    text: { type: "string", required: true, description: "Teks quote (wajib diisi manual)", example: '"Hukum tidak selalu adil"' },
    username: { type: "string", required: true, description: "Nama karakter/author (wajib diisi manual)", example: "Higuruma" },
    background: { type: "string", required: true, description: "Nama background", enum: BG_ENUMS, example: BG_ENUMS[0] }
  },

  async run(req, res) {
    try {
      const { text, username, background } = { ...req.query, ...req.body };

      if (!text || !String(text).trim()) {
        return res.status(400).json({ status: false, message: "Parameter 'text' wajib diisi" });
      }
      if (!username || !String(username).trim()) {
        return res.status(400).json({ status: false, message: "Parameter 'username' wajib diisi" });
      }
      if (!background || !BACKGROUNDS[background]) {
        return res.status(400).json({ status: false, message: `Parameter 'background' wajib diisi, pilih salah satu: ${BG_ENUMS.join(", ")}` });
      }

      const quoteText = String(text).trim();
      const character = String(username).trim();
      const bg = BACKGROUNDS[background];

      const bgLocalPath = path.join(ASSETS_DIR, bg.file);
      if (!fs.existsSync(bgLocalPath)) {
        return res.status(500).json({ status: false, message: `File background '${bg.file}' tidak ditemukan di ${ASSETS_DIR}` });
      }

      const bgImg = await loadImage(bgLocalPath);

      const canvas = createCanvas(CANVAS_SIZE.width, CANVAS_SIZE.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bgImg, 0, 0, CANVAS_SIZE.width, CANVAS_SIZE.height);

      const fontName = FONTS[Math.floor(Math.random() * FONTS.length)];
      const fallback = fs.existsSync(FONT1_PATH) && fs.existsSync(FONT2_PATH) ? fontName : "sans-serif";

      const tz = bg.textZone;
      let fontSize = 52;
      let lines = [];
      ctx.textBaseline = "middle";
      while (fontSize >= 20) {
        ctx.font = `${fontSize}px "${fallback}"`;
        lines = wrapText(ctx, quoteText, tz.w);
        const totalHeight = lines.length * fontSize * 1.2;
        if (totalHeight <= tz.h) break;
        fontSize -= 2;
      }

      ctx.font = `${fontSize}px "${fallback}"`;
      ctx.fillStyle = "#111111";
      ctx.textAlign = "center";

      const lineHeight = fontSize * 1.2;
      const totalHeight = lines.length * lineHeight;
      const centerX = tz.x + tz.w / 2;
      const startY = tz.y + (tz.h - totalHeight) / 2 + lineHeight / 2;

      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], centerX, startY + i * lineHeight);
      }

      const uz = bg.usernameZone;
      ctx.font = `${bg.usernameFontSize}px "${fallback}"`;
      ctx.fillStyle = "#121212";
      ctx.textAlign = "center";
      ctx.fillText(character, uz.x + uz.w / 2, uz.y + uz.h / 2);

      const buffer = canvas.toBuffer("image/png");
      res.set("Content-Type", "image/png");
      res.set("Content-Length", buffer.length);
      res.send(buffer);
    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || "Gagal generate quote anime" });
    }
  }
};