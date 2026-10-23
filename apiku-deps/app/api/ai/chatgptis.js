import axios from 'axios'
import logger from "../../src/utils/logger.js"

const AVAILABLE_MODELS = [
  'gpt', 'claude', 'gemini', 'grok',
  'deepseek', 'qwen', 'kimi', 'perplexity'
]

const MODEL_LABELS = {
  gpt: 'GPT',
  claude: 'Claude',
  gemini: 'Gemini',
  grok: 'Grok',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  kimi: 'Kimi',
  perplexity: 'Perplexity'
}

const BASE_URL = 'https://chatgptis.org'

export default {
  name: "ChatGPTis AI Chat",
  description: "ChatGPTis multi-model AI chat (GPT, Claude, Gemini, Grok, DeepSeek, Qwen, Kimi, Perplexity) - free unlimited",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["message", "model", "conversation_id"],
  paramsSchema: {
    message: { type: "string", required: true, description: "Pertanyaan/pesan untuk AI" },
    model: { type: "string", required: false, default: "gpt", enum: ["gpt", "claude", "gemini", "grok", "deepseek", "qwen", "kimi", "perplexity"], description: "Model AI yang digunakan" },
    conversation_id: { type: "string", required: false, description: "ID percakapan untuk multi-turn (opsional)" }
  },

  async run(req, res) {
    try {
      const { message, model = "gpt", conversation_id } = { ...req.query, ...req.body }

      if (!AVAILABLE_MODELS.includes(model)) {
        return res.status(400).json({ status: false, message: `Model tidak tersedia. Pilihan: ${AVAILABLE_MODELS.join(', ')}` })
      }

      if (!message) return res.status(400).json({ status: false, message: "Parameter 'message' wajib" })

      const response = await axios.post(`${BASE_URL}/api/chat`, {
        messages: [{ role: "user", content: message }],
        model
      }, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Zyvor/1.0',
          'Referer': `${BASE_URL}/chat`,
          'Origin': BASE_URL
        },
        timeout: 60000
      })

      const text = response.data || ''
      return res.json({
        status: true,
        result: {
          text: text.trim(),
          model: MODEL_LABELS[model] || model,
          conversation_id: conversation_id || `conv-${Date.now()}`
        }
      })

    } catch (err) {
      logger.error(`[CHATGPTIS] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || "ChatGPTis request failed" })
    }
  }
}