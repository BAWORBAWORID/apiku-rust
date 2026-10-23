import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createCanvas, loadImage, registerFont } from "canvas";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_DIR = path.join(__dirname, "assets", "nulis");
const FONT_PATH = path.join(ASSETS_DIR, "PatrickHand-Regular.ttf");
const BG_PATH = path.join(ASSETS_DIR, "paper.png");

const FONT_SOURCE = path.join(__dirname, "assets", "motivasi", "PatrickHand-Regular.ttf");
const BG_URL = "https://raw.githubusercontent.com/rzkrohanmedia/cloud-backup/main/uploads/KyzoCDN_1784739409872_undefined.png";

if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
if (!fs.existsSync(FONT_PATH) && fs.existsSync(FONT_SOURCE)) fs.copyFileSync(FONT_SOURCE, FONT_PATH);

const FONT_FAMILY = "PatrickHand";

if (fs.existsSync(FONT_PATH)) {
  try {
    registerFont(FONT_PATH, { family: FONT_FAMILY });
  } catch (e) {
    console.error("Gagal load font PatrickHand:", e.message);
  }
}

async function ensureBackground() {
  if (fs.existsSync(BG_PATH)) return;
  const res = await axios.get(BG_URL, { responseType: "arraybuffer", timeout: 15000 });
  fs.writeFileSync(BG_PATH, Buffer.from(res.data));
}

function wrapText(ctx, text, maxWidth) {
  const paragraphs = String(text).split("\n");
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/);
    let line = "";
    for (const word of words) {
      const testLine = line ? line + " " + word : word;
      if (ctx.measureText(testLine).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export default {
  name: "Nulis",
  description: "Teks ke gambar tulisan tangan di atas kertas notebook",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["text"],

  paramsSchema: {
    text: {
      type: "string",
      required: true,
      default: "Halo, ini contoh tulisan tangan.",
      description: "Teks yang akan ditulis",
    },
  },

  async run(req, res) {
    try {
      const { text } = { ...req.query, ...req.body };

      if (!text || !text.trim()) {
        return res.status(400).json({ status: false, message: "Parameter 'text' wajib diisi" })
      }

      await ensureBackground();

      if (!fs.existsSync(BG_PATH)) {
        throw new Error("Background tidak tersedia")
      }
      if (!fs.existsSync(FONT_PATH)) {
        throw new Error("Font PatrickHand tidak tersedia")
      }

      const bg = await loadImage(BG_PATH);
      const canvas = createCanvas(bg.width, bg.height);
      const ctx = canvas.getContext("2d");

      ctx.drawImage(bg, 0, 0, bg.width, bg.height);

      const FONT_SIZE = 42;
      const LINE_HEIGHT = 56;
      const START_X = 170;
      const START_Y = 310;
      const MAX_WIDTH = 790;

      ctx.font = `${FONT_SIZE}px "${FONT_FAMILY}"`;
      ctx.fillStyle = "#444444";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";

      const lines = wrapText(ctx, text, MAX_WIDTH);
      let y = START_Y;
      for (const line of lines) {
        if (y + LINE_HEIGHT > bg.height - 100) break;
        ctx.fillText(line, START_X, y);
        y += LINE_HEIGHT;
      }

      const buffer = canvas.toBuffer("image/png");
      res.set("Content-Type", "image/png");
      res.set("X-Art", "nulis");
      res.send(buffer);
    } catch (err) {
      res.status(500).json({ status: false, message: err.message })
    }
  }
}