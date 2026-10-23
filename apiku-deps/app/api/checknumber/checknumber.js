/**
 * Combined Check Number API (XL & Tri)
 *
 * GET /api/checknumber/checknumber?number=081915895220
 * POST /api/checknumber/checknumber
 *
 * Mendukung operator XL, Axis, dan Tri dengan deteksi otomatis berdasarkan prefix nomor.
 */

import logger from "../../src/utils/logger.js"
import xlCheck from "./xlcheck.js"
import triCheck from "./tricheck.js"

/**
 * Deteksi operator berdasarkan prefix nomor HP Indonesia
 * @param {string} cleanNumber - Nomor HP hanya digit angka
 * @returns {"TRI" | "XL" | "UNKNOWN"}
 */
function detectOperator(cleanNumber) {
  let num = cleanNumber
  if (num.startsWith("628")) {
    num = "0" + num.slice(2)
  } else if (num.startsWith("8")) {
    num = "0" + num
  }

  // Tri (3) prefixes: 0895, 0896, 0897, 0898, 0899
  if (/^089[5-9]/.test(num)) {
    return "TRI"
  }

  // XL Axiata & Axis prefixes:
  // XL: 0817, 0818, 0819, 0859, 0877, 0878
  // Axis: 0831, 0832, 0833, 0838
  if (/^(081[7-9]|0859|087[7-8]|083[1-3]|0838)/.test(num)) {
    return "XL"
  }

  return "UNKNOWN"
}

export default {
  name: "Check Number (XL & Tri)",
  description: "Cek informasi nomor kartu seluler (otomatis deteksi operator XL, Axis, dan Tri) — paket, kuota, masa aktif, dan status kartu",
  category: "Check Number",
  methods: ["GET", "POST"],
  params: ["number"],

  paramsSchema: {
    number: {
      type: "string",
      required: true,
      description: "Nomor XL/Axis (0817-0819, 0859, 0877-0878, 0831-0838) atau Tri (0895-0899)",
      example: "081915895220"
    }
  },

  async run(req, res) {
    try {
      const number = req.query?.number || req.body?.number

      if (!number) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'number' wajib diisi"
        })
      }

      const cleanNumber = String(number).replace(/\D/g, "")
      const operator = detectOperator(cleanNumber)

      if (operator === "TRI") {
        logger.info(`[CHECK-NUMBER] Routed to Tri | ip=${req.ip} | number=${cleanNumber}`)
        return triCheck.run(req, res)
      }

      if (operator === "XL") {
        logger.info(`[CHECK-NUMBER] Routed to XL | ip=${req.ip} | number=${cleanNumber}`)
        return xlCheck.run(req, res)
      }

      logger.warn(`[CHECK-NUMBER] Unsupported operator prefix | ip=${req.ip} | number=${cleanNumber}`)
      return res.status(400).json({
        status: false,
        message: "Operator tidak didukung. Nomor harus merupakan kartu XL/Axis (0817–0819, 0859, 0877–0878, 0831–0838) atau Tri (0895–0899)."
      })
    } catch (err) {
      logger.error(`[CHECK-NUMBER] Error | ip=${req.ip} | error=${err.message}`)
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses pengecekan nomor"
      })
    }
  }
}
