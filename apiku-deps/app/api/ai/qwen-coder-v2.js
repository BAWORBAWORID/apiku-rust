/**
 * Qwen Coder V2 — Qwen3 Coder AI via FreeAI
 * Provider: api.free.ai
 * Author: BINTANG
 * Model: qwen3-coder
 * Parameter: teks (required)
 */

import https from "node:https";

function generateUserId() {
  return `user_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

async function freeAIChat(message) {
  const userId = generateUserId();
  const payload = JSON.stringify({
    messages: [{ role: "user", content: message }],
    model: "qwen3-coder",
    stream: true,
    lang: "en"
  });

  return new Promise((resolve, reject) => {
    let fullAnswer = "";
    let modelUsed = "qwen3-coder";

    const options = {
      hostname: "api.free.ai",
      port: 443,
      path: "/v1/chat/",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": userId,
        "Content-Length": Buffer.byteLength(payload),
        "User-Agent": "Mozilla/5.0"
      },
      timeout: 60000
    };

    const req = https.request(options, (res) => {
      let buffer = "";

      res.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") continue;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) fullAnswer += content;
            if (parsed.model) modelUsed = parsed.model;
          } catch {}
        }
      });

      res.on("end", () => {
        resolve({ content: fullAnswer.trim(), model: modelUsed });
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("FreeAI request timeout (60s)"));
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

export default {
  name: "Qwen Coder V2",
  description: "Qwen3 Coder AI — parameter: teks",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["teks"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Prompt atau pertanyaan coding",
      example: "Buatkan fungsi binary search di JavaScript",
      minLength: 1,
      maxLength: 10000
    }
  },
  async run(req, res) {
    const { teks } = { ...req.query, ...req.body };

    if (!teks || typeof teks !== "string" || !teks.trim()) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'teks' wajib diisi",
        example: {
          GET: "/api/ai/qwen-coder-v2?teks=Buatkan%20fungsi%20sorting",
          POST: { teks: "Buatkan fungsi sorting" }
        }
      });
    }

    try {
      const result = await freeAIChat(teks.trim());

      res.json({
        status: true,
        input: teks.trim(),
        model: result.model,
        result: result.content
      });
    } catch (err) {
      const errMsg = err.message || "Qwen Coder V2 request failed";
      res.status(500).json({ status: false, message: errMsg });
    }
  }
};
