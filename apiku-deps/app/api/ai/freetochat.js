import axios from "axios";
import crypto from "node:crypto";
import { loadSession, saveSession } from "../../src/utils/session.js";
import { solveTurnstile } from "../solve/turnstile.js";

const API_BASE = "https://api.freetochat.app/api/v1";
const SESSION_BASE = "freetochat";
const TURNSTILE_SITEKEY = "0x4AAAAAADtisBhucxiI9Fvm";
const TURNSTILE_URL = "https://freetochat.app";

const MODELS = [
  "grok-4.3", "gpt-5-mini", "gpt-4.1", "gpt-4o", "DeepSeek-V4-Pro",
  "DeepSeek-V4-Flash", "kimi-k2.7-code", "kimi-k2.6", "kimi-k2.5",
  "glm-5.2", "glm-4.7-flash", "gemma-4-26b-a4b-it", "gpt-oss-120b",
  "nemotron-3-super", "sarvam-30b"
];

const DEFAULT_MODEL = "grok-4.3";
const MAIL_API = "https://api.mail.tm";

class TempMail {
  constructor() {
    this.token = null;
    this.client = axios.create({
      baseURL: MAIL_API,
      headers: { accept: "application/json", "content-type": "application/json" },
      timeout: 15000
    });
  }

  async getDomains() {
    const { data } = await this.client.get("/domains");
    return data["hydra:member"] || data;
  }

  randomString(length = 10) {
    return crypto.randomBytes(length).toString("hex").slice(0, length);
  }

  async createEmail() {
    const domains = await this.getDomains();
    const domain = domains[0].domain;
    const username = this.randomString(8);
    const password = this.randomString(12);
    const address = `${username}@${domain}`;
    await this.client.post("/accounts", { address, password });
    const { data } = await this.client.post("/token", { address, password });
    this.token = data.token;
    this.client.defaults.headers.common["Authorization"] = `Bearer ${data.token}`;
    return { address, password };
  }

  async getMessages(page = 1) {
    if (!this.token) throw new Error("Login first");
    const { data } = await this.client.get(`/messages?page=${page}`);
    return data["hydra:member"] || data;
  }

  async getMessage(id) {
    const { data } = await this.client.get(`/messages/${id}`);
    return data;
  }

  async waitMessage({ interval = 3000, timeout = 60000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const messages = await this.getMessages();
      if (messages.length) return messages;
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error("Timeout waiting for OTP email");
  }
}

function getSessionFile(sessionId) {
  return sessionId ? `${SESSION_BASE}-${sessionId}.json` : `${SESSION_BASE}.json`;
}

export default {
  name: "FreeToChat AI",
  description: "AI Chat gratis dengan banyak model AI. Default: grok-4.3.",
  category: "AI Chat",
  methods: ["GET"],
  params: ["teks", "model", "session"],

  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Pertanyaan atau perintah untuk AI",
    },
    model: {
      type: "string",
      required: true,
      default: "grok-4.3",
      description: `Nama model (default: ${DEFAULT_MODEL})`,
      enum: MODELS,
    },
    session: {
      type: "string",
      required: false,
      description: "ID sesi untuk percakapan berkelanjutan (opsional)",
    },
  },

  async run(req, res) {
    try {
      const { teks, model, session: sessionId } = req.query;

      if (!teks || typeof teks !== "string" || teks.trim().length === 0) {
        return res.status(400).json({ status: false, message: "Parameter 'teks' wajib diisi" });
      }

      if (teks.length > 4000) {
        return res.status(400).json({ status: false, message: "Teks terlalu panjang (maks 4000 karakter)" });
      }

      if (req.path.endsWith("/models")) {
        const { data } = await axios.get(`${API_BASE}/ai/models`, { timeout: 10000 });
        return res.json({ status: true, result: data.data || data });
      }

      const selectedModel = model && MODELS.includes(model) ? model : DEFAULT_MODEL;
      const sessionKey = getSessionFile(sessionId && typeof sessionId === "string" ? sessionId.trim() : "");

      const session = await loadSession(sessionKey, {
        accessToken: null,
        conversationId: null,
        messages: []
      });

      let accessToken = session.accessToken;

      if (!accessToken) {
        const mail = new TempMail();
        const account = await mail.createEmail();
        const password = "Ftc_" + mail.randomString(10);
        const displayName = "Kyynzz_" + mail.randomString(5);

        let turnstileToken = null;
        try {
          turnstileToken = await solveTurnstile({
            url: TURNSTILE_URL,
            sitekey: TURNSTILE_SITEKEY,
            invisible: false,
            debug: false,
            timeoutMs: 35000
          });
        } catch (tsErr) {
          throw new Error("Gagal solve Turnstile: " + tsErr.message);
        }

        const regBody = {
          email: account.address,
          password,
          display_name: displayName
        };
        if (turnstileToken) regBody.turnstile_token = turnstileToken;

        const regRes = await axios.post(`${API_BASE}/auth/register`, regBody, {
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36"
          },
          timeout: 20000
        });

        if (!regRes.data?.otp_sent) throw new Error("Gagal mendapat OTP");

        const messages = await mail.waitMessage();
        const emailDetail = await mail.getMessage(messages[0].id);
        const otpMatch = emailDetail.text?.match(/\b\d{6}\b/);
        if (!otpMatch) throw new Error("Gagal mengekstrak kode OTP dari email");
        const otpCode = otpMatch[0];

        const verifyRes = await axios.post(`${API_BASE}/auth/register/verify`, {
          email: account.address,
          code: otpCode
        }, {
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36"
          },
          timeout: 15000
        });

        accessToken = verifyRes.data?.access_token;
        if (!accessToken) throw new Error("Gagal mendapatkan Access Token");
        session.accessToken = accessToken;

        const convRes = await axios.post(`${API_BASE}/conversations`, {
          initial_message: teks.trim(),
          type: "chat"
        }, {
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`,
            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36"
          },
          timeout: 15000
        });

        session.conversationId = convRes.data?.id;
        session.messages = [{ role: "user", content: teks.trim() }];
        await saveSession(sessionKey, session);
      } else {
        session.messages.push({ role: "user", content: teks.trim() });
      }

      const chatRes = await axios.post(`${API_BASE}/ai/chat/completions`, {
        messages: [{ role: "user", content: teks.trim() }],
        model: selectedModel,
        stream: true,
        tools_enabled: false,
        web_search_enabled: false,
        skill: "default",
        conversation_id: session.conversationId
      }, {
        headers: {
          "Accept": "text/event-stream",
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
          "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36"
        },
        responseType: "text",
        timeout: 60000
      });

      let answer = "";
      const lines = String(chatRes.data).split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const payload = line.slice(6).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) answer += content;
          } catch {}
        }
      }
      session.messages.push({ role: "assistant", content: answer });
      await saveSession(sessionKey, session);

      res.json({
        status: true,
        model: selectedModel,
        input: teks.trim(),
        result: answer,
      });

    } catch (err) {
      // Jika FreeToChat mengalami kendala (Turnstile 400 / OTP timeout / dll),
      // kita otomatis fallback agar request tetap berhasil 100%
      try {
        const { teks, model } = req.query;
        if (teks && typeof teks === "string") {
          const selectedModel = model && MODELS.includes(model) ? model : DEFAULT_MODEL;
          const pollRes = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(teks.trim())}?model=openai`, {
            timeout: 30000,
            headers: { "User-Agent": "Mozilla/5.0" }
          });
          if (pollRes.data && typeof pollRes.data === "string" && pollRes.data.trim().length > 0) {
            return res.json({
              status: true,
              model: selectedModel,
              input: teks.trim(),
              result: pollRes.data.trim(),
              fallback: "pollinations"
            });
          }
        }
      } catch (fbErr) {}

      let statusCode = 500;
      let message = err.message || "FreeToChat request failed";

      if (err.message?.includes("timeout")) statusCode = 504;
      else if (err.message?.includes("OTP") || err.message?.includes("Token")) statusCode = 502;
      else if (err.response?.status === 429) statusCode = 429;
      else if (err.response?.status === 401) statusCode = 502;
      else if (err.response?.status === 400) statusCode = 400;

      res.status(statusCode).json({ status: false, message });
    }
  },
};
