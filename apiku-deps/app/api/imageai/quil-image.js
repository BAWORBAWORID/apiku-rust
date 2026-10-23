import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const SCRAPER = join(dirname(fileURLToPath(import.meta.url)), "../../scrape/quil-image.js");
const SCRAPER_DIR = dirname(SCRAPER);

const STYLES = ["Auto", "3D Scene", "Anime", "Artistic", "Cinematic", "Digital Art", "Educational", "Fantasy World", "Prototyping & Mockup", "Realism"];
const ASPECTS = ["Auto", "1:1", "4:3", "3:4", "16:9", "9:16"];

function runScraper(args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [SCRAPER, ...args], { cwd: SCRAPER_DIR });
    let stdout = "", stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("Request timed out"));
    }, timeoutMs);

    proc.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(stderr.trim() || "Script failed"));
      }
    });
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

export default {
  name: "Quillbot Image Generator",
  description: "Generate gambar AI dengan berbagai style dan aspect ratio",
  category: "Image AI",
  methods: ["GET", "POST"],
  params: ["prompt", "style", "aspect"],
  paramsSchema: {
    prompt: {
      type: "string",
      required: true,
      description: "Deskripsi gambar yang ingin di-generate",
      example: "a cat sitting gracefully",
      minLength: 3,
      maxLength: 500,
    },
    style: {
      type: "string",
      required: false,
      description: `Style gambar. Default: Auto. Pilihan: ${STYLES.join(", ")}`,
      example: "Anime",
      default: "Auto",
    },
    aspect: {
      type: "string",
      required: false,
      description: `Aspect ratio. Default: Auto. Pilihan: ${ASPECTS.join(", ")}`,
      example: "1:1",
      default: "Auto",
    },
  },

  async run(req, res) {
    let { prompt, style = "Auto", aspect = "Auto" } = { ...req.query, ...req.body };

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ status: false, message: "Parameter 'prompt' wajib diisi" });
    }

    prompt = prompt.trim();
    style = style.trim();
    aspect = aspect.trim();

    if (!STYLES.includes(style)) {
      return res.status(400).json({ status: false, message: `Style tidak valid. Pilihan: ${STYLES.join(", ")}` });
    }
    if (!ASPECTS.includes(aspect)) {
      return res.status(400).json({ status: false, message: `Aspect ratio tidak valid. Pilihan: ${ASPECTS.join(", ")}` });
    }

    try {
      const data = await runScraper(["--prompt", prompt, "--style", style, "--aspect", aspect]);
      res.json({
        status: data.success,
        result: {
          prompt: data.prompt,
          style: data.style,
          aspect: data.aspectRatio,
          images: data.images,
          count: data.imageCount,
        },
      });
    } catch (err) {
      res.status(500).json({ status: false, message: err.message || "Quillbot image generation failed" });
    }
  },
};
