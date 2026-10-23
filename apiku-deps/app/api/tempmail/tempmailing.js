/**
 * TempMail v10 - tempmail.ing backend
 * GET /tempmail/tempmailing?action=create
 * GET /tempmail/tempmailing?action=inbox&email=xxx
 *
 * Base: https://tempmail.ing
 * API : https://api.tempmail.ing/api
 */

const API_URL = "https://api.tempmail.ing/api"

const HEADERS = {
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9",
  "content-type": "application/json",
  origin: "https://tempmail.ing",
  referer: "https://tempmail.ing/",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
}

async function generateEmail() {
  try {
    const res = await fetch(`${API_URL}/generate`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({}),
    })
    const data = await res.json()
    if (!data?.success || !data?.email?.address) {
      throw new Error(data?.message || "Gagal generate email")
    }
    return { status: true, email: data.email.address, raw: data.email }
  } catch (err) {
    return { status: false, error: err.message }
  }
}

async function checkInbox(email) {
  try {
    const res = await fetch(
      `${API_URL}/emails/${encodeURIComponent(email)}`,
      { method: "GET", headers: HEADERS }
    )
    const data = await res.json()
    if (!data?.success) {
      throw new Error(data?.message || "Gagal mengecek inbox")
    }
    return { status: true, emails: data.emails || [] }
  } catch (err) {
    return { status: false, error: err.message }
  }
}

export default {
  name: "TempMail - TempMail.ing",
  description: "Temporary email generator - create & inbox",
  category: "Email",
  methods: ["GET", "POST"],

  params: ["action", "email"],

  paramsSchema: {
    action: {
      type: "string",
      required: true,
      enum: ["create", "inbox"],
      description: "Aksi: create (buat email baru), inbox (cek pesan masuk)",
    },
    email: {
      type: "string",
      required: false,
      description: "Alamat email (wajib untuk action=inbox)",
    },
  },

  async run(req, res) {
    try {
      const { action, email } = { ...req.query, ...req.body }

      if (!action || (action !== "create" && action !== "inbox")) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'action' harus 'create' atau 'inbox'",
        })
      }

      if (action === "create") {
        const result = await generateEmail()
        if (!result.status) {
          return res.status(500).json({ status: false, message: result.error })
        }
        return res.json({
          status: true,
          action: "create",
          result: { email: result.email },
        })
      }

      if (action === "inbox") {
        if (!email || typeof email !== "string" || !email.includes("@")) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'email' wajib diisi (valid) untuk action=inbox",
          })
        }
        const result = await checkInbox(email.trim())
        if (!result.status) {
          return res.status(500).json({ status: false, message: result.error })
        }
        return res.json({
          status: true,
          action: "inbox",
          email: email.trim(),
          result: { inbox: result.emails },
        })
      }
    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "TempMail request failed",
      })
    }
  },
}
