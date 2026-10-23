import axios from "axios";
import crypto from "node:crypto";
import logger from "../../src/utils/logger.js";

const BASE = "https://app.helvast.com";
const API = `${BASE}/api/chat`;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Content-Type": "application/json",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
  Origin: BASE,
  Referer: `${BASE}/`,
};

async function helvastChat(message, opts = {}) {
  if (!message) throw new Error("message wajib diisi");

  const sessionId = opts.sessionId || crypto.randomUUID();

  const payload = {
    message,
    userId: opts.userId ?? 1,
    workspaceId: opts.workspaceId ?? 2,
    sessionId,
    history: [{ role: "user", text: message }],
    browserLanguage: opts.browserLanguage || "id",
  };

  const { data } = await axios.post(API, payload, {
    headers: HEADERS,
    timeout: 60000,
  });

  if (!data || typeof data.reply !== "string") {
    throw new Error("Response tidak valid");
  }

  return {
    sessionId: data.sessionId || sessionId,
    message,
    reply: data.reply,
    has_answer: data.has_answer ?? null,
    confidence: data.confidence ?? null,
    semantic_search_used: data.semantic_search_used ?? null,
  };
}

export default {
  name: "Islami AI",
  description: "Tanya jawab Islam berbasis RAG dengan rujukan sumber (muslim.or.id, dll)",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["teks", "session"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Pertanyaan seputar Islam",
      example: "Assalamualaikum, sebutkan 3 rukun iman",
    },
    session: {
      type: "string",
      required: false,
      description: "ID sesi untuk melanjutkan percakapan (opsional)",
    },
  },

  async run(req, res) {
    const { teks, session: sessionId } = { ...req.query, ...req.body };
    const message = typeof teks === "string" ? teks.trim() : "";

    if (!message) {
      return res.status(400).json({ status: false, message: "Parameter 'teks' wajib diisi" });
    }

    try {
      logger.info(`[Islami AI] Request | session=${sessionId || "new"}`);
      const result = await helvastChat(message, {
        sessionId: typeof sessionId === "string" ? sessionId.trim() : undefined,
      });
      logger.info(`[Islami AI] Success | answer=${result.has_answer} | confidence=${result.confidence}`);
      return res.json({ status: true, result });
    } catch (error) {
      logger.error(`[Islami AI] Error: ${error.message}`);
      return res.status(500).json({ status: false, message: error.message || "Gagal menghubungi Islami AI" });
    }
  },
};
