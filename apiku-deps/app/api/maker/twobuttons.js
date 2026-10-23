/**
 * TWO BUTTONS MEME CANVAS GENERATOR
 * 
 * Generate meme "Two Buttons" dari gambar template dengan 3 teks kustom.
 * Dilengkapi auto-resize text dan safe-zone bounding box.
 * Menggunakan @napi-rs/canvas + font lokal mandiri di assets/twobuttons/
 *
 * @route {GET|POST} /api/maker/twobuttons
 */

import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../../src/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_DIR = path.join(__dirname, 'assets', 'twobuttons');
const FONTS_DIR = path.join(ASSETS_DIR, 'fonts');
const BG_PATH = path.join(ASSETS_DIR, 'Two-Buttons.jpg');

const fontCandidate1 = path.join(FONTS_DIR, 'arial.ttf');
const fontCandidate2 = path.join(FONTS_DIR, 'impact.ttf');

let fontsRegistered = false;
function ensureFonts() {
  if (!fontsRegistered) {
    if (fs.existsSync(fontCandidate1)) {
      GlobalFonts.registerFromPath(fontCandidate1, 'ARIAL');
    }
    if (fs.existsSync(fontCandidate2)) {
      GlobalFonts.registerFromPath(fontCandidate2, 'impact');
    }
    fontsRegistered = true;
  }
}

function drawTextInSafeZone(ctx, text, zone, initialFontSize, fontFamily, align, outlineColor, outlineWidth) {
  let fontSize = initialFontSize;
  let lh = fontSize * 1.2;
  let out = [];
  let minSize = 10;
  
  while (fontSize >= minSize) {
    ctx.font = `400 ${fontSize}px ${fontFamily}`;
    lh = fontSize * 1.2;
    out = [];
    let fitsWidth = true;

    text.split('\n').forEach(p => {
      let cur = '';
      p.split(' ').forEach(w => {
        const t = cur ? cur + ' ' + w : w;
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

  const drawX = align === 'center' ? zone.x + zone.w / 2 : align === 'right' ? zone.x + zone.w : zone.x;
  
  ctx.save();
  ctx.beginPath();
  ctx.rect(zone.x, zone.y, zone.w, zone.h);
  ctx.clip();
  
  const startY = zone.y + zone.h / 2 - (out.length * lh) / 2 + lh / 2;
  out.forEach((l, i) => {
    if (outlineColor) {
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = outlineWidth * (fontSize / initialFontSize);
      ctx.strokeText(l, drawX, startY + i * lh);
    }
    ctx.fillText(l, drawX, startY + i * lh);
  });
  ctx.restore();
}

export default {
  name: "Two Buttons Meme",
  description: "Generator meme 'Two Buttons' merah dengan teks kustom dan auto-resize text",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["teks1", "teks2", "teks3"],

  paramsSchema: {
    teks1: {
      type: "string",
      required: true,
      description: "Teks pada tombol merah kiri",
      example: "Red Bull"
    },
    teks2: {
      type: "string",
      required: true,
      description: "Teks pada tombol merah kanan",
      example: "Mercedes"
    },
    teks3: {
      type: "string",
      required: true,
      description: "Teks caption karakter di bawah",
      example: "GWH"
    }
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      ensureFonts();

      const params = { ...req.query, ...req.body };
      const { teks1, teks2, teks3 } = params;

      if (!teks1 || !teks2 || !teks3) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'teks1', 'teks2', dan 'teks3' wajib diisi",
          example: {
            get: "/api/maker/twobuttons?teks1=Red+Bull&teks2=Mercedes&teks3=GWH",
            post: { teks1: "Red Bull", teks2: "Mercedes", teks3: "GWH" }
          }
        });
      }

      if (!fs.existsSync(BG_PATH)) {
        throw new Error("Template image Two-Buttons.jpg missing in assets/twobuttons");
      }

      const CANVAS_SIZE = { width: 600, height: 908 };
      const canvas = createCanvas(CANVAS_SIZE.width, CANVAS_SIZE.height);
      const ctx = canvas.getContext('2d');

      const bgBuffer = await fs.promises.readFile(BG_PATH);
      const bgImg = await loadImage(bgBuffer);
      ctx.drawImage(bgImg, 0, 0, CANVAS_SIZE.width, CANVAS_SIZE.height);

      // Teks 1 (Tombol Kiri)
      ctx.save();
      ctx.translate(153, 135);
      ctx.rotate(-0.261799);
      ctx.translate(-153, -135);
      const safeZone_el1 = { x: 69, y: 108, w: 168, h: 54 };
      ctx.fillStyle = '#111111';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      drawTextInSafeZone(ctx, String(teks1), safeZone_el1, 60, 'ARIAL, sans-serif', 'center');
      ctx.restore();

      // Teks 2 (Tombol Kanan)
      ctx.save();
      ctx.translate(348, 97.5);
      ctx.rotate(-0.191986);
      ctx.translate(-348, -97.5);
      const safeZone_el2 = { x: 275, y: 76, w: 146, h: 43 };
      ctx.fillStyle = '#111111';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      drawTextInSafeZone(ctx, String(teks2), safeZone_el2, 50, 'ARIAL, sans-serif', 'center');
      ctx.restore();

      // Teks 3 (Caption Bawah)
      ctx.save();
      const safeZone_el3 = { x: 28, y: 796, w: 542, h: 66 };
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      drawTextInSafeZone(ctx, String(teks3), safeZone_el3, 60, 'impact, sans-serif', 'center', '#000000', 8);
      ctx.restore();

      const buffer = await canvas.encode('png');
      const duration = Date.now() - startTime;

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('X-Generated-In', `${duration}ms`);
      res.setHeader('X-Generator', 'twobuttons-meme');
      return res.send(buffer);

    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[TwoButtons] Generation failed after ${duration}ms: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: "Failed to generate Two Buttons meme image",
        error: err.message
      });
    }
  }
};
