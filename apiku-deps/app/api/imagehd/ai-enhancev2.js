/**
 * AI Enhance-HD Image API v2
 * 
 * GET /tools/ai-enhance-v2?url=https://example.com/photo.jpg&size=4
 * 
 * result: 
 * - Langsung menampilkan gambar enhanced di browser
 * 
 * Author : Gienetic
 * Base   : https://play.google.com/store/apps/details?id=photoeditor.photocut.background.eraser.collagemaker.cutout
 * Updated: Menggunakan API upscalepics.com dengan dukungan scale 2x,4x,6x,8x (max)
 */

import axios from "axios"
import FormData from "form-data"
import Jimp from "jimp"
import logger from "../../src/utils/logger.js"
import crypto from "crypto"
import { fileTypeFromBuffer } from "file-type"

// Valid scales yang didukung API (max 8x)
const VALID_SCALES = [2, 4, 6, 8]

/**
 * Upscale image menggunakan API upscalepics.com
 * @param {Buffer} buffer - Image buffer
 * @param {number} size - Scale factor (2,4,6,8)
 * @returns {Promise<Object>} - Result object with image URL
 */
const upscale = async (buffer, size = 4) => {
    try {
        return await new Promise((resolve, reject) => {
            // Validasi input
            if (!buffer) return reject(new Error("Buffer input is undefined!"))
            if (!Buffer.isBuffer(buffer)) return reject(new Error("Invalid buffer input"))
            if (!VALID_SCALES.includes(Number(size))) {
                return reject(new Error(`Invalid scale size! Must be one of: ${VALID_SCALES.join(', ')}`))
            }

            // Baca gambar dengan Jimp untuk mendapatkan dimensi
            Jimp
                .read(buffer)
                .then((image) => {
                    const { width, height } = image.bitmap
                    const newWidth = width * size
                    const newHeight = height * size
                    
                    const timestamp = Date.now()
                    const filename = `upscale-${timestamp}.png`

                    const form = new FormData()
                    form.append("name", `upscale-${timestamp}`)
                    form.append("imageName", `upscale-${timestamp}`)
                    form.append("desiredHeight", newHeight.toString())
                    form.append("desiredWidth", newWidth.toString())
                    form.append("outputFormat", "png")
                    form.append("compressionLevel", "none")
                    form.append("anime", "false") // Selalu false untuk versi ini
                    form.append("image_file", buffer, {
                        filename: filename,
                        contentType: "image/png",
                    })

                    logger.info(`[UPSCALE] Uploading image | size=${size}x | dimensions=${width}x${height} -> ${newWidth}x${newHeight}`)

                    axios
                        .post("https://api.upscalepics.com/upscale-to-size", form, {
                            headers: {
                                ...form.getHeaders(),
                                'Origin': 'https://upscalepics.com',
                                'Referer': 'https://upscalepics.com',
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                'Accept': 'application/json',
                            },
                            timeout: 60000, // 60 detik untuk proses upscale
                            maxContentLength: Infinity,
                            maxBodyLength: Infinity
                        })
                        .then((res) => {
                            const data = res.data
                            
                            if (data.error) {
                                logger.error(`[UPSCALE] API Error: ${data.error}`)
                                return reject(new Error("Error from upscaler API: " + data.error))
                            }
                            
                            if (!data.bgRemoved && !data.image) {
                                return reject(new Error("No image URL in response"))
                            }
                            
                            // API mengembalikan URL gambar di field bgRemoved
                            const imageUrl = data.bgRemoved || data.image
                            
                            logger.info(`[UPSCALE] Success | imageUrl=${imageUrl.substring(0, 50)}...`)
                            
                            resolve({
                                status: true,
                                image: imageUrl,
                                width: newWidth,
                                height: newHeight
                            })
                        })
                        .catch((err) => {
                            logger.error(`[UPSCALE] Axios Error: ${err.message}`)
                            reject(new Error(`Failed to connect to upscaler API: ${err.message}`))
                        })
                })
                .catch((err) => {
                    logger.error(`[UPSCALE] Jimp Error: ${err.message}`)
                    reject(new Error(`Failed to process image: ${err.message}`))
                })
        })
    } catch (e) {
        logger.error(`[UPSCALE] Unexpected error: ${e.message}`)
        return {
            status: false,
            message: e.message
        }
    }
}

// Fungsi download gambar dari URL
const downloadImage = async (url) => {
    try {
        const response = await axios.get(url, { 
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        })
        
        return Buffer.from(response.data)
    } catch (e) {
        logger.error(`[DOWNLOAD] Failed: ${e.message}`)
        return null
    }
}

export default {
    name: "AI Enhance HD v2",
    description: "Enhance image resolution using AI with scale options (2x,4x,6x,8x max)",
    category: "Image HD",
    methods: ["GET"],
    params: ["url", "size"],

    paramsSchema: {
        url: {
            type: "string",
            required: true,
            default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
            description: "URL gambar yang akan di-enhance"
        },
        size: {
            type: "number",
            required: false,
            default: 4,
            enum: [2, 4, 6, 8],
            description: "Faktor skala pembesaran (2,4,6,8) - maksimal 8x"
        }
    },

    async run(req, res) {
        try {
            const { url, size = 4 } = req.query || {}

            // Validasi URL
            if (!url) {
                return res.status(400).json({
                    status: false,
                    message: "Parameter 'url' wajib diisi",
                })
            }

            // Validasi size
            const scaleSize = Number(size)
            if (!VALID_SCALES.includes(scaleSize)) {
                return res.status(400).json({
                    status: false,
                    message: `Parameter 'size' tidak valid. Harus salah satu dari: ${VALID_SCALES.join(', ')}`,
                })
            }

            /* =======================================
               AI ENHANCE PROCESS V2 (UPSCALEPICS)
            ======================================= */
            
            logger.info(`[AI-ENHANCE-V2] Starting | ip=${req.ip} | url=${url.substring(0, 50)}... | size=${scaleSize}x`)

            // 1. Download gambar dari URL
            const imageBuffer = await downloadImage(url)
            
            if (!imageBuffer) {
                return res.status(400).json({
                    status: false,
                    message: "Gagal mendownload gambar dari URL yang diberikan",
                })
            }

            // 2. Deteksi tipe file untuk informasi saja
            const fileInfo = await fileTypeFromBuffer(imageBuffer) || { ext: 'jpg', mime: 'image/jpeg' }

            // 3. Proses upscale
            const result = await upscale(imageBuffer, scaleSize)
            
            if (!result.status || !result.image) {
                throw new Error(result.message || "Gagal memproses enhance gambar")
            }

            const resultUrl = result.image
            logger.info(`[AI-ENHANCE-V2] Got result URL | ip=${req.ip} | resultUrl=${resultUrl.substring(0, 50)}...`)

            // 4. Download hasil enhanced image
            const finalImage = await axios.get(resultUrl, {
                responseType: 'arraybuffer',
                timeout: 60000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            })

            const enhancedBuffer = Buffer.from(finalImage.data)

            // 5. Hitung ukuran file untuk logging
            const originalSizeKB = (imageBuffer.length / 1024).toFixed(2)
            const enhancedSizeKB = (enhancedBuffer.length / 1024).toFixed(2)
            const sizeIncrease = ((enhancedBuffer.length / imageBuffer.length) * 100).toFixed(2)

            logger.info(
                `[AI-ENHANCE-V2] Success | ip=${req.ip} | ` +
                `size=${scaleSize}x | ` +
                `original=${originalSizeKB}KB | enhanced=${enhancedSizeKB}KB | ` +
                `increase=${sizeIncrease}%`
            )

            // Determine content type
            let contentType = finalImage.headers['content-type'] || "image/png"
            
            // Fallback jika content-type tidak valid
            if (!contentType.startsWith('image/')) {
                contentType = "image/png"
            }

            // Set header dengan informasi lengkap
            res.setHeader("Content-Type", contentType)
            res.setHeader("X-Enhance-Service", "upscalepics-v2")
            res.setHeader("X-Scale-Factor", scaleSize)
            res.setHeader("X-Original-Size-KB", originalSizeKB)
            res.setHeader("X-Enhanced-Size-KB", enhancedSizeKB)
            res.setHeader("X-Size-Increase-Percent", sizeIncrease)
            res.setHeader("X-Original-Dimensions", result.width ? `${result.width/scaleSize}x${result.height/scaleSize}` : 'unknown')
            res.setHeader("X-Enhanced-Dimensions", result.width ? `${result.width}x${result.height}` : 'unknown')
            
            // Kirim buffer langsung
            return res.send(enhancedBuffer)

        } catch (err) {
            logger.error(
                `[AI-ENHANCE-V2] Error | ip=${req.ip} | error=${err.message}`
            )
            
            // Handle specific errors
            if (err.message.includes("Invalid scale")) {
                return res.status(400).json({
                    status: false,
                    message: err.message,
                })
            }
            
            if (err.message.includes("Buffer input")) {
                return res.status(400).json({
                    status: false,
                    message: "Gambar tidak valid atau corrupt",
                })
            }
            
            if (err.code === "ECONNABORTED" || err.message.includes("timeout")) {
                return res.status(504).json({
                    status: false,
                    message: "Timeout saat memproses gambar",
                })
            }
            
            if (err.response?.status === 404) {
                return res.status(404).json({
                    status: false,
                    message: "Gambar tidak ditemukan di server",
                })
            }
            
            if (err.message.includes("Failed to connect")) {
                return res.status(503).json({
                    status: false,
                    message: "Layanan upscale sedang sibuk, coba lagi nanti",
                })
            }
            
            return res.status(500).json({
                status: false,
                message: err.message || "Gagal memproses AI enhance",
            })
        }
    },
}