/**
 * Static QRIS Payment API v2
 *
 * GET /payment/qris-static-v2?qr=QR_STRING&amount=10000&logo=https://example.com/logo.png
 *
 * result:
 *  - qr_string
 *  - url (PNG with logo, auto delete)
 */

import QRCode from "qrcode"
import sharp from "sharp"
import fs from "fs"
import path from "path"
import crypto from "crypto"
import logger from "../../src/utils/logger.js"

/* ===============================
   FILE STORAGE
=============================== */
const uploadDir = path.join(process.cwd(), "files")
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir)

/* ===============================
   UTILS
============================== */
function randomName(ext = ".png") {
  return crypto.randomBytes(16).toString("hex") + ext
}

/* ===============================
   TLV PARSER
============================== */
function parseTLV(data) {
  let i = 0
  const res = []

  while (i < data.length) {
    const id = data.substr(i, 2)
    const len = parseInt(data.substr(i + 2, 2))
    const value = data.substr(i + 4, len)
    res.push({ id, value })
    i += 4 + len
  }
  return res
}

function buildTLV(tlvs) {
  return tlvs
    .map(t => `${t.id}${String(t.value.length).padStart(2, "0")}${t.value}`)
    .join("")
}

/* ===============================
   CRC16 CCITT
============================== */
function crc16ccitt(str) {
  let crc = 0xffff
  for (const c of str) {
    crc ^= c.charCodeAt(0) << 8
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1
      crc &= 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0")
}

function withCRC(qr) {
  const base = qr.replace(/6304.{4}$/, "")
  return base + "6304" + crc16ccitt(base + "6304")
}

/* ===============================
   SET AMOUNT (TAG 54)
============================== */
function setAmount(qr, amount) {
  const tlvs = parseTLV(qr)
  const value = String(parseInt(amount, 10))

  const idx = tlvs.findIndex(t => t.id === "54")
  if (idx !== -1) {
    tlvs[idx].value = value
  } else {
    tlvs.splice(tlvs.length - 1, 0, { id: "54", value })
  }

  return withCRC(buildTLV(tlvs))
}

/* ===============================
   EXPORT API
============================== */
export default {
  name: "QRIS Static v2",
  description: "Generate static QRIS with logo",
  category: "Payment",
  methods: ["GET", "POST"],

  params: ["qr", "amount", "logo"],

  paramsSchema: {
    qr: {
      type: "string",
      required: true,
      description: "QRIS string (static)",
    },
    amount: {
      type: "string",
      required: true,
      example: "10000",
    },
    logo: {
      type: "string",
      required: false,
      description: "Logo URL untuk QR code center",
      example: "https://example.com/logo.png",
    },
  },

  async run(req, res) {
    try {
      const { qr, amount, logo } = { ...req.query, ...req.body }
      const asJpg = true

      if (!qr) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'qr' wajib diisi",
        })
      }

      if (!amount || isNaN(amount)) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'amount' harus angka",
        })
      }

      /* ===============================
         GENERATE QR STRING
      ================================ */
      const qrString = setAmount(qr, amount)

      /* ===============================
          SAVE QR IMAGE WITH LOGO
       ================================ */
      const ext = asJpg ? ".jpg" : ".png"
      const filename = crypto.randomBytes(16).toString("hex") + ext
      const filePath = path.join(process.cwd(), "files", filename)

      try {
        // 1. Generate QR to PNG buffer
        const qrBuffer = await QRCode.toBuffer(qrString, {
          scale: 8,
          margin: 1,
          errorCorrectionLevel: logo ? "H" : "M",
          color: { dark: "#000000", light: "#ffffff" },
        })

        let finalBuffer = qrBuffer

        // 2. Composite logo in center (if provided)
        if (logo) {
          const resLogo = await fetch(logo)
          if (!resLogo.ok) {
            throw new Error("Gagal fetch logo (HTTP " + resLogo.status + ")")
          }
          const logoBuf = Buffer.from(await resLogo.arrayBuffer())

          const qrMeta = await sharp(qrBuffer).metadata()
          const qrSize = qrMeta.width

          const logoSize = Math.round(qrSize * 0.22)
          const pad = Math.round(logoSize * 0.15)
          const boxSize = logoSize + pad * 2

          const roundedLogo = await sharp(logoBuf)
            .resize(logoSize, logoSize, { fit: "contain", background: "#ffffff" })
            .flatten({ background: "#ffffff" })
            .png()
            .toBuffer()

          const box = await sharp({
            create: {
              width: boxSize,
              height: boxSize,
              channels: 4,
              background: { r: 255, g: 255, b: 255, alpha: 1 },
            },
          })
            .composite([{ input: roundedLogo }])
            .png()
            .toBuffer()

          finalBuffer = await sharp(qrBuffer)
            .composite([
              {
                input: box,
                gravity: "center",
              },
            ])
            .png()
            .toBuffer()
        }

        // Convert to JPG if requested
        if (asJpg) {
          finalBuffer = await sharp(finalBuffer)
            .jpeg({ quality: 92 })
            .toBuffer()
        }

        // Always return image bytes directly
        res.setHeader(
          "Content-Type",
          asJpg ? "image/jpeg" : "image/png"
        )
        logger.info(
          `[QRIS] QR generated (direct) | ip=${req.ip} | amount=${amount} | fmt=${ext}`
        )
        return res.send(finalBuffer)
      } catch (qrErr) {
        logger.error(`[QRIS] QR generation error: ${qrErr.message}`)
        return res.status(500).json({
          status: false,
          message: "Gagal generate QR code: " + qrErr.message,
        })
      }
    } catch (err) {
      logger.error(
        `[QRIS] Error | ip=${req.ip} | error=${err.message}`
      )
      return res.status(500).json({
        status: false,
        message: err.message || "Failed to generate QR",
      })
    }
  },
}