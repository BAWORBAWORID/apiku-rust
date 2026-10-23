/**
 * To Anime V2 API - Convert photo to anime style using PixNova AI
 * 
 * GET /tools/to-anime-v2?url=https://example.com/photo.jpg
 * POST /tools/to-anime-v2 (JSON: { url: "https://example.com/photo.jpg" })
 * 
 * result: 
 * - Langsung menampilkan gambar hasil konversi ke anime style
 * 
 * Author : Gienetic
 * Category: Tools
 */

import axios from "axios";
import FormData from "form-data";
import { randomBytes } from 'crypto';
import sharp from 'sharp';
import { Readable } from 'stream';
import logger from "../../src/utils/logger.js";

// ==================== AIEASE CLASS ====================
class Aiease {
    constructor() {
        this.api = {
            upload: "https://api.pixnova.ai/aitools/upload-img",
            create: "https://api.pixnova.ai/aitools/of/create",
            status: "https://api.pixnova.ai/aitools/of/check-status",
            uploadPng: "https://uguu.se/upload.php",
        };
        this.headersBase = {
            fp: "c74f54010942b009eaa50cd58a1f4419",
            fp1: "3LXezMA2LSO2kESzl2EYNEQBUWOCDQ/oQMQaeP5kWWHbtCWoiTptGi2EUCOLjkdD",
            origin: "https://pixnova.ai",
            referer: "https://pixnova.ai/",
            "theme-version": "83EmcUoQTUv50LhNx0VrdcK8rcGexcP35FcZDcpgWsAXEyO4xqL5shCY6sFIWB2Q",
            "x-code": "1752930995556",
            "x-guide": "SjwMWX+LcTqkoPt48PIOgZzt3eQ93zxCGvzs1VpdikRR9b9+HvKM0Qiceq6Zusjrv8bUEtDGZdVqjQf/bdOXBb0vEaUUDRZ29EXYW0kt047grMMceXzd3zppZoHZj9DeXZOTGaG50PpTHxTjX3gb0D1wmfjol2oh7d5jJFSIsY0=",
            "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
            accept: "application/json, text/plain, */*",
        };
        this.constants = { maxRetry: 30, retryDelay: 2000 };
    }

    randomIP() {
        return Array(4).fill(0).map(() => Math.floor(Math.random() * 256)).join(".");
    }

    randomUserAgent() {
        const userAgents = [
            "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Android 12; Mobile; rv:102.0) Gecko/102.0 Firefox/102.0",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15",
        ];
        return userAgents[Math.floor(Math.random() * userAgents.length)];
    }

    // Upload image ke PixNova
    async uploadImage(buffer) {
        logger.info('[Aiease] Uploading image to PixNova...');
        
        const stream = Readable.from(buffer);
        const form = new FormData();
        form.append("file", stream, { filename: "image.jpg" });
        form.append("fn_name", "demo-photo2anime");
        form.append("request_from", "2");
        form.append("origin_from", "111977c0d5def647");

        const response = await axios.post(this.api.upload, form, {
            headers: {
                ...this.headersBase,
                ...form.getHeaders(),
                "user-agent": this.randomUserAgent(),
                "X-Forwarded-For": this.randomIP(),
                "Client-IP": this.randomIP(),
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });
        
        const path = response.data?.data?.path;
        logger.info(`[Aiease] Image uploaded, path: ${path}`);
        
        return path;
    }

    // Create task untuk konversi
    async createTask(sourceImage) {
        logger.info('[Aiease] Creating conversion task...');
        
        const payload = {
            fn_name: "demo-photo2anime",
            call_type: 3,
            input: {
                source_image: sourceImage,
                strength: 0.6,
                prompt: "use anime style, hd, 8k, smooth, aesthetic",
                negative_prompt: "(worst quality, low quality:1.4), (greyscale, monochrome:1.1), cropped, lowres, username, blurry, trademark, watermark, title, multiple view, Reference sheet, curvy, plump, fat, strabismus, clothing cutout, side slit, worst hand, (ugly face:1.2), extra leg, extra arm, bad foot, text, name",
                request_from: 2,
            },
            request_from: 2,
            origin_from: "111977c0d5def647",
        };

        const response = await axios.post(this.api.create, payload, {
            headers: {
                ...this.headersBase,
                "content-type": "application/json",
                "user-agent": this.randomUserAgent(),
                "X-Forwarded-For": this.randomIP(),
                "Client-IP": this.randomIP(),
            },
        });
        
        const taskId = response.data?.data?.task_id;
        logger.info(`[Aiease] Task created, ID: ${taskId}`);
        
        return taskId;
    }

    // Check status task
    async checkTaskStatus(taskId) {
        logger.info(`[Aiease] Checking task status: ${taskId}`);
        
        const payload = {
            task_id: taskId,
            fn_name: "demo-photo2anime",
            call_type: 3,
            request_from: 2,
            origin_from: "111977c0d5def647",
        };

        for (let i = 0; i < this.constants.maxRetry; i++) {
            logger.info(`[Aiease] Status check ${i + 1}/${this.constants.maxRetry}...`);
            
            const response = await axios.post(this.api.status, payload, {
                headers: {
                    ...this.headersBase,
                    "content-type": "application/json",
                    "user-agent": this.randomUserAgent(),
                    "X-Forwarded-For": this.randomIP(),
                    "Client-IP": this.randomIP(),
                },
            });

            const data = response.data?.data;
            
            if (data?.status === 2 && data?.result_image) {
                const resultUrl = data.result_image.startsWith("http")
                    ? data.result_image
                    : `https://oss-global.pixnova.ai/${data.result_image}`;
                
                logger.info(`[Aiease] Task completed, result URL: ${resultUrl}`);
                return resultUrl;
            }
            
            logger.info(`[Aiease] Task still processing, waiting ${this.constants.retryDelay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, this.constants.retryDelay));
        }
        
        throw new Error("Waktu habis, proses gagal!");
    }

    // Convert WebP ke PNG menggunakan sharp
    async convertToPNG(url) {
        logger.info('[Aiease] Downloading and converting result to PNG...');
        
        const response = await axios.get(url, { 
            responseType: 'arraybuffer',
            timeout: 30000
        });
        
        const webpBuffer = Buffer.from(response.data);
        const pngBuffer = await sharp(webpBuffer).png().toBuffer();
        
        logger.info(`[Aiease] Converted to PNG: ${(pngBuffer.length / 1024).toFixed(2)}KB`);
        
        return pngBuffer;
    }

    // Upload PNG ke uguu.se
    async uploadPNG(buffer) {
        logger.info('[Aiease] Uploading PNG to uguu.se...');
        
        const stream = Readable.from(buffer);
        const form = new FormData();
        form.append("files[]", stream, { filename: "converted.png" });

        const response = await axios.post(this.api.uploadPng, form, {
            headers: {
                ...form.getHeaders(),
                "user-agent": this.randomUserAgent(),
                "X-Forwarded-For": this.randomIP(),
                "Client-IP": this.randomIP(),
            },
        });
        
        const url = response.data.files[0].url;
        logger.info(`[Aiease] PNG uploaded, URL: ${url}`);
        
        return url;
    }

    // Generate image dari buffer input
    async generateImage(input) {
        const startTime = Date.now();
        
        try {
            const sourceImage = await this.uploadImage(input);
            const taskId = await this.createTask(sourceImage);
            const resultUrl = await this.checkTaskStatus(taskId);
            const pngBuffer = await this.convertToPNG(resultUrl);
            const finalUrl = await this.uploadPNG(pngBuffer);
            
            logger.info(
                `[Aiease] Success | ` +
                `task_id=${taskId} | ` +
                `time=${Date.now() - startTime}ms`
            );
            
            return {
                success: true,
                url: finalUrl,
                buffer: pngBuffer,
                taskId: taskId,
                processingTime: Date.now() - startTime
            };
            
        } catch (error) {
            logger.error(`[Aiease] Error: ${error.message}`);
            throw error;
        }
    }

    // Generate langsung return buffer (tanpa upload ke uguu)
    async generateImageBuffer(input) {
        const startTime = Date.now();
        
        try {
            const sourceImage = await this.uploadImage(input);
            const taskId = await this.createTask(sourceImage);
            const resultUrl = await this.checkTaskStatus(taskId);
            const pngBuffer = await this.convertToPNG(resultUrl);
            
            logger.info(
                `[Aiease] Success (buffer) | ` +
                `task_id=${taskId} | ` +
                `time=${Date.now() - startTime}ms | ` +
                `size=${(pngBuffer.length / 1024).toFixed(2)}KB`
            );
            
            return {
                success: true,
                buffer: pngBuffer,
                taskId: taskId,
                processingTime: Date.now() - startTime
            };
            
        } catch (error) {
            logger.error(`[Aiease] Error: ${error.message}`);
            throw error;
        }
    }

}

// ==================== MAIN ENDPOINT ====================
export default {
    name: "To Anime V2",
    description: "Konversi foto menjadi gaya anime menggunakan AI PixNova - Hasil HD 8K smooth aesthetic",
    category: "Image",
    methods: ["GET", "POST"],
    params: ["url"],

    paramsSchema: {
        url: {
            type: "string",
            required: true,
            default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
            description: "URL foto yang akan dikonversi ke anime style"
        }
    },

    async run(req, res) {
        const aiease = new Aiease();
        
        try {
            // Parse request - hanya url
            let url;

            if (req.method === 'GET') {
                url = req.query.url;
            } else if (req.method === 'POST') {
                url = req.body.url;
            }

            // Validasi parameter
            if (!url) {
                return res.status(400).json({
                    status: false,
                    message: "Parameter 'url' wajib diisi",
                    code: "MISSING_URL",
                    example: {
                        get: "/tools/to-anime-v2?url=https://example.com/photo.jpg",
                        post: {
                            method: "POST",
                            url: "/tools/to-anime-v2",
                            body: {
                                url: "https://example.com/photo.jpg"
                            }
                        }
                    }
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
               TO ANIME V2 PROCESS
            ======================================= */

            // 1. Download image from URL
            logger.info(`[ToAnimeV2] Downloading image from: ${url.substring(0, 50)}...`);
            
            const imageResponse = await axios.get(url, { 
                responseType: 'arraybuffer',
                timeout: 30000,
                headers: {
                    'User-Agent': aiease.randomUserAgent()
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

            // Dapatkan filename dari URL
            const urlParts = url.split('/');
            const originalFilename = urlParts[urlParts.length - 1].split('?')[0];
            const filename = originalFilename.match(/\.(jpg|jpeg|png|gif|webp)$/i) 
                ? originalFilename 
                : `image-${Date.now()}.jpg`;

            // 2. Proses konversi ke anime (langsung return buffer)
            logger.info(`[ToAnimeV2] Converting to anime style...`);
            
            const result = await aiease.generateImageBuffer(buffer);

            if (!result.success || !result.buffer) {
                throw new Error("Gagal memproses konversi ke anime");
            }
            
            // Log success dengan info lengkap
            logger.info(
                `[ToAnimeV2] Success | ip=${req.ip} | ` +
                `task_id=${result.taskId} | ` +
                `time=${result.processingTime}ms | ` +
                `size=${(result.buffer.length / 1024).toFixed(2)}KB`
            );
            
            // Set header untuk response gambar langsung
            res.setHeader("Content-Type", "image/png");
            res.setHeader("Content-Length", result.buffer.length);
            res.setHeader("X-Service", "ToAnimeV2");
            res.setHeader("X-Task-ID", result.taskId);
            res.setHeader("X-Processing-Time", result.processingTime);
            
            // Kirim buffer gambar langsung
            return res.status(200).send(result.buffer);
            
        } catch (err) {
            // Detailed error logging
            logger.error(
                `[ToAnimeV2] Error | ip=${req.ip} | ` +
                `message=${err.message} | code=${err.code || 'N/A'}`
            );
            
            // Untuk error, kembalikan JSON
            let errorMessage = err.message || "Gagal memproses konversi ke anime";
            let errorCode = "INTERNAL_ERROR";
            let statusCode = 500;
            
            // Check specific errors
            if (err.message.includes("Waktu habis")) {
                errorMessage = "Proses konversi memakan waktu terlalu lama. Coba lagi dengan gambar berbeda.";
                errorCode = "TIMEOUT";
                statusCode = 504;
            } else if (err.message.includes("Failed to upload")) {
                errorMessage = "Gagal mengupload gambar ke server AI";
                errorCode = "UPLOAD_FAILED";
                statusCode = 502;
            } else if (err.message.includes("ECONNABORTED")) {
                errorMessage = "Timeout mengambil gambar";
                errorCode = "TIMEOUT";
                statusCode = 504;
            } else if (err.response?.status === 404) {
                errorMessage = "Gambar tidak ditemukan";
                errorCode = "NOT_FOUND";
                statusCode = 404;
            } else if (err.code === "ENOTFOUND") {
                errorMessage = "Domain gambar tidak dapat diakses";
                errorCode = "DOMAIN_NOT_FOUND";
                statusCode = 400;
            }
            
            return res.status(statusCode).json({
                status: false,
                message: errorMessage,
                code: errorCode
            });
            
        }
    },
};