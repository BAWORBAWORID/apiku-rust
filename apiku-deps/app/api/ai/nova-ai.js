/**
 * Nova AI Chat
 *
 * GET  /api/ai/nova-ai?teks=hai&session=opsional
 * POST /api/ai/nova-ai — JSON { "teks": "...", "session": "opsional" }
 *
 * Response shape mengikuti pola AI endpoint sibling (halodoc.js/deepseek-flash.js).
 *
 * Category: AI CHAT
 */

import crypto from "node:crypto";
import { loadSession, saveSession } from "../../src/utils/session.js";
import logger from "../../src/utils/logger.js";

const UPSTREAM_URL =
  "https://us-central1-nova-ai---android.cloudfunctions.net/app/ai-response/v2";
const SESSION_BASE = "nova-ai";

const NOVA_HEADERS = {
  "User-Agent": "okhttp/4.10.0",
  "Accept-Encoding": "gzip",
  platform: "Android",
  version: "1.4.0",
  language: "in",
  "content-type": "application/json; charset=utf-8"
};

function getSessionFile(sessionId) {
  return sessionId && typeof sessionId === "string" && sessionId.trim()
    ? `${SESSION_BASE}-${sessionId.trim()}.json`
    : `${SESSION_BASE}.json`;
}

/**
 * Hit upstream Nova AI endpoint. Returns the raw JSON response.
 *
 * conversation_items sengaja kosong — mengikuti pattern upstream asli.
 * App-level session memory (riwayat chat) disimpan di `src/utils/session.js`
 * untuk konsistensi dengan endpoint AI lain.
 */
async function callNovaAi(text, conversationItems = []) {
  const payload = {
    question_text: text,
    conversation: {
      conversation_items: conversationItems
    }
  };

  const res = await fetch(UPSTREAM_URL, {
    method: "POST",
    headers: NOVA_HEADERS,
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(
      `Upstream returned HTTP ${res.status} ${res.statusText}${
        errBody ? ` — ${errBody.slice(0, 200)}` : ""
      }`
    );
  }

  return await res.json();
}

export default {
  name: "Nova AI",
  description:
    "Nova AI Chat dengan optional session memory (Android client v1.4.0)",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["teks", "session"],

  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Pertanyaan atau perintah untuk Nova AI",
      example: "hai, siapa kamu?",
      minLength: 1,
      maxLength: 2000
    },
    session: {
      type: "string",
      required: false,
      description: "ID sesi kustom untuk percakapan terpisah (opsional)",
      example: "user123"
    }
  },

  async run(req, res) {
    try {
      const { teks, session: sessionId } = { ...req.query, ...req.body };
      const trimmedSessionId =
        sessionId && typeof sessionId === "string" ? sessionId.trim() : "";

      if (!teks || typeof teks !== "string" || teks.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'teks' wajib diisi"
        });
      }

      if (teks.length > 2000) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'teks' melebihi panjang maksimum (2000 karakter)"
        });
      }

      const history = await loadSession(getSessionFile(trimmedSessionId), []);
      const turn = Math.floor(history.length / 2) + 1;
      const requestId = crypto.randomUUID();

      logger.info(
        `[NOVA-AI] Request | ip=${req.ip} | session=${
          trimmedSessionId || "default"
        } | turn=${turn}`
      );

      const result = await callNovaAi(teks.trim(), []);

      // Extract primary AI reply text from upstream payload (simple response)
      const aiText =
        result && typeof result === "object" && typeof result.text === "string"
          ? result.text.trim()
          : null;

      if (!aiText) {
        logger.error(
          `[NOVA-AI] Upstream missing 'text' field | ip=${req.ip} | payload=${JSON.stringify(
            result
          ).slice(0, 300)}`
        );
        return res.status(502).json({
          status: false,
          message: "Upstream response missing 'text' field"
        });
      }

      // Persist session memory (user/assistant pair) for traceability
      history.push({ user: teks.trim(), assistant: aiText });
      await saveSession(getSessionFile(trimmedSessionId), history);

      res.setHeader("X-NovaAI-Endpoint", "us-central1-nova-ai---android.cloudfunctions.net");
      res.setHeader("X-NovaAI-Model", "nova-ai-v1.4.0");
      res.setHeader("X-NovaAI-Turn", turn);

      res.json({
        status: true,
        input: teks.trim(),
        result: aiText,
        request_id: requestId,
        session_id: trimmedSessionId || null,
        turn,
        timestamp: Date.now()
      });
    } catch (err) {
      logger.error(`[NOVA-AI] Error | ip=${req.ip} | ${err.message}`);
      res.status(500).json({
        status: false,
        message: err.message || "Nova AI request failed"
      });
    }
  }
};
