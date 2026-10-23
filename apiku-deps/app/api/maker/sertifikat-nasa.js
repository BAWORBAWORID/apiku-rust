/**
 * SERTIFIKAT NASA
 *
 * Generate sertifikat NASA dengan custom nama.
 * Template: template.jpg lokal (cached di api/maker/assets/sertifikat-nasa/)
 * Posisi nama: hasil scan pixel dari template — "fachriadliazaditya" di x=114..337, y=230..236
 *
 * @route {GET|POST} /api/maker/sertifikat-nasa
 *
 * @param {string} nama - Nama yang akan ditulis di sertifikat
 *
 * @example
 * GET /api/maker/sertifikat-nasa?nama=John%20Doe
 * POST /api/maker/sertifikat-nasa -d {"nama":"John Doe"}
 *
 * Category: Maker
 */

import { createCanvas, loadImage } from "@napi-rs/canvas";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../../src/utils/logger.js";

// ==================== ASSET PATHS ====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.join(__dirname, "assets", "sertifikat-nasa");
const TEMPLATE_PATH = path.join(ASSETS_DIR, "template.jpg");

// ==================== PIXEL-SCANNED TEXT AREA ====================
// Hasil scan template: "fachriadliazaditya" ditemukan di:
//   - x: 114..337  (lebar ~223px)
//   - y: 230..236  (tinggi ~6px)
//
// Template: cuma ada nama asli, gak ada "Dear".
// Kita tulis "Dear {nama}," dari kode, cover area pake font 23px.

const NAME_X = 114; // Posisi X awal nama asli di template
const TEXT_CENTER_Y = 233; // (230 + 236) / 2 ≈ 233
const COVER_H = 30; // Tinggi muat untuk font 23px (6px + padding atas/bawah)
const COVER_Y = TEXT_CENTER_Y - COVER_H / 2; // ≈ 218
const ORIGINAL_NAME_W = 223; // Lebar nama asli (337 - 114)

const MAX_NAMA_LENGTH = 200;

// ==================== API HANDLER ====================

export default {
  name: "Sertifikat NASA",
  description:
    "Generate sertifikat NASA dengan nama custom — timpa nama lama di template",
  category: "Maker",
  methods: ["GET", "POST"],

  params: ["nama"],

  paramsSchema: {
    nama: {
      type: "string",
      required: true,
      description: "Nama yang akan ditampilkan di sertifikat",
      example: "John Doe",
      minLength: 1,
      maxLength: MAX_NAMA_LENGTH
    }
  },

  async run(req, res) {
    const startTime = Date.now();

    try {
      // ========== 1. EXTRACT & VALIDATE ==========
      const { nama } = { ...req.query, ...req.body };

      if (!nama || typeof nama !== "string" || !nama.trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'nama' wajib diisi"
        });
      }

      const namaTrimmed = nama.trim();
      if (namaTrimmed.length > MAX_NAMA_LENGTH) {
        return res.status(400).json({
          status: false,
          message: `Parameter 'nama' melebihi panjang maksimum (${MAX_NAMA_LENGTH} karakter)`
        });
      }

      // ========== 2. CHECK TEMPLATE ==========
      if (!fs.existsSync(TEMPLATE_PATH)) {
        return res.status(500).json({
          status: false,
          message: "Template tidak ditemukan"
        });
      }

      // ========== 3. LOG ==========
      logger.info(
        `[SertifikatNasa] Generating | ip=${req.ip} | name="${namaTrimmed}"`
      );

      // ========== 4. GENERATE ==========
      const bgBuffer = fs.readFileSync(TEMPLATE_PATH);
      const bg = await loadImage(bgBuffer);

      const canvas = createCanvas(bg.width, bg.height);
      const ctx = canvas.getContext("2d");

      // Gambar template
      ctx.drawImage(bg, 0, 0);

  // Hitung lebar cover dinamis berdasarkan panjang teks "Dear {nama},"
  // Setiap karakter ≈ 13px di font 23px Arial (+ padding 20px utk karakter lebar)
  const fullText = `Dear ${namaTrimmed},`;
  const estimatedWidth = Math.max(ORIGINAL_NAME_W + 60, fullText.length * 13 + 20);

  // Timpa area nama lama dengan putih (mulai dari NAME_X = 114)
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(NAME_X, COVER_Y, estimatedWidth, COVER_H);

  // Tulis "Dear {nama}," — template gak punya teks "Dear", semua dari sini
  ctx.fillStyle = "#000000";
  ctx.font = "bold 23px Arial, Helvetica, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(fullText, NAME_X, TEXT_CENTER_Y);

      const buffer = await canvas.encode("png");

      // ========== 5. RESPOND ==========
      const duration = Date.now() - startTime;
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("X-Generated-In", `${duration}ms`);

      return res.send(buffer);
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[SertifikatNasa] Error after ${duration}ms: ${err.message}`);

      if (res.headersSent) {
        return res.end();
      }

      return res.status(500).json({
        status: false,
        message: err.message || "Failed to generate certificate"
      });
    }
  }
};
