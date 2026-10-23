/**
 * AI Bing Image Search API
 * 
 * GET /api/bing?query=kucing%20lucu
 * 
 * result: 
 * - Mengembalikan langsung gambar hasil pencarian dari Bing
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import logger from "../../src/utils/logger.js";

// ==================== BING IMAGE CLIENT ====================
class BingImageClient {
  constructor() {
    this.baseURL = 'https://www.bing.com/images/search';
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    };
  }

  async searchImages(query) {
    const startTime = Date.now();

    try {
      // Validasi query
      if (!query || query.trim().length === 0) {
        throw new Error('Query pencarian tidak boleh kosong');
      }

      logger.info(`[BingImage] Searching for: "${query}"`);

      // Encode query untuk URL
      const encodedQuery = encodeURIComponent(query);
      const searchUrl = `${this.baseURL}?q=${encodedQuery}&form=HDRSC2&first=1&tsc=ImageBasicHover`;

      // Request ke Bing
      const response = await axios.get(searchUrl, {
        headers: this.headers,
        timeout: 30000,
        maxRedirects: 5
      });

      // Parse HTML dengan cheerio
      const $ = cheerio.load(response.data);
      const imageUrls = [];

      // Ekstrak URL gambar dari atribut 'm' di tag 'a.iusc'
      $('a.iusc').each((i, el) => {
        const m = $(el).attr('m');
        if (m) {
          try {
            const match = m.match(/"murl":"(.*?)"/);
            if (match && match[1]) {
              // Decode URL
              const imageUrl = match[1].replace(/\\/g, '');
              if (this.isValidImageUrl(imageUrl)) {
                imageUrls.push(imageUrl);
              }
            }
          } catch (e) {
            // Abaikan jika parsing gagal
          }
        }
      });

      // Filter URL duplikat
      const uniqueUrls = [...new Set(imageUrls)];

      if (uniqueUrls.length === 0) {
        throw new Error('Tidak ada gambar ditemukan untuk pencarian ini');
      }

      // Pilih gambar random
      const randomIndex = Math.floor(Math.random() * uniqueUrls.length);
      const selectedImage = uniqueUrls[randomIndex];

      const processingTime = Date.now() - startTime;

      logger.info(`[BingImage] Found ${uniqueUrls.length} images, selected index ${randomIndex}`);

      return {
        success: true,
        query: query,
        imageUrl: selectedImage,
        totalFound: uniqueUrls.length,
        processingTime: processingTime
      };

    } catch (error) {
      logger.error(`[BingImage] Error: ${error.message}`);
      
      if (error.response?.status === 403) {
        throw new Error('Akses ke Bing diblokir. Coba lagi nanti.');
      }
      
      if (error.code === 'ECONNABORTED') {
        throw new Error('Timeout saat mengakses Bing');
      }

      throw error;
    }
  }

  // Validasi URL gambar
  isValidImageUrl(url) {
    if (!url) return false;
    
    // Cek format URL
    try {
      new URL(url);
    } catch {
      return false;
    }

    // Cek ekstensi gambar umum
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
    const lowerUrl = url.toLowerCase();
    
    return imageExtensions.some(ext => lowerUrl.includes(ext)) || 
           lowerUrl.includes('image') || 
           lowerUrl.includes('img');
  }

  // Download gambar
  async downloadImage(url) {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.bing.com/'
        },
        maxRedirects: 5,
        validateStatus: status => status < 400
      });

      const contentType = response.headers['content-type'];
      if (!contentType || !contentType.startsWith('image/')) {
        throw new Error('URL bukan gambar');
      }

      return {
        buffer: Buffer.from(response.data),
        contentType: contentType
      };
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error('Gambar tidak ditemukan (404)');
      }
      if (error.code === 'ECONNABORTED') {
        throw new Error('Timeout download gambar');
      }
      throw error;
    }
  }

  // Dapatkan ekstensi dari content-type
  getExtension(contentType) {
    const map = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/bmp': 'bmp'
    };
    return map[contentType] || 'jpg';
  }
}

// ==================== HELPER FUNCTIONS ====================
function sanitizeQuery(query) {
  return query
    .replace(/[<>]/g, '')
    .trim()
    .substring(0, 100); // Batasi panjang query
}

// ==================== MAIN ENDPOINT ====================
export default {
  name: "AI Bing Image",
  description: "Search and get random images from Bing",
  category: "Image AI",
  methods: ["GET"],
  params: ["query"],

  paramsSchema: {
    query: {
      type: "string",
      required: true,
      description: "Kata kunci pencarian gambar"
    }
  },

  async run(req, res) {
    const client = new BingImageClient();
    const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);

    try {
      // Parse parameter query (GET only)
      const query = req.query?.query;

      // Validasi query
      if (!query) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'query' wajib diisi",
          code: "MISSING_QUERY",
          example: "/api/bing?query=kucing%20lucu"
        });
      }

      // Sanitize query
      const sanitizedQuery = sanitizeQuery(query);

      /* =======================================
         BING IMAGE SEARCH PROCESS
      ======================================= */

      logger.info(`[Bing:${requestId}] Searching: "${sanitizedQuery}"`);

      // Search images
      const result = await client.searchImages(sanitizedQuery);

      if (!result.success || !result.imageUrl) {
        throw new Error('Gagal mendapatkan URL gambar');
      }

      // Download gambar
      logger.info(`[Bing:${requestId}] Downloading image...`);
      
      const imageData = await client.downloadImage(result.imageUrl);
      
      // Tentukan ekstensi file
      const extension = client.getExtension(imageData.contentType);

      // Log success
      logger.info(
        `[Bing:${requestId}] Success | ` +
        `query="${sanitizedQuery}" | ` +
        `total=${result.totalFound} | ` +
        `size=${(imageData.buffer.length / 1024).toFixed(2)}KB | ` +
        `type=${imageData.contentType} | ` +
        `time=${result.processingTime}ms`
      );

      // Set response headers untuk gambar
      res.setHeader('Content-Type', imageData.contentType);
      res.setHeader('Content-Length', imageData.buffer.length);
      res.setHeader('X-Query', sanitizedQuery);
      res.setHeader('X-Total-Results', result.totalFound);
      res.setHeader('X-Processing-Time', `${result.processingTime}ms`);
      res.setHeader('X-Request-ID', requestId);
      
      // Kirim langsung gambar
      return res.status(200).send(imageData.buffer);

    } catch (err) {
      // Error logging
      logger.error(
        `[Bing:${requestId}] Error | ` +
        `message=${err.message}`
      );

      // Untuk error, kembalikan JSON
      res.setHeader('Content-Type', 'application/json');

      // Map errors
      if (err.message.includes('Tidak ada gambar ditemukan')) {
        return res.status(404).json({
          status: false,
          message: err.message,
          code: "NO_RESULTS",
          query: req.query?.query,
          tips: "Coba dengan kata kunci yang berbeda atau lebih spesifik"
        });
      }

      if (err.message.includes('Akses ke Bing diblokir')) {
        return res.status(503).json({
          status: false,
          message: err.message,
          code: "BLOCKED",
          tips: "Coba lagi nanti atau gunakan VPN"
        });
      }

      if (err.message.includes('Timeout')) {
        return res.status(504).json({
          status: false,
          message: err.message,
          code: "TIMEOUT"
        });
      }

      if (err.message.includes('Gambar tidak ditemukan')) {
        return res.status(404).json({
          status: false,
          message: err.message,
          code: "IMAGE_NOT_FOUND",
          tips: "Gambar mungkin sudah dihapus. Coba lagi"
        });
      }

      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses permintaan",
        code: "INTERNAL_ERROR",
        requestId: requestId
      });
    }
  }
};