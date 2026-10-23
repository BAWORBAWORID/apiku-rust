/**
 * TutorGPT AI — Chat via tutorgpt.io (SSE)
 * Upstream : tutorgpt.io/api/v1/chat/stream
 * Feature  : multi-turn chat via session, pilihan model
 */
import axios from "axios";
import { randomUUID } from "node:crypto";
import { loadSession, saveSession } from "../../src/utils/session.js";

const API_BASE = "https://tutorgpt.io";
const CHAT_ENDPOINT = "/api/v1/chat/stream";
const DEFAULT_MODEL = "gpt-5.6-luna";

function getSessionFile(sessionId) {
  return `tutorgpt_${(sessionId || "default").replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
}

async function tutorgptChat(message, options = {}) {
  const conversationId = options.conversationId || randomUUID();
  const payload = {
    message,
    language: options.language || "auto",
    model: options.model || DEFAULT_MODEL,
    tone: options.tone || "default",
    length: options.length || "moderate",
    conversation_id: conversationId,
    image_urls: [],
    chat_mode: "standard",
  };

  const response = await axios.post(API_BASE + CHAT_ENDPOINT, payload, {
    responseType: "stream",
    timeout: 180000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
      "Accept": "application/json, text/event-stream",
      "Content-Type": "application/json",
      Origin: API_BASE,
      Referer: API_BASE + "/",
    },
  });

  if (response.status >= 400) {
    throw new Error(`HTTP ${response.status}`);
  }

  return new Promise((resolve, reject) => {
    let answer = "";
    let buffer = "";
    let settled = false;

    response.data.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const block of parts) {
        const line = block.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const dataStr = line.slice(5).trim();
        if (!dataStr) continue;
        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.text) answer += parsed.text;
          if (!settled && parsed.done) {
            settled = true;
            resolve({ success: true, conversationId, answer });
          }
        } catch {}
      }
    });

    response.data.on("end", () => {
      if (!settled) resolve({ success: true, conversationId, answer });
    });
    response.data.on("error", reject);
  });
}

export default {
  name: "TutorGPT AI",
  description: "AI chat gratis — multi-turn sesuai session, banyak pilihan model, opsi tone & length",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["text", "session", "model", "tone", "length"],
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Pertanyaan / prompt chat",
      example: "jelaskan hukum newton",
    },
    session: {
      type: "string",
      required: false,
      default: "default",
      description: "ID sesi untuk multi-turn chat (conversation_id upstream disimpan)",
    },
    model: {
      type: "string",
      required: false,
      default: DEFAULT_MODEL,
      description: "Nama model (default: gpt-5.6-luna)",
    },
    tone: {
      type: "string",
      required: false,
      default: "default",
      description: "Tone respons (default: default)",
    },
    length: {
      type: "string",
      required: false,
      default: "moderate",
      description: "Panjang jawaban: short / moderate / long",
    },
  },

  async run(req, res) {
    try {
      const { text, session, model, tone, length } = { ...req.query, ...req.body };
      const prompt = (text || "").trim();
      if (!prompt) {
        return res.status(400).json({ status: false, message: "Parameter 'text' wajib diisi" });
      }
      const sessionId = (session && typeof session === "string" && session.trim()) || "default";
      const sessionFile = getSessionFile(sessionId);

      const stored = (await loadSession(sessionFile, {})) || {};
      const conversationId = stored.conversationId || randomUUID();

      const result = await tutorgptChat(prompt, {
        conversationId,
        model: model || DEFAULT_MODEL,
        tone: tone || "default",
        length: length || "moderate",
      });

      await saveSession(sessionFile, {
        conversationId: result.conversationId,
        updatedAt: Date.now(),
      });

      return res.json({
        status: true,
        result: {
          reply: result.answer,
          conversationId: result.conversationId,
          model: model || DEFAULT_MODEL,
          session: sessionId,
        },
      });
    } catch (err) {
      const status = err.response?.status || 500;
      return res.status(status).json({
        status: false,
        message: err.message || "TutorGPT request failed",
      });
    }
  },
};