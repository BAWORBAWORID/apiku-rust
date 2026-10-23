import axios from "axios";

const API_URL = "https://rough-mouse-ae3c.musharaf-h-abid.workers.dev/chat";

const MODELS = [
  "deepseek/deepseek-chat-v3-0324",
  "deepseek/deepseek-chat",
  "deepseek/deepseek-r1",
  "gpt-4o",
  "gpt-4o-mini",
  "claude-3-5-sonnet",
  "claude-3-7-sonnet",
  "gemini-2-0-flash",
  "qwen/qwen-2-5-72b",
];

export default {
  name: "VoidChat",
  description: "AI chat multi-model",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["text", "model"],

  paramsSchema: {
    text: {
      type: "string",
      required: true,
      default: "Halo, apa kabar?",
      description: "Pertanyaan atau perintah untuk AI",
    },
    model: {
      type: "string",
      required: false,
      default: "deepseek/deepseek-chat-v3-0324",
      enum: MODELS,
      description: "Model AI yang digunakan",
    },
  },

  async run(req, res) {
    try {
      const { text, model = "deepseek/deepseek-chat-v3-0324" } = { ...req.query, ...req.body };

      if (!text || !text.trim()) {
        return res.status(400).json({ status: false, message: "Parameter 'text' wajib diisi" });
      }

      const { data } = await axios.post(API_URL, { message: text.trim() }, {
        headers: { "Content-Type": "application/json" },
        timeout: 60000,
      });

      return res.json({
        status: true,
        result: data.answer || "",
        model,
      });
    } catch (err) {
      const msg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      return res.status(500).json({ status: false, message: msg });
    }
  }
}