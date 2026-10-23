/**
 * 【 SparkPix Free HD Upscale 】
 * Creator  : rhmt
 * Base     : https://sparkpix.ai/
 * Category : Upscaler
 * Desc     : Free HD image upscaler 4K/6K/8K + optional face enhancement
 */

import axios from "axios"
import logger from "../../src/utils/logger.js"

const API = "https://sparkpix.ai/api/free-hd-upscale"
const REFERER = "https://sparkpix.ai/aitools/free-hd-upscaler"

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36"

function parseQuality(input = "4k") {
    const raw = String(input).toLowerCase().replace(/\s+/g, "")
    if (["8k", "4", "4x"].includes(raw)) return { quality: "8K", scale: "4" }
    if (["6k", "3", "3x"].includes(raw)) return { quality: "6K", scale: "3" }
    return { quality: "4K", scale: "2" }
}

export default {
    name: "SparkPix HD Upscale",
    description: "Free HD image upscaler 4K/6K/8K with optional face enhancement",
    category: "Image HD",
    methods: ["GET", "POST"],
    params: ["url", "quality", "face"],

    paramsSchema: {
        url: {
            type: "string",
            required: true,
            default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
            description: "URL gambar yang akan di-upscale",
            example: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg"
        },
        quality: {
            type: "string",
            required: false,
            default: "4k",
            enum: ["4k", "6k", "8k"],
            description: "Kualitas output (4K=2x, 6K=3x, 8K=4x)"
        },
        face: {
            type: "string",
            required: false,
            default: "false",
            enum: ["true", "false"],
            description: "Face enhancement"
        }
    },

    async run(req, res) {
        try {
            const url = req.method === "POST" ? req.body?.url : req.query?.url
            const quality = (req.method === "POST" ? req.body?.quality : req.query?.quality) || "4k"
            const faceRaw = (req.method === "POST" ? req.body?.face : req.query?.face) || "false"
            const faceEnhance = ["true", "1", "yes"].includes(String(faceRaw).toLowerCase())

            if (!url) {
                return res.status(400).json({
                    status: false,
                    message: "Parameter 'url' wajib diisi"
                })
            }

            const { quality: qLabel, scale } = parseQuality(quality)

            const started = Date.now()

            const apiResponse = await axios.post(API, {
                imageUrl: url,
                scale,
                face_enhance: faceEnhance
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'accept': '*/*',
                    'origin': 'https://sparkpix.ai',
                    'referer': REFERER,
                    'user-agent': UA
                },
                timeout: 120000
            })

            const json = apiResponse.data

            if (!json?.success || !json?.resultUrl) {
                throw new Error(JSON.stringify({
                    status_code: apiResponse.status,
                    response: json
                }))
            }

            const resultUrl = json.resultUrl
            const downloadUrl = `https://sparkpix.ai/api/download-image?url=${encodeURIComponent(resultUrl)}`
            const processingTime = json.processingTime ?? (Date.now() - started)

            logger.info(`[SPARKPIX] Upscale done | quality=${qLabel} | face=${faceEnhance} | time=${processingTime}ms | ip=${req.ip}`)

            // 3. Return JSON response with result
            return res.json({
                status: true,
                quality: qLabel,
                scale: `${scale}x`,
                result: resultUrl,
                download: downloadUrl
            })

        } catch (err) {
            logger.error(`[SPARKPIX] Error | ip=${req.ip} | error=${err.message}`)

            if (err.code === "ECONNABORTED") {
                return res.status(504).json({
                    status: false,
                    message: "Timeout mengambil gambar atau proses upscale terlalu lama"
                })
            }

            return res.status(500).json({
                status: false,
                message: err.message || "Gagal memproses upscale"
            })
        }
    }
}
