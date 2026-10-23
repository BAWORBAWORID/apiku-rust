/**
 * instanttempemail.com — temp mail CLI (ESM)
 *
 *   node tes.js create
 *   node tes.js inbox <token>
 *   node tes.js watch <token> [--wait 120]
 *   node tes.js demo [--wait 90]
 *   node tes.js read <token> <messageId>
 *   node tes.js delete <token>
 *   node tes.js --json
 *
 * Kontrak API (di-reverse-engineer dari /_next/static/chunks/11af3023173507bf.js):
 *   POST /api/create                 -> { address, expires, token }
 *   GET  /api/inbox/{token}          -> { address, emails: [], expires }
 *   POST /api/inbox/{token}/read/{id}-> tandai sudah dibaca
 *   POST /api/delete/{token}         -> hapus mailbox
 *
 * Catatan:
 *   - TIDAK ada captcha / API key. Semua endpoint publik.
 *   - Inbox di-key oleh `token` (UUID), BUKAN `address`.
 *   - `?name=` / `?prefix=` / `?domain=` diabaikan server (alamat di-random),
 *     jadi generate kustom tidak didukung oleh API ini.
 */

const BASE = "https://instanttempemail.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const TIMEOUT = 30_000;
const DEBUG = process.argv.includes("--debug");
const log = (...a) => DEBUG && console.log("  [dbg]", ...a);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, { method = "GET" } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "User-Agent": UA, Accept: "application/json", Referer: `${BASE}/` },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const m = text.match(/<h1>([^<]+)<\/h1>/);
    data = { error: m ? m[1].trim() : text.slice(0, 200) };
  }
  if (!res.ok) {
    const e = new Error(data.error || data.message || `HTTP ${res.status}`);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

// ─── Buat mailbox baru ───────────────────────────────────────
export async function createMailbox() {
  const box = await call("/api/create", { method: "POST" });
  if (!box.address || !box.token) throw new Error("Respons /api/create tidak lengkap");
  log("made:", box.address);
  return box;
}

// ─── Baca inbox ──────────────────────────────────────────────
export async function getInbox(token) {
  return call(`/api/inbox/${encodeURIComponent(token)}`);
}

export async function markRead(token, messageId) {
  return call(`/api/inbox/${encodeURIComponent(token)}/read/${encodeURIComponent(messageId)}`, {
    method: "POST",
  });
}

export async function deleteMailbox(token) {
  return call(`/api/delete/${encodeURIComponent(token)}`, { method: "POST" });
}

/** Tunggu sampai ada pesan (atau timeout). Kembalikan respons inbox terakhir. */
export async function watchInbox(token, seconds = 120, intervalMs = 5000) {
  const deadline = Date.now() + seconds * 1000;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await getInbox(token);
      const n = (last.emails || []).length;
      log(`poll: ${n} email`);
      if (n > 0) return last;
    } catch (e) {
      if (e.status === 404) throw new Error("Mailbox sudah expired");
      log("poll error:", e.message);
    }
    await sleep(intervalMs);
  }
  return last;
}

/** Ringkas isi email supaya enak dibaca di terminal. */
function summarize(mails) {
  return (mails || []).map((m) => ({
    id: m.id,
    from: m.from ?? m.sender,
    subject: m.subject,
    date: m.date ?? m.receivedAt ?? m.createdAt,
    preview: (m.text || m.body || m.html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300),
    attachments: (m.attachments || []).length || undefined,
  }));
}

export default {
  name: "InstantTempEmail",
  description: "Temp mail instan instanttempemail.com — buat mailbox, cek inbox, hapus mailbox",
  category: "Email",
  methods: ["GET", "POST"],
  params: ["action", "token", "messageId", "wait"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      description: "Aksi: create | inbox | watch | demo | read | delete",
      default: "create",
      example: "create",
      enum: ["create", "inbox", "watch", "demo", "read", "delete"],
    },
    token: {
      type: "string",
      required: false,
      description: "Token mailbox dari aksi create (bukan alamat email)",
      example: "5939be1e-f8f8-4eae-b17b-3dc42fed1189",
    },
    messageId: {
      type: "string",
      required: false,
      description: "ID email, dipakai bersama action=read",
      example: "abc123def456",
    },
    wait: {
      type: "string",
      required: false,
      description: "Berapa detik menunggu email masuk (action=watch|dem)",
      default: "120",
      example: "120",
    },
  },
  async run(req, res) {
    const startTime = Date.now();
    const { action = "create", token, messageId, wait } = { ...req.query, ...req.body };

    try {
      const ACTIONS = ["create", "inbox", "watch", "demo", "read", "delete"];
      if (!ACTIONS.includes(action)) {
        return res.status(400).json({
          status: false,
          message: `Parameter 'action' harus salah satu dari: ${ACTIONS.join(", ")}`,
          code: "INVALID_ACTION",
        });
      }

      if (["inbox", "watch", "read", "delete"].includes(action) && !token) {
        return res.status(400).json({
          status: false,
          message: `Parameter 'token' wajib diisi untuk action '${action}'. Token didapat dari action=create.`,
          code: "MISSING_TOKEN",
        });
      }

      if (action === "read" && !messageId) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'messageId' wajib diisi untuk action 'read'",
          code: "MISSING_MESSAGE_ID",
        });
      }

      let result;
      if (action === "create") result = await createMailbox();
      else if (action === "inbox") result = await getInbox(token);
      else if (action === "watch") result = await watchInbox(token, Number(wait) || 120);
      else if (action === "read") result = await markRead(token, messageId);
      else if (action === "delete") result = await deleteMailbox(token);
      else if (action === "demo") {
        const box = await createMailbox();
        result = { ...box, inbox: await watchInbox(box.token, Number(wait) || 120) };
      }

      return res.json({
        status: true,
        action,
        result,
        responseTime: `${Date.now() - startTime}ms`,
      });
    } catch (err) {
      const code = err.status === 404 ? "MAILBOX_EXPIRED" : "UPSTREAM_ERROR";
      return res.status(err.status === 404 ? 404 : 502).json({
        status: false,
        action,
        message: err.message,
        code,
        responseTime: `${Date.now() - startTime}ms`,
      });
    }
  },
};
