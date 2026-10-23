import { createCanvas, registerFont } from "canvas";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../../src/utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FONT_PATH = path.join(__dirname, "assets", "quotecard", "fonts", "Lora-Regular.ttf");
const FONT_ITALIC_PATH = path.join(__dirname, "assets", "quotecard", "fonts", "Lora-Italic.ttf");

let fontReady = false;

function ensureFonts() {
  if (fontReady) return;
  if (!existsSync(FONT_PATH) || !existsSync(FONT_ITALIC_PATH)) {
    logger.error("[QuoteCard] Font files missing from assets/quotecard/fonts/");
    return;
  }
  registerFont(FONT_PATH, { family: "QuoteFont", weight: "normal" });
  registerFont(FONT_ITALIC_PATH, { family: "QuoteFont", style: "italic" });
  fontReady = true;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawSparkle(ctx, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.bezierCurveTo(cx + r * 0.1, cy - r * 0.1, cx + r * 0.1, cy - r * 0.1, cx + r, cy);
  ctx.bezierCurveTo(cx + r * 0.1, cy + r * 0.1, cx + r * 0.1, cy + r * 0.1, cx, cy + r);
  ctx.bezierCurveTo(cx - r * 0.1, cy + r * 0.1, cx - r * 0.1, cy + r * 0.1, cx - r, cy);
  ctx.bezierCurveTo(cx - r * 0.1, cy - r * 0.1, cx - r * 0.1, cy - r * 0.1, cx, cy - r);
  ctx.closePath();
  ctx.fillStyle = "#fbdfa6";
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.05);
  ctx.strokeStyle = "#3d2417";
  ctx.stroke();
  ctx.restore();
}

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
  name: "QuoteCard",
  description: "Generate quote card with gradient background, elegant typography, and decorative elements",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["text", "author"],
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Teks kutipan",
      example: "Jangan ragu menggapai bintang",
    },
    author: {
      type: "string",
      required: false,
      default: "@Zyyvor",
      description: "Nama penulis",
      example: "@reallygreatsite",
    },
  },

  async run(req, res) {
    try {
      ensureFonts();
      const FONT_FAMILY = fontReady ? "QuoteFont" : "serif";

      let { text, author } = { ...req.query, ...req.body };

      if (!text) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'text' wajib diisi",
        });
      }

      let quote = text.trim();
      if (author) {
        author = author.trim();
      } else if (quote.includes(",")) {
        const parts = quote.split(",");
        quote = parts[0].trim();
        author = parts.slice(1).join(",").trim() || "";
      } else {
        author = "@Zyyvor";
      }

      const W = 720;
      const H = 1280;
      const canvas = createCanvas(W, H);
      const ctx = canvas.getContext("2d");

      const grad = ctx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, "#cdbce8");
      grad.addColorStop(0.25, "#9c7fb5");
      grad.addColorStop(0.5, "#8a6b86");
      grad.addColorStop(0.75, "#a87a5e");
      grad.addColorStop(1, "#c08f4f");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = "#3d2417";
      ctx.beginPath();
      ctx.ellipse(0, H, W * 0.55, H * 0.25, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(W, 0, W * 0.5, H * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const cardX = W * 0.076;
      const cardY = H * 0.206;
      const cardW = W * 0.847;
      const cardH = H * 0.471;
      const radius = W * 0.045;

      roundRect(ctx, cardX, cardY, cardW, cardH, radius);
      ctx.fillStyle = "#f6f3ee";
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#3d2417";
      ctx.stroke();

      const capW = cardW * 0.165;
      const capH = cardH * 0.085;
      const capX = cardX + cardW * 0.04;
      const capY = cardY - capH * 0.55;
      roundRect(ctx, capX, capY, capW, capH, capH / 2);
      ctx.fillStyle = "#fbdfa6";
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#3d2417";
      ctx.stroke();

      ctx.font = `bold ${Math.floor(capH * 0.65)}px Georgia`;
      ctx.fillStyle = "#3d2417";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("\u201D", capX + capW / 2, capY + capH / 2 + capH * 0.05);

      drawSparkle(ctx, cardX + cardW - cardW * 0.045, cardY + cardH * 0.04, cardW * 0.038);
      drawSparkle(ctx, cardX + cardW * 0.06, cardY + cardH - cardH * 0.02, cardW * 0.042);

      const paddingX = cardW * 0.12;
      const MAX_WIDTH = cardW - paddingX * 2;
      const MAX_HEIGHT = cardH * 0.58;

      let fontSize = Math.floor(cardW * 0.105);
      let lines = [];

      while (fontSize >= 22) {
        ctx.font = `bold ${fontSize}px "${FONT_FAMILY}"`;
        lines = wrapText(ctx, quote, MAX_WIDTH);
        const lineHeight = fontSize * 1.18;
        const totalHeight = lines.length * lineHeight;
        if (totalHeight <= MAX_HEIGHT) break;
        fontSize -= 2;
      }

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const lineHeight = fontSize * 1.18;
      const totalHeight = lines.length * lineHeight;
      const CENTER_X = cardX + cardW / 2;
      const textBlockCenterY = cardY + cardH * 0.36;
      const startY = textBlockCenterY - totalHeight / 2 + lineHeight / 2;

      ctx.fillStyle = "#1a120a";
      for (let i = 0; i < lines.length; i++) {
        const isLast = i === lines.length - 1 && lines.length > 1;
        ctx.font = `${isLast ? "bold italic" : "bold"} ${fontSize}px "${FONT_FAMILY}"`;
        ctx.fillText(lines[i], CENTER_X, startY + i * lineHeight);
      }

      const dividerY = cardY + cardH * 0.685;
      ctx.strokeStyle = "#1a120a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cardX + cardW * 0.12, dividerY);
      ctx.lineTo(cardX + cardW - cardW * 0.12, dividerY);
      ctx.stroke();

      const authorSize = Math.floor(fontSize * 0.46);
      ctx.font = `italic ${authorSize}px "${FONT_FAMILY}"`;
      ctx.textAlign = "center";
      ctx.fillStyle = "#1a120a";
      ctx.fillText(author, CENTER_X, dividerY + cardH * 0.085);

      const btnW = cardW * 0.56;
      const btnH = H * 0.055;
      const btnX = W / 2 - btnW / 2;
      const btnY = cardY + cardH + H * 0.085;

      roundRect(ctx, btnX, btnY, btnW, btnH, btnH / 2);
      ctx.fillStyle = "#fbdfa6";
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#3d2417";
      ctx.stroke();

      ctx.font = `italic bold ${Math.floor(btnH * 0.38)}px "${FONT_FAMILY}"`;
      ctx.textAlign = "center";
      ctx.fillStyle = "#1a120a";
      ctx.fillText("Bagikan kutipan", W / 2, btnY + btnH / 2 + btnH * 0.04);

      const buffer = canvas.toBuffer("image/png");

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", buffer.length);
      return res.send(buffer);
    } catch (err) {
      logger.error(`[QuoteCard] ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Failed to generate quote card",
      });
    }
  },
};
