/**
 * Photooxy API - Create text effects with various styles from photooxy.com
 * 
 * GET /api/ephoto/photooxy?effect=flaming&text=Ourin-AI
 * POST /api/ephoto/photooxy with JSON body { "effect": "...", "text": "...", "text2": "..." }
 * 
 * result: 
 * - Mengembalikan langsung gambar hasil efek text
 */

import logger from "../../src/utils/logger.js";
import crypto from "crypto";

// ==================== PHOTOOXY EFFECTS ====================
const PHOTOOXY_EFFECTS = {
    flaming: { url: "https://photooxy.com/logo-and-text-effects/realistic-flaming-text-effect-online-197.html", textCount: 1, desc: "Realistic Flaming Text Effect" },
    "shadow-sky": { url: "https://photooxy.com/logo-and-text-effects/shadow-text-effect-in-the-sky-394.html", textCount: 1, desc: "Shadow Text Effect in the Sky" },
    metallic: { url: "https://photooxy.com/other-design/create-metallic-text-glow-online-188.html", textCount: 1, desc: "Metallic Text Glow" },
    naruto: { url: "https://photooxy.com/manga-and-anime/make-naruto-banner-online-free-378.html", textCount: 1, desc: "Naruto Banner" },
    pubg: { url: "https://photooxy.com/battlegrounds/make-wallpaper-battlegrounds-logo-text-146.html", textCount: 2, desc: "PUBG Wallpaper Logo Text" },
    "under-grass": { url: "https://photooxy.com/logo-and-text-effects/make-quotes-under-grass-376.html", textCount: 1, desc: "Quotes Under Grass" },
    "harry-potter": { url: "https://photooxy.com/logo-and-text-effects/create-harry-potter-text-on-horror-background-178.html", textCount: 1, desc: "Harry Potter Text on Horror Background" },
    "flower-typography": { url: "https://photooxy.com/art-effects/flower-typography-text-effect-164.html", textCount: 1, desc: "Flower Typography Text Effect" },
    "picture-of-love": { url: "https://photooxy.com/logo-and-text-effects/create-a-picture-of-love-message-377.html", textCount: 1, desc: "Picture of Love Message" },
    "coffee-cup": { url: "https://photooxy.com/logo-and-text-effects/put-any-text-in-to-coffee-cup-371.html", textCount: 1, desc: "Text on Coffee Cup" },
    butterfly: { url: "https://photooxy.com/logo-and-text-effects/butterfly-text-with-reflection-effect-183.html", textCount: 1, desc: "Butterfly Text with Reflection" },
    "night-sky": { url: "https://photooxy.com/logo-and-text-effects/write-stars-text-on-the-night-sky-200.html", textCount: 1, desc: "Stars Text on Night Sky" },
    "carved-wood": { url: "https://photooxy.com/logo-and-text-effects/carved-wood-effect-online-171.html", textCount: 1, desc: "Carved Wood Effect" },
    "illuminated-metallic": { url: "https://photooxy.com/logo-and-text-effects/illuminated-metallic-effect-177.html", textCount: 1, desc: "Illuminated Metallic Effect" },
    "sweet-candy": { url: "https://photooxy.com/logo-and-text-effects/sweet-andy-text-online-168.html", textCount: 1, desc: "Sweet Candy Text" }
};

// ==================== SIMPLE IN-MEMORY CACHE ====================
const cache = new Map();
const CACHE_TTL = 3600;

function generateCacheKey(effect, texts) {
    const data = { effect, texts };
    return `photooxy:${crypto.createHash('md5').update(JSON.stringify(data)).digest('hex')}`;
}

// ==================== MAIN PHOTOOXY FUNCTION (PUPPETEER) ====================
async function photooxy(effectName, texts) {
    const effect = PHOTOOXY_EFFECTS[effectName];
    if (!effect) {
        throw new Error(`Effect "${effectName}" tidak ditemukan`);
    }

    const { default: puppeteer } = await import('puppeteer');

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 720 });

        logger.info(`[PHOTOOXY] Navigating to ${effectName}...`);
        await page.goto(effect.url, { waitUntil: 'networkidle0', timeout: 30000 });

        const inputs = await page.$$('#main-form input[type="text"]');
        for (let i = 0; i < Math.min(texts.length, inputs.length); i++) {
            await inputs[i].type(texts[i], { delay: 30 });
        }

        await page.click('#main-form button[type="submit"], #main-form input[type="submit"]');

        logger.info('[PHOTOOXY] Waiting for result...');
        await new Promise(r => setTimeout(r, 15000));

        const result = await page.evaluate(() => {
            const img = document.querySelector(
                '.result img, #result img, .preview img, #preview img, ' +
                '.show-image img, img[alt*="result"], img[src*="yotools"]'
            );
            if (img) {
                const src = img.src || img.getAttribute('src');
                if (src) return { type: 'img', url: src };
            }
            const link = document.querySelector(
                'a[href*="yotools"], a[href*="download"], a[href*="result"]'
            );
            if (link) return { type: 'link', url: link.href };
            return null;
        });

        if (!result || !result.url) {
            await page.screenshot({ path: '/tmp/photooxy-debug.png', fullPage: true });
            throw new Error('Image not found, check /tmp/photooxy-debug.png');
        }

        logger.info(`[PHOTOOXY] Found result: ${result.type} - ${result.url}`);

        const viewSource = await page.goto(result.url, { waitUntil: 'networkidle0' });
        const buffer = await viewSource.buffer();

        return {
            buffer: Buffer.from(buffer),
            url: result.url,
            effect: effectName,
            text: texts.join(' | ')
        };

    } catch (error) {
        logger.error(`[PHOTOOXY] Error: ${error.message}`);
        throw error;
    } finally {
        await browser.close();
    }
}

// ==================== MAIN ENDPOINT ====================
export default {
    name: "Photooxy Text Effects",
    description: "Create text effects with various styles",
    category: "Ephoto",
    methods: ["GET", "POST"],
    params: ["effect", "text", "text2"],

    paramsSchema: {
        effect: {
            type: "string",
            required: true,
            enum: Object.keys(PHOTOOXY_EFFECTS),
            description: "Nama effect photooxy (lihat daftar di /api/ephoto/photooxy/list)"
        },
        text: {
            type: "string",
            required: true,
            minLength: 1,
            maxLength: 100,
            description: "Teks utama yang akan diberi effect"
        },
        text2: {
            type: "string",
            required: false,
            minLength: 1,
            maxLength: 100,
            description: "Teks kedua (hanya untuk effect yang membutuhkan 2 teks, seperti pubg)"
        }
    },

    async run(req, res) {
        try {
            const params = req.method === 'POST' ? req.body : req.query;
            const { effect, text, text2 } = params;

            // Special case: list all effects
            if (req.path?.endsWith('/list') || effect === 'list') {
                const effectsList = Object.entries(PHOTOOXY_EFFECTS).map(([name, config]) => ({
                    name,
                    url: config.url,
                    description: config.desc,
                    textCount: config.textCount
                }));

                return res.status(200).json({
                    status: true,
                    message: "Daftar effect photooxy",
                    total: effectsList.length,
                    effects: effectsList
                });
            }

            if (!effect) {
                return res.status(400).json({
                    status: false,
                    message: "Parameter 'effect' wajib diisi. Gunakan /api/ephoto/photooxy/list untuk melihat daftar effect",
                    code: "MISSING_EFFECT",
                    available_effects: Object.keys(PHOTOOXY_EFFECTS)
                });
            }

            if (!text) {
                return res.status(400).json({
                    status: false,
                    message: "Parameter 'text' wajib diisi",
                    code: "MISSING_TEXT"
                });
            }

            // Validasi effect
            const validEffects = Object.keys(PHOTOOXY_EFFECTS);
            if (!validEffects.includes(effect)) {
                return res.status(400).json({
                    status: false,
                    message: `Effect "${effect}" tidak valid`,
                    code: "INVALID_EFFECT",
                    available_effects: validEffects,
                    hint: "Gunakan /api/ephoto/photooxy/list untuk melihat daftar effect yang tersedia"
                });
            }

            const effectConfig = PHOTOOXY_EFFECTS[effect];

            // Validasi text count
            const texts = [text];
            if (effectConfig.textCount === 2) {
                if (!text2) {
                    return res.status(400).json({
                        status: false,
                        message: `Effect "${effect}" membutuhkan 2 teks. Gunakan parameter 'text' dan 'text2'`,
                        code: "MISSING_TEXT2"
                    });
                }
                texts.push(text2);
            }

            if (text.length > 100 || (text2 && text2.length > 100)) {
                return res.status(400).json({
                    status: false,
                    message: "Text terlalu panjang. Maksimal 100 karakter per teks.",
                    code: "TEXT_TOO_LONG"
                });
            }

            // Cek cache
            const cacheKey = generateCacheKey(effect, texts);
            const cached = cache.get(cacheKey);
            if (cached) {
                logger.info(`[PHOTOOXY] Cache hit for ${effect}`);
                res.setHeader("Content-Type", "image/png");
                res.setHeader("Content-Length", cached.length);
                res.setHeader("X-Cache-Hit", "true");
                res.setHeader("X-Effect", effect);
                return res.end(cached);
            }

            // Proses efek
            logger.info(`[PHOTOOXY] Processing request | effect=${effect} | texts="${texts.join(', ')}" | ip=${req.ip}`);

            const startTime = Date.now();
            const result = await photooxy(effect, texts);
            const processingTime = Date.now() - startTime;

            // Simpan ke cache
            cache.set(cacheKey, result.buffer);
            setTimeout(() => cache.delete(cacheKey), CACHE_TTL * 1000);

            logger.info(
                `[PHOTOOXY] Success | ip=${req.ip} | ` +
                `effect=${effect} | ` +
                `time=${processingTime}ms | ` +
                `output_size=${(result.buffer.length / 1024).toFixed(2)}KB`
            );

            res.setHeader("Content-Type", "image/png");
            res.setHeader("Content-Length", result.buffer.length);
            res.setHeader("X-Processing-Time", `${processingTime}ms`);
            res.setHeader("X-Effect", effect);
            res.setHeader("X-Text", encodeURIComponent(texts.join(' | ')));
            res.setHeader("X-Image-URL", result.url);
            res.setHeader("X-Cache-Hit", "false");

            return res.end(result.buffer);

        } catch (err) {
            logger.error(`[PHOTOOXY] Error | ip=${req.ip} | message=${err.message}`);

            if (err.message.includes("Image not found")) {
                return res.status(502).json({
                    status: false,
                    message: "Gagal memuat gambar hasil. Mungkin effect sedang tidak tersedia.",
                    code: "IMAGE_ERROR"
                });
            }

            if (err.message.includes("timeout") || err.code === "ECONNABORTED") {
                return res.status(504).json({
                    status: false,
                    message: "Timeout memproses gambar",
                    code: "TIMEOUT"
                });
            }

            return res.status(500).json({
                status: false,
                message: err.message || "Gagal memproses efek text",
                code: "INTERNAL_ERROR"
            });
        }
    },
};
