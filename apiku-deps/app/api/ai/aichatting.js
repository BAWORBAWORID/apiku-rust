import crypto from "node:crypto";

/**
 * AI Chatting - Chat with ChatGPT (gpt-5.6-luna) via aichatting.net
 * POST/GET /api/ai/aichatting?text=Pesanmu&model=gpt-5.6-luna
 */

const API_BASE = "https://aga-api.aichatting.net";
const SITE = "https://www.aichatting.net";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const PUBLIC_KEY = "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDCAdf/EyIbLBxjGqmh7qLU6/CPCzru+75+82OSPZ+nf4BFvg88drpZ6KigNW0J8TNgxe6Yms1irCZNVDyu+RXsl4y/7c2KOHc4OGTzHB5fUMiMasFUvcEs2P70e6yA/sKHZfBLG1XPhlb84Ibs3nhD3W5e2SuC+4EuVkaqzN08LQIDAQAB";
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----\n${PUBLIC_KEY}\n-----END PUBLIC KEY-----`;

const MODELS = ["gpt-5.6-luna"];
const DEFAULT_MODEL = "gpt-5.6-luna";

const newVisitor = () => {
  const id = "e" + Array.from({ length: 15 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  const vToken = crypto.publicEncrypt(
    { key: PUBLIC_KEY_PEM, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(id, "utf8")
  ).toString("base64");
  return { id, vToken };
};

const clean = (raw) =>
  raw
    .replace(/(\n|-=- --)/g, " ")
    .replace(/(\n|-=-n--)/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

async function createConversation(vToken) {
  const res = await fetch(`${API_BASE}/aigc/chat/record/conversation/create`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/json",
      Accept: "text/event-stream,application/json",
      source: "web",
      lang: "en",
      vToken,
    },
    body: JSON.stringify({ roleId: 0 }),
  });
  const data = await res.json();
  if (!res.ok || data.code !== 0) {
    throw new Error(`Gagal membuat sesi: ${data.message || res.status}`);
  }
  return data.data.conversationId;
}

async function streamChat({ vToken, model, messages }) {
  const conversationId = await createConversation(vToken);
  const body = JSON.stringify({
    spaceHandle: true,
    roleId: 0,
    conversationId,
    model,
    messages,
  });

  const res = await fetch(`${API_BASE}/aigc/chat/v2/askai/stream`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/json",
      Accept: "text/event-stream,application/json",
      source: "web",
      lang: "en",
      vToken,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stream error ${res.status}: ${text.slice(0, 120)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", reply = "", done = false;

  while (!done) {
    const { done: streamEnd, value } = await reader.read();
    if (streamEnd) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const rawEvent = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = rawEvent.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const data = dataLine.slice(5).trim().replace(/\r$/, "");
      if (data === "--@DONE@--") { done = true; break; }
      reply += data;
    }
  }

  const cleaned = clean(reply);
  return { conversationId, reply: cleaned };
}

export default {
  name: "AIChatting",
  description: "Chat AI gratis (model ChatGPT gpt-5.6). Mendukung percakapan multi-turn dengan parameter session.",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["text", "model", "session"],

  paramsSchema: {
    text: { type: "string", required: true, description: "Pesan/pertanyaan untuk AI", example: "Halo, siapa kamu?", minLength: 1, maxLength: 2000 },
    model: { type: "string", required: false, description: "Model yang dipakai", default: "gpt-5.6-luna", enum: MODELS },
    session: { type: "string", required: false, description: "ID sesi (conversationId) untuk percakapan multi-turn. Kosongkan untuk memulai sesi baru", default: "" }
  },

  async run(req, res) {
    const { text = "", model = DEFAULT_MODEL, session = "" } = { ...req.query, ...req.body };

    if (!text) {
      return res.status(400).json({ status: false, message: "Parameter 'text' wajib diisi", code: "MISSING_TEXT" });
    }
    if (!MODELS.includes(model)) {
      return res.status(400).json({ status: false, message: `Model tidak valid. Pilihan: ${MODELS.join(", ")}`, code: "INVALID_MODEL" });
    }

    const { vToken } = newVisitor();
    const messages = [
      { role: "user", content: [{ type: "text", text }] }
    ];

    try {
      const { conversationId, reply } = await streamChat({ vToken, model, messages });

      return res.json({
        status: true,
        result: reply,
        model,
        session: String(conversationId)
      });
    } catch (err) {
      if (err.message.includes("Stream error")) {
        return res.status(502).json({ status: false, message: err.message, code: "UPSTREAM_ERROR" });
      }
      return res.status(500).json({ status: false, message: err.message, code: "INTERNAL_ERROR" });
    }
  }
};
