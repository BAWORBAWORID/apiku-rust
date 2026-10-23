import axios from "axios";
import { loadSession, saveSession } from "../../src/utils/session.js";

const API = "https://api.internal.temp-mail.io/api/v3/email";

function randomStr(len = 15) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function buildHeaders() {
  return {
    "Content-Type": "application/json",
    "Application-Name": "web",
    "Application-Version": "4.0.0",
    "X-CORS-Header": randomStr(15),
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Referer": "https://temp-mail.io/"
  };
}

async function createEmail() {
  const res = await axios.post(`${API}/new`, { min_name_length: 10, max_name_length: 12 }, { headers: buildHeaders() });
  return res.data.email;
}

async function getMessages(email) {
  const res = await axios.get(`${API}/${email}/messages`, { headers: buildHeaders() });
  return res.data || [];
}

export default {
  name: "TempMail - Temp-Mail.io",
  description: "Temporary email service — create & inbox.",
  category: "Email",
  methods: ["GET", "POST"],
  params: ["action", "sessionId"],

  paramsSchema: {
    action: {
      type: "string",
      required: true,
      default: "create",
      enum: ["create", "inbox"],
      description: "Aksi: create (buat email baru) atau inbox (cek pesan masuk)"
    },
    sessionId: {
      type: "string",
      required: false,
      description: "Session ID untuk menyimpan email (wajib jika action=inbox)",
      example: "mysession123"
    }
  },

  async run(req, res) {
    const { action, sessionId } = { ...req.query, ...req.body };

    if (!action) {
      return res.status(400).json({ status: false, message: "Parameter 'action' wajib diisi (create / inbox)" });
    }

    if (action === "create") {
      try {
        const email = await createEmail();
        const session = { email, createdAt: new Date().toISOString() };

        if (sessionId) await saveSession(`tmv8_${sessionId}.json`, session);

        return res.json({
          status: true,
          action: "create",
          result: { email, sessionId: sessionId || null }
        });
      } catch (err) {
        return res.status(500).json({ status: false, message: err.message || "Gagal membuat email" });
      }
    }

    if (action === "inbox") {
      if (!sessionId) {
        return res.status(400).json({ status: false, message: "Parameter 'sessionId' wajib diisi untuk action=inbox" });
      }

      try {
        const session = await loadSession(`tmv8_${sessionId}.json`, null);
        if (!session?.email) {
          return res.status(404).json({ status: false, message: "Session tidak ditemukan. Buat email baru dengan action=create" });
        }

        const messages = await getMessages(session.email);

        return res.json({
          status: true,
          action: "inbox",
          result: {
            email: session.email,
            total: messages.length,
            messages: messages.map(msg => ({
              id: msg.id,
              from: msg.from,
              subject: msg.subject,
              date: msg.created_at,
              body: msg.body_text || null
            }))
          }
        });
      } catch (err) {
        return res.status(500).json({ status: false, message: err.message || "Gagal mengambil pesan" });
      }
    }

    return res.status(400).json({ status: false, message: "action tidak valid. Gunakan: create / inbox" });
  }
};
