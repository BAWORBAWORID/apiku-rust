/**
 * Brat Vermeil — image generator with centered text on Vermeil template
 * Uses @napi-rs/canvas
 *
 * GET  /api/canvas/brat-vermeil?text=Watashi+wa+Verumei
 * POST /api/canvas/brat-vermeil -d {"text":"Watashi wa Verumei"}
 */

import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ESM __dirname — points to api/canvas/ folder
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const BRAT_IMAGE_URL = "https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/Brat/Vermile.jpg";
const BRAT_FONT_URL  = "https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/Brat/Poppins.ttf";
// Local fallback paths (auto-resolved relative to this file)
const LOCAL_IMAGE_PATH = path.join(__dirname, "assets", "Vermile.jpg");
const LOCAL_FONT_PATH = path.join(__dirname, "assets", "Poppins.ttf");

const CANVAS_SIZE = { width: 1254, height: 1254 };
const SAFE_ZONE   = { a: 655, b: 1118, c: 282, d: 993 };
const TEXT_STYLE  = {
  fontFamily: "Poppins",
  maxFontSize: 90,
  minFontSize: 22,
  lineHeight: 1.18,
  color: "#111111",
  align: "center"
};

let fontLoaded = false;

async function ensureFont() {
  if (fontLoaded) return;
  let buf;
  try {
    const res = await fetch(BRAT_FONT_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if (fs.existsSync(LOCAL_FONT_PATH)) {
      console.warn(`[BratVermeil] Font fetch failed (${err.message}); using local fallback ${LOCAL_FONT_PATH}`);
      buf = fs.readFileSync(LOCAL_FONT_PATH);
    } else {
      throw new Error(`Font download failed (remote err: ${err.message}; local fallback missing at ${LOCAL_FONT_PATH})`);
    }
  }
  GlobalFonts.register(buf, TEXT_STYLE.fontFamily);
  fontLoaded = true;
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getSafeRect(zone) {
  return {
    x: zone.c, y: zone.a,
    w: zone.d - zone.c, h: zone.b - zone.a,
    centerX: (zone.c + zone.d) / 2,
    centerY: (zone.a + zone.b) / 2
  };
}

function setFont(ctx, size) {
  ctx.font = `${size}px ${TEXT_STYLE.fontFamily}`;
}

function splitLongWord(ctx, word, maxWidth) {
  const chars = [...word];
  const parts = [];
  let current = "";
  for (const char of chars) {
    const test = current + char;
    if (ctx.measureText(test).width <= maxWidth || !current) {
      current = test;
    } else {
      parts.push(current);
      current = char;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function wrapParagraph(ctx, paragraph, maxWidth) {
  const words = paragraph.split(" ").filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) { current = test; continue; }
    if (current) { lines.push(current); current = ""; }
    if (ctx.measureText(word).width <= maxWidth) {
      current = word;
    } else {
      const parts = splitLongWord(ctx, word, maxWidth);
      lines.push(...parts.slice(0, -1));
      current = parts.at(-1) || "";
    }
  }
  if (current) lines.push(current);
  return lines;
}

function wrapText(ctx, text, maxWidth) {
  return text.split("\n").flatMap(paragraph => {
    const clean = paragraph.trim();
    return clean ? wrapParagraph(ctx, clean, maxWidth) : [""];
  });
}

function fitText(ctx, text, rect) {
  for (let size = TEXT_STYLE.maxFontSize; size >= TEXT_STYLE.minFontSize; size--) {
    setFont(ctx, size);
    const lineHeight = Math.ceil(size * TEXT_STYLE.lineHeight);
    const lines = wrapText(ctx, text, rect.w);
    if (lines.length * lineHeight <= rect.h) {
      return { size, lines, lineHeight, totalHeight: lines.length * lineHeight };
    }
  }
  const size = TEXT_STYLE.minFontSize;
  setFont(ctx, size);
  const lineHeight = Math.ceil(size * TEXT_STYLE.lineHeight);
  const lines = wrapText(ctx, text, rect.w);
  const maxLines = Math.max(1, Math.floor(rect.h / lineHeight));
  const clipped = lines.slice(0, maxLines);
  if (lines.length > maxLines && clipped.length) {
    let last = clipped[clipped.length - 1];
    while (last.length > 0 && ctx.measureText(`${last}...`).width > rect.w) last = last.slice(0, -1);
    clipped[clipped.length - 1] = `${last}...`;
  }
  return { size, lines: clipped, lineHeight, totalHeight: clipped.length * lineHeight };
}

function drawCenteredText(ctx, text, zone) {
  const rect = getSafeRect(zone);
  const fitted = fitText(ctx, text, rect);
  const startY = rect.y + (rect.h - fitted.totalHeight) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  setFont(ctx, fitted.size);
  ctx.fillStyle = TEXT_STYLE.color;
  ctx.textAlign = TEXT_STYLE.align;
  ctx.textBaseline = "top";
  fitted.lines.forEach((line, i) => {
    ctx.fillText(line, rect.centerX, startY + i * fitted.lineHeight);
  });
  ctx.restore();
}

async function generateBratImage(text) {
  await ensureFont();

  let imgBuf;
  try {
    const imgRes = await fetch(BRAT_IMAGE_URL);
    if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
    imgBuf = Buffer.from(await imgRes.arrayBuffer());
  } catch (err) {
    if (fs.existsSync(LOCAL_IMAGE_PATH)) {
      console.warn(`[BratVermeil] Image fetch failed (${err.message}); using local fallback ${LOCAL_IMAGE_PATH}`);
      imgBuf = fs.readFileSync(LOCAL_IMAGE_PATH);
    } else {
      throw new Error(`Image download failed (remote err: ${err.message}; local fallback missing at ${LOCAL_IMAGE_PATH})`);
    }
  }
  const image = await loadImage(imgBuf);

  const canvas = createCanvas(CANVAS_SIZE.width, CANVAS_SIZE.height);
  const ctx = canvas.getContext("2d");

  ctx.drawImage(image, 0, 0, CANVAS_SIZE.width, CANVAS_SIZE.height);
  drawCenteredText(ctx, text, SAFE_ZONE);

  return await canvas.encode("png");
}

export default {
  name: "Brat Vermeil",
  description: "Generate gambar Vermeil dengan teks custom — auto center, auto wrap, auto resize font",
  category: "Canvas",
  methods: ["GET", "POST"],
  params: ["text"],
  paramsSchema: {
    text: {
      type: "string", required: true,
      description: "Teks yang akan ditampilkan di gambar Vermeil"
    }
  },

  async run(req, res) {
    try {
      const { text } = { ...req.query, ...req.body };

      if (!text || !String(text).trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'text' wajib diisi"
        });
      }

      const normalized = normalizeText(String(text));
      const buffer = await generateBratImage(normalized);

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message
      });
    }
  }
};
