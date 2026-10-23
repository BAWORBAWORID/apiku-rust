import logger from "../../src/utils/logger.js";

const HF_MODELS = [
  {
    id: "deepseek-ai/DeepSeek-V4-Flash-0731",
    object: "model",
    created: 1785427901,
    owned_by: "deepseek-ai",
    provider: "huggingface",
    endpoint: "https://q5dh1rfszfym23hj.us-east-2.aws.endpoints.huggingface.cloud/v1/chat/completions",
  },
];

export default {
  name: "HF DeepSeek Models",
  description: "Daftar model AI",
  category: "Agent",
  methods: ["GET"],
  params: [],

  paramsSchema: {},

  async run(req, res) {
    try {
      logger.info(`[v1 Models] Request from ${req.ip}`);

      const data = HF_MODELS.map((m) => ({
        id: m.id,
        object: m.object,
        created: m.created,
        owned_by: m.owned_by,
      }));

      res.json({ object: "list", data });
    } catch (err) {
      logger.error(`[v1 Models] Error: ${err.message}`);
      res.status(500).json({ error: { message: err.message || "Proxy error" } });
    }
  },
};