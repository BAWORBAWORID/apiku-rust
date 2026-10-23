/**
 * Optimole AI Image Upscaler
 * Provider : optimole.com/ai-image-upscaling-tool (AI model via Replicate)
 * Feature  : AI upscale — rekonstruksi detail (bukan sekadar stretch), output WebP
 * Response : langsung gambar (buffer WebP) — Content-Type image/webp
 */
import axios from "axios";
import FormData from "form-data";
import logger from "../../src/utils/logger.js";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

async function fetchImage(url, timeout = 60000) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout,
    headers: { "User-Agent": BROWSER_UA },
  });
  return Buffer.from(res.data);
}

async function optimoleUpscale(imageUrl) {
  const form = new FormData();
  form.append("image_url", imageUrl);

  const upscaleRes = await axios.post(
    "https://optimole.com/wp-json/optimole-image/v1/upscale-image",
    form,
    {
      headers: {
        origin: "https://optimole.com",
        referer: "https://optimole.com/ai-image-upscaling-tool/",
        "User-Agent": BROWSER_UA,
        ...form.getHeaders(),
      },
      timeout: 180000,
      validateStatus: () => true,
    }
  );

  if (upscaleRes.status !== 200 || !upscaleRes.data?.success || !upscaleRes.data?.data?.processedUrl) {
    throw new Error(
      "Gagal upscale via optimole (" + upscaleRes.status + "): " + JSON.stringify(upscaleRes.data)
    );
  }

  return upscaleRes.data.data.processedUrl;
}

export default {
  name: "Optimole Upscaler",
  description: "AI image upscale (model Replicate) — rekonstruksi detail, response langsung gambar WebP",
  category: "Image HD",
  methods: ["GET", "POST"],
  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL gambar yang akan di-upscale",
      example: "https://picsum.photos/300/300",
      minLength: 1,
    },
  },

  async run(req, res) {
    const { url } = { ...req.query, ...req.body };

    if (!url) {
      return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" });
    }

    try {
      logger.info(`[OPTIMOLE] Start | ip=${req.ip}`);

      logger.info("[OPTIMOLE] Requesting upscale (10-30s)...");
      const processedUrl = await optimoleUpscale(url);
      logger.info(`[OPTIMOLE] Done upstream | fetching result...`);

      const buffer = await fetchImage(processedUrl, 120000);

      if (buffer.length < 1000) {
        throw new Error("Hasil upscale tidak valid (bukan gambar)");
      }

      logger.info(`[OPTIMOLE] Sent | size=${buffer.length} bytes`);

      res.setHeader("Content-Type", "image/webp");
      res.setHeader("Content-Length", String(buffer.length));
      res.setHeader("Content-Disposition", 'inline; filename="optimole-upscaled.webp"');
      res.setHeader("X-Provider", "optimole");

      return res.send(buffer);
    } catch (err) {
      logger.error(`[OPTIMOLE] Error | ip=${req.ip} | ${err.message}`);

      if (err.code === "ECONNABORTED") {
        return res.status(504).json({ status: false, message: "Timeout: proses upscale terlalu lama (coba gambar lebih kecil)" });
      }

      return res.status(500).json({ status: false, message: err.message || "Gagal memproses gambar" });
    }
  },
};
