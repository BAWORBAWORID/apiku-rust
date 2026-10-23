/**
 * Static DANA QRIS Payment API
 *
 * GET /payment/dana?qr=QR_STRING&amount=10000
 *
 * result:
 *  - qr_string
 *  - url (PNG, auto delete)
 */

import QRCode from "qrcode"
import fs from "fs"
import path from "path"
import crypto from "crypto"
import logger from "../../src/utils/logger.js"

/* ===============================
   FILE STORAGE (SAMA DENGAN TOURL)
================================ */
const uploadDir = path.join(process.cwd(), "files")
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir)

/* ===============================
   UTILS
================================ */
function randomName(ext = ".png") {
  return crypto.randomBytes(16).toString("hex") + ext
}

/* ===============================
   TLV PARSER
================================ */
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
================================ */
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
================================ */
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
================================ */
export default {
  name: "QRIS STATIC ALL PAYMENT",
  description: "Generate static QR with fixed amount",
  category: "Payment",
  methods: ["GET"],

  params: ["qr", "amount"],

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
  },

  async run(req, res) {
    try {
      const { qr, amount } = req.query || {}

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
         SAVE QR IMAGE (PNG)
      ================================ */
      const filename = randomName(".png")
      const filePath = path.join(uploadDir, filename)

      await QRCode.toFile(filePath, qrString, {
        scale: 8,
        margin: 1,
      })

      const url = `${req.protocol}://${req.get("host")}/files/${filename}`
      
      /*
      const TTL = 5 * 60 * 1000
      // ⏱️ auto delete (SAMA DENGAN TOURL)
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
          logger.info(`[DANA] QR expired & deleted | file=${filename}`)
        }
      }, TTL)
      */
      
      logger.info(
        `[DANA] QR generated | ip=${req.ip} | amount=${amount} | file=${filename}`
      )

      return res.json({
        status: true,
        result: {
          amount: amount,
          qr_string: qrString,
          url,
        },
        //expiresIn: TTL,
        timestamp: Date.now(),
      })
    } catch (err) {
      logger.error(
        `[DANA] Error | ip=${req.ip} | error=${err.message}`
      )
      return res.status(500).json({
        status: false,
        message: err.message || "Failed to generate QR",
      })
    }
  },
}