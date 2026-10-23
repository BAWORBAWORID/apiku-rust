import crypto from "crypto"
import logger from "../../src/utils/logger.js"

const TOKOGAKE_BASE = "https://api.tokogame.com/core/v1"

function makeHeaders() {
  const requestId = crypto.randomUUID()
  const secretId = crypto.createHmac("sha256", "tokogame.com").update(requestId).digest("hex")
  const appInstanceId = crypto.randomUUID().replace(/-/g, "")
  return {
    Accept: "application/json, text/plain, */*",
    "X-Language": "ID",
    "X-Region": "ID",
    "X-Currency": "IDR",
    "X-Request-Id": requestId,
    "X-Secret-Id": secretId,
    "X-App-Instance-Id": appInstanceId,
    Origin: "https://www.tokogame.com",
    Referer: "https://www.tokogame.com/",
  }
}

export default {
  name: "CEK TOP UP",
  description: "Cek status pembayaran top-up (DANA, Free Fire, dll)",
  category: "Topup",
  methods: ["GET", "POST"],

  params: ["orderId", "orderCode"],

  paramsSchema: {
    orderId: {
      type: "string",
      required: true,
      description: "Order ID dari hasil create order",
      example: "6a472ebad5dc3a56a627fe9e",
    },
    orderCode: {
      type: "string",
      required: true,
      description: "Order Code dari hasil create order",
      example: "260703YASJKYYBZ",
    },
  },

  async run(req, res) {
    try {
      const { orderId, orderCode } = { ...req.query, ...req.body }

      if (!orderId) {
        return res.status(400).json({ status: false, message: "Parameter 'orderId' wajib diisi" })
      }
      if (!orderCode) {
        return res.status(400).json({ status: false, message: "Parameter 'orderCode' wajib diisi" })
      }

      const url = `${TOKOGAKE_BASE}/orders?id=${orderId}&code=${orderCode}`

      logger.info(`[CEK-TOPUP] Checking order | id=${orderId} | code=${orderCode}`)

      const response = await fetch(url, {
        method: "GET",
        headers: makeHeaders(),
      })

      const data = await response.json()

      if (!response.ok) {
        logger.error(`[CEK-TOPUP] Tokogame error | status=${response.status} | body=${JSON.stringify(data)}`)
        return res.status(response.status).json({ status: false, message: data.message || "Gagal cek status" })
      }

      const { paymentStatus, processingStatus } = data.data || {}

      logger.info(`[CEK-TOPUP] Result | id=${orderId} | payment=${paymentStatus} | process=${processingStatus}`)

      return res.json({
        status: true,
        result: {
          orderId,
          orderCode,
          paymentStatus: paymentStatus || "UNKNOWN",
          processingStatus: processingStatus || "UNKNOWN",
        },
        timestamp: Date.now(),
      })
    } catch (err) {
      logger.error(`[CEK-TOPUP] Error | ip=${req.ip} | error=${err.message}`)
      return res.status(500).json({ status: false, message: err.message || "Gagal cek status" })
    }
  },
}
