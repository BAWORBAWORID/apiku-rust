import logger from "../../../src/utils/logger.js";

const ROUTER_ENDPOINT = "https://router.zyvor.my.id/v1/chat/completions";

export default {
  name: "Router Chat Completions V2",
  description: "Proxy chat completions ke router.zyvor.my.id (OpenAI-compatible, 300+ models)",
  category: "Agent",
  methods: ["POST"],
  params: ["model", "messages", "temperature", "max_tokens", "stream", "top_p", "frequency_penalty", "presence_penalty"],
  paramsSchema: {
    model: {
      type: "string",
      required: true,
      description: "Model ID dari router (contoh: antigravity/gemini-2.5-flash, deepseek-r1, claude-sonnet-4, gpt-4o:free, dll). List: /api/v2/models",
      example: "antigravity/gemini-2.5-flash",
    },
    messages: {
      type: "array",
      required: true,
      description: "Array pesan OpenAI format [{ role, content }]",
      example: [{ role: "user", content: "Halo!" }],
    },
    temperature: { type: "number", required: false, default: 0.7, minimum: 0, maximum: 2 },
    max_tokens: { type: "number", required: false, minimum: 1 },
    stream: { type: "boolean", required: false, default: false },
    top_p: { type: "number", required: false, default: 1, minimum: 0, maximum: 1 },
    frequency_penalty: { type: "number", required: false, default: 0, minimum: -2, maximum: 2 },
    presence_penalty: { type: "number", required: false, default: 0, minimum: -2, maximum: 2 },
  },

  async run(req, res) {
    try {
      const body = req.body || {};
      const { model, messages, temperature, max_tokens, stream, top_p, frequency_penalty, presence_penalty } = body;

      logger.info(`[v2 Chat] Request from ${req.ip} | model=${model}`);

      if (!model || typeof model !== "string") {
        return res.status(400).json({ error: { message: "Parameter 'model' wajib diisi" } });
      }
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: { message: "Parameter 'messages' wajib diisi (array tidak kosong)" } });
      }

      const forwardBody = {
        model,
        messages,
        temperature: temperature ?? 0.7,
        max_tokens: max_tokens ?? undefined,
        stream: stream ?? false,
        top_p: top_p ?? 1,
        frequency_penalty: frequency_penalty ?? 0,
        presence_penalty: presence_penalty ?? 0,
      };

      const resp = await fetch(ROUTER_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(forwardBody),
        signal: AbortSignal.timeout(180000),
      });

      if (stream && resp.body) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        for await (const chunk of resp.body) {
          res.write(chunk);
        }
        res.end();
        return;
      }

      const data = await resp.json();

      if (!resp.ok) {
        logger.info(`[v2 Chat] Upstream response ${resp.status}`);
        return res.status(resp.status).json(data);
      }

      logger.info(`[v2 Chat] Success model=${model}`);
      res.json(data);
    } catch (err) {
      logger.error(`[v2 Chat] Error: ${err.message}`);
      res.status(500).json({ error: { message: err.message || "Proxy error" } });
    }
  },
};