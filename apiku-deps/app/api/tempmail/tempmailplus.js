/**
 * TempMail Plus — Temporary Disposable Email Provider
 * Base: https://tempmail.plus
 * 
 * Fitur:
 *   - create: Buat alamat email random / custom dengan 9 pilihan domain
 *   - domains: List semua domain yang didukung
 *   - inbox: Cek daftar email masuk
 *   - message: Baca detail isi email (teks, HTML, attachment)
 *   - delete: Hapus pesan tertentu
 *   - wait: Tunggu email masuk secara realtime (polling otomatis)
 */

import axios from "axios";
import crypto from "node:crypto";

const BASE_URL = "https://tempmail.plus";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const DOMAINS = [
  "mailto.plus",
  "fexpost.com",
  "fexbox.org",
  "mailbox.in.ua",
  "rover.info",
  "chitthi.in",
  "fextemp.com",
  "any.pink",
  "merepost.com"
];

const HEADERS = {
  "User-Agent": UA,
  "Accept": "application/json, text/plain, */*",
  "Referer": `${BASE_URL}/`
};

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomString(length = 8) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let res = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    res += chars[bytes[i] % chars.length];
  }
  return res;
}

export async function getInbox(email, limit = 20) {
  const res = await axios.get(`${BASE_URL}/api/mails`, {
    params: { email, limit },
    headers: HEADERS,
    timeout: 30000,
    validateStatus: () => true
  });

  if (res.status !== 200 || !res.data) {
    throw new Error(`Gagal mengambil inbox (HTTP ${res.status})`);
  }

  const list = res.data.mail_list || [];
  return {
    count: list.length,
    total: res.data.count || list.length,
    messages: list.map((m) => ({
      id: m.mail_id,
      from: m.from_mail,
      from_name: m.from_name,
      subject: m.subject,
      time: m.time,
      is_new: Boolean(m.is_new),
      attachments: m.attachment_count || 0
    }))
  };
}

export async function getMessage(email, mailId) {
  const res = await axios.get(`${BASE_URL}/api/mails/${mailId}`, {
    params: { email },
    headers: HEADERS,
    timeout: 30000,
    validateStatus: () => true
  });

  if (res.status !== 200 || !res.data) {
    throw new Error(`Gagal membaca pesan ${mailId} (HTTP ${res.status})`);
  }

  const d = res.data;
  return {
    id: d.mail_id,
    subject: d.subject,
    from: d.from_mail,
    from_name: d.from_name,
    to: d.to,
    text: d.text,
    html: d.html,
    is_tls: Boolean(d.is_tls),
    message_id: d.message_id
  };
}

export async function deleteMessage(email, mailId) {
  const res = await axios.delete(`${BASE_URL}/api/mails/${mailId}`, {
    params: { email },
    headers: HEADERS,
    timeout: 30000,
    validateStatus: () => true
  });

  return res.data?.result === true;
}

export async function waitForEmail(email, maxWaitSec = 60, intervalSec = 4) {
  const maxAttempts = Math.ceil(maxWaitSec / intervalSec);
  const initial = await getInbox(email);
  const initialCount = initial.count;

  for (let i = 0; i < maxAttempts; i++) {
    await delay(intervalSec * 1000);
    const current = await getInbox(email);

    if (current.count > initialCount || (initialCount === 0 && current.count > 0)) {
      const latestMsg = current.messages[0];
      const detail = await getMessage(email, latestMsg.id).catch(() => null);
      return {
        ...latestMsg,
        detail
      };
    }
  }

  return null;
}

export default {
  name: "TempMail Plus",
  description: "Temporary disposable email service dari tempmail.plus dengan 9 pilihan domain gratis",
  category: "Email",
  methods: ["GET", "POST"],
  params: ["action", "email", "name", "domain", "id", "timeout"],
  paramsSchema: {
    action: {
      type: "string",
      required: false,
      default: "create",
      enum: ["create", "domains", "inbox", "message", "delete", "wait"],
      description: "Aksi yang diinginkan: create, domains, inbox, message, delete, wait"
    },
    email: {
      type: "string",
      required: false,
      description: "Alamat email lengkap (wajib untuk inbox, message, delete, wait)"
    },
    name: {
      type: "string",
      required: false,
      description: "Nama/username custom untuk email (opsional, pada action=create)"
    },
    domain: {
      type: "string",
      required: false,
      enum: DOMAINS,
      default: "mailto.plus",
      description: "Pilihan domain tempmail (opsional, pada action=create)"
    },
    id: {
      type: "string",
      required: false,
      description: "ID email untuk membaca detail atau menghapus pesan"
    },
    timeout: {
      type: "number",
      required: false,
      default: 60,
      description: "Batas waktu tunggu dalam detik untuk action=wait (maksimal 180s)"
    }
  },

  async run(req, res) {
    const q = { ...req.query, ...req.body };
    const action = (q.action || "create").toLowerCase().trim();

    try {
      // 1. DOMAINS
      if (action === "domains") {
        return res.json({
          status: true,
          total: DOMAINS.length,
          domains: DOMAINS
        });
      }

      // 2. CREATE
      if (action === "create" || action === "generate") {
        const domain = (q.domain || "mailto.plus").toLowerCase().trim();
        if (!DOMAINS.includes(domain)) {
          return res.status(400).json({
            status: false,
            message: `Domain tidak valid. Pilihan yang tersedia: ${DOMAINS.join(", ")}`
          });
        }

        const username = q.name
          ? q.name.toString().toLowerCase().replace(/[^a-z0-9_.-]/g, "")
          : randomString(8);

        const email = `${username}@${domain}`;

        return res.json({
          status: true,
          action: "create",
          result: {
            email,
            username,
            domain
          }
        });
      }

      // Validasi email untuk aksi inbox, message, delete, wait
      const email = (q.email || "").toString().trim().toLowerCase();
      if (!email || !email.includes("@")) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'email' valid wajib diisi untuk aksi ini"
        });
      }

      // 3. INBOX
      if (action === "inbox" || action === "messages") {
        const inbox = await getInbox(email);
        return res.json({
          status: true,
          action: "inbox",
          email,
          total: inbox.total,
          count: inbox.count,
          messages: inbox.messages
        });
      }

      // 4. MESSAGE (Read single email)
      if (action === "message" || action === "read" || action === "detail") {
        const mailId = q.id || q.mail_id;
        if (!mailId) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'id' (mail ID) wajib diisi untuk membaca pesan"
          });
        }

        const message = await getMessage(email, mailId);
        return res.json({
          status: true,
          action: "message",
          result: message
        });
      }

      // 5. DELETE
      if (action === "delete" || action === "destroy") {
        const mailId = q.id || q.mail_id;
        if (!mailId) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'id' (mail ID) wajib diisi untuk menghapus pesan"
          });
        }

        const success = await deleteMessage(email, mailId);
        return res.json({
          status: success,
          action: "delete",
          message: success ? "Pesan berhasil dihapus" : "Gagal menghapus pesan / pesan tidak ditemukan"
        });
      }

      // 6. WAIT (Poll until an email arrives)
      if (action === "wait") {
        const maxWait = Math.min(Math.max(parseInt(q.timeout, 10) || 60, 5), 180);
        const incoming = await waitForEmail(email, maxWait, 4);

        if (!incoming) {
          return res.json({
            status: false,
            action: "wait",
            message: `Tidak ada email baru masuk dalam ${maxWait} detik`,
            email
          });
        }

        return res.json({
          status: true,
          action: "wait",
          email,
          result: incoming
        });
      }

      return res.status(400).json({
        status: false,
        message: "Action tidak valid. Gunakan: create, domains, inbox, message, delete, wait"
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Terjadi kesalahan pada layanan TempMail Plus"
      });
    }
  }
};
