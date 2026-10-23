import https from "https";
import crypto from "crypto";

function generateCsrfToken() {
  return crypto.randomBytes(32).toString("base64").slice(0, 40);
}

function deepseekV3Chat(prompt) {
  const csrfToken = generateCsrfToken();
  const postData = JSON.stringify({
    model: "deepseek/deepseek-v3.2",
    messages: [{ role: "user", content: prompt }],
  });

  return new Promise((resolve, reject) => {
    let fullResponse = "";
    let modelUsed = "";

    const req = https.request(
      {
        hostname: "deep-seek.ai",
        port: 443,
        path: "/api/chat",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-TOKEN": csrfToken,
          "Content-Length": Buffer.byteLength(postData),
        },
        timeout: 60000,
      },
      (res) => {
        let buffer = "";

        res.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            if (line.startsWith(": OPENROUTER")) continue;
            if (!line.startsWith("data: ") || line.slice(6) === "[DONE]") continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.choices?.[0]?.delta?.content) {
                fullResponse += data.choices[0].delta.content;
              }
              if (data.model) modelUsed = data.model;
            } catch {}
          }
        });

        res.on("end", () => resolve({
          answer: fullResponse.trim(),
          model: modelUsed || "deepseek/deepseek-v3.2-20251201",
        }));
      }
    );

    req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout (60s)")); });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

export default {
  name: "DeepSeek V3",
  description: "DeepSeek V3 AI Chat (model: deepseek-v3.2)",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["teks"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Pertanyaan atau perintah untuk DeepSeek V3",
      example: "Halo, siapa kamu?",
      minLength: 1,
      maxLength: 10000,
    },
  },

  async run(req, res) {
    const { teks } = { ...req.query, ...req.body };

    if (!teks || typeof teks !== "string" || !teks.trim()) {
      return res.status(400).json({ status: false, message: "Parameter 'teks' wajib diisi" });
    }

    try {
      const result = await deepseekV3Chat(teks.trim());
      res.json({
        status: true,
        model: result.model,
        input: teks.trim(),
        result: result.answer,
      });
    } catch (err) {
      res.status(500).json({ status: false, message: err.message || "DeepSeek V3 request failed" });
    }
  },
};
