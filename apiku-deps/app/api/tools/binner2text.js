/**
 * Binary to Text API
 *
 * GET /tools/binary-to-text?binary=0100100001000101&format=raw|space
 * POST /tools/binary-to-text { "binary": "01001000 01000101", "format": "space" }
 *
 * result: "HE"
 */

import logger from "../../src/utils/logger.js"

export default {
  name: "Binary To Text",
  description: "Convert binary back to readable text",
  category: "Tools",
  methods: ["GET", "POST"],
  params: ["binary", "format"],

  paramsSchema: {
    binary: {
      type: "string",
      required: true,
    },
    format: {
      type: "string",
      enum: ["raw", "space"],
      default: "raw",
    },
  },

  async run(req, res) {
    try {
      const { binary, format = "raw" } = req.method === "GET" ? req.query : req.body

      if (!binary) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'binary' wajib diisi",
        })
      }

      // Bersihkan binary berdasarkan format
      let cleanBinary = binary.trim()
      
      if (format === "space") {
        // Jika format space, split lalu join tanpa spasi
        cleanBinary = cleanBinary.split(" ").join("")
      } else {
        // Format raw: hapus semua spasi atau karakter non-binary
        cleanBinary = cleanBinary.replace(/[^01]/g, "")
      }

      // Validasi panjang binary harus kelipatan 8
      if (cleanBinary.length % 8 !== 0) {
        return res.status(400).json({
          status: false,
          message: "Panjang binary harus kelipatan 8",
        })
      }

      // Konversi binary ke teks
      let text = ""
      for (let i = 0; i < cleanBinary.length; i += 8) {
        const byte = cleanBinary.substr(i, 8)
        const charCode = parseInt(byte, 2)
        
        // Validasi karakter (32-126 untuk printable ASCII, atau 0-255 untuk extended)
        if (charCode >= 32 && charCode <= 126 || charCode >= 128 && charCode <= 255) {
          text += String.fromCharCode(charCode)
        } else {
          // Karakter non-printable, tampilkan sebagai hex
          text += `\\x${charCode.toString(16).padStart(2, '0')}`
        }
      }

      logger.info(
        `[BINARY-TEXT] converted | ip=${req.ip} | bytes=${cleanBinary.length / 8}`
      )

      return res.json({
        status: true,
        original: binary,
        cleanedBinary: cleanBinary,
        text: text,
        length: text.length
      })

    } catch (err) {
      logger.error(
        `[BINARY-TEXT] Error | ip=${req.ip} | error=${err.message}`
      )
      return res.status(500).json({
        status: false,
        message: err.message || "Failed to convert binary to text",
      })
    }
  },
}