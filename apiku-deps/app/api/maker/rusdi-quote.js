import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Register Courier Prime font if available
const FONTS_DIR = path.join(process.cwd(), 'fonts');
try {
  const fullPath = path.join(FONTS_DIR, 'Courier Prime.ttf');
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).size > 0) {
    GlobalFonts.registerFromPath(fullPath, 'CourierPrime');
  }
} catch {}

// Try register fonts from quotecard assets as fallback
try {
  const loraPath = path.join(__dirname, 'assets', 'quotecard', 'fonts', 'Lora-Regular.ttf');
  if (fs.existsSync(loraPath)) {
    GlobalFonts.registerFromPath(loraPath, 'LoraQuote');
  }
} catch {}

const QUOTE_FONT = 'CourierPrime, LoraQuote, "Courier New", monospace';
const AUTHOR_FONT = 'CourierPrime, LoraQuote, "Courier New", monospace';

const OUTPUT_WIDTH = 1280;
const OUTPUT_HEIGHT = 720;
const SCALE = 2;

// Local template image (default jika user tidak kirim URL)
const TEMPLATE_IMG = path.join(__dirname, 'assets', 'rusdi-quote', 'template.jpg');
const CANVAS_WIDTH = OUTPUT_WIDTH * SCALE;
const CANVAS_HEIGHT = OUTPUT_HEIGHT * SCALE;

function fetchImageBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return resolve(fetchImageBuffer(response.headers.location));
      }
      if (response.statusCode !== 200) {
        return reject(new Error(`Download gagal, status ${response.statusCode}`));
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

const SOBEL_X = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
const SOBEL_Y = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

function applySketchEffect(ctx, img, x, y, w, h) {
  ctx.drawImage(img, x, y, w, h);
  const imageData = ctx.getImageData(x, y, w, h);
  const data = imageData.data;
  const width = w;
  const height = h;

  // 1. Grayscale
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  // 2. Sobel edge detection (full 3x3 kernel)
  const edges = new Float32Array(width * height);
  let maxMagnitude = 0;
  for (let yPos = 1; yPos < height - 1; yPos++) {
    for (let xPos = 1; xPos < width - 1; xPos++) {
      let gx = 0, gy = 0, k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const sampleIdx = (yPos + dy) * width + (xPos + dx);
          gx += gray[sampleIdx] * SOBEL_X[k];
          gy += gray[sampleIdx] * SOBEL_Y[k];
          k++;
        }
      }
      const magnitude = Math.sqrt(gx * gx + gy * gy);
      edges[yPos * width + xPos] = magnitude;
      if (magnitude > maxMagnitude) maxMagnitude = magnitude;
    }
  }

  // 3. Normalize + invert (pencil sketch look)
  const output = new Uint8ClampedArray(data.length);
  const scale = maxMagnitude > 0 ? 255 / maxMagnitude : 1;
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const normalized = Math.min(255, edges[i] * scale * 1.6);
    const inverted = 255 - normalized;
    const soft = inverted > 235 ? 255 : inverted;
    output[idx] = soft;
    output[idx + 1] = soft;
    output[idx + 2] = soft;
    output[idx + 3] = 255;
  }

  // 4. Subtle cross-hatch texture
  for (let yPos = 0; yPos < height; yPos += 3) {
    for (let xPos = 0; xPos < width; xPos += 3) {
      const idx = (yPos * width + xPos) * 4;
      if (output[idx] < 120) {
        const hatchNoise = (xPos + yPos) % 6 < 1 ? -8 : 0;
        output[idx] = Math.max(0, output[idx] + hatchNoise);
        output[idx + 1] = output[idx];
        output[idx + 2] = output[idx];
      }
    }
  }

  const imgData = ctx.createImageData(width, height);
  imgData.data.set(output);
  ctx.putImageData(imgData, x, y);
}

function drawQuote(ctx, text, x, y, maxWidth, maxHeight) {
  const words = text.split(' ');
  let lines = [];
  let currentLine = '';
  let fontSize = 32 * SCALE;
  let lineHeight = fontSize * 1.5;

  while (fontSize > 16 * SCALE) {
    ctx.font = `${fontSize}px ${QUOTE_FONT}`;
    lines = [];
    currentLine = '';

    for (const word of words) {
      const testLine = currentLine + word + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && currentLine.length > 0) {
        lines.push(currentLine.trim());
        currentLine = word + ' ';
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine.trim().length > 0) lines.push(currentLine.trim());

    const totalHeight = lines.length * lineHeight;
    if (totalHeight <= maxHeight) break;
    fontSize -= 2 * SCALE;
    lineHeight = fontSize * 1.5;
  }

  ctx.font = `${fontSize}px ${QUOTE_FONT}`;
  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const totalHeight = lines.length * lineHeight;
  const startY = y + Math.max(0, (maxHeight - totalHeight) / 2);

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, startY + i * lineHeight);
  }

  return { lines, totalHeight, fontSize, startY };
}

function drawAuthor(ctx, text, x, y, fontSize) {
  ctx.save();
  ctx.fillStyle = '#333333';
  ctx.font = `${fontSize * 0.7}px ${AUTHOR_FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`— ${text}`, x, y);
  ctx.restore();
}

// ═══════════════════════════════════════════
// API Endpoint Export
// ═══════════════════════════════════════════
export default {
  name: 'Rusdi Quote',
  description: 'Buat gambar sketsa hitam-putih + quote dari foto',
  category: 'Maker',
  methods: ['GET', 'POST'],
  params: ['quote', 'author'],

  paramsSchema: {
    quote: {
      type: 'string',
      required: false,
      default: 'Hidup adalah perjuangan yang indah',
      description: 'Teks quote yang akan ditampilkan',
      example: 'Hidup adalah perjuangan yang indah',
    },
    author: {
      type: 'string',
      required: false,
      default: 'Zyyvor',
      description: 'Nama penulis / author quote',
      example: 'Zyyvor',
    },
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body };
    const quoteText = (params.quote || 'Hidup adalah perjuangan yang indah').slice(0, 300);
    const authorText = params.author;

    try {
      // Load template dari lokal asset
      const img = await loadImage(TEMPLATE_IMG);

      // Create canvas
      const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
      const ctx = canvas.getContext('2d');

      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Left: sketch image (48% width)
      const imgW = Math.round(CANVAS_WIDTH * 0.48);
      const imgH = Math.round((img.height / img.width) * imgW);
      const imgX = 50 * SCALE;
      const imgY = (CANVAS_HEIGHT - imgH) / 2;

      applySketchEffect(ctx, img, imgX, imgY, imgW, imgH);

      // Divider line
      const lineX = imgX + imgW + 40 * SCALE;
      ctx.save();
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 2 * SCALE;
      ctx.beginPath();
      ctx.moveTo(lineX, 60 * SCALE);
      ctx.lineTo(lineX, CANVAS_HEIGHT - 60 * SCALE);
      ctx.stroke();
      ctx.restore();

      // Right: quote text
      const quoteX = lineX + 50 * SCALE;
      const quoteY = 100 * SCALE;
      const maxW = CANVAS_WIDTH - quoteX - 50 * SCALE;
      const maxH = CANVAS_HEIGHT - 220 * SCALE;

      drawQuote(ctx, quoteText, quoteX, quoteY, maxW, maxH);

      // Author
      const authorY = CANVAS_HEIGHT - 50 * SCALE;
      drawAuthor(ctx, authorText, CANVAS_WIDTH - 50 * SCALE, authorY, 30 * SCALE);

      // Downscale to output resolution (anti-aliased)
      const finalCanvas = createCanvas(OUTPUT_WIDTH, OUTPUT_HEIGHT);
      const finalCtx = finalCanvas.getContext('2d');
      finalCtx.imageSmoothingEnabled = true;
      finalCtx.imageSmoothingQuality = 'high';
      finalCtx.drawImage(canvas, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);

      const buffer = await finalCanvas.encode('png');

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', 'inline; filename="rusdi-quote.png"');
      return res.end(buffer);
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || 'Gagal membuat gambar rusdi-quote',
      });
    }
  },
};
