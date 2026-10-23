/**
 * Remove Background API - Remove image background using AI
 * 
 * GET /api/removebg?url=https://example.com/photo.jpg
 * 
 * result: 
 * - Langsung menampilkan gambar dengan background transparan
 */

import axios from "axios";
import FormData from "form-data";
import sharp from "sharp";
import logger from "../../src/utils/logger.js";

// ==================== REMOVE BG CLIENT ====================
class RemoveBGClient {
    constructor() {
        this.idToken = null;
        this.refreshToken = "AMf-vBwpudXTnY1FgobhqhDbSVE1ysyhrUQZaxHVNPeViBXZTC8q3f-yawGwDvRNqlokG848eNS8k4SgLCLGp_rb6MUEz0HXoxu-G54TtFismWggMLfimC8nhGUE6PRj0vjplcNhGDN7OPujzDENzuvDDuZLkRBuqyF4kaNYUqAZI_Q_hjYvHJwaWQqJGdKWOGXkv8tNGn_M";
        this.tokenExpiry = 0;
    }

    async getValidIdToken() {
        const now = Date.now();
        
        if (this.idToken && (this.tokenExpiry - now) > 5 * 60 * 1000) {
            return this.idToken;
        }
        
        try {
            logger.info(`[REMOVEBG] Refreshing token...`);
            
            const response = await axios({
                method: 'post',
                url: 'https://securetoken.googleapis.com/v1/token',
                params: { key: 'AIzaSyAJGrgbFGB_-h8V2oJLr4b-_ipetqM0duU' },
                headers: {
                    'Content-Type': 'application/json',
                    'X-Android-Package': 'com.photoroom.app',
                    'X-Android-Cert': '0424A4898A4B33940D8BF16E44251B876E97F8D0',
                    'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 14; sdk_gphone64_x86_64 Build/UE1A.230829.036.A4)'
                },
                data: {
                    grant_type: 'refresh_token',
                    refresh_token: this.refreshToken
                },
                timeout: 30000
            });

            this.idToken = response.data.id_token;
            this.refreshToken = response.data.refresh_token || this.refreshToken;
            this.tokenExpiry = Date.now() + (parseInt(response.data.expires_in) * 1000);
            
            logger.info(`[REMOVEBG] Token refreshed, expires in ${response.data.expires_in}s`);
            
            return this.idToken;
            
        } catch (error) {
            logger.error(`[REMOVEBG] Token error: ${error.message}`);
            throw new Error('Gagal mendapatkan token: ' + error.message);
        }
    }

    async removeBackground(imageBuffer) {
        try {
            const authToken = await this.getValidIdToken();
            
            const form = new FormData();
            form.append('sourceImage', imageBuffer, { 
                filename: 'source.jpg', 
                contentType: 'image/jpeg' 
            });
            form.append('user_id', '48acFOd8fTfvyjU0nI4oaqKB7512');
            form.append('resize_mask', 'false');
            form.append('model_type', 'free');
            form.append('experiment_flag', 'default');

            logger.info(`[REMOVEBG] Sending request to segmentation API`);

            const response = await axios({
                method: 'post',
                url: 'https://segmentation-inference.photoroom.com/v1/mask',
                data: form,
                headers: {
                    ...form.getHeaders(),
                    'User-Agent': 'okhttp/5.3.2',
                    'authorization': authToken,
                    'pr-app-version': '2026.07.02 (2274)',
                    'pr-platform': 'android'
                },
                timeout: 60000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });

            if (!response.data || !response.data.b64_mask) {
                throw new Error('Gagal mendapatkan mask dari API.');
            }

            // Decode mask dari base64
            const maskBuffer = Buffer.from(response.data.b64_mask, 'base64');
            
            // Dapatkan metadata mask
            const metadata = await sharp(maskBuffer).metadata();
            
            // Proses gambar dengan mask
            const resultBuffer = await sharp(imageBuffer)
                .resize(metadata.width, metadata.height, {
                    fit: 'fill',
                    withoutEnlargement: false
                })
                .joinChannel(maskBuffer)
                .png()
                .toBuffer();

            logger.info(
                `[REMOVEBG] Success | ` +
                `input_size=${(imageBuffer.length / 1024).toFixed(2)}KB | ` +
                `output_size=${(resultBuffer.length / 1024).toFixed(2)}KB | ` +
                `dimensions=${metadata.width}x${metadata.height}`
            );

            return {
                success: true,
                buffer: resultBuffer,
                metadata: {
                    width: metadata.width,
                    height: metadata.height
                }
            };

        } catch (error) {
            logger.error(`[REMOVEBG] Error: ${error.message}`);
            
            if (error.response) {
                const detail = error.response.data?.toString() || 'Unknown error';
                throw new Error(`API ERROR: ${detail.substring(0, 200)}`);
            }
            
            throw error;
        }
    }
}

// ==================== MAIN ENDPOINT ====================
export default {
    name: "Remove Background",
    description: "Remove image background automatically using AI",
    category: "Image",
    methods: ["GET"],
    params: ["url"],

    paramsSchema: {
        url: {
            type: "string",
            required: true,
            default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
            description: "URL gambar yang akan dihapus backgroundnya"
        }
    },

    async run(req, res) {
        const client = new RemoveBGClient();
        
        try {
            const { url } = req.query || {};

            // Validasi parameter
            if (!url) {
                return res.status(400).json({
                    status: false,
                    message: "Parameter 'url' wajib diisi",
                    code: "MISSING_URL"
                });
            }

            // Validasi URL
            try {
                new URL(url);
            } catch (e) {
                return res.status(400).json({
                    status: false,
                    message: "Format URL tidak valid",
                    code: "INVALID_URL"
                });
            }

            /* =======================================
               REMOVE BACKGROUND PROCESS
            ======================================= */

            // 1. Download image from URL
            logger.info(`[REMOVEBG] Downloading image from: ${url.substring(0, 50)}...`);
            
            const imageResponse = await axios.get(url, { 
                responseType: 'arraybuffer',
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                maxContentLength: 10 * 1024 * 1024 // Maksimal 10MB
            });
            
            // Validasi tipe konten
            const contentType = imageResponse.headers['content-type'];
            if (!contentType || !contentType.startsWith('image/')) {
                return res.status(400).json({
                    status: false,
                    message: "URL harus mengarah ke file gambar",
                    code: "INVALID_CONTENT_TYPE"
                });
            }

            const buffer = Buffer.from(imageResponse.data);
            const fileSizeMB = buffer.length / (1024 * 1024);
            
            if (fileSizeMB > 10) {
                return res.status(400).json({
                    status: false,
                    message: "Ukuran gambar terlalu besar. Maksimal 10MB",
                    code: "FILE_TOO_LARGE"
                });
            }

            // 2. Proses remove background
            logger.info(`[REMOVEBG] Processing image (${fileSizeMB.toFixed(2)}MB)...`);
            const result = await client.removeBackground(buffer);

            if (!result.success || !result.buffer) {
                throw new Error("Gagal memproses remove background");
            }

            // Log success
            logger.info(
                `[REMOVEBG] Success | ip=${req.ip} | ` +
                `dimensions=${result.metadata.width}x${result.metadata.height} | ` +
                `size=${(result.buffer.length / 1024).toFixed(2)}KB`
            );

            // Set headers
            res.setHeader("Content-Type", "image/png")
            res.setHeader("Content-Length", result.buffer.length)
            //res.setHeader("Cache-Control", "public, max-age=86400") // Cache 1 hari
            //res.setHeader("X-AI-Processor", "photoroom.com")
            //res.setHeader("X-Transformer", "removebg")
            //res.setHeader("X-Image-Width", result.metadata.width)
            //res.setHeader("X-Image-Height", result.metadata.height)
            //res.setHeader("X-Original-Size", `${fileSizeMB.toFixed(2)}MB`)
            
            // Send buffer directly
            return res.send(result.buffer)

        } catch (err) {
            // Detailed error logging
            logger.error(
                `[REMOVEBG] Error | ip=${req.ip} | ` +
                `message=${err.message} | code=${err.code || 'N/A'}`
            );
            
            // Check specific errors
            if (err.message.includes("token")) {
                return res.status(502).json({
                    status: false,
                    message: "Gagal mendapatkan token autentikasi",
                    code: "TOKEN_FAILED"
                });
            }
            
            if (err.message.includes("mask")) {
                return res.status(502).json({
                    status: false,
                    message: "Gagal mendapatkan mask dari API",
                    code: "MASK_FAILED"
                });
            }
            
            if (err.message.includes("API ERROR")) {
                return res.status(502).json({
                    status: false,
                    message: err.message,
                    code: "API_ERROR"
                });
            }
            
            if (err.code === "ECONNABORTED") {
                return res.status(504).json({
                    status: false,
                    message: "Timeout mengambil gambar",
                    code: "TIMEOUT"
                });
            }
            
            if (err.response?.status === 404) {
                return res.status(404).json({
                    status: false,
                    message: "Gambar tidak ditemukan",
                    code: "NOT_FOUND"
                });
            }

            if (err.code === "ENOTFOUND") {
                return res.status(400).json({
                    status: false,
                    message: "Domain gambar tidak dapat diakses",
                    code: "DOMAIN_NOT_FOUND"
                });
            }
            
            return res.status(500).json({
                status: false,
                message: err.message || "Gagal memproses remove background",
                code: "INTERNAL_ERROR"
            });
        }
    },
}