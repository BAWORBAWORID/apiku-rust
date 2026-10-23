import logger from "../../src/utils/logger.js";

const ROUTER_MODELS_URL = "https://router.zyvor.my.id/v1/models";

export default {
  name: "Router Models V2",
  description: "Daftar model AI dari router.zyvor.my.id (OpenRouter-compatible)",
  category: "Agent",
  methods: ["GET"],
  params: [],
  paramsSchema: {},
  async run(req, res) {
    try {
      logger.info(`[v2 Models] Request from ${req.ip}`);

      const resRouter = await fetch(ROUTER_MODELS_URL, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!resRouter.ok) {
        throw new Error(`Router HTTP ${resRouter.status}`);
      }

      const routerData = await resRouter.json();

      if (!routerData.data || !Array.isArray(routerData.data)) {
        throw new Error("Invalid router response format");
      }

      function extractProvider(modelId) {
        const customPrefixes = ["zen/", "antigravity/", "openai/", "tokenrouter/", "srouter/"];
        for (const p of customPrefixes) {
          if (modelId.startsWith(p)) return p.replace("/", "");
        }
        const parts = modelId.split("/");
        if (parts.length >= 2) {
          const modelName = parts.slice(1).join("/");
          const known = [
            "deepseek", "gemini", "claude", "gpt", "glm", "qwen", "nemotron",
            "mistral", "llama", "kimi", "minimax", "mimo", "grok", "nova",
            "flux", "stable", "sdxl", "sarvam", "seed", "north", "nex",
            "sensenova", "step", "typhoon", "villanova", "wai", "whisper",
            "riva", "plamo", "jina", "sea-lion", "l3", "l3.3", "laguna",
            "leanstral", "ling", "longcat", "majicmix", "manta", "muse",
            "mn-violet", "ntr-mix", "or-", "prefect-pony", "quiet-goodnight",
            "qwen-sea-lion", "qwen2.5", "qwen3", "qwq", "realistic-vision",
            "rev-animated", "swamponyxl", "swe-1", "text-embedding", "tunix",
            "villanova", "zen"
          ];
          for (const k of known) {
            if (modelName.startsWith(k)) return k;
          }
          return modelName.split("-")[0] || "router";
        }
        return "router";
      }

      function simplifyId(fullId) {
        const parts = fullId.split("/");
        return parts.length >= 2 ? parts.slice(1).join("/") : fullId;
      }

      const data = routerData.data.map((m) => ({
        id: m.custom === true ? m.id : simplifyId(m.id),
        object: m.object || "model",
        created: m.created || Math.floor(Date.now() / 1000),
        owned_by: m.custom === true ? (m.owned_by || "custom") : extractProvider(m.id),
      }));

      res.json({ object: "list", data });
    } catch (err) {
      logger.error(`[v2 Models] Error: ${err.message}`);
      res.status(500).json({ error: { message: err.message || "Proxy error" } });
    }
  },
};