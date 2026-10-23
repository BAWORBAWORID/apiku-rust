import logger from "../../../src/utils/logger.js";

const HF_ENDPOINT = "https://q5dh1rfszfym23hj.us-east-2.aws.endpoints.huggingface.cloud/v1/chat/completions";
const HF_MODEL = "deepseek-ai/DeepSeek-V4-Flash-0731";

export default {
  name: "HF DeepSeek Chat Completions",
  description: "Proxy chat completions ke HuggingFace DeepSeek-V4-Flash-0731 — OpenAI-compatible",
  category: "Agent",
  methods: ["POST"],
  params: ["model", "messages"],

  paramsSchema: {
    model: {
      type: "string",
      required: false,
      default: "deepseek-ai/DeepSeek-V4-Flash-0731",
      description: "Model HF endpoint (default: deepseek-ai/DeepSeek-V4-Flash-0731)",
      example: "deepseek-ai/DeepSeek-V4-Flash-0731",
    },
    messages: {
      type: "array",
      required: true,
      description: "Array pesan OpenAI format [{ role, content }]",
      example: [{ role: "user", content: "Halo!" }],
    },
  },

  async run(req, res) {
    try {
      const body = req.body || {};
      const model = body.model || HF_MODEL;
      const messages = body.messages;

      logger.info(`[v1 Chat] Request from ${req.ip} | model=${model}`);

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: { message: "Parameter 'messages' wajib diisi (array tidak kosong)" } });
      }

      const resp = await fetch(HF_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer not-needed",
        },
        body: JSON.stringify({ model, messages }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        logger.info(`[v1 Chat] Upstream response ${resp.status}`);
        return res.status(resp.status).json(data);
      }

      logger.info(`[v1 Chat] Success model=${model}`);

      res.json(data);
    } catch (err) {
      logger.error(`[v1 Chat] Error: ${err.message}`);
      res.status(500).json({ error: { message: err.message || "Proxy error" } });
    }
  },
};