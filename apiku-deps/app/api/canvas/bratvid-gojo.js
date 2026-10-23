import { createCanvas, loadImage, registerFont } from "canvas";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

// ESM __dirname — points to api/canvas/ folder
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const BRAT_IMAGE_URL = "https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/Brat/Gojo.jpeg";
const BRAT_FONT_URL  = "https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/Brat/Poppins.ttf";
// Local fallback paths (auto-resolved relative to this file)
const LOCAL_IMAGE_PATH = path.join(__dirname, "assets", "Gojo.jpeg");
const LOCAL_FONT_PATH = path.join(__dirname, "assets", "Poppins.ttf");

const CANVAS_SIZE = { width: 1254, height: 1254 };
const SAFE_ZONE   = { a: 660, b: 1180, c: 270, d: 990 };
const TEXT_STYLE  = {
  fontFamily: "PoppinsBratVid",
  maxFontSize: 90,
  minFontSize: 22,
  lineHeight: 1.18,
  color: "#111111",
  align: "center"
};
const VIDEO_CONFIG = {
  fps: 24,
  width: 512,
  height: 512,
  lyric: {
    maxWordPerLayer: 5,
    frameDuration: 0.7,
    lastFrameDuration: 1.5
  }
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
      console.warn(`[BratvidGojo] Font fetch failed (${err.message}); using local fallback ${LOCAL_FONT_PATH}`);
      buf = fs.readFileSync(LOCAL_FONT_PATH);
    } else {
      throw new Error(`Font download failed (remote err: ${err.message}; local fallback missing at ${LOCAL_FONT_PATH})`);
    }
  }
  const tmpPath = path.join(os.tmpdir(), "PoppinsBratVid.ttf");
  fs.writeFileSync(tmpPath, buf);
  registerFont(tmpPath, { family: TEXT_STYLE.fontFamily });
  fontLoaded = true;
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function tokenize(text) {
  return normalizeText(text)
    .replace(/[,，]/g, " ")
    .split(/\s+/)
    .map(v => v.trim())
    .filter(Boolean);
}

function splitIntoLayers(tokens, maxWordPerLayer) {
  if (!Number.isFinite(maxWordPerLayer) || maxWordPerLayer <= 0) return [tokens];
  const layers = [];
  for (let i = 0; i < tokens.length; i += maxWordPerLayer) {
    layers.push(tokens.slice(i, i + maxWordPerLayer));
  }
  return layers;
}

function buildRevealFrames(text, config) {
  const tokens = tokenize(text);
  const layers = splitIntoLayers(tokens, config.lyric.maxWordPerLayer);
  const frames = [];

  for (const layer of layers) {
    let current = "";
    for (let i = 0; i < layer.length; i++) {
      current += (current ? " " : "") + layer[i];
      frames.push({ text: current, isLastInLayer: i === layer.length - 1 });
    }
  }

  return frames.map(frame => ({
    ...frame,
    duration: frame.isLastInLayer ? config.lyric.lastFrameDuration : config.lyric.frameDuration
  }));
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
  const parts = [];
  let current = "";
  for (const char of [...word]) {
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

async function createFrame(image, text, filePath) {
  const canvas = createCanvas(CANVAS_SIZE.width, CANVAS_SIZE.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, CANVAS_SIZE.width, CANVAS_SIZE.height);
  drawCenteredText(ctx, text, SAFE_ZONE);
  fs.writeFileSync(filePath, canvas.toBuffer("image/png"));
}

function buildManifest(frames, framePaths) {
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    lines.push(`file '${framePaths[i].replace(/'/g, "'\\''")}'`);
    lines.push(`duration ${frames[i].duration}`);
  }
  // ffmpeg concat demuxer requires last file repeated
  lines.push(`file '${framePaths[framePaths.length - 1].replace(/'/g, "'\\''")}'`);
  return lines.join("\n");
}

async function generateBratVid(text, config) {
  await ensureFont();

  const frames = buildRevealFrames(text, config);
  if (!frames.length) throw new Error("Teks kosong");

  let imgBuf;
  try {
    const imgRes = await fetch(BRAT_IMAGE_URL);
    if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
    imgBuf = Buffer.from(await imgRes.arrayBuffer());
  } catch (err) {
    if (fs.existsSync(LOCAL_IMAGE_PATH)) {
      console.warn(`[BratvidGojo] Image fetch failed (${err.message}); using local fallback ${LOCAL_IMAGE_PATH}`);
      imgBuf = fs.readFileSync(LOCAL_IMAGE_PATH);
    } else {
      throw new Error(`Image download failed (remote err: ${err.message}; local fallback missing at ${LOCAL_IMAGE_PATH})`);
    }
  }
  const image = await loadImage(imgBuf);

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "bratvid-"));
  const outputPath = path.join(tmpDir, "output.mp4");

  try {
    const framePaths = frames.map((_, i) =>
      path.join(tmpDir, `frame-${String(i + 1).padStart(4, "0")}.png`)
    );

    // Render frames in batches of 5
    const batchSize = 5;
    for (let start = 0; start < frames.length; start += batchSize) {
      const batch = frames.slice(start, start + batchSize);
      await Promise.all(batch.map((frame, i) =>
        createFrame(image, frame.text, framePaths[start + i])
      ));
    }

    const concatPath = path.join(tmpDir, "concat.txt");
    fs.writeFileSync(concatPath, buildManifest(frames, framePaths));

    await execFileAsync("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatPath,
      "-vf", `fps=${config.fps},scale=${config.width}:${config.height}:flags=lanczos`,
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outputPath
    ], { maxBuffer: 1024 * 1024 * 50 });

    const videoBuffer = fs.readFileSync(outputPath);
    return videoBuffer;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export default {
  name: "Bratvid Gojo",
  description: "Generate video Gojo dengan teks muncul bertahap per kata — auto center, auto wrap, auto resize font",
  category: "Canvas",
  methods: ["GET", "POST"],
  params: ["text", "fps", "width", "height", "maxWordPerLayer", "frameDuration", "lastFrameDuration"],
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Teks yang akan ditampilkan bertahap di video Gojo"
    },
    fps: {
      type: "number",
      required: false,
      description: "Frame rate video (default: 24)"
    },
    width: {
      type: "number",
      required: false,
      description: "Lebar output video dalam pixel (default: 512)"
    },
    height: {
      type: "number",
      required: false,
      description: "Tinggi output video dalam pixel (default: 512)"
    },
    maxWordPerLayer: {
      type: "number",
      required: false,
      description: "Maksimum kata per layer sebelum reset (default: 5)"
    },
    frameDuration: {
      type: "number",
      required: false,
      description: "Durasi tiap frame dalam detik (default: 0.7)"
    },
    lastFrameDuration: {
      type: "number",
      required: false,
      description: "Durasi frame terakhir tiap layer dalam detik (default: 1.5)"
    }
  },

  async run(req, res) {
    try {
      const input = { ...req.query, ...req.body };
      const { text } = input;

      if (!text || !String(text).trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'text' wajib diisi"
        });
      }

      const config = {
        fps:    Math.min(60, Math.max(1, Number(input.fps)    || VIDEO_CONFIG.fps)),
        width:  Math.min(1920, Math.max(64, Number(input.width)  || VIDEO_CONFIG.width)),
        height: Math.min(1920, Math.max(64, Number(input.height) || VIDEO_CONFIG.height)),
        lyric: {
          maxWordPerLayer:  Math.min(20, Math.max(1, Number(input.maxWordPerLayer)  || VIDEO_CONFIG.lyric.maxWordPerLayer)),
          frameDuration:    Math.max(0.05, Number(input.frameDuration)    || VIDEO_CONFIG.lyric.frameDuration),
          lastFrameDuration: Math.max(0.05, Number(input.lastFrameDuration) || VIDEO_CONFIG.lyric.lastFrameDuration)
        }
      };

      const normalized = normalizeText(String(text));
      const videoBuffer = await generateBratVid(normalized, config);

      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Length", videoBuffer.length);
      res.setHeader("Content-Disposition", "inline; filename=\"bratvid-gojo.mp4\"");
      res.send(videoBuffer);
    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message
      });
    }
  }
};
