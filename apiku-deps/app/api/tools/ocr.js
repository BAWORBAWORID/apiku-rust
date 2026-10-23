import multer from "multer";
import Tesseract from "tesseract.js";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../../src/utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let worker = null;
let currentLang = null;

async function getWorker(lang) {
  if (worker && currentLang === lang) return worker;
  if (worker) {
    try { await worker.terminate(); } catch {}
  }
  worker = await Tesseract.createWorker(lang, 1, {
    langPath: path.join(__dirname, "assets", "ocr"),
    logger: (m) => {
      if (m.status === "error") logger.error(`[OCR] Worker: ${m.message}`);
    },
  });
  currentLang = lang;
  return worker;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export default {
  name: "OCR",
  description: "Optical Character Recognition — Extract text from images using Tesseract.js",
  category: "Tools",
  methods: ["POST"],
  params: ["file", "lang"],
  paramsSchema: {
    file: {
      type: "file",
      required: true,
      description: "Image file to extract text from (jpg, png, webp, etc)",
    },
    lang: {
      type: "string",
      required: false,
      default: "eng",
      description: "Language code for OCR (e.g. eng, ind, jpn). Multiple: eng+ind",
      example: "eng",
    },
  },

  async run(req, res) {
    upload.single("file")(req, res, async (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ status: false, message: "File too large (max 10MB)" });
        }
        return res.status(400).json({ status: false, message: err.message || "Upload error" });
      }

      if (!req.file) {
        return res.status(400).json({ status: false, message: "No file uploaded (field name must be 'file')" });
      }

      const lang = req.body?.lang || req.query?.lang || "eng";

      try {
        const t0 = Date.now();
        const w = await getWorker(lang);
        const { data } = await w.recognize(req.file.buffer);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

        return res.json({
          status: true,
          result: {
            text: data.text.trim(),
            confidence: Math.round(data.confidence),
            lang,
            time: `${elapsed}s`,
            blocks: data.blocks?.length || 0,
          },
        });
      } catch (e) {
        logger.error(`[OCR] Recognition error: ${e.message}`);
        if (e.message && e.message.includes("lang") && e.message.includes("not found")) {
          return res.status(400).json({
            status: false,
            message: `Language '${lang}' not supported. Make sure the .traineddata file exists.`,
          });
        }
        return res.status(400).json({
          status: false,
          message: "Failed to recognize text. Ensure the file is a valid image.",
        });
      }
    });
  },
};
