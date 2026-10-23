/**
 * Image Resize — resize gambar via URL (canvacord v6 loadImage + @napi-rs/canvas)
 * Response langsung buffer gambar (bukan JSON).
 * Params: url (required), width (required), height (required), format (png|jpg|webp), quality (1-100)
 */
import { loadImage } from "canvacord";
import { createCanvas, loadImage as napiLoadImage } from "@napi-rs/canvas";

const FORMATS = {
  png: { encode: "png", ext: "png", mime: "image/png" },
  jpg: { encode: "jpeg", ext: "jpg", mime: "image/jpeg" },
  jpeg: { encode: "jpeg", ext: "jpg", mime: "image/jpeg" },
  webp: { encode: "webp", ext: "webp", mime: "image/webp" },
};

const MAX_DIM = 10000;

function convertStringToNumber(str) {
  const n = parseInt(String(str).replace(/[^\d-]/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

export default {
  name: "Image Resize",
  description: "Resize gambar dari URL ke ukuran custom, response langsung gambar",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["url", "width", "height", "format", "quality"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL gambar yang mau diresize",
      example: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    },
    width: {
      type: "number",
      required: true,
      description: "Lebar hasil (px, max 10000)",
      example: "800",
    },
    height: {
      type: "number",
      required: true,
      description: "Tinggi hasil (px, max 10000)",
      example: "450",
    },
    format: {
      type: "string",
      required: false,
      enum: ["png", "jpg", "webp"],
      default: "png",
      description: "Format output gambar",
    },
    quality: {
      type: "number",
      required: false,
      default: 90,
      description: "Kualitas kompresi untuk jpg/webp (1-100)",
    },
  },

  async run(req, res) {
    try {
      const { url, width, height, format, quality } = { ...req.query, ...req.body };

      if (!url || typeof url !== "string" || url.trim() === "") {
        return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" });
      }
      if (!width) {
        return res.status(400).json({ status: false, message: "Parameter 'width' wajib diisi" });
      }
      if (!height) {
        return res.status(400).json({ status: false, message: "Parameter 'height' wajib diisi" });
      }

      const w = convertStringToNumber(width);
      const h = convertStringToNumber(height);
      if (!w || !h) {
        return res.status(400).json({ status: false, message: "width/height harus angka valid" });
      }
      if (w > MAX_DIM || h > MAX_DIM) {
        return res.status(400).json({ status: false, message: `Maksimal ${MAX_DIM}x${MAX_DIM}` });
      }

      const fmt = FORMATS[String(format || "png").toLowerCase()];
      if (!fmt) {
        return res.status(400).json({ status: false, message: "Format tersedia: png, jpg, webp" });
      }

      let q = parseInt(quality, 10);
      if (isNaN(q) || q < 1 || q > 100) q = 90;

      // Download gambar via canvacord loadImage (support URL, auto redirect)
      const canva = await loadImage(url.trim());
      if (!canva?.data) {
        return res.status(400).json({ status: false, message: "Gagal mengambil gambar dari URL" });
      }

      // Decode + resize (stretch) ke width x height
      const img = await napiLoadImage(canva.data);
      const canvas = createCanvas(w, h);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);

      const buffer =
        fmt.encode === "jpeg" || fmt.encode === "webp"
          ? await canvas.encode(fmt.encode, q)
          : await canvas.encode(fmt.encode);

      res.set({
        "Content-Type": fmt.mime,
        "Content-Length": String(buffer.length),
        "Content-Disposition": `inline; filename="resize_${w}x${h}.${fmt.ext}"`,
        "Cache-Control": "public, max-age=86400",
      });

      return res.send(buffer);
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: error.message || "Gagal meresize gambar",
      });
    }
  },
};
