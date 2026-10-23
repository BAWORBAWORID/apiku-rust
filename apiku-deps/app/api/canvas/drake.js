/**
 * Drake Hotline Bling Meme Canvas Generator
 * Converted from Ditzzx Snippet (https://gist.ditzzzx.my.id/code/drake-meme.js)
 *
 * @route {GET|POST} /api/canvas/drake
 */

import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../../src/utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_DIR = path.join(__dirname, "assets", "drake");
const FONTS_DIR = path.join(ASSETS_DIR, "fonts");
const BG_PATH = path.join(ASSETS_DIR, "Drake-Hotline-Bling.jpg");
const FONT_PATH = path.join(FONTS_DIR, "arial.ttf");

const BG_URL = "https://imgflip.com/s/meme/Drake-Hotline-Bling.jpg";
const FONT_URL = "https://cdn.jsdelivr.net/gh/wolfsonliu/web_typography/fonts/arial.ttf";
const CANVAS_SIZE = { width: 1200, height: 1200 };

async function downloadAsset(url, dest) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
  });
  if (!res.ok) throw new Error(`Fetch failed ${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.writeFile(dest, buf);
  return buf;
}

let assetsPrepared = false;
async function ensureAssets() {
  if (assetsPrepared) return;
  
  if (!fs.existsSync(FONT_PATH)) {
    await downloadAsset(FONT_URL, FONT_PATH);
  }
  GlobalFonts.registerFromPath(FONT_PATH, "ARIAL");

  if (!fs.existsSync(BG_PATH)) {
    await downloadAsset(BG_URL, BG_PATH);
  }
  
  assetsPrepared = true;
}

function drawTextInSafeZone(ctx, text, zone, initialFontSize, fontFamily, align) {
  let fontSize = initialFontSize;
  let lh = fontSize * 1.2;
  let out = [];
  let minSize = 10;
  
  while (fontSize >= minSize) {
    ctx.font = `400 ${fontSize}px ${fontFamily}`;
    lh = fontSize * 1.2;
    out = [];
    let fitsWidth = true;

    text.split("\n").forEach(p => {
      let cur = "";
      p.split(" ").forEach(w => {
        const t = cur ? cur + " " + w : w;
        if (ctx.measureText(t).width > zone.w && cur) { 
          out.push(cur); 
          cur = w; 
        } else {
          cur = t;
        }
      });
      out.push(cur);
    });

    for (const line of out) {
      if (ctx.measureText(line).width > zone.w) {
        fitsWidth = false;
        break;
      }
    }

    if (fitsWidth && (out.length * lh) <= zone.h) {
      break;
    }
    fontSize -= 2;
  }

  if (fontSize < minSize) {
    fontSize = minSize;
    ctx.font = `400 ${fontSize}px ${fontFamily}`;
    lh = fontSize * 1.2;
  }

  const drawX = align === "center" ? zone.x + zone.w / 2 : align === "right" ? zone.x + zone.w : zone.x;
  
  ctx.save();
  ctx.beginPath();
  ctx.rect(zone.x, zone.y, zone.w, zone.h);
  ctx.clip();
  
  const startY = zone.y + zone.h / 2 - (out.length * lh) / 2 + lh / 2;
  out.forEach((l, i) => {
    ctx.fillText(l, drawX, startY + i * lh);
  });
  ctx.restore();
}

export default {
  name: "Drake Meme",
  description: "Generate 2-panel Drake Hotline Bling meme image",
  category: "Canvas",
  methods: ["GET", "POST"],
  params: ["text1", "text2"],
  paramsSchema: {
    text1: { type: "string", required: true, description: "Teks panel atas (menolak/disapprove)", example: "Femboy" },
    text2: { type: "string", required: true, description: "Teks panel bawah (menyetujui/approve)", example: "Tomboy" }
  },

  async run(req, res) {
    try {
      const { text1, text2, teks1, teks2 } = { ...req.query, ...req.body };
      const t1 = text1 || teks1 || "Femboy";
      const t2 = text2 || teks2 || "Tomboy";

      await ensureAssets();

      const canvas = createCanvas(CANVAS_SIZE.width, CANVAS_SIZE.height);
      const ctx = canvas.getContext("2d");

      const bgImg = await loadImage(BG_PATH);
      ctx.drawImage(bgImg, 0, 0, CANVAS_SIZE.width, CANVAS_SIZE.height);

      ctx.save();
      const safeZone_el1 = { x: 615, y: 22, w: 571, h: 564 };
      ctx.fillStyle = "#111111";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      drawTextInSafeZone(ctx, t1, safeZone_el1, 110, "ARIAL, sans-serif", "center");
      ctx.restore();

      ctx.save();
      const safeZone_el2 = { x: 615, y: 623, w: 571, h: 561 };
      ctx.fillStyle = "#111111";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      drawTextInSafeZone(ctx, t2, safeZone_el2, 110, "ARIAL, sans-serif", "center");
      ctx.restore();

      const pngBuffer = await canvas.encode("png");

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", pngBuffer.length);
      res.setHeader("Cache-Control", "public, max-age=3600");
      
      return res.send(pngBuffer);
    } catch (error) {
      logger.error(`[DrakeMeme] Error: ${error.message}`);
      return res.status(500).json({
        status: false,
        message: error.message || "Failed to generate Drake meme"
      });
    }
  }
};
