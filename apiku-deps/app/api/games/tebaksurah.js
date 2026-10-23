/**
 * Tebak Surah Game API - Get random Quran verse for guessing game
 * 
 * GET /api/games/surah
 * POST /api/games/surah
 * 
 * result: 
 * - JSON response with Quran verse details
 */

import axios from "axios";
import logger from "../../src/utils/logger.js";

// ==================== Tebak Surah Client ====================
class TebakSurahClient {
    async getRandomAyah() {
        try {
            // Generate random ayah number (1-6236)
            const randomAyah = Math.floor(Math.random() * 6236) + 1;
            
            logger.info(`[SURAH] Fetching ayah #${randomAyah} from Quran API`);
            
            // Try without proxy first
            const url = `https://api.alquran.cloud/v1/ayah/${randomAyah}/ar.alafasy`;
            
            const response = await axios({
                method: 'get',
                url: url,
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            if (response.status === 200 && response.data && response.data.data) {
                const ayahData = response.data.data;
                
                logger.info(
                    `[SURAH] Success | ` +
                    `surah=${ayahData.surah.name} | ` +
                    `ayah=${ayahData.numberInSurah}`
                );

                return {
                    success: true,
                    data: ayahData,
                    metadata: {
                        surah: ayahData.surah.name,
                        ayah: ayahData.numberInSurah,
                        juz: ayahData.juz
                    }
                };
            } else {
                throw new Error("Data not found");
            }

        } catch (error) {
            logger.error(`[SURAH] Error: ${error.message}`);
            
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
    name: "Tebak Surah",
    description: "Get random Quran verses for surah guessing game",
    category: "Games",
    methods: ["GET", "POST"],
    params: [],

    paramsSchema: {},

    async run(req, res) {
        const client = new TebakSurahClient();
        
        try {
            // Get random ayah
            const result = await client.getRandomAyah();

            if (!result.success || !result.data) {
                throw new Error("Gagal mendapatkan ayat Al-Quran");
            }

            // Log success
            logger.info(
                `[SURAH] Success | ip=${req.ip} | ` +
                `method=${req.method} | ` +
                `surah="${result.data.surah.name}"`
            );

            // Set headers - NO CACHE
            res.setHeader("Content-Type", "application/json");
            
            // NO CACHE HEADERS
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
            res.setHeader("Surrogate-Control", "no-store");
            
            // Return JSON response
            return res.json({
                status: true,
                result: result.data
            });

        } catch (err) {
            // Detailed error logging
            logger.error(
                `[SURAH] Error | ip=${req.ip} | ` +
                `message=${err.message} | code=${err.code || 'N/A'}`
            );
            
            // Check specific errors
            if (err.message.includes("Data not found")) {
                return res.status(404).json({
                    status: false,
                    message: "Ayat tidak ditemukan",
                    code: "AYAH_NOT_FOUND"
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
                    message: "Timeout mengambil data dari Quran API",
                    code: "TIMEOUT"
                });
            }
            
            return res.status(500).json({
                status: false,
                message: err.message || "Gagal mendapatkan ayat Al-Quran",
                code: "INTERNAL_ERROR"
            });
        }
    },
};