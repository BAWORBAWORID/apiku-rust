/**
 * AskMe AI — Chat + Image Vision
 * Upstream : askme.matlubapps.com/ask-me (text + vision, model gpt_4__1_nano)
 * Source   : scraper by febry.is-a.dev
 * Feature  : multi-turn chat via session, image analysis (URL/base64/data:)
 */
import axios from "axios";
import fs from "fs";
import { loadSession, saveSession } from "../../src/utils/session.js";

const ASKME_URL = "https://askme.matlubapps.com/ask-me";
const ASKME_KEY = "ak8asda9$5kpq";
const ASKME_MODEL = "gpt_4__1_nano";

function getSessionFile(sessionId) {
  return `askme_${(sessionId || "default").replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
}

async function resolveMedia(input) {
  if (!input) return "";
  if (Buffer.isBuffer(input)) return input.toString("base64");
  if (typeof input === "string") {
    if (input.startsWith("http://") || input.startsWith("https://")) {
      const { data } = await axios.get(input, { responseType: "arraybuffer", timeout: 30000 });
      return Buffer.from(data).toString("base64");
    }
    if (input.startsWith("data:")) return input.split(",")[1];
    if (fs.existsSync(input)) return fs.readFileSync(input).toString("base64");
    return input;
  }
  return "";
}

async function askmeChat(history) {
  const { data } = await axios.post(ASKME_URL, {
    history,
    isPremium: false,
    modelname: ASKME_MODEL,
  }, {
    headers: { "Content-Type": "application/json", key: ASKME_KEY },
    timeout: 60000,
  });
  const reply = data.msg || data.text;
  if (!reply) throw new Error("Empty response from AskMe server");
  return reply;
}

export default {
  name: "AskMe AI",
  description: "AI chat + image vision — multi-turn chat (session), analisis gambar (URL/base64)",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["text", "image", "session", "system"],
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Pertanyaan / prompt chat",
      example: "apa itu kecerdasan buatan?",
    },
    image: {
      type: "string",
      required: false,
      default: "",
      description: "URL / base64 / data: URI gambar untuk dianalisis (opsional)",
    },
    session: {
      type: "string",
      required: false,
      default: "default",
      description: "ID sesi untuk multi-turn chat (history disimpan 24 jam)",
    },
    system: {
      type: "string",
      required: false,
      default: "",
      description: "System prompt untuk mengatur perilaku AI (opsional)",
    },
  },

  async run(req, res) {
    try {
      const { text, image, session, system } = { ...req.query, ...req.body };
      const prompt = (text || "").trim();
      if (!prompt && !image) {
        return res.status(400).json({ status: false, message: "Parameter 'text' wajib diisi" });
      }
      const sessionId = (session && typeof session === "string" && session.trim()) || "default";
      const sessionFile = getSessionFile(sessionId);

      const history = await loadSession(sessionFile, []);
      if (!Array.isArray(history)) {
        await saveSession(sessionFile, []);
        history = [];
      }

      const systemPrompt = (system && typeof system === "string" && system.trim()) || null;

      const userMsg = { role: "user", content: prompt || "deskripsikan gambar ini" };
      if (image) {
        userMsg.data = await resolveMedia(image);
      }
      history.push(userMsg);

      // AskMe needs the full history; image data must ride on the last user msg only
      const baseHistory = systemPrompt
        ? [{ role: "system", content: systemPrompt, data: "" }, ...history]
        : history;
      const payloadHistory = baseHistory.slice(-12).map((h, i, arr) => {
        const clean = { role: h.role, content: h.content, data: "" };
        if (i === arr.length - 1 && h.data) clean.data = h.data;
        return clean;
      });

      const reply = await askmeChat(payloadHistory);

      history.push({ role: "assistant", content: reply, data: "" });
      if (history.length > 40) history.splice(0, history.length - 40);
      await saveSession(sessionFile, history);

      return res.json({ status: true, result: { reply, source: "askme", session: sessionId } });
    } catch (err) {
      const status = err.response?.status || 500;
      const detail = err.response?.data;
      return res.status(500).json({
        status: false,
        message: err.message || "AskMe request failed",
        ...(detail ? { detail } : {}),
      });
    }
  },
};
