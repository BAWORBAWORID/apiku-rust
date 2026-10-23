/**
 * AI Image Detector (Hive Detect)
 * Provider: https://hivedetect.ai
 * Mendeteksi apakah sebuah gambar dibuat oleh AI (AI-generated), foto asli (human), atau deepfake.
 */

import axios from "axios";
import FormData from "form-data";
import multer from "multer";
import logger from "../../src/utils/logger.js";

const BASE_URL = "https://hivedetect.ai";

const HEADERS = {
  accept: "application/json, text/plain, */*",
  origin: BASE_URL,
  referer: `${BASE_URL}/new`,
  "user-agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // Max 15MB
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function scanImage(buffer, mimeType = "image/jpeg") {
  const ext = mimeType.split("/")[1]?.split(";")[0] || "jpg";
  const form = new FormData();
  form.append("media", buffer, {
    filename: `image.${ext}`,
    contentType: mimeType,
  });

  const uploadRes = await axios.post(`${BASE_URL}/api/v1/upload`, form, {
    headers: { ...HEADERS, ...form.getHeaders() },
    timeout: 120000,
    maxBodyLength: Infinity,
  });

  const key = uploadRes.data?.data?.short_key;
  if (!key) {
    throw new Error(
      "Gagal mengunggah gambar ke Hive Detect: " + JSON.stringify(uploadRes.data)
    );
  }

  // Polling hasil JSON deteksi
  let classes = null;
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    try {
      const jsonRes = await axios.get(`${BASE_URL}/json/${key}.json`, {
        headers: HEADERS,
        timeout: 15000,
      });
      classes = jsonRes.data?.visual?.status?.[0]?.response?.output?.[0]?.classes;
      if (Array.isArray(classes)) break;
    } catch {
      // Tunggu backend selesai proses
    }
    await sleep(1500);
  }

  if (!Array.isArray(classes)) {
    throw new Error("Hasil deteksi belum tersedia atau gagal diproses oleh Hive Detect");
  }

  const aiScore = classes.find((v) => v.class === "ai_generated")?.score;
  const humanScore = classes.find((v) => v.class === "not_ai_generated")?.score;
  const deepfakeScore = classes.find((v) => v.class === "deepfake")?.score;

  const persen = (n) =>
    typeof n === "number" ? (n * 100).toFixed(2) + "%" : "Tidak tersedia";

  const isAi =
    typeof aiScore === "number" && typeof humanScore === "number" && aiScore > humanScore;

  const kesimpulan =
    typeof aiScore === "number" && typeof humanScore === "number"
      ? isAi
        ? "Kemungkinan gambar dibuat oleh AI."
        : "Kemungkinan gambar bukan hasil AI (asli/human)."
      : "Hasil belum dapat disimpulkan.";

  return {
    kesimpulan,
    is_ai: isAi,
    scores: {
      ai_generated: aiScore ?? null,
      ai_generated_percent: persen(aiScore),
      not_ai_generated: humanScore ?? null,
      not_ai_generated_percent: persen(humanScore),
      deepfake: deepfakeScore ?? null,
      deepfake_percent: persen(deepfakeScore),
    },
    short_key: key,
    json_url: `${BASE_URL}/json/${key}.json`,
    classes,
  };
}

export default {
  name: "AI Image Detector",
  description:
    "Deteksi apakah sebuah gambar dibuat oleh AI (AI Slop / AI-generated), deepfake, atau gambar manusia/asli menggunakan engine Hive Detect.",
  category: "Tools",
  methods: ["GET", "POST"],
  params: ["url", "file"],
  paramsSchema: {
    url: {
      type: "string",
      required: false,
      description: "URL gambar yang ingin diperiksa (http/https)",
      example: "https://picsum.photos/400/400.jpg",
    },
    file: {
      type: "file",
      required: false,
      description: "Upload file gambar langsung via multipart/form-data (jpg, png, webp, maks. 15MB)",
    },
  },

  async run(req, res) {
    // Jalankan multer untuk menangani upload multipart file (jika ada)
    upload.single("file")(req, res, async (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            status: false,
            message: "Ukuran file terlalu besar (maksimal 15MB)",
          });
        }
        return res.status(400).json({
          status: false,
          message: err.message || "Gagal mengunggah file gambar",
        });
      }

      try {
        let buffer = null;
        let mimeType = "image/jpeg";

        // 1. Cek dari direct file upload
        if (req.file && req.file.buffer) {
          buffer = req.file.buffer;
          mimeType = req.file.mimetype || "image/jpeg";
        } else {
          // 2. Cek dari parameter url / image di query / body
          const imageUrl = String(
            req.query.url || req.query.image || req.body?.url || req.body?.image || ""
          ).trim();

          if (!imageUrl) {
            return res.status(400).json({
              status: false,
              message:
                "Parameter 'url' gambar atau file upload multipart ('file') wajib disertakan",
            });
          }

          if (imageUrl.startsWith("data:image/")) {
            const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
              mimeType = matches[1];
              buffer = Buffer.from(matches[2], "base64");
            } else {
              return res.status(400).json({
                status: false,
                message: "Format Data URL / Base64 gambar tidak valid",
              });
            }
          } else {
            logger.info(`[AIDETECT] Mengunduh gambar dari: ${imageUrl}`);
            const imgRes = await axios.get(imageUrl, {
              responseType: "arraybuffer",
              headers: { "User-Agent": HEADERS["user-agent"] },
              timeout: 30000,
            });
            buffer = Buffer.from(imgRes.data);
            mimeType = imgRes.headers["content-type"] || "image/jpeg";
          }
        }

        if (!buffer || buffer.length === 0) {
          return res.status(400).json({
            status: false,
            message: "Data gambar kosong atau tidak dapat diunduh",
          });
        }

        logger.info(`[AIDETECT] Memeriksa gambar (size: ${buffer.length} bytes, mime: ${mimeType})`);
        const result = await scanImage(buffer, mimeType);

        return res.status(200).json({
          status: true,
          result,
        });
      } catch (e) {
        logger.error(`[AIDETECT] Error: ${e.message}`);
        return res.status(500).json({
          status: false,
          message: e.message || "Gagal melakukan deteksi AI pada gambar",
        });
      }
    });
  },
};
