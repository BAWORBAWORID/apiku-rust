import https from "https";

const API_HOST = "api.tempamail.com";
const FALLBACK_UUID = "1ccbf8ff-1ad7-426f-b00e-bc4db79dd558";
const TIMEOUT_MS = 10000;

// Cache UUID — fetch sekali, reuse selamanya
let cachedUUID = null;

function httpsPost(hostname, path, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        port: 443,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(postData),
          "User-Agent": "Mozilla/5.0",
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      }
    );
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

function fetchUUID() {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "tempamail.com",
        path: "/",
        method: "GET",
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          const match = data.match(/uuid["']?\s*[:=]\s*["']([a-f0-9-]+)["']/i);
          resolve(match ? match[1] : FALLBACK_UUID);
        });
      }
    );
    req.on("timeout", () => { req.destroy(); resolve(FALLBACK_UUID); });
    req.on("error", () => resolve(FALLBACK_UUID));
    req.end();
  });
}

async function getUUID() {
  if (!cachedUUID) cachedUUID = await fetchUUID();
  return cachedUUID;
}

function buildForm(obj) {
  return new URLSearchParams(obj).toString();
}

async function createEmail(alias, uuid) {
  const postData = buildForm({ uuid, alias, domain_id: 2 });
  const raw = await httpsPost(API_HOST, "/webapp/email/custom", postData);
  const json = JSON.parse(raw);
  return {
    email_id: json.email.id,
    email: json.email.address,
    alias: json.email.alias,
    domain: json.email.domain_name,
  };
}

async function checkInbox(emailId, uuid) {
  const postData = buildForm({ uuid, selected_email_id: emailId, known_message_id: 0 });
  const raw = await httpsPost(API_HOST, "/webapp/messages", postData);
  const json = JSON.parse(raw);

  const messages = (json.messages || [])
    .filter((msg) => msg.email_id === parseInt(emailId))
    .map((msg) => {
      let from;
      try { from = JSON.parse(msg.from); } catch { from = { name: msg.from, address: msg.from }; }

      const body = (msg.body || "")
        .replace(/<div[^>]*>/g, "\n")
        .replace(/<\/div>/g, "")
        .replace(/<br\s*\/?>/g, "\n")
        .replace(/<[^>]*>/g, "")
        .trim();

      return { id: msg.id, from, subject: msg.subject, body, created_at: msg.created_at };
    });

  return { email_id: parseInt(emailId), total: messages.length, messages };
}

export default {
  name: "TempMail - TempAMail.com",
  description: "Temporary email — buat email & cek inbox",
  category: "Email",
  methods: ["GET", "POST"],
  params: ["action", "alias", "email_id"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      enum: ["create", "inbox"],
      description: "Aksi: create (buat email baru) atau inbox (cek inbox)",
    },
    alias: {
      type: "string",
      required: false,
      description: "Alias email custom (hanya untuk action=create, opsional — random jika kosong)",
      example: "cobacoba123",
    },
    email_id: {
      type: "string",
      required: false,
      description: "ID email dari hasil create (wajib untuk action=inbox)",
      example: "12345678",
    },
  },

  async run(req, res) {
    const { action, alias, email_id } = { ...req.query, ...req.body };

    if (!action || !["create", "inbox"].includes(action)) {
      return res.status(400).json({ status: false, message: "Parameter 'action' harus 'create' atau 'inbox'" });
    }

    if (action === "inbox" && !email_id) {
      return res.status(400).json({ status: false, message: "Parameter 'email_id' wajib diisi untuk action=inbox" });
    }

    try {
      const uuid = await getUUID();

      if (action === "create") {
        const finalAlias = alias?.trim() || Math.random().toString(36).substring(2, 12);
        const result = await createEmail(finalAlias, uuid);
        return res.json({ status: true, ...result });
      }

      if (action === "inbox") {
        const result = await checkInbox(email_id.trim(), uuid);
        return res.json({ status: true, ...result });
      }
    } catch (err) {
      res.status(500).json({ status: false, message: err.message || "TempMail v6 request failed" });
    }
  },
};
