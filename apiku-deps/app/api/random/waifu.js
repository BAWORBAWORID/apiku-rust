/**
 * Random Waifu API (Direct Image Response)
 * Provider: waifu.im
 * Anti-cache implementation
 *
 * Endpoint:
 *   GET /api/random/waifu
 *
 * Result:
 *   - Browser langsung menampilkan gambar
 *   - Gambar SELALU berbeda
 *   - Tidak bisa di-cache (browser / proxy / CDN)
 */

import axios from "axios"
import logger from "../../src/utils/logger.js"

const API_URL = "https://api.waifu.im/images"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"

async function getRandomWaifuImage() {
    const { data } = await axios.get(API_URL, {
        timeout: 15000,
        headers: {
            "User-Agent": UA,
            "Accept": "application/json"
        }
    })

    const item = data?.items?.[0]
    if (!item?.url) {
        throw new Error("Invalid response: missing image URL")
    }

    const imageResponse = await axios.get(item.url, {
        responseType: "arraybuffer",
        timeout: 30000,
        headers: {
            "User-Agent": UA,
            "Accept": "image/*"
        }
    })

    return {
        buffer: imageResponse.data,
        contentType: imageResponse.headers['content-type'] || 'image/jpeg',
        contentLength: imageResponse.headers['content-length'],
        url: item.url,
        id: item.id,
        artist: item.artists?.[0]?.name || null,
        tags: item.tags?.map(t => t.name) || []
    }
}

export default {
    name: "Random Waifu",
    description: "Random waifu image — gambar anime berkualitas tinggi, selalu berbeda setiap request",
    category: "Random",
    methods: ["GET"],
    params: [],

    async run(req, res) {
        try {
            const imageData = await getRandomWaifuImage()

            res.setHeader("Content-Type", imageData.contentType)
            if (imageData.contentLength) {
                res.setHeader("Content-Length", imageData.contentLength)
            }

            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0, no-transform")
            res.setHeader("Pragma", "no-cache")
            res.setHeader("Expires", "0")
            res.setHeader("Surrogate-Control", "no-store")
            res.setHeader("ETag", `"${Date.now()}-${Math.random().toString(36).substr(2, 9)}"`)
            res.setHeader("Last-Modified", new Date().toUTCString())
            res.setHeader("Vary", "User-Agent, Accept-Encoding, *")
            res.setHeader("X-Content-Type-Options", "nosniff")

            logger.info(`[WAIFU] Sent | id=${imageData.id} | artist=${imageData.artist} | size=${imageData.buffer.length} | ip=${req.ip}`)

            return res.end(imageData.buffer)

        } catch (err) {
            logger.error(`[WAIFU] Error | ${err.message}`)

            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate")
            res.setHeader("Pragma", "no-cache")

            return res.status(503).json({
                status: false,
                message: "Waifu service unavailable",
                reason: err.message,
                timestamp: Date.now()
            })
        }
    }
}
