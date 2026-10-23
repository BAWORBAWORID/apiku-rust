/**
 * Sertifikat Tolol — Generate sertifikat tolol dengan nama custom
 * (ported from https://github.com/ibnux/Generator-Sertifikat-Tolol)
 *
 * GET  /api/canvas/sertifikat-tolol?nama=John
 * POST /api/canvas/sertifikat-tolol
 */

import { createCanvas, loadImage, registerFont } from "canvas";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Template moved from src/template/template.jpg → api/canvas/assets/sertifikat-tolol/template.jpg
// (offline-first: cached locally so the endpoint survives upstream / file-share outages)
const TEMPLATE_PATH = join(__dirname, "assets", "sertifikat-tolol", "template.jpg");
// Font co-located with template (per-endpoint convention matching the other canvas endpoints)
const FONT_PATH = join(__dirname, "assets", "sertifikat-tolol", "HelveticaNeueMed.ttf");

const FONT_FAMILY = "HelveticaNeueMed";

let assetsReady = false;

function ensureAssets() {
  if (assetsReady) return;
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Template image not found: ${TEMPLATE_PATH}`);
  }
  if (!fs.existsSync(FONT_PATH)) {
    throw new Error(`Font file not found: ${FONT_PATH}`);
  }
  registerFont(FONT_PATH, { family: FONT_FAMILY });
  assetsReady = true;
}

async function generateSertifikat(nama) {
  ensureAssets();

  const text = nama.toUpperCase();

  // Load template
  const image = await loadImage(TEMPLATE_PATH);
  const width = image.width;
  const height = image.height;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Draw template
  ctx.drawImage(image, 0, 0, width, height);

  // Font size 30 (same as original PHP)
  const fontSize = 30;
  ctx.font = `${fontSize}px ${FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";

  // Centered position
  const x = width / 2;
  const y = height / 2;

  ctx.fillText(text, x, y);

  return canvas.toBuffer("image/jpeg", { quality: 100 });
}

export default {
  name: "Sertifikat Tolol",
  description: "Generate sertifikat tolol dengan nama custom.",
  category: "Canvas",
  methods: ["GET", "POST"],
  params: ["nama"],

  paramsSchema: {
    nama: {
      type: "string",
      required: true,
      description: "Nama yang akan ditampilkan di sertifikat"
    }
  },

  async run(req, res) {
    try {
      const { nama } = { ...req.query, ...req.body };

      if (!nama || !String(nama).trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'nama' wajib diisi"
        });
      }

      const normalized = String(nama).trim();
      const buffer = await generateSertifikat(normalized);

      res.setHeader("Content-Type", "image/jpeg");
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
