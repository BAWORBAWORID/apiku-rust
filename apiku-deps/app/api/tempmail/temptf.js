import axios from "axios";
import logger from "../../src/utils/logger.js";

const BASE_URL = "https://temp.tf";

const PROVIDERS = ["gmail", "outlook", "hotmail", "high.edu.pl"];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function baseHeaders(extra = {}) {
  return {
    "User-Agent": UA,
    Referer: `${BASE_URL}/`,
    Origin: BASE_URL,
    ...extra,
  };
}

const isTruthy = (v) =>
  v === true || v === "true" || v === "1" || v === 1 || v === "yes";

/**
 * Generate satu alamat email sementara dari pool provider.
 */
async function generateEmail({ providers, dot, plus, retries = 2 }) {
  const list = String(providers || "high.edu.pl")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .filter((p) => PROVIDERS.includes(p));

  if (list.length === 0) {
    return {
      status: false,
      message: `Provider tidak valid. Pilihan: ${PROVIDERS.join(", ")}`,
    };
  }

  const query = {
    providers: list.join(","),
    dot: dot ? "1" : "0",
    plus: plus ? "1" : "0",
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { data, status } = await axios.get(`${BASE_URL}/api/account`, {
        params: query,
        headers: baseHeaders(),
        timeout: 30000,
        validateStatus: (s) => s < 500,
      });

      if (status === 429) {
        if (attempt === retries) {
          return { status: false, message: "Rate limited, coba lagi beberapa saat lagi." };
        }
        await sleep(1500 * (attempt + 1));
        continue;
      }

      if (status !== 200) {
        return {
          status: false,
          message: data?.error || `Gagal generate email (HTTP ${status})`,
        };
      }

      const email =
        typeof data?.email === "string" ? data.email.trim().toLowerCase() : "";

      if (!email) {
        return { status: false, message: "Tidak ada alamat email yang dikembalikan." };
      }

      return { status: true, email, providers: query.providers, domain: email.split("@")[1] };
    } catch (e) {
      if (attempt === retries) {
        return {
          status: false,
          message: e.response?.data?.error || e.message || "Gagal menghubungi server",
        };
      }
      await sleep(1200 * (attempt + 1));
    }
  }

  return { status: false, message: "Gagal generate email setelah semua percobaan." };
}

function normalizeMessage(m) {
  const body = typeof m.body === "string" ? m.body : "";

  return {
    id: m.id ?? null,
    date: m.date ?? null,
    subject: m.subject ?? null,
    from: m.from ?? null,
    preview: body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) || null,
    body: body || null,
    bodyContentType: m.bodyContentType ?? null,
    isHtml: m.bodyContentType === "html",
    links: body.match(/https?:\/\/[^"'<>\s]+/g) || [],
    attachments: Array.isArray(m.attachments)
      ? m.attachments.map((a) => ({
          id: a.id ?? null,
          name: a.name ?? null,
          contentType: a.contentType ?? null,
          size: a.size ?? null,
          url:
            a.id != null
              ? `${BASE_URL}/api/attachment?email=${encodeURIComponent(
                  m.to || m.email || ""
                )}&messageId=${encodeURIComponent(m.id)}&attachmentId=${encodeURIComponent(
                  a.id
                )}`
              : null,
        }))
      : [],
  };
}

/**
 * Ambil isi inbox satu kali.
 */
async function checkInbox(email, { wait = false, timeout = 60000 } = {}) {
  const addr = String(email || "").trim().toLowerCase();

  if (!addr || !addr.includes("@")) {
    return { status: false, message: "Alamat email tidak valid." };
  }

  try {
    const { data, status } = await axios.post(
      `${BASE_URL}/api/check`,
      { email: addr, wait: Boolean(wait) },
      {
        headers: baseHeaders({ "Content-Type": "application/json" }),
        timeout,
        validateStatus: (s) => s < 500,
      }
    );

    if (status === 429) {
      return { status: false, message: "Rate limited, coba lagi beberapa saat lagi." };
    }

    if (status !== 200) {
      return { status: false, message: data?.error || `Gagal cek inbox (HTTP ${status})` };
    }

    const items = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];

    return {
      status: true,
      email: addr,
      total: items.length,
      messages: items.map(normalizeMessage),
    };
  } catch (e) {
    return {
      status: false,
      message: e.response?.data?.error || e.message || "Gagal cek inbox",
    };
  }
}

export default {
  name: "temp.tf Temporary Email",
  description:
    "Generate alamat email sementara dan cek isi inbox. Mendukung pool gmail, outlook, hotmail, dan high.edu.pl (alias plus/dot).",
  category: "Email",
  methods: ["GET", "POST"],
  params: ["action", "providers", "email"],
  paramsSchema: {
    action: {
      type: "string",
      required: false,
      default: "create",
      enum: ["create", "inbox"],
      description: "create = generate email baru, inbox = cek isi inbox",
    },
    providers: {
      type: "string",
      required: false,
      default: "high.edu.pl",
      enum: ["gmail", "outlook", "hotmail", "high.edu.pl"],
      description:
        "Provider untuk action=create. Bisa dikombinasikan dengan koma, contoh: gmail,outlook",
    },
    email: {
      type: "string",
      required: false,
      description: "Alamat email lengkap (wajib untuk action=inbox)",
    },
    dot: {
      type: "boolean",
      required: false,
      default: false,
      description: "Gunakan varian titik pada local-part (khusus gmail)",
    },
    plus: {
      type: "boolean",
      required: false,
      default: true,
      description: "Gunakan varian plus pada local-part",
    },
    wait: {
      type: "boolean",
      required: false,
      default: false,
      description: "Tunggu email masuk di sisi server (action=inbox)",
    },
  },

  async run(req, res) {
    const { action, providers, email, dot, plus, wait } = { ...req.query, ...req.body };

    try {
      if (action === "inbox") {
        if (!email || typeof email !== "string" || !email.includes("@")) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'email' wajib diisi untuk action=inbox",
          });
        }

        const result = await checkInbox(email, { wait: isTruthy(wait) });
        if (!result.status) return res.status(502).json(result);

        return res.json(result);
      }

      const result = await generateEmail({
        providers,
        dot: isTruthy(dot),
        plus: plus === undefined ? true : isTruthy(plus),
      });

      if (!result.status) return res.status(502).json(result);

      logger.info(`[temptf] generated ${result.email}`);
      return res.json(result);
    } catch (e) {
      logger.error(`[temptf] ${e.message}`);
      return res.status(500).json({
        status: false,
        message: e.message || "Gagal memproses permintaan",
      });
    }
  },
};
