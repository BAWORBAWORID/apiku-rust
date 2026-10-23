import multer from "multer";
import TinyURL from "tinyurl";
import { uploadToCloudStorage } from "../../src/utils/cloudStorage.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // Maksimal 50MB
});

export default {
  name: "TinyURL File Shortener",
  description: "Upload semua jenis file ke Cloud Storage dan perpendek link menggunakan TinyURL",
  category: "Shortlink",
  methods: ["POST"],

  params: ["file"],

  paramsSchema: {
    file: {
      type: "file",
      required: true,
      description: "File yang akan diupload dan diperpendek (semua format file didukung)",
    },
  },

  async run(req, res) {
    upload.single("file")(req, res, async (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            status: false,
            message: "Ukuran file terlalu besar (maksimal 50MB)",
          });
        }
        return res.status(400).json({
          status: false,
          message: err.message || "Upload error",
        });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({
          status: false,
          message: "Parameter file wajib (multipart/form-data, field: file)",
        });
      }

      try {
        // 1. Upload file (semua tipe) ke Cloud Storage (AWS S3)
        const cdnUrl = await uploadToCloudStorage(file.buffer, file.originalname);
        if (!cdnUrl) {
          throw new Error("Gagal mengupload file ke CDN Cloud Storage");
        }

        // 2. Perpendek URL file menggunakan TinyURL
        const shortUrl = await TinyURL.shorten(cdnUrl);
        if (!shortUrl || shortUrl.trim().toLowerCase().startsWith("error")) {
          throw new Error("Gagal memperpendek link dari layanan TinyURL");
        }

        // 3. Return JSON response
        return res.json({
          status: true,
          result: shortUrl.trim(),
          cdnUrl: cdnUrl,
          filename: file.originalname,
          size: file.size,
          mimetype: file.mimetype || "application/octet-stream",
        });
      } catch (error) {
        return res.status(500).json({
          status: false,
          message: error.message || "Terjadi kesalahan pada server",
        });
      }
    });
  },
};
