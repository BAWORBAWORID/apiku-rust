import axios from 'axios'
import logger from "../../src/utils/logger.js"

const COUNTRY_MAP = {
  ID: "Indonesia", MY: "Malaysia", PH: "Philippines", SG: "Singapore",
  MM: "Myanmar", TH: "Thailand", VN: "Vietnam", KH: "Cambodia",
  LA: "Laos", BR: "Brazil", US: "United States", TR: "Turkey",
  RU: "Russia", IN: "India", SA: "Saudi Arabia", AE: "United Arab Emirates",
  JP: "Japan", KR: "South Korea", TW: "Taiwan", HK: "Hong Kong"
}

async function checkMobileLegends(userId, zoneId) {
  userId = String(userId || '').trim().replace(/\D/g, '')
  zoneId = String(zoneId || '').trim().replace(/\D/g, '')
  if (!userId || !zoneId || userId.length < 4 || zoneId.length < 3) {
    return { status: "error", status_code: 400, message: "User ID & Zone ID harus angka valid" }
  }

  const payload = {
    code: "MOBILE_LEGENDS",
    data: { userId, zoneId }
  }

  try {
    const res = await axios.post("https://gopay.co.id/games/v1/order/user-account", payload, {
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      timeout: 6000
    })

    const { message, data } = res.data
    if (message !== "Success" && !data?.username) {
      return { status: "not_found", status_code: 404, message: "Akun MLBB tidak ditemukan" }
    }

    const countryCode = (data.countryOrigin || "").toUpperCase()
    return {
      status: "success",
      account: {
        user_id: userId,
        zone_id: zoneId,
        nickname: data.username,
        country_code: countryCode || "UNKNOWN",
        country_name: COUNTRY_MAP[countryCode] || countryCode || "Unknown"
      }
    }
  } catch (err) {
    if (err.response?.data?.message) {
      return { status: "not_found", status_code: 404, message: err.response.data.message }
    }
    return { status: "not_found", status_code: 404, message: "Invalid ID Player or Server ID" }
  }
}

export default {
  name: "Mobile Legends ID Checker",
  description: "Check Mobile Legends account by User ID & Zone ID",
  category: "Stalker",
  methods: ["GET", "POST"],
  params: ["user_id", "zone_id"],
  paramsSchema: {
    user_id: { type: "string", required: true, description: "Mobile Legends User ID", example: "496332516" },
    zone_id: { type: "string", required: true, description: "Mobile Legends Zone/Server ID", example: "2463" }
  },
  async run(req, res) {
    try {
      const { user_id, zone_id } = { ...req.query, ...req.body }
      if (!user_id || !zone_id) return res.status(400).json({ status: false, message: "Parameter 'user_id' dan 'zone_id' wajib diisi" })
      const result = await checkMobileLegends(user_id, zone_id)
      const statusCode = result.status_code || (result.status === 'success' ? 200 : 500)
      return res.status(statusCode).json(result)
    } catch (err) {
      logger.error(`[STALKER-ML-ID] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message })
    }
  }
}