/**
 * Face Swap API - Swap faces between two images using AI
 * 
 * GET /api/faceswap?source_url=https://example.com/source.jpg&target_url=https://example.com/target.jpg
 * 
 * result: 
 * - Langsung menampilkan gambar hasil face swap
 */

import axios from "axios";
import FormData from "form-data";
import sharp from "sharp";
import logger from "../../src/utils/logger.js";

// ==================== FACE SWAP CLIENT ====================
class FaceSwapClient {
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

    async createJob(sourceBuffer, targetBuffer) {
        const form = new FormData();
        
        const sourceMime = this.detectMime(sourceBuffer);
        const targetMime = this.detectMime(targetBuffer);

        form.append('source_image', sourceBuffer, {
            filename: `source.${this.extFromMime(sourceMime)}`,
            contentType: sourceMime
        });

        form.append('target_image', targetBuffer, {
            filename: `target.${this.extFromMime(targetMime)}`,
            contentType: targetMime
        });

        logger.info(`[FACESWAP] Creating job with source: ${sourceMime}, target: ${targetMime}`);

        const create = await axios.post(
            'https://api.lovefaceswap.com/api/face-swap/create-poll',
            form,
            {
                headers: {
                    ...form.getHeaders(),
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
                    'Accept': 'application/json',
                    'origin': 'https://lovefaceswap.com',
                    'referer': 'https://lovefaceswap.com/'
                },
                maxBodyLength: Infinity,
                timeout: 30000
            }
        );

        return create.data.data.task_id;
    }

    async checkJob(jobId) {
        const check = await axios.get(
            `https://api.lovefaceswap.com/api/common/get?job_id=${jobId}`,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
                    'origin': 'https://lovefaceswap.com',
                    'referer': 'https://lovefaceswap.com/'
                },
                timeout: 30000
            }
        );

        return check.data.data;
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
            logger.error(`[FACESWAP] Failed to download result image: ${error.message}`);
            throw new Error('Gagal mengunduh gambar hasil: ' + error.message);
        }
    }

    async swapFaces(sourceBuffer, targetBuffer) {
        try {
            logger.info(`[FACESWAP] Creating face swap job...`);
            
            // Create job
            const jobId = await this.createJob(sourceBuffer, targetBuffer);
            logger.info(`[FACESWAP] Job created: ${jobId}`);

            // Poll for result
            let result;
            let retry = 0;
            const maxRetries = 40;
            const pollInterval = 3000; // 3 seconds

            while (retry < maxRetries) {
                await new Promise(r => setTimeout(r, pollInterval));
                result = await this.checkJob(jobId);

                if (result?.image_url?.length) {
                    logger.info(
                        `[FACESWAP] Job completed | job_id=${jobId} | ` +
                        `attempts=${retry + 1} | downloading image...`
                    );

                    // Download the result image
                    const imageBuffer = await this.downloadResultImage(result.image_url[0]);

                    return {
                        success: true,
                        job_id: jobId,
                        buffer: imageBuffer,
                        metadata: {
                            width: result.width,
                            height: result.height,
                            format: result.format,
                            image_url: result.image_url[0]
                        }
                    };
                }

                retry++;
                logger.debug(`[FACESWAP] Polling job ${jobId} (${retry}/${maxRetries})...`);
            }

            throw new Error('Face swap timeout after ' + (maxRetries * pollInterval / 1000) + ' seconds');

        } catch (error) {
            logger.error(`[FACESWAP] Error: ${error.message}`);
            
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
    try {
        const metadata = await sharp(buffer).metadata();
        dimensions = {
            width: metadata.width || 0,
            height: metadata.height || 0
        };
    } catch (e) {
        logger.warn(`[FACESWAP] Could not get image dimensions: ${e.message}`);
    }

    return {
        buffer,
        contentType,
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
    name: "Face Swap",
    description: "Swap faces between two images using AI and return image directly",
    category: "Image",
    methods: ["GET"],
    params: ["source_url", "target_url"],

    paramsSchema: {
        source_url: {
            type: "string",
            required: true,
            default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
            description: "URL gambar sumber (wajah yang akan dipindahkan)"
        },
        target_url: {
            type: "string",
            required: true,
            default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
            description: "URL gambar target (wajah yang akan diganti)"
        }
    },

    async run(req, res) {
        const client = new FaceSwapClient();
        
        try {
            const { source_url, target_url } = req.query || {};

            // Validasi parameter
            if (!source_url || !target_url) {
                return res.status(400).json({
                    status: false,
                    message: "Parameter 'source_url' dan 'target_url' wajib diisi",
                    code: "MISSING_PARAMETERS"
                });
            }

            // Validasi URL format
            if (!validateUrl(source_url) || !validateUrl(target_url)) {
                return res.status(400).json({
                    status: false,
                    message: "Format URL tidak valid",
                    code: "INVALID_URL"
                });
            }

            /* =======================================
               FACE SWAP PROCESS
            ======================================= */

            // 1. Download source image
            logger.info(`[FACESWAP] Downloading source image from: ${source_url.substring(0, 50)}...`);
            const source = await downloadImage(source_url);
            
            // 2. Download target image
            logger.info(`[FACESWAP] Downloading target image from: ${target_url.substring(0, 50)}...`);
            const target = await downloadImage(target_url);

            logger.info(
                `[FACESWAP] Images downloaded | ` +
                `source=${source.sizeMB.toFixed(2)}MB (${source.contentType}) ${source.dimensions.width}x${source.dimensions.height} | ` +
                `target=${target.sizeMB.toFixed(2)}MB (${target.contentType}) ${target.dimensions.width}x${target.dimensions.height}`
            );

            // 3. Process face swap
            logger.info(`[FACESWAP] Processing face swap...`);
            const result = await client.swapFaces(source.buffer, target.buffer);

            if (!result.success || !result.buffer) {
                throw new Error("Gagal memproses face swap");
            }

            // Dapatkan metadata gambar hasil
            const resultMetadata = await sharp(result.buffer).metadata();

            // Log success
            logger.info(
                `[FACESWAP] Success | ip=${req.ip} | ` +
                `job_id=${result.job_id} | ` +
                `dimensions=${resultMetadata.width}x${resultMetadata.height} | ` +
                `size=${(result.buffer.length / 1024).toFixed(2)}KB`
            );

            // Set headers untuk response gambar
            res.setHeader("Content-Type", "image/png");
            res.setHeader("Content-Length", result.buffer.length);
            res.setHeader("Cache-Control", "public, max-age=86400"); // Cache 1 hari
            res.setHeader("X-AI-Processor", "lovefaceswap.com");
            res.setHeader("X-Transformer", "faceswap");
            res.setHeader("X-Job-ID", result.job_id);
            res.setHeader("X-Image-Width", resultMetadata.width);
            res.setHeader("X-Image-Height", resultMetadata.height);
            res.setHeader("X-Source-Size", `${source.sizeMB.toFixed(2)}MB`);
            res.setHeader("X-Target-Size", `${target.sizeMB.toFixed(2)}MB`);
            res.setHeader("X-Source-Dimensions", `${source.dimensions.width}x${source.dimensions.height}`);
            res.setHeader("X-Target-Dimensions", `${target.dimensions.width}x${target.dimensions.height}`);
            
            // Send buffer langsung
            return res.send(result.buffer);

        } catch (err) {
            // Detailed error logging
            logger.error(
                `[FACESWAP] Error | ip=${req.ip} | ` +
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
                message: err.message || "Gagal memproses face swap",
                code: "INTERNAL_ERROR"
            });
        }
    },
};