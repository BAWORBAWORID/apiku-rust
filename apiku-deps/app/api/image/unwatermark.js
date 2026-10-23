/**
 * Unwatermark API - Remove watermarks, text, and logos from images using AI
 * 
 * GET /api/unwatermark?url=https://example.com/watermarked.jpg
 * 
 * result: 
 * - Langsung menampilkan gambar tanpa watermark
 */

import axios from "axios";
import FormData from "form-data";
import crypto from "crypto";
import sharp from "sharp";
import logger from "../../src/utils/logger.js";

// ==================== UNWATERMARK CLIENT ====================
class UnwatermarkClient {
    detectMime(buffer) {
        const hex = buffer.slice(0, 4).toString('hex');
        if (hex === '89504e47') return 'image/png';
        if (hex.startsWith('52494646')) return 'image/webp';
        return 'image/jpeg';
    }

    extFromMime(mime) {
        if (mime === 'image/png') return 'png';
        if (mime === 'image/webp') return 'webp';
        return 'jpg';
    }

    async createJob(buffer, productSerial) {
        const form = new FormData();
        
        const mime = this.detectMime(buffer);
        const ext = this.extFromMime(mime);

        form.append('original_image_file', buffer, {
            filename: `upload.${ext}`,
            contentType: mime
        });

        form.append('output_format', 'jpg');
        form.append('is_remove_text', 'true');
        form.append('is_remove_logo', 'true');
        form.append('is_enhancer', 'true');

        logger.info(`[UNWATERMARK] Creating job with format: ${mime}, product_serial: ${productSerial.substring(0, 8)}...`);

        const response = await axios.post(
            'https://api.unwatermark.ai/api/web/v1/image-watermark-auto-remove-upgrade/create-job',
            form,
            {
                headers: {
                    ...form.getHeaders(),
                    'Product-Serial': productSerial,
                    'Product-Code': '067003',
                    'origin': 'https://unwatermark.ai',
                    'referer': 'https://unwatermark.ai/'
                },
                maxBodyLength: Infinity,
                timeout: 30000
            }
        );

        return response.data.result.job_id;
    }

    async getJob(jobId, productSerial) {
        const response = await axios.get(
            `https://api.unwatermark.ai/api/web/v1/image-watermark-auto-remove-upgrade/get-job/${jobId}`,
            {
                headers: {
                    'Product-Serial': productSerial,
                    'Product-Code': '067003',
                    'origin': 'https://unwatermark.ai',
                    'referer': 'https://unwatermark.ai/'
                },
                timeout: 30000
            }
        );
        
        return response.data;
    }

    async downloadResultImage(imageUrl) {
        try {
            const response = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            return Buffer.from(response.data);
        } catch (error) {
            logger.error(`[UNWATERMARK] Failed to download result image: ${error.message}`);
            throw new Error('Gagal mengunduh gambar hasil: ' + error.message);
        }
    }

    async removeWatermark(imageBuffer) {
        try {
            // Generate random UUID untuk productSerial
            const productSerial = crypto.randomUUID();
            
            logger.info(`[UNWATERMARK] Creating unwatermark job with serial: ${productSerial.substring(0, 8)}...`);
            
            // Create job
            const jobId = await this.createJob(imageBuffer, productSerial);
            logger.info(`[UNWATERMARK] Job created: ${jobId}`);

            // Poll for result
            let result;
            let retry = 0;
            const maxRetries = 40;
            const pollInterval = 3000; // 3 seconds

            while (retry < maxRetries) {
                await new Promise(r => setTimeout(r, pollInterval));
                result = await this.getJob(jobId, productSerial);

                // Check if job is completed
                if (result.code === 100000 && result.result?.output_url) {
                    const outputUrl = Array.isArray(result.result.output_url) 
                        ? result.result.output_url[0] 
                        : result.result.output_url;

                    logger.info(
                        `[UNWATERMARK] Job completed | job_id=${jobId} | ` +
                        `attempts=${retry + 1} | downloading image...`
                    );

                    // Download the result image
                    const imageBuffer = await this.downloadResultImage(outputUrl);

                    return {
                        success: true,
                        job_id: jobId,
                        buffer: imageBuffer,
                        metadata: {
                            input_url: result.result.input_url,
                            output_url: outputUrl
                        }
                    };
                }

                // Check for errors (code selain 100000 dan 300006)
                if (result.code !== 100000 && result.code !== 300006) {
                    throw new Error(`Job failed with code ${result.code}: ${result.message || 'Unknown error'}`);
                }

                retry++;
                logger.info(`[UNWATERMARK] Polling job ${jobId} (${retry}/${maxRetries})...`);
            }

            throw new Error('Unwatermark timeout after ' + (maxRetries * pollInterval / 1000) + ' seconds');

        } catch (error) {
            logger.error(`[UNWATERMARK] Error: ${error.message}`);
            
            if (error.response) {
                const detail = error.response.data?.toString() || 'Unknown error';
                throw new Error(`API ERROR: ${detail.substring(0, 200)}`);
            }
            
            throw error;
        }
    }
}

// ==================== HELPER FUNCTIONS ====================
async function downloadImage(url, maxSizeMB = 10) {
    const response = await axios.get(url, { 
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        maxContentLength: maxSizeMB * 1024 * 1024
    });
    
    // Validate content type
    const contentType = response.headers['content-type'];
    if (!contentType || !contentType.startsWith('image/')) {
        throw new Error('URL harus mengarah ke file gambar');
    }

    const buffer = Buffer.from(response.data);
    const fileSizeMB = buffer.length / (1024 * 1024);
    
    if (fileSizeMB > maxSizeMB) {
        throw new Error(`Ukuran gambar terlalu besar. Maksimal ${maxSizeMB}MB`);
    }

    // Dapatkan dimensi gambar menggunakan sharp
    let dimensions = { width: 0, height: 0 };
    let format = 'unknown';
    try {
        const metadata = await sharp(buffer).metadata();
        dimensions = {
            width: metadata.width || 0,
            height: metadata.height || 0
        };
        format = metadata.format || 'unknown';
    } catch (e) {
        logger.warn(`[UNWATERMARK] Could not get image dimensions: ${e.message}`);
    }

    return {
        buffer,
        contentType,
        format,
        sizeMB: fileSizeMB,
        dimensions
    };
}

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
    name: "Unwatermark",
    description: "Remove watermarks, text, and logos from images using AI",
    category: "Image",
    methods: ["GET"],
    params: ["url"],

    paramsSchema: {
        url: {
            type: "string",
            required: true,
            default: "https://example.com/watermarked-image.jpg",
            description: "URL gambar yang akan dihapus watermarknya"
        }
    },

    async run(req, res) {
        const client = new UnwatermarkClient();
        
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

            // Validasi URL format
            if (!validateUrl(url)) {
                return res.status(400).json({
                    status: false,
                    message: "Format URL tidak valid",
                    code: "INVALID_URL"
                });
            }

            /* =======================================
               UNWATERMARK PROCESS
            ======================================= */

            // 1. Download image from URL
            logger.info(`[UNWATERMARK] Downloading image from: ${url.substring(0, 50)}...`);
            const image = await downloadImage(url);

            logger.info(
                `[UNWATERMARK] Image downloaded | ` +
                `size=${image.sizeMB.toFixed(2)}MB (${image.format}) | ` +
                `dimensions=${image.dimensions.width}x${image.dimensions.height}`
            );

            // 2. Process unwatermark
            logger.info(`[UNWATERMARK] Processing unwatermark...`);
            const result = await client.removeWatermark(image.buffer);

            if (!result.success || !result.buffer) {
                throw new Error("Gagal memproses unwatermark");
            }

            // Dapatkan metadata gambar hasil
            const resultMetadata = await sharp(result.buffer).metadata();

            // Log success
            logger.info(
                `[UNWATERMARK] Success | ip=${req.ip} | ` +
                `job_id=${result.job_id} | ` +
                `dimensions=${resultMetadata.width}x${resultMetadata.height} | ` +
                `size=${(result.buffer.length / 1024).toFixed(2)}KB`
            );

            // Set headers untuk response gambar
            res.setHeader("Content-Type", `image/${resultMetadata.format || 'png'}`);
            res.setHeader("Content-Length", result.buffer.length);
            res.setHeader("Cache-Control", "public, max-age=86400"); // Cache 1 hari
            res.setHeader("X-AI-Processor", "unwatermark.ai");
            res.setHeader("X-Transformer", "unwatermark");
            res.setHeader("X-Job-ID", result.job_id);
            res.setHeader("X-Image-Width", resultMetadata.width);
            res.setHeader("X-Image-Height", resultMetadata.height);
            res.setHeader("X-Image-Format", resultMetadata.format);
            res.setHeader("X-Original-Size", `${image.sizeMB.toFixed(2)}MB`);
            res.setHeader("X-Original-Dimensions", `${image.dimensions.width}x${image.dimensions.height}`);
            res.setHeader("X-Original-Format", image.format);
            res.setHeader("X-Remove-Text", "true");
            res.setHeader("X-Remove-Logo", "true");
            res.setHeader("X-Enhancer", "true");
            
            // Send buffer langsung
            return res.send(result.buffer);

        } catch (err) {
            // Detailed error logging
            logger.error(
                `[UNWATERMARK] Error | ip=${req.ip} | ` +
                `message=${err.message} | code=${err.code || 'N/A'}`
            );
            
            // Check specific errors
            if (err.message.includes("timeout")) {
                return res.status(504).json({
                    status: false,
                    message: err.message,
                    code: "TIMEOUT"
                });
            }
            
            if (err.message.includes("API ERROR")) {
                return res.status(502).json({
                    status: false,
                    message: err.message,
                    code: "API_ERROR"
                });
            }
            
            if (err.message.includes("Job failed with code")) {
                return res.status(502).json({
                    status: false,
                    message: err.message,
                    code: "JOB_FAILED"
                });
            }
            
            if (err.code === "ECONNABORTED") {
                return res.status(504).json({
                    status: false,
                    message: "Timeout mengambil gambar",
                    code: "DOWNLOAD_TIMEOUT"
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

            if (err.message.includes("Ukuran gambar terlalu besar")) {
                return res.status(400).json({
                    status: false,
                    message: err.message,
                    code: "FILE_TOO_LARGE"
                });
            }

            if (err.message.includes("URL harus mengarah ke file gambar")) {
                return res.status(400).json({
                    status: false,
                    message: err.message,
                    code: "INVALID_CONTENT_TYPE"
                });
            }
            
            return res.status(500).json({
                status: false,
                message: err.message || "Gagal memproses unwatermark",
                code: "INTERNAL_ERROR"
            });
        }
    },
};