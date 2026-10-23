/**
 * Tri Check API
 *
 * POST /checknumber/tricheck
 * GET /checknumber/tricheck?number=62897xxxxxxx
 *
 * result:
 * - Mengembalikan informasi kartu Tri
 */

import logger from "../../src/utils/logger.js"

export default {
  name: "Tri Check",
  description: "Cek informasi nomor kartu Tri",
  category: "Check Number",
  methods: ["GET", "POST"],
  params: ["number"],

  paramsSchema: {
    number: {
      type: "string",
      required: true,
    },
  },

  async run(req, res) {
    try {
      const { number } = { ...req.query, ...req.body }

      if (!number) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'number' wajib diisi",
        })
      }

      let msisdn = String(number).replace(/[^0-9]/g, "")

      if (msisdn.startsWith("08")) {
        msisdn = "62" + msisdn.slice(1)
      }

      const triPrefix = /^(6289[5-9])/
      if (!triPrefix.test(msisdn)) {
        return res.status(400).json({
          status: false,
          message: "Nomor bukan prefix SIM TRI (0895\u20130899)",
        })
      }

      const response = await fetch("https://tri.co.id/api/v1/information/sim-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "sec-ch-ua-platform": '"Android"',
          "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "sec-ch-ua": '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
          "sec-ch-ua-mobile": "?1",
          "Origin": "https://tri.co.id",
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Dest": "empty",
          "Referer": "https://tri.co.id/",
          "Accept-Language": "id,en-US;q=0.9,en;q=0.8,ar;q=0.7",
        },
        body: JSON.stringify({
          action: "MSISDN_STATUS_WEB",
          input1: "",
          input2: "",
          language: "ID",
          msisdn,
        }),
      })

      const result = await response.json()

      if (!result?.status) {
        return res.status(400).json({
          status: false,
          message: "Nomor tidak valid atau bukan SIM TRI",
        })
      }

      const data = result.data

      if (!data || data.responseCode !== "00000") {
        return res.status(400).json({
          status: false,
          message: "Nomor tidak valid atau bukan SIM TRI",
        })
      }

      const getStatusEmoji = (status) => {
        const s = status?.toLowerCase() || ""
        if (s.includes("aktif") || s.includes("sudah") || s.includes("registrasi")) return "✅"
        if (s.includes("non") || s.includes("belum")) return "❌"
        if (s.includes("blok")) return "🔒"
        return "❓"
      }

      const now = new Date()
      const endDate = data.actEndDate ? new Date(data.actEndDate) : null
      const remainingDays =
        endDate && !isNaN(endDate)
          ? Math.max(0, Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)))
          : "-"

      logger.info(`[TRI-CHECK] success | ip=${req.ip} | number=${msisdn}`)

      return res.json({
        status: true,
        result: {
          informasi_umum: {
            nomor: data.msisdn,
            iccid: data.iccid,
          },
          status_layanan: {
            kartu: {
              status: data.cardStatus,
              emoji: getStatusEmoji(data.cardStatus),
            },
            registrasi: {
              status: data.activationStatus,
              emoji: getStatusEmoji(data.activationStatus),
            },
          },
          masa_berlaku: {
            aktivasi: data.activationDate || "-",
            berakhir: data.actEndDate || "-",
            sisa_waktu_hari: remainingDays,
          },
          produk_distribusi: {
            produk: data.prodDesc || "-",
            wilayah: data.retDistrict || "-",
          },
        },
      })
    } catch (err) {
      logger.error(`[TRI-CHECK] Error | ip=${req.ip} | error=${err.message}`)
      return res.status(500).json({
        status: false,
        message: err.message || "Failed to check Tri number",
      })
    }
  },
}
