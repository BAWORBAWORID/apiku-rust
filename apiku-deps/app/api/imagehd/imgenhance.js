/**
 * Image Enhancer (imgupscaler.ai — Home Image Enhancer)
 * Memakai router-key iu_home_image_enhancer_v1 yang belum dipakai endpoint lain.
 *
 * GET /api/imagehd/imgenhance?url=https://example.com/photo.jpg
 *
 * Response: langsung gambar hasil enhance (image/jpeg)
 */

import axios from "axios";
import FormData from "form-data";
import crypto from "node:crypto";
import logger from "../../src/utils/logger.js";

const CONFIG = {
  baseUrl: "https://api-v2.imgupscaler.ai",
  origin: "https://imgupscaler.ai",
  referer: "https://imgupscaler.ai/",
  productCode: "Imgupscaler",
  routerKey: "iu_home_image_enhancer_v1",
  userAgent:
    "Mozilla/5.0 (Linux; Android 12; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
};

const POLL_MAX = 30;
const POLL_INTERVAL_MS = 2000;

function baseHeaders(productSerial, formHeaders = {}) {
  return {
    "User-Agent": CONFIG.userAgent,
    Origin: CONFIG.origin,
    Referer: CONFIG.referer,
    Accept: "*/*",
    "Product-Code": CONFIG.productCode,
    "Product-Serial": productSerial,
    "Router-Key": CONFIG.routerKey,
    Timezone: "Asia/Jakarta",
    "Sec-Ch-Ua": '"Chromium";v="139", "Not;A=Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?1",
    "Sec-Ch-Ua-Platform": '"Android"',
    ...formHeaders,
  };
}

function getAxiosInstance() {
  return axios.create({
    baseURL: CONFIG.baseUrl,
    timeout: 60000,
    validateStatus: () => true,
  });
}

function pickOutputUrl(data) {
  return (
    data?.result?.output_image_url ||
    data?.result?.outputUrl ||
    data?.result?.output_url ||
    data?.data?.output_image_url ||
    data?.data?.outputUrl ||
    data?.data?.output_url ||
    data?.output_image_url ||
    data?.outputUrl ||
    data?.output_url ||
    null
  );
}

function pickStatus(data) {
  return data?.result?.status ?? data?.data?.status ?? data?.status;
}

function isFailure(status) {
  return status === -1 || status === -2 || status === 3 ||
    String(status).toLowerCase() === "failed" ||
    String(status).toLowerCase() === "error" ||
    String(status).toUpperCase() === "FAILURE";
}

async function createJob(apiClient, imageUrl) {
  const image = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: 30000,
    headers: { "User-Agent": CONFIG.userAgent },
  });

  const productSerial = crypto.randomUUID();
  const form = new FormData();

  form.append("original_image_file", Buffer.from(image.data), {
    filename: `${crypto.randomBytes(16).toString("hex")}.jpg`,
    contentType: image.headers["content-type"] || "image/jpeg",
  });
  form.append("scene", "normal");
  form.append("output_format", "jpg");

  const res = await apiClient.post("/api/runtime/jobs/create-job", form, {
    headers: baseHeaders(productSerial, form.getHeaders()),
  });

  if (res.status !== 200) {
    throw new Error(`Create job gagal (HTTP ${res.status})`);
  }

  if (res.data?.code !== undefined && res.data.code !== 100000) {
    const msg = res.data?.message?.en || res.data?.message || "";
    if (/insufficient|limit|credit/i.test(String(msg))) {
      throw new Error("INSUFFICIENT_CREDITS");
    }
    throw new Error(msg || `API error (code: ${res.data.code})`);
  }

  const jobId = res.data?.result?.job_id;
  if (!jobId) {
    throw new Error(`Job ID tidak ditemukan: ${JSON.stringify(res.data).slice(0, 200)}`);
  }

  return { jobId, productSerial };
}

async function pollJob(apiClient, jobId, productSerial) {
  for (let attempt = 1; attempt <= POLL_MAX; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await apiClient.get(`/api/runtime/jobs/get-job/${jobId}`, {
      headers: baseHeaders(productSerial),
    });

    if (res.status !== 200) continue;

    const data = res.data;
    const output = pickOutputUrl(data);
    if (output) return output;

    if (isFailure(pickStatus(data))) {
      throw new Error(`Enhance gagal: ${JSON.stringify(data).slice(0, 200)}`);
    }
  }

  throw new Error(`Timeout menunggu hasil (job: ${jobId})`);
}

async function enhanceImage(imageUrl) {
  const apiClient = getAxiosInstance();
  const { jobId, productSerial } = await createJob(apiClient, imageUrl);
  logger.info(`[ImgEnhance] Job dibuat: ${jobId}`);

  const outputUrl = await pollJob(apiClient, jobId, productSerial);
  logger.info(`[ImgEnhance] Selesai: ${outputUrl.slice(0, 60)}...`);
  return { jobId, outputUrl };
}

export default {
  name: "Image Enhancer",
  description: "Enhance & upscale kualitas gambar (AI Image Enhancer)",
  category: "Image HD",
  methods: ["GET", "POST"],
  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL gambar yang akan di-enhance",
      example: "https://cdn.zass.in/NTMXjB49dZ.png",
    },
  },

  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body };
      const imageUrl = typeof url === "string" ? url.trim() : "";

      if (!imageUrl) {
        return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" });
      }

      if (!/^https?:\/\//i.test(imageUrl)) {
        return res.status(400).json({ status: false, message: "URL harus diawali http:// atau https://" });
      }

      try {
        new URL(imageUrl);
      } catch {
        return res.status(400).json({ status: false, message: "URL tidak valid" });
      }

      const started = Date.now();
      logger.info(`[ImgEnhance] Request | ip=${req.ip} | url=${imageUrl.substring(0, 60)}`);

      const { jobId, outputUrl } = await enhanceImage(imageUrl);

      const imageRes = await axios.get(outputUrl, {
        responseType: "arraybuffer",
        timeout: 60000,
        headers: { "User-Agent": CONFIG.userAgent },
      });

      const buffer = Buffer.from(imageRes.data);
      if (!buffer.length) throw new Error("Gambar hasil kosong");

      res.setHeader("Content-Type", imageRes.headers["content-type"] || "image/jpeg");
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("X-Job-Id", jobId);
      res.setHeader("X-Image-Processor", "imgupscaler-iu_home_image_enhancer_v1");
      res.setHeader("X-Duration", `${Date.now() - started}ms`);

      return res.send(buffer);
    } catch (err) {
      const msg = err.message || "Gagal memproses gambar";
      logger.error(`[ImgEnhance] Error: ${msg}`);

      if (msg === "INSUFFICIENT_CREDITS") {
        return res.status(429).json({
          status: false,
          message: "Kuota enhance habis di sisi provider, coba lagi nanti.",
        });
      }
      if (/Timeout/i.test(msg)) {
        return res.status(504).json({ status: false, message: msg });
      }
      if (/create job|gagal \(HTTP/i.test(msg)) {
        return res.status(502).json({ status: false, message: msg });
      }

      return res.status(500).json({ status: false, message: msg });
    }
  },
};
