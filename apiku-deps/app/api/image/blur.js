/**
 * Blur Image API
 * Membuat efek blur pada gambar dengan berbagai tingkat kekaburan
 * 
 * GET /api/blur?url=https://example.com/image.jpg&level=3
 * 
 * result: 
 * - Mengembalikan langsung gambar yang sudah di-blur
 */

import axios from 'axios';
import Jimp from 'jimp';
import logger from "../../src/utils/logger.js";

// ==================== BLUR CLIENT ====================
class BlurClient {
  async process(imageUrl, level = 3) {
    const startTime = Date.now();

    try {
      // Validasi level blur (1-5)
      const blurLevel = isNaN(level) ? 3 : parseInt(level);
      
      // Batasi level blur sesuai enum (1-5)
      const safeBlurLevel = Math.min(5, Math.max(1, blurLevel));
      
      // Konversi level (1-5) ke radius blur yang sesuai
      // Level 1 = blur ringan (radius 2), level 5 = blur sangat kuat (radius 20)
      const blurRadius = safeBlurLevel * 4; // 4, 8, 12, 16, 20
      
      logger.info(`[Blur] Processing image from: ${imageUrl.substring(0, 50)}... with level: ${safeBlurLevel} (radius: ${blurRadius})`);

      // Download gambar
      const imageRes = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        maxContentLength: 10 * 1024 * 1024 // 10MB max
      });

      const contentType = imageRes.headers['content-type'];
      if (!contentType || !contentType.startsWith('image/')) {
        throw new Error('URL harus mengarah ke file gambar');
      }

      const buffer = Buffer.from(imageRes.data);
      
      // Proses dengan JIMP
      const img = await Jimp.read(buffer);
      
      // Apply blur dengan radius yang sudah dikonversi
      // Jimp.blur(radius) menggunakan Gaussian blur
      img.blur(blurRadius);
      
      // Get buffer
      const resultBuffer = await new Promise((resolve, reject) => {
        img.getBuffer(Jimp.MIME_JPEG, (err, buffer) => {
          if (err) reject(err);
          else resolve(buffer);
        });
      });

      const processingTime = Date.now() - startTime;

      logger.info(
        `[Blur] Success | ` +
        `level=${safeBlurLevel} | ` +
        `radius=${blurRadius} | ` +
        `original_size=${(buffer.length / 1024).toFixed(2)}KB | ` +
        `result_size=${(resultBuffer.length / 1024).toFixed(2)}KB | ` +
        `time=${processingTime}ms`
      );

      return {
        success: true,
        buffer: resultBuffer,
        originalSize: buffer.length,
        resultSize: resultBuffer.length,
        processingTime: processingTime,
        level: safeBlurLevel,
        blurRadius: blurRadius,
        mimeType: Jimp.MIME_JPEG
      };

    } catch (error) {
      logger.error(`[Blur] Error: ${error.message}`);
      
      if (error.code === 'ENOTFOUND') {
        throw new Error('Domain gambar tidak dapat diakses');
      }
      
      if (error.response?.status === 404) {
        throw new Error('Gambar tidak ditemukan (404)');
      }
      
      if (error.code === 'ECONNABORTED') {
        throw new Error('Timeout saat download gambar');
      }

      throw error;
    }
  }
}

// ==================== HELPER FUNCTIONS ====================
function validateUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// ==================== MAIN ENDPOINT ====================
export default {
  name: "Image Blur",
  description: "Membuat efek blur pada gambar. Level 1-5 dengan 1 = blur ringan, 5 = blur sangat kuat.",
  category: "Image",
  methods: ["GET", "POST"],
  params: ["url", "level"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
      description: "URL gambar yang akan di-blur"
    },
    level: {
      type: "number",
      required: false,
      enum: [1, 2, 3, 4, 5],
      default: 3,
      description: "Tingkat blur: 1 (ringan), 2 (sedang), 3 (cukup blur), 4 (sangat blur), 5 (ekstrim blur)"
    }
  },

  async run(req, res) {
    const client = new BlurClient();
    const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);

    try {
      // Parse parameters
      let url, level = 3;

      if (req.method === 'GET') {
        url = req.query?.url;
        level = req.query?.level;
      } else if (req.method === 'POST') {
        url = req.body?.url;
        level = req.body?.level;
      }

      // Validasi URL
      if (!url) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
          code: "MISSING_URL",
          method: req.method,
          requestId: requestId,
          example: "/api/blur?url=https://example.com/image.jpg&level=3"
        });
      }

      if (!validateUrl(url)) {
        return res.status(400).json({
          status: false,
          message: "Format URL tidak valid",
          code: "INVALID_URL",
          requestId: requestId
        });
      }

      // Validasi level - harus sesuai enum [1,2,3,4,5]
      const validLevels = [1, 2, 3, 4, 5];
      let blurLevel = 3; // default
      
      if (level !== undefined && level !== null) {
        // Konversi ke number
        if (typeof level === 'string') {
          blurLevel = parseInt(level);
        } else if (typeof level === 'number') {
          blurLevel = level;
        } else {
          return res.status(400).json({
            status: false,
            message: "Parameter 'level' harus berupa angka",
            code: "INVALID_LEVEL_TYPE",
            valid_levels: validLevels,
            requestId: requestId
          });
        }

        // Cek apakah NaN
        if (isNaN(blurLevel)) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'level' harus berupa angka yang valid",
            code: "INVALID_LEVEL_NAN",
            valid_levels: validLevels,
            requestId: requestId
          });
        }

        // Cek apakah dalam range 1-5
        if (!validLevels.includes(blurLevel)) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'level' harus salah satu dari: 1, 2, 3, 4, 5",
            code: "INVALID_LEVEL_RANGE",
            valid_levels: validLevels,
            requestId: requestId
          });
        }
      }

      // Deskripsi level untuk logging
      const levelDescriptions = {
        1: "blur ringan",
        2: "blur sedang", 
        3: "blur cukup",
        4: "blur sangat",
        5: "blur ekstrim"
      };

      /* =======================================
         BLUR PROCESS
      ======================================= */

      logger.info(`[Blur:${requestId}] Processing | method=${req.method} | url=${url.substring(0, 50)}... | level=${blurLevel} (${levelDescriptions[blurLevel]})`);

      // Process blur
      const result = await client.process(url, blurLevel);

      // Set response headers
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Length', result.buffer.length);
      res.setHeader('X-Blur-Level', result.level);
      res.setHeader('X-Blur-Radius', result.blurRadius);
      res.setHeader('X-Processing-Time', result.processingTime);

      // Kirim langsung gambar
      return res.status(200).send(result.buffer);

    } catch (err) {
      // Error logging
      logger.error(
        `[Blur:${requestId}] Error | ` +
        `message=${err.message}`
      );

      // Untuk error, kembalikan JSON
      res.setHeader('Content-Type', 'application/json');

      // Map errors
      if (err.message.includes('Domain gambar tidak dapat diakses')) {
        return res.status(400).json({
          status: false,
          message: err.message,
          code: "DOMAIN_NOT_FOUND",
          requestId: requestId
        });
      }

      if (err.message.includes('Gambar tidak ditemukan')) {
        return res.status(404).json({
          status: false,
          message: err.message,
          code: "NOT_FOUND",
          requestId: requestId
        });
      }

      if (err.message.includes('URL harus mengarah ke file gambar')) {
        return res.status(400).json({
          status: false,
          message: err.message,
          code: "INVALID_CONTENT_TYPE",
          requestId: requestId
        });
      }

      if (err.message.includes('Timeout')) {
        return res.status(504).json({
          status: false,
          message: err.message,
          code: "TIMEOUT",
          requestId: requestId
        });
      }

      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses gambar",
        code: "INTERNAL_ERROR",
        requestId: requestId
      });
    }
  }
};