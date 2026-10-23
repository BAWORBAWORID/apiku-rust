/**
 * Random Seegore API - Get random gore content from Seegore
 * 
 * GET /api/randomseegore
 * 
 * result: 
 * - JSON response dengan random gore content beserta detail video
 */

import axios from "axios";
import * as cheerio from "cheerio";
import logger from "../../src/utils/logger.js";

// ==================== Type Definitions ====================
/**
 * @typedef {Object} LinkData
 * @property {string} title
 * @property {string} link
 * @property {string|undefined} thumb
 * @property {string} view
 * @property {string} vote
 * @property {string} tag
 * @property {string} comment
 */

/**
 * @typedef {Object} DetailedData
 * @property {string} title
 * @property {string} source
 * @property {string|undefined} thumb
 * @property {string} tag
 * @property {string} upload
 * @property {string} author
 * @property {string} comment
 * @property {string} vote
 * @property {string} view
 * @property {string|undefined} video1
 * @property {string|undefined} video2
 */

// ==================== Seegore Client ====================
class SeegoreClient {
    /**
     * Fetch detailed data from individual post page
     * @param {LinkData} linkData - Basic link data from listing
     * @returns {Promise<DetailedData>}
     */
    async fetchDetailedData(linkData) {
        try {
            logger.info(`[SEEGORE] Fetching details from: ${linkData.link.substring(0, 50)}...`);
            
            const res = await axios({
                method: 'get',
                url: linkData.link,
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const $ = cheerio.load(res.data);
            
            // Extract detailed data
            const detailed = {
                title: $("h1.entry-title, h1").first().text().trim() || linkData.title,
                source: linkData.link,
                thumb: linkData.thumb,
                tag: $("a[href*='/tag/'], a[href*='/category/']").map((i, el) => $(el).text().trim()).get().filter(t => !["Home", "Previous", "Next"].includes(t)).slice(0, 5).join(", ") || linkData.tag,
                upload: $("time").first().text().trim(),
                author: $(".author a, .entry-author a").text().trim() || "SeeGore",
                comment: linkData.comment || "",
                vote: linkData.vote || "",
                view: $("[class*='view']").text().replace(/\s+/g, " ").trim() || linkData.view || "",
                video1: $("video source").attr("src") || $("video").attr("src") || undefined,
                video2: $("video source").eq(1).attr("src") || $("video a").attr("href") || undefined
            };

            logger.info(`[SEEGORE] Details fetched successfully for: ${detailed.title.substring(0, 30)}...`);
            
            return detailed;

        } catch (error) {
            logger.error(`[SEEGORE] Fetch detailed error: ${error.message}`);
            throw new Error(`Fetching detailed data failed: ${error.message}`);
        }
    }

    /**
     * Scrape random content from Seegore
     * @returns {Promise<DetailedData>}
     */
    async getRandomContent() {
        try {
            // Random page between 1 and 250
            const page = Math.floor(Math.random() * 250) + 1;
            const targetUrl = page === 1 ? "https://seegore.com/gore/" : `https://seegore.com/gore/page/${page}/`;
            logger.info(`[SEEGORE] Scraping page: ${page} -> ${targetUrl}`);
            
            // Fetch listing page
            const res = await axios({
                method: 'get',
                url: targetUrl,
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });

            const $ = cheerio.load(res.data);
            
            // Extract links from articles
            const links = $("article").map((i, el) => {
                const title = $(el).find("h2").text().trim();
                const link = $(el).find("a").attr("href") || "";
                const thumb = $(el).find("img").attr("src") || $(el).find("img").attr("data-src");
                const view = $(el).find("[class*='view']").text().replace(/\s+/g, ' ').trim();
                const vote = $(el).find("[class*='vote']").text().replace(/\s+/g, ' ').trim();
                const tag = $(el).find("[class*='cat'] a, [class*='tag'] a").map((_, a) => $(a).text().trim()).get().join(", ");
                return {
                    title,
                    link,
                    thumb,
                    view,
                    vote,
                    tag,
                    comment: ""
                };
            }).get().filter(item => item.title && item.link);

            if (links.length === 0) {
                throw new Error("No links found on the scraped page.");
            }

            logger.info(`[SEEGORE] Found ${links.length} items on page ${page}`);

            // Select random link
            const randomIndex = Math.floor(Math.random() * links.length);
            const randomLink = links[randomIndex];
            
            logger.info(`[SEEGORE] Selected random item #${randomIndex}: "${randomLink.title.substring(0, 30)}..."`);

            // Fetch detailed data
            const detailedData = await this.fetchDetailedData(randomLink);

            return {
                success: true,
                data: detailedData,
                metadata: {
                    page: page,
                    total_items: links.length,
                    selected_index: randomIndex
                }
            };

        } catch (error) {
            logger.error(`[SEEGORE] Scraping error: ${error.message}`);
            
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
    name: "Random Seegore",
    description: "Get random gore content from Seegore (Warning: Graphic Content)",
    category: "Random",
    methods: ["GET"],
    params: [],

    paramsSchema: {},

    async run(req, res) {
        const client = new SeegoreClient();
        
        try {
            /* =======================================
               RANDOM SEEGORE PROCESS
            ======================================= */

            // Get random content
            const result = await client.getRandomContent();

            if (!result.success || !result.data) {
                throw new Error("Gagal mendapatkan konten dari Seegore");
            }

            // Log success
            logger.info(
                `[SEEGORE] Success | ip=${req.ip} | ` +
                `page=${result.metadata.page} | ` +
                `title="${result.data.title.substring(0, 30)}..." | ` +
                `has_video=${result.data.video1 ? 'yes' : 'no'}`
            );

            // Set headers
            res.setHeader("Content-Type", "application/json");
            res.setHeader("X-Page", result.metadata.page);
            res.setHeader("X-Total-Items", result.metadata.total_items);
            res.setHeader("X-Selected-Index", result.metadata.selected_index);
            res.setHeader("X-Title", encodeURIComponent(result.data.title));
            res.setHeader("X-Has-Video", result.data.video1 ? 'true' : 'false');
            
            // NO CACHE HEADERS
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
            res.setHeader("Surrogate-Control", "no-store");
            
            // Add warning header for graphic content
            res.setHeader("X-Content-Warning", "Graphic content may be disturbing");
            
            // Return JSON response
            return res.json({
                status: true,
                result: result.data
            });

        } catch (err) {
            // Detailed error logging
            logger.error(
                `[SEEGORE] Error | ip=${req.ip} | ` +
                `message=${err.message} | code=${err.code || 'N/A'}`
            );
            
            // Check specific errors
            if (err.message.includes("No links found")) {
                return res.status(404).json({
                    status: false,
                    message: "Tidak ada konten ditemukan pada halaman tersebut",
                    code: "NO_CONTENT_FOUND"
                });
            }
            
            if (err.message.includes("Fetching detailed data failed")) {
                return res.status(502).json({
                    status: false,
                    message: "Gagal mengambil detail konten",
                    code: "DETAIL_FETCH_FAILED"
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
                    message: "Timeout mengambil data dari Seegore",
                    code: "TIMEOUT"
                });
            }
            
            return res.status(500).json({
                status: false,
                message: err.message || "Gagal mendapatkan konten random dari Seegore",
                code: "INTERNAL_ERROR"
            });
        }
    },
};