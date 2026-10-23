/**
 * Tebak Hero ML Game API - Get random Mobile Legends hero audio
 * 
 * GET /api/games/tebakheroml
 * POST /api/games/tebakheroml
 * 
 * result: 
 * - JSON response with hero name and audio URL
 * 
 * Note: Uses Puppeteer + Stealth to bypass Cloudflare on fandom.com
 */

import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import logger from "../../src/utils/logger.js"

// Setup puppeteer dengan plugin stealth
puppeteer.use(StealthPlugin())

// ==================== Mobile Legends Heroes List (clean, no roles) ====================
const HEROES = [
    "Aamon", "Akai", "Aldous", "Alice", "Alpha", "Alucard", "Angela", "Argus",
    "Arlott", "Atlas", "Aulus", "Aurora", "Badang", "Balmond", "Bane", "Barats",
    "Baxia", "Beatrix", "Belerick", "Benedetta", "Brody", "Bruno", "Carmilla",
    "Cecilion", "Chou", "Cici", "Claude", "Clint", "Cyclops", "Diggie", "Dyrroth",
    "Edith", "Esmeralda", "Estes", "Eudora", "Fanny", "Faramis", "Floryn",
    "Franco", "Fredrinn", "Freya", "Gatotkaca", "Gloo", "Gord", "Granger",
    "Grock", "Guinevere", "Gusion", "Hanabi", "Hanzo", "Harith", "Harley",
    "Hayabusa", "Helcurt", "Hilda", "Hylos", "Irithel", "Ixia", "Jawhead",
    "Johnson", "Joy", "Julian", "Kadita", "Kagura", "Kaja", "Karina", "Karrie",
    "Khaleed", "Khufra", "Kimmy", "Lancelot", "Layla", "Leomord", "Lesley",
    "Ling", "Lolita", "Lunox", "Luo Yi", "Lylia", "Martis", "Masha", "Mathilda",
    "Melissa", "Minotaur", "Minsitthar", "Miya", "Moskov", "Nana", "Natalia",
    "Natan", "Novaria", "Odette", "Paquito", "Pharsa", "Phoveus",
    "Popol and Kupa", "Rafaela", "Roger", "Ruby", "Saber", "Selena", "Silvanna",
    "Sun", "Terizla", "Thamuz", "Tigreal", "Uranus", "Vale", "Valentina",
    "Valir", "Vexana", "Wanwan", "Xavier", "Yin", "Yu Zhong", "Yve", "Zhask",
    "Zilong"
]

// ==================== Tebak Hero ML Client ====================
class TebakHeroMLClient {
    async getRandomHeroAudio() {
        let browser = null

        try {
            // Pick random hero
            const randomHero = HEROES[Math.floor(Math.random() * HEROES.length)]
            logger.info(`[TEBAKHEROML] Selected hero: ${randomHero}`)

            // Format hero name for URL (replace spaces with underscores)
            const formattedHero = randomHero.replace(/ /g, '_')
            const url = `https://mobile-legends.fandom.com/wiki/${formattedHero}/Audio/id`

            logger.info(`[TEBAKHEROML] Launching browser for: ${url}`)

            // Launch browser with stealth
            browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                ],
                ignoreHTTPSErrors: true,
            })

            // Create page
            const page = await browser.newPage()

            // Set user agent
            await page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            )

            // Set viewport
            await page.setViewport({ width: 1280, height: 720 })

            // Navigate to fandom page (bypasses Cloudflare via real browser)
            await page.goto(url, {
                waitUntil: 'networkidle0',
                timeout: 45000
            })

            // Wait a bit for dynamic content to load
            await new Promise(resolve => setTimeout(resolve, 2000))

            // Extract all audio sources from the page
            const audioUrls = await page.evaluate(() => {
                const audioElements = document.querySelectorAll('audio source, audio[src]')
                const sources = []

                audioElements.forEach(el => {
                    const src = el.getAttribute('src') || el.src || ''
                    if (src && src.trim() !== '' && !src.includes('data:') && !src.includes('blank')) {
                        sources.push(src)
                    }
                })

                return sources
            })

            // If no audio found via direct elements, try looking for mp3 links in the page
            let finalAudioUrls = audioUrls

            if (finalAudioUrls.length === 0) {
                logger.info(`[TEBAKHEROML] No audio elements found, trying fallback extraction`)
                
                finalAudioUrls = await page.evaluate(() => {
                    // Look for any links/URLs that end with .mp3 or contain 'audio' or 'sound'
                    const pageText = document.body.innerText || ''
                    const mp3Urls = []

                    // Find all links
                    document.querySelectorAll('a[href*=".mp3"], a[href*="audio"], a[href*="sound"]').forEach(a => {
                        const href = a.getAttribute('href')
                        if (href && href.trim()) {
                            // Make absolute URL if relative
                            if (href.startsWith('//')) mp3Urls.push('https:' + href)
                            else if (href.startsWith('/')) mp3Urls.push('https://mobile-legends.fandom.com' + href)
                            else if (href.startsWith('http')) mp3Urls.push(href)
                        }
                    })

                    // Also check for any data attributes or custom elements
                    document.querySelectorAll('[data-src*="mp3"], [data-audio], [data-sound]').forEach(el => {
                        const val = el.getAttribute('data-src') || el.getAttribute('data-audio') || el.getAttribute('data-sound') || ''
                        if (val && val.trim()) {
                            if (val.startsWith('//')) mp3Urls.push('https:' + val)
                            else if (val.startsWith('/')) mp3Urls.push('https://mobile-legends.fandom.com' + val)
                            else if (val.startsWith('http')) mp3Urls.push(val)
                        }
                    })

                    return mp3Urls
                })
            }

            // Close page
            await page.close().catch(() => {})

            if (finalAudioUrls.length === 0) {
                throw new Error(`No audio found for hero: ${randomHero}`)
            }

            // Pick random audio
            const randomAudio = finalAudioUrls[Math.floor(Math.random() * finalAudioUrls.length)]

            logger.info(
                `[TEBAKHEROML] Success | ` +
                `hero=${randomHero} | ` +
                `total_audio=${finalAudioUrls.length}`
            )

            return {
                success: true,
                data: {
                    name: randomHero,
                    audio: randomAudio
                },
                metadata: {
                    hero: randomHero,
                    total_audio: finalAudioUrls.length
                }
            }

        } catch (error) {
            logger.error(`[TEBAKHEROML] Error: ${error.message}`)
            throw error
        } finally {
            if (browser) await browser.close().catch(() => {})
        }
    }
}

// ==================== MAIN ENDPOINT ====================
export default {
    name: "Tebak Hero ML",
    description: "Get random Mobile Legends hero audio for guessing game (bypasses Cloudflare via Puppeteer)",
    category: "Games",
    methods: ["GET", "POST"],
    params: [],

    paramsSchema: {},

    async run(req, res) {
        const client = new TebakHeroMLClient()

        try {
            // Get random hero audio
            const result = await client.getRandomHeroAudio()

            if (!result.success || !result.data) {
                throw new Error("Gagal mendapatkan audio hero")
            }

            // Log success
            logger.info(
                `[TEBAKHEROML] Success | ip=${req.ip} | ` +
                `method=${req.method} | ` +
                `hero=${result.data.name}`
            )

            // Set headers - NO CACHE
            res.setHeader("Content-Type", "application/json")
            res.setHeader("X-Hero", result.data.name)
            res.setHeader("X-Total-Audio", result.metadata.total_audio)

            // NO CACHE HEADERS
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0")
            res.setHeader("Pragma", "no-cache")
            res.setHeader("Expires", "0")
            res.setHeader("Surrogate-Control", "no-store")

            // Return JSON response
            return res.json({
                status: true,
                result: result.data
            })

        } catch (err) {
            // Detailed error logging
            logger.error(
                `[TEBAKHEROML] Error | ip=${req.ip} | ` +
                `message=${err.message} | code=${err.code || 'N/A'}`
            )

            // Check specific errors
            if (err.message.includes("No audio found")) {
                return res.status(404).json({
                    status: false,
                    message: "Tidak ada audio ditemukan untuk hero tersebut",
                    code: "NO_AUDIO_FOUND"
                })
            }

            if (err.message.includes("Timeout") || err.message.includes("timed out")) {
                return res.status(504).json({
                    status: false,
                    message: "Timeout mengambil data halaman hero",
                    code: "TIMEOUT"
                })
            }

            return res.status(500).json({
                status: false,
                message: err.message || "Gagal mendapatkan audio hero",
                code: "INTERNAL_ERROR"
            })
        }
    },
}
