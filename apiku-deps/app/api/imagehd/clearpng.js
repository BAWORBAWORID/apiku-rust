/**
 * ClearPNG Image Upscaler
 * Provider : tools.cleanpng.com/image-upscaler
 * Feature  : AI upscale 2x/4x, format png/jpg, quality enhance
 * Response : langsung gambar (buffer) — Content-Type sesuai format
 */
import axios from "axios";
import FormData from "form-data";
import logger from "../../src/utils/logger.js";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function downloadImage(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 60000,
    headers: { "User-Agent": BROWSER_UA },
  });
  return { buffer: Buffer.from(res.data), contentType: res.headers["content-type"] || "" };
}

async function clearPngUpload(imageUrl) {
  const { buffer } = await downloadImage(imageUrl);
  const form = new FormData();
  form.append("image", buffer, { filename: "image.png", contentType: "image/png" });
  form.append("ratio", "2");

  const uploadImg = await axios.post(
    "https://tools.cleanpng.com/image-upscaler/upload.php",
    form,
    {
      headers: {
        ...form.getHeaders(),
        origin: "https://tools.cleanpng.com",
        referer: "https://tools.cleanpng.com/image-upscaler/",
        "user-agent": BROWSER_UA,
      },
      timeout: 60000,
      validateStatus: () => true,
    }
  );

  if (uploadImg.status !== 200 || !uploadImg.data?.success || !uploadImg.data?.path) {
    throw new Error(
      "Gagal upload gambar ke cleanpng (" + uploadImg.status + "): " + JSON.stringify(uploadImg.data)
    );
  }
  return uploadImg.data;
}

async function clearPngUpscale(serverPath, ratio, format) {
  const form = new FormData();
  form.append("path", serverPath);
  form.append("ratio", ratio);
  form.append("format", format);
  form.append("enhance_quality", "1");

  const resultImg = await axios.post(
    "https://tools.cleanpng.com/image-upscaler/upscale.php",
    form,
    {
      headers: {
        ...form.getHeaders(),
        origin: "https://tools.cleanpng.com",
        referer: "https://tools.cleanpng.com/image-upscaler/",
        "user-agent": BROWSER_UA,
      },
      timeout: 120000,
      validateStatus: () => true,
    }
  );

  if (resultImg.status !== 200 || !resultImg.data?.success || !resultImg.data?.url) {
    throw new Error(
      "Gagal upscale gambar (" + resultImg.status + "): " + JSON.stringify(resultImg.data)
    );
  }

  return {
    url: `https://tools.cleanpng.com/image-upscaler/${resultImg.data.url}`,
    width: resultImg.data.width,
    height: resultImg.data.height,
  };
}

export default {
  name: "ClearPNG Upscaler",
  description: "AI image upscale 2x/4x — response langsung gambar (PNG/JPG)",
  category: "Image HD",
  methods: ["GET", "POST"],
  params: ["url", "ratio", "format"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL gambar yang akan di-upscale",
      example: "https://cdn.nekohime.site/file/614w3no8.jpg",
      minLength: 1,
    },
    ratio: {
      type: "string",
      required: false,
      default: "2",
      enum: ["2", "4"],
      description: "Perbesaran gambar (2x atau 4x)",
    },
    format: {
      type: "string",
      required: false,
      default: "png",
      enum: ["png", "jpg"],
      description: "Format output gambar",
    },
  },

  async run(req, res) {
    const { url, ratio = "2", format = "png" } = { ...req.query, ...req.body };

    if (!url) {
      return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" });
    }

    if (!["2", "4"].includes(String(ratio))) {
      return res.status(400).json({ status: false, message: "Ratio tersedia: 2, 4" });
    }

    if (!["png", "jpg"].includes(String(format).toLowerCase())) {
      return res.status(400).json({ status: false, message: "Format tersedia: png, jpg" });
    }

    try {
      logger.info(`[CLEARPNG] Start | ip=${req.ip} | ratio=${ratio}x | format=${format}`);

      logger.info("[CLEARPNG] Uploading image...");
      const uploaded = await clearPngUpload(url);

      logger.info(`[CLEARPNG] Upscaling ${ratio}x...`);
      const result = await clearPngUpscale(uploaded.path, String(ratio), String(format).toLowerCase());

      logger.info(`[CLEARPNG] Done | ${result.width}x${result.height}`);

      logger.info("[CLEARPNG] Downloading result...");
      const { buffer, contentType } = await downloadImage(result.url);

      if (contentType.includes("json") || buffer.length < 1000) {
        throw new Error("Hasil upscale tidak valid (bukan gambar)");
      }

      const ext = format === "jpg" ? "jpg" : "png";
      res.setHeader("Content-Type", format === "jpg" ? "image/jpeg" : "image/png");
      res.setHeader("Content-Length", String(buffer.length));
      res.setHeader("Content-Disposition", `inline; filename="clearpng-${result.width}x${result.height}.${ext}"`);
      res.setHeader("X-Scale", `${ratio}x`);
      res.setHeader("X-Width", String(result.width));
      res.setHeader("X-Height", String(result.height));

      return res.send(buffer);
    } catch (err) {
      logger.error(`[CLEARPNG] Error | ip=${req.ip} | ${err.message}`);

      if (err.code === "ECONNABORTED") {
        return res.status(504).json({ status: false, message: "Timeout: cleanpng terlalu lama merespon" });
      }

      return res.status(500).json({ status: false, message: err.message || "Gagal memproses gambar" });
    }
  },
};
