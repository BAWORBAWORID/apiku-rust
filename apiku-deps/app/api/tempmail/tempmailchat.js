/**
 * TempMail Chat — tempmail.chat backend (Cloudflare Workers)
 * Feature: create inbox, check inbox, wait for email, auto (create+wait), delete inbox
 * Upstream: tempmail-backend.hasnaintariq142.workers.dev
 */
import axios from "axios"

const API_BASE = "https://api.lmngh.site/api"
const CREATE_API = `${API_BASE}/create-inbox`
const INBOX_API = `${API_BASE}/inbox`
const DELETE_API = `${API_BASE}/delete-inbox`

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "Origin": "https://lmngh.site",
  "Referer": "https://lmngh.site/"
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function createInbox() {
  const response = await axios.post(CREATE_API, {}, {
    timeout: 30000,
    headers: HEADERS,
    validateStatus: () => true
  })
  return {
    status: response.status,
    data: response.data
  }
}

async function getInbox(token) {
  const response = await axios.get(`${INBOX_API}?token=${encodeURIComponent(token)}`, {
    timeout: 30000,
    headers: { ...HEADERS, Accept: "application/json" },
    validateStatus: () => true
  })
  return {
    status: response.status,
    data: response.data
  }
}

async function deleteInbox(token) {
  const response = await axios.post(DELETE_API, {
    token: token
  }, {
    timeout: 30000,
    headers: HEADERS,
    validateStatus: () => true
  })
  return {
    status: response.status,
    data: response.data
  }
}

async function waitForEmail(token, maxWait) {
  const maxAttempts = Math.ceil((maxWait || 120) / 5)
  const knownIds = new Set()

  for (let i = 0; i < maxAttempts; i++) {
    const inbox = await getInbox(token)

    if (inbox.status === 200 && inbox.data?.success) {
      const messages = inbox.data.messages || []

      for (const msg of messages) {
        const msgId = msg.id || msg.received_at || JSON.stringify(msg)
        if (!knownIds.has(msgId)) {
          knownIds.add(msgId)
          return inbox.data
        }
      }
    }

    await delay(5000)
  }

  return null
}

function extractLinks(body) {
  if (!body) return []
  const links = new Set()
  const hrefRe = /href=['"]([^'"]+)['"]/gi
  let m
  while ((m = hrefRe.exec(body)) !== null) links.add(m[1])
  const urlRe = /https?:\/\/[^\s<>'"]+/gi
  while ((m = urlRe.exec(body)) !== null) links.add(m[0])
  return Array.from(links)
}

function normalizeMessages(messages) {
  return messages.map((m, index) => ({
    index: index + 1,
    id: m.id || null,
    from: m.sender || null,
    fromName: m.sender_name || null,
    to: m.recipient || null,
    subject: m.subject || null,
    body: m.text_body || null,
    html: m.html_body || null,
    links: extractLinks(m.html_body || m.text_body || ""),
    date: m.received_at || null,
    expires: m.expires_at ? formatExpiresData(m.expires_at).expires : null
  }))
}

function formatRemaining(s) {
  if (s <= 0) return "expired";
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);

  if (hours >= 24 && hours % 24 === 0 && minutes === 0) {
    return `${hours} jam`;
  }
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remH = hours % 24;
    return remH > 0 ? `${days} hari ${remH} jam` : `${days} hari`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours} jam ${minutes} menit` : `${hours} jam`;
  }
  return `${Math.max(1, minutes)} menit`;
}

function formatExpiresData(expiresInOrAt) {
  const pad = (n) => String(n).padStart(2, "0");
  const formatDate = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  if (!expiresInOrAt) return { expires: null, expires_human: null };

  let targetDate;
  let remainingSec = 0;

  if (typeof expiresInOrAt === "number" || /^\d+$/.test(String(expiresInOrAt).trim())) {
    remainingSec = Number(expiresInOrAt);
    targetDate = new Date(Date.now() + remainingSec * 1000);
  } else {
    const raw = String(expiresInOrAt).trim();
    // Upstream sends "YYYY-MM-DD HH:mm:ss" in UTC
    const iso = raw.includes("T") ? raw : raw.replace(" ", "T") + (raw.endsWith("Z") ? "" : "Z");
    targetDate = new Date(iso);
    if (isNaN(targetDate.getTime())) {
      targetDate = new Date(raw);
    }
    if (!isNaN(targetDate.getTime())) {
      remainingSec = Math.max(0, Math.floor((targetDate.getTime() - Date.now()) / 1000));
    }
  }

  if (!targetDate || isNaN(targetDate.getTime())) {
    return {
      expires: String(expiresInOrAt),
      expires_human: null
    };
  }

  return {
    expires: formatDate(targetDate),
    expires_human: formatRemaining(remainingSec)
  };
}

export default {
  name: "TempMail Chat",
  description:
    "Temporary email — create inbox, cek inbox, wait email masuk, auto (create+wait), delete inbox",
  category: "Email",
  methods: ["GET", "POST"],
  params: ["action", "token", "maxwait"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      description: "Action yang tersedia",
      enum: ["create", "inbox", "wait", "auto", "delete"],
      required_error: "Parameter 'action' wajib diisi (create|inbox|wait|auto|delete)",
      invalid_error: "Action tidak valid. Gunakan: create, inbox, wait, auto, delete"
    },
    token: {
      type: "string",
      required: false,
      description: "Access token inbox (hasil dari action=create) — wajib untuk inbox/wait/delete"
    },
    maxwait: {
      type: "number",
      required: false,
      description: "Maksimal waktu tunggu email (detik) untuk action wait/auto",
      default: 120,
      min: 5,
      max: 300
    }
  },
  async run(req, res) {
    const { action, token, maxwait } = { ...req.query, ...req.body }

    if (!action) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'action' wajib diisi (create|inbox|wait|auto|delete)"
      })
    }

    const maxWait = parseInt(maxwait) || 120

    try {
      if (action === "create") {
        const hasil = await createInbox()

        if (hasil.status === 200 && hasil.data?.success) {
          const exp = formatExpiresData(hasil.data.expires_in || hasil.data.expires_at);
          return res.json({
            status: true,
            data: {
              email: hasil.data.email,
              token: hasil.data.access_token,
              expires: exp.expires,
              expires_human: exp.expires_human
            }
          })
        }
        return res.json({
          status: false,
          message: hasil.data?.error || `HTTP ${hasil.status}`
        })
      }

      if (action === "inbox") {
        if (!token) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'token' wajib diisi (dari action=create)"
          })
        }

        const hasil = await getInbox(token)

        if (hasil.status === 200 && hasil.data?.success) {
          const messages = normalizeMessages(hasil.data.messages || [])
          const exp = formatExpiresData(hasil.data.expires_at || hasil.data.expires_in);
          return res.json({
            status: true,
            data: {
              email: hasil.data.email || null,
              expires: exp.expires,
              expires_human: exp.expires_human,
              total: messages.length,
              messages
            }
          })
        }
        return res.json({
          status: false,
          message: hasil.data?.error || `HTTP ${hasil.status}`
        })
      }

      if (action === "wait") {
        if (!token) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'token' wajib diisi (dari action=create)"
          })
        }

        const hasil = await waitForEmail(token, maxWait)

        if (hasil) {
          const messages = normalizeMessages(hasil.messages || [])
          const exp = formatExpiresData(hasil.expires_at || hasil.expires_in);
          return res.json({
            status: true,
            data: {
              email: hasil.email || null,
              expires: exp.expires,
              expires_human: exp.expires_human,
              total: messages.length,
              messages
            }
          })
        }
        return res.json({
          status: false,
          message: `Tidak ada email masuk dalam ${maxWait} detik`
        })
      }

      if (action === "auto") {
        const buat = await createInbox()

        if (buat.status !== 200 || !buat.data?.success) {
          return res.json({
            status: false,
            message: buat.data?.error || "Gagal buat inbox"
          })
        }

        const hasil = await waitForEmail(buat.data.access_token, maxWait)

        if (hasil) {
          const messages = normalizeMessages(hasil.messages || [])
          const exp = formatExpiresData(hasil.expires_at || hasil.expires_in);
          return res.json({
            status: true,
            data: {
              email: hasil.email || buat.data.email,
              token: buat.data.access_token,
              expires: exp.expires,
              expires_human: exp.expires_human,
              total: messages.length,
              messages
            }
          })
        }
        return res.json({
          status: false,
          message: `Tidak ada email masuk dalam ${maxWait} detik`,
          data: {
            email: buat.data.email,
            token: buat.data.access_token
          }
        })
      }

      if (action === "delete") {
        if (!token) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'token' wajib diisi (dari action=create)"
          })
        }

        const hasil = await deleteInbox(token)
        return res.json({
          status: hasil.status === 200 && hasil.data?.success,
          data: hasil.data
        })
      }

      return res.status(400).json({
        status: false,
        message: "Action tidak valid. Gunakan: create, inbox, wait, auto, delete"
      })
    } catch (error) {
      res.json({
        status: false,
        message: error.message || "Terjadi kesalahan internal"
      })
    }
  },
}
