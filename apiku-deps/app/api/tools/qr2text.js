/**
 * QR To Text API
 * GET /tools/qr-to-text?url=IMAGE_URL
 */

import axios from "axios"
import jsQR from "jsqr"
import { createCanvas, Image } from "canvas"
import logger from "../../src/utils/logger.js"

/* ===============================
   DECODE QR FROM IMAGE BUFFER
================================ */
function decodeQR(buffer) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = createCanvas(img.width, img.height)
      const ctx = canvas.getContext("2d")
      ctx.drawImage(img, 0, 0)

      const imageData = ctx.getImageData(
        0,
        0,
        img.width,
        img.height
      )

      const qr = jsQR(
        imageData.data,
        imageData.width,
        imageData.height
      )

      if (!qr) return reject(new Error("QR code not detected"))
      resolve(qr.data)
    }

    img.onerror = () => reject(new Error("Invalid image"))
    img.src = buffer
  })
}

/* ===============================
   EXPORT API
================================ */
export default {
  name: "QR To Text",
  description: "Decode QR code image (URL) into text",
  category: "Tools",
  methods: ["GET"],

  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL gambar QR",
      example: "https://files.catbox.moe/qr.png",
    },
  },

  async run(req, res) {
    try {
      const { url } = req.query || {}

      if (!url) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
        })
      }

      try {
        new URL(url)
      } catch {
        return res.status(400).json({
          status: false,
          message: "URL tidak valid",
        })
      }

      let imgRes
      try {
        imgRes = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: 15000,
        })
      } catch (axiosErr) {
        const status = axiosErr.response?.status || 0
        if (status === 404) {
          return res.status(400).json({
            status: false,
            message: "Gambar QR tidak ditemukan di URL tersebut (404)",
          })
        }
        if (status === 403) {
          return res.status(400).json({
            status: false,
            message: "URL gambar tidak dapat diakses (403 Forbidden)",
          })
        }
        if (axiosErr.code === "ECONNABORTED") {
          return res.status(408).json({
            status: false,
            message: "Timeout saat mengunduh gambar",
          })
        }
        return res.status(400).json({
          status: false,
          message: `Gagal mengunduh gambar: ${axiosErr.message}`,
        })
      }

      const text = await decodeQR(Buffer.from(imgRes.data))

      logger.info(
        `[QR2TEXT] decoded | ip=${req.ip} | length=${text.length}`
      )

      return res.json({
        status: true,
        result: {
          text,
        },
      })
    } catch (err) {
      const msg = err.message || "Failed to decode QR"
      logger.error(`[QR2TEXT] error | ip=${req.ip} | ${msg}`)

      if (msg.includes("QR code not detected")) {
        return res.status(400).json({
          status: false,
          message: "Tidak dapat mendeteksi QR code pada gambar",
        })
      }
      if (msg.includes("Invalid image")) {
        return res.status(400).json({
          status: false,
          message: "Gambar tidak valid atau rusak",
        })
      }

      return res.status(500).json({
        status: false,
        message: "Gagal mendekode QR code",
      })
    }
  },
}