import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.join(__dirname, "assets", "jarvismeme");
const BG_PATH = path.join(ASSETS_DIR, "jarvismeme.png");
const FONT_PATH = path.join(ASSETS_DIR, "ArialBd.ttf");

GlobalFonts.registerFromPath(FONT_PATH, "ARIALBD");

const CANVAS_SIZE = { width: 735, height: 678 };

function drawTextInSafeZone(ctx, text, zone, initialFontSize, align) {
  let fontSize = initialFontSize;
  let lines = [];
  let lh = fontSize * 1.2;

  while (fontSize > 10) {
    lh = fontSize * 1.2;
    ctx.font = `500 ${fontSize}px ARIALBD, sans-serif`;
    lines = [];
    let fits = true;

    const paragraphs = text.split("\n");
    for (const p of paragraphs) {
      let cur = "";
      const words = p.split(" ");

      for (const w of words) {
        const t = cur ? cur + " " + w : w;
        if (ctx.measureText(t).width > zone.w) {
          if (cur) {
            lines.push(cur);
            cur = w;
            if (ctx.measureText(w).width > zone.w) {
              fits = false;
              break;
            }
          } else {
            fits = false;
            break;
          }
        } else {
          cur = t;
        }
      }
      if (!fits) break;
      lines.push(cur);
    }

    if (fits && lines.length * lh <= zone.h) break;
    fontSize -= 2;
  }

  ctx.font = `500 ${fontSize}px ARIALBD, sans-serif`;
  ctx.fillStyle = "#111111";
  ctx.textBaseline = "middle";
  ctx.textAlign = align;

  const drawX = align === "center" ? zone.x + zone.w / 2 : align === "right" ? zone.x + zone.w : zone.x;

  ctx.save();
  ctx.beginPath();
  ctx.rect(zone.x, zone.y, zone.w, zone.h);
  ctx.clip();

  const startY = zone.y + zone.h / 2 - (lines.length * lh) / 2 + lh / 2;
  lines.forEach((l, i) => ctx.fillText(l, drawX, startY + i * lh));
  ctx.restore();
}

export default {
  name: "Jarvis Meme",
  description: "Generate Jarvis meme image with custom text",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["text"],
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Text to display on the meme",
      example: "Jarvis, tolong diapakan dulu apa itu biar ga apa kali",
      minLength: 1,
      maxLength: 500,
    },
  },
  async run(req, res) {
    const { text } = { ...req.query, ...req.body };

    if (!text) {
      return res.status(400).json({ status: false, error: "Parameter 'text' is required" });
    }

    try {
      const bgImg = await loadImage(BG_PATH);
      const canvas = createCanvas(CANVAS_SIZE.width, CANVAS_SIZE.height);
      const ctx = canvas.getContext("2d");

      ctx.clearRect(0, 0, CANVAS_SIZE.width, CANVAS_SIZE.height);
      ctx.drawImage(bgImg, 0, 0, CANVAS_SIZE.width, CANVAS_SIZE.height);

      const safeZone = { x: 20, y: 3, w: 695, h: 237 };
      drawTextInSafeZone(ctx, text, safeZone, 100, "center");

      const pngBuffer = canvas.toBuffer("image/png");
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(pngBuffer);
    } catch (err) {
      res.status(500).json({ status: false, error: "Failed to generate image", details: err.message });
    }
  },
};
