/**
 * Remove Watermark v2 (Magic Eraser) - imgupscaler.ai magiceraser_v6 with proxy rotation to bypass credit limits
 *
 * GET /api/image/removewm-v2?url=https://example.com/watermarked.jpg
 *
 * result:
 * - Langsung menampilkan gambar hasil tanpa watermark
 *
 * Based on: tes.js (Create: t.me/AwasPhpJir / RestApis: api.ikyyxd.my.id)
 */

import axios from "axios";
import FormData from "form-data";
import logger from "../../src/utils/logger.js";

const IkyyProxy = "https://api.ikyyxd.my.id/v2l/proxy-free/ikyy-xsample";

const CONFIG = {
    baseUrl: "https://api-v2.imgupscaler.ai",
    referer: "https://magiceraser.org/",
    origin: "https://magiceraser.org",
    userAgent: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
};

let PROXY_LIST = [];
let currentProxyIndex = 0;

function generateRandomSerial() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function getCleanHeaders(formHeaders = {}) {
    return {
        "User-Agent": CONFIG.userAgent,
        "Origin": CONFIG.origin,
        "Referer": CONFIG.referer,
        "Product-Code": "magiceraser",
        "Product-Serial": generateRandomSerial(),
        "Router-Key": "photo_editor_me_v6",
        "Sec-Ch-Ua": '"Chromium";v="139", "Not;A=Brand";v="99"',
        "Sec-Ch-Ua-Mobile": "?1",
        "Sec-Ch-Ua-Platform": '"Android"',
        ...formHeaders,
    };
}

function getAxiosInstance() {
    const proxy = PROXY_LIST.length > 0 ? PROXY_LIST[currentProxyIndex] : undefined;
    return axios.create({
        baseURL: CONFIG.baseUrl,
        timeout: 60000,
        validateStatus: () => true,
        proxy,
    });
}

function rotateProxy() {
    if (PROXY_LIST.length === 0) return;
    currentProxyIndex = (currentProxyIndex + 1) % PROXY_LIST.length;
}

async function fetchProxies() {
    try {
        const res = await axios.get(IkyyProxy, { timeout: 10000 });
        if (!Array.isArray(res.data) || res.data.length === 0) throw new Error("Proxy list kosong");

        PROXY_LIST = res.data
            .map((p) => {
                const parts = p.split(":");
                if (parts.length !== 4) return null;
                const [host, port, username, password] = parts;
                return { protocol: "http", host, port: parseInt(port), auth: { username, password } };
            })
            .filter(Boolean);
        logger.info(`[REMOVEWM-V2] Proxies ready: ${PROXY_LIST.length}`);
    } catch (err) {
        PROXY_LIST = [];
        logger.warn(`[REMOVEWM-V2] Proxy fetch failed (${err.message}) - continuing without proxy`);
    }
}

async function createWatermarkJob(apiClient, imageUrl, modelName, prompt) {
    const form = new FormData();

    form.append("model_name", modelName);
    form.append("prompt", prompt);
    form.append("original_image_url", imageUrl);
    form.append("aspect_ratio", "default");
    form.append("output_format", "jpg");
    form.append("mode", "editor");
    form.append("megapixels", "1");

    const res = await apiClient.post("/api/runtime/jobs/create-job", form, {
        headers: getCleanHeaders(form.getHeaders()),
    });

    if (res.status !== 200 || !res.data?.code) {
        throw new Error(`Server Error (HTTP ${res.status})`);
    }

    if (res.data.code !== 100000) {
        const msg = res.data.message?.en || "";
        if (msg.toLowerCase().includes("insufficient") || msg.toLowerCase().includes("limit")) {
            throw new Error("INSUFFICIENT_CREDITS");
        }
        throw new Error(msg || `API Error (Code: ${res.data.code})`);
    }

    return res.data.result.job_id;
}

async function pollJobStatus(apiClient, jobId, maxAttempts = 60, interval = 2000) {
    for (let i = 1; i <= maxAttempts; i++) {
        const res = await apiClient.get(`/api/runtime/jobs/get-job/${jobId}`, {
            headers: getCleanHeaders(),
        });

        const status = res.data?.result?.status;

        if (status === 1 && res.data.result.output_url) {
            return res.data.result.output_url;
        }

        if (status === -1) throw new Error("AI Processing Failed");

        if (i < maxAttempts) await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error("Timeout: Proses remove watermark terlalu lama.");
}

async function downloadResultImage(url) {
    const res = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 30000,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    return Buffer.from(res.data);
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
    name: "Remove Watermark (Magic Eraser)",
    description: "Hapus watermark dari gambar, dengan proxy rotation untuk bypass limit kredit.",
    category: "Image",
    methods: ["GET", "POST"],
    params: ["url"],

    paramsSchema: {
        url: {
            type: "string",
            required: true,
            default: "https://i.pravatar.cc/300?img=5",
            description: "URL gambar yang akan dihapus watermarknya",
        },
        prompt: {
            type: "string",
            required: false,
            default: "移除所有水印和移除右下角四角星水印",
            description: "Perintah AI untuk removal (opsional, improgressive)",
        },
    },

    async run(req, res) {
        try {
            const { url, prompt } = { ...req.query, ...req.body };

            if (!url) {
                return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi", code: "MISSING_PARAMETERS" });
            }

            if (!validateUrl(url)) {
                return res.status(400).json({ status: false, message: "Format URL tidak valid", code: "INVALID_URL" });
            }

            const modelName = "magiceraser_v6";
            const finalPrompt = prompt || "移除所有水印和移除右下角四角星水印";
            const maxTotalAttempts = Math.max(PROXY_LIST.length * 2, 6);

            await fetchProxies();

            let lastError = "";
            let usedProxy = "";
            let resultUrl = "";
            let jobId = "";

            for (let attempts = 0; attempts < maxTotalAttempts; attempts++) {
                usedProxy = PROXY_LIST.length > 0 ? PROXY_LIST[currentProxyIndex].host : "direct";
                try {
                    const apiClient = getAxiosInstance();
                    jobId = await createWatermarkJob(apiClient, url, modelName, finalPrompt);
                    logger.info(`[REMOVEWM-V2] Job ${jobId} created via ${usedProxy}`);
                    resultUrl = await pollJobStatus(apiClient, jobId);

                    const buffer = await downloadResultImage(resultUrl);
                    res.setHeader("Content-Type", "image/jpeg");
                    res.setHeader("Content-Length", buffer.length);
                    res.setHeader("Cache-Control", "public, max-age=86400");
                    res.setHeader("X-AI-Processor", "magiceraser_v6");
                    res.setHeader("X-Transformer", "removewm-v2");
                    res.setHeader("X-Proxy-IP", usedProxy);
                    res.setHeader("X-Job-ID", jobId);
                    res.setHeader("X-Attempts", attempts + 1);

                    logger.info(`[REMOVEWM-V2] Success via ${usedProxy} on attempt ${attempts + 1} | ${(buffer.length / 1024).toFixed(2)}KB`);
                    return res.send(buffer);
                } catch (err) {
                    lastError = err.message;
                    logger.warn(`[REMOVEWM-V2] Attempt ${attempts + 1}/${maxTotalAttempts} via ${usedProxy} failed: ${lastError}`);
                    rotateProxy();
                }
            }

            return res.status(502).json({
                status: false,
                message: "All attempts failed",
                error: lastError,
                proxy_last_used: usedProxy,
                code: "ALL_ATTEMPTS_FAILED",
            });
        } catch (err) {
            logger.error(`[REMOVEWM-V2] Error | ip=${req.ip} | ${err.message}`);
            return res.status(500).json({ status: false, message: err.message || "Gagal memproses remove watermark", code: "INTERNAL_ERROR" });
        }
    },
};