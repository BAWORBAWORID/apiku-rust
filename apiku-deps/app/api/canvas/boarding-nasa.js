import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createCanvas, loadImage } from "canvas";

// ==================== PATH RESOLUTION (ESM) ====================
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_PATH = path.join(__dirname, "assets", "boarding-pass.png");
const REMOTE_URL = "https://www3.nasa.gov/send-your-name-with-artemis/img/boarding-pass.png";

// ==================== TEMPLATE LOADER (network → local fallback) ====================
/**
 * Try to load the boarding-pass template from NASA (network).
 * On any network error, automatically fall back to the local asset
 * under api/canvas/assets/boarding-pass.png so the endpoint keeps
 * working when upstream is down.
 *
 * @returns {Promise<Image>}
 */
async function loadTemplate() {
  try {
    return await loadImage(REMOTE_URL);
  } catch (err) {
    if (fs.existsSync(LOCAL_PATH)) {
      console.warn(
        `[BoardingNasa] Remote failed (${err.message}); using local fallback ${LOCAL_PATH}`
      );
      // loadImage accepts a Buffer, so no need for a separate fs.readFileSync branch
      return await loadImage(fs.readFileSync(LOCAL_PATH));
    }
    throw new Error(
      `Failed to load template image — remote error "${err.message}" and local asset not found at ${LOCAL_PATH}`
    );
  }
}

// ==================== IMAGE GENERATION ====================
async function generateCustomImage(name) {
  // Konfigurasi default untuk boarding pass
  const width = 1200;
  const height = 498;
  const fontSize = 40;
  const fontWeight = "bold";
  const fontFamily = "Helvetica, Arial, sans-serif";
  const textColor = "#000000";
  const textAlign = "left";
  const textBaseline = "top";
  const x = 408;
  const y = 140;
  const maxWidth = 500;
  const outputFormat = "jpeg";
  const quality = 1;

  // Buat canvas
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  try {
    // Load gambar template (network-primary, local-fallback)
    const image = await loadTemplate();
    ctx.drawImage(image, 0, 0, width, height);
  } catch (error) {
    console.error("Error loading image:", error.message);
    throw new Error("Failed to load template image");
  }

  // Set styling untuk teks
  ctx.fillStyle = textColor;
  ctx.textAlign = textAlign;
  ctx.textBaseline = textBaseline;

  // Set font awal
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;

  // Gambar teks dengan auto scaling
  const textToDraw = name.toUpperCase();
  const metrics = ctx.measureText(textToDraw);

  // Auto scaling jika melebihi maxWidth
  if (metrics.width > maxWidth && maxWidth > 0) {
    const scale = maxWidth / metrics.width;
    const scaledFontSize = Math.floor(fontSize * scale);
    ctx.font = `${fontWeight} ${scaledFontSize}px ${fontFamily}`;
  }

  // Gambar teks
  ctx.fillText(textToDraw, x, y);

  // Return buffer
  return canvas.toBuffer("image/jpeg", { quality });
}

// Versi function lama untuk backward compatibility
async function generateBoardingPass(name) {
  return await generateCustomImage(name);
}

// Export default
export default {
  name: "Canvas Boarding Nasa",
  description: "Generate custom images with text overlay",
  category: "Canvas",
  methods: ["GET", "POST"],
  params: ["name"],

  paramsSchema: {
    name: {
      type: "string",
      required: true,
      description: "Nama yang akan ditampilkan di gambar"
    }
  },

  async run(req, res) {
    try {
      // Ambil parameter dari query atau body
      const { name } = { ...req.query, ...req.body };

      if (!name) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'name' wajib diisi"
        });
      }

      // Generate image
      const imageBuffer = await generateBoardingPass(name);

      // Set header
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Content-Disposition", 'inline; filename="generated.jpg"');
      res.send(imageBuffer);
    } catch (error) {
      console.error("Error generating image:", error);
      res.status(500).json({
        status: false,
        message: error.message || "Failed to generate image"
      });
    }
  }
};
