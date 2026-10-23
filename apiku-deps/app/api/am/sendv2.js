import axios from 'axios'
import logger from "../../src/utils/logger.js"

const API_KEY = 'AIzaSyDrZ9jr_Y16ltSBqsQR5IH6I04FRga6Ki0'
const FIREBASE_REFERER = 'https://alight-creative.firebaseapp.com'
const CONTINUE_URL = 'https://alightcreative.com'

const headers = {
  'Content-Type': 'application/json',
  'User-Agent': 'Zyvor/1.0',
  'Referer': FIREBASE_REFERER,
  'Origin': 'https://alight-creative.firebaseapp.com'
}

async function sendMagicLink(email) {
  const response = await axios.post(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${API_KEY}`,
    {
      requestType: 'EMAIL_SIGNIN',
      email: email.trim(),
      actionCodeSettings: {
        url: CONTINUE_URL,
        handleCodeInApp: true
      }
    },
    { headers, timeout: 30000 }
  )
  return response.data
}

export default {
  name: "AlightMotion Send v2",
  description: "Kirim email sign-in link Alight Motion",
  category: "AlightMotion",
  methods: ["GET", "POST"],
  params: ["email"],
  paramsSchema: {
    email: {
      type: "string",
      required: true,
      description: "Email tujuan untuk magic link verifikasi",
      example: "user@email.com"
    }
  },

  async run(req, res) {
    try {
      const { email } = { ...req.query, ...req.body }

      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return res.status(400).json({
          status: false,
          error: "Parameter 'email' wajib diisi dan harus valid"
        })
      }

      const result = await sendMagicLink(email)

      if (result.error) {
        logger.error(`[AM SENDv2] Error: ${result.error.message}`)
        return res.status(502).json({ status: false, error: result.error.message })
      }

      return res.json({
        status: true,
        message: "Link verifikasi berhasil dikirim",
        result: {
          email: email.trim(),
          kind: result.kind
        }
      })

    } catch (err) {
      logger.error(`[AM SENDv2] Error: ${err.message}`)
      const errMsg = err.response?.data?.error?.message || err.message
      return res.status(500).json({ status: false, error: errMsg })
    }
  }
}