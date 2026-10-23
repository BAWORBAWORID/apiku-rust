/**
 * Text to QR API (Direct Image Response)
 *
 * GET /tools/text-to-qr?text=HELLO_WORLD
 *
 * result: 
 * - Langsung menampilkan gambar PNG di browser
 */

import QRCode from "qrcode"
import logger from "../../src/utils/logger.js"

export default {
  name: "Text To QR",
  description: "Convert text/string to QR code image directly",
  category: "Tools",
  methods: ["GET"],
  params: ["text"],

  paramsSchema: {
    text: {
      type: "string",
      required: true,
    },
  },

  async run(req, res) {
    try {
      const { text } = req.query || {}

      if (!text) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'text' wajib diisi",
        })
      }

      /* =======================================
         GENERATE QR AS BUFFER (NOT BASE64)
      ======================================= */
      const qrBuffer = await QRCode.toBuffer(text, {
        type: 'png',
        scale: 8,
        margin: 1,
        errorCorrectionLevel: "M",
      })

      logger.info(
        `[TEXT-QR] image sent | ip=${req.ip} | length=${text.length}`
      )

      // Set header agar browser mengenali ini sebagai gambar PNG
      res.setHeader("Content-Type", "image/png")
      res.setHeader("Cache-Control", "public, max-age=86400") // Opsional: Cache 1 hari
      
      // Kirim buffer langsung
      return res.send(qrBuffer)

    } catch (err) {
      logger.error(
        `[TEXT-QR] Error | ip=${req.ip} | error=${err.message}`
      )
      return res.status(500).json({
        status: false,
        message: err.message || "Failed to generate QR",
      })
    }
  },
}
