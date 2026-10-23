import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createCanvas, loadImage, registerFont } from "canvas";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Per-endpoint assets (offline-first, pre-populated in api/maker/assets/motivasi/)
const ASSETS_DIR = path.join(__dirname, "assets", "motivasi");
const FONT_PATH = path.join(ASSETS_DIR, "PatrickHand-Regular.ttf");
const BG_PATH = path.join(ASSETS_DIR, "738395416_rafaofficial.jpg");

// Register Font
if (fs.existsSync(FONT_PATH)) {
    try {
        registerFont(FONT_PATH, { family: "QuoteFont" });
        global.__fakemoviFont = "QuoteFont";
    } catch (e) {
        console.error("Gagal load font custom:", e.message);
        global.__fakemoviFont = "sans-serif";
    }
} else {
    global.__fakemoviFont = "sans-serif";
}

const FONT_FAMILY = global.__fakemoviFont;

export default {
  name: "Fake Motivasi",
  description: "Membuat gambar fake motivasi quotes secara otomatis",
  category: "Maker",
  methods: ["GET"],
  params: ["quote", "author"],
  paramsSchema: {
    quote: {
      type: "string",
      required: true,
      description: "Teks motivasi atau quote",
      example: "Tidak selalu hidup berjalan dengan baik"
    },
    author: {
      type: "string",
      required: false,
      description: "Nama author atau username di pojok bawah",
      example: "@Zyyvor"
    }
  },

  async run(req, res) {
    try {
      let { quote, author } = { ...req.query, ...req.body };

      if (!quote || quote.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'quote' wajib diisi"
        });
      }

      quote = quote.trim();
      author = author ? author.trim() : "@Zyyvor";

      // Load background hard-fail if missing (offline-first, no network fallback per user spec)
      if (!fs.existsSync(BG_PATH)) {
        throw new Error(`Template background missing: ${BG_PATH}. Place 738395416_rafaofficial.jpg in api/maker/assets/motivasi/.`);
      }
      const bg = await loadImage(BG_PATH);

      const canvas = createCanvas(bg.width, bg.height);
      const ctx = canvas.getContext("2d");

      ctx.drawImage(bg, 0, 0, bg.width, bg.height);

      // ========================
      // TEKS QUOTE (warna coklat tua, gaya handwriting)
      // ========================
      const CENTER_X = 540;
      const CENTER_Y = 560;
      const MAX_WIDTH = 650;
      const MAX_HEIGHT = 240;

      function wrapText(ctx, text, maxWidth) {
        const words = text.trim().split(/\s+/);
        let lines = [];
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

      let fontSize = 64;
      let lines = [];
      while (fontSize >= 28) {
        ctx.font = `${fontSize}px "${FONT_FAMILY}"`;
        lines = wrapText(ctx, quote, MAX_WIDTH);
        const lineHeight = fontSize * 1.15;
        const totalHeight = lines.length * lineHeight;
        if (totalHeight <= MAX_HEIGHT) break;
        fontSize -= 2;
      }

      ctx.font = `${fontSize}px "${FONT_FAMILY}"`;
      ctx.fillStyle = "#733A25";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const lineHeight = fontSize * 1.15;
      const totalHeight = lines.length * lineHeight;
      const startY = CENTER_Y - totalHeight / 2 + lineHeight / 2;

      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], CENTER_X, startY + i * lineHeight);
      }

      // ========================
      // AUTHOR / USERNAME (lebih kecil, warna oranye-coklat)
      // ========================
      ctx.font = `36px "${FONT_FAMILY}"`;
      ctx.fillStyle = "#7F4C1D";
      ctx.textAlign = "center";
      ctx.fillText(author, CENTER_X, 935);

      const buffer = canvas.toBuffer("image/png");

      res.set("Content-Type", "image/png");
      res.send(buffer);

    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message
      });
    }
  }
};
