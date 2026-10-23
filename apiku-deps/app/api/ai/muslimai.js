import axios from "axios";

const BASE = "https://www.muslimai.io";
const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";

const DISTINCT_ID = "019ebfc5-619f-78d5-be7b-ba3494e16e3a";

const HEADERS = {
  authority: "www.muslimai.io",
  accept: "*/*",
  "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "content-type": "application/json",
  origin: BASE,
  referer: `${BASE}/`,
  "sec-ch-ua": '"Chromium";v="137", "Not/A)Brand";v="24"',
  "sec-ch-ua-mobile": "?1",
  "sec-ch-ua-platform": '"Android"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent": USER_AGENT,
};

async function muslimAIChat(query) {
  const body = { query, distinctId: DISTINCT_ID };

  const response = await axios.post(`${BASE}/api/chat`, body, {
    headers: HEADERS,
    responseType: "stream",
    validateStatus: () => true,
    timeout: 60000,
  });

  if (response.status !== 200) {
    const chunks = [];
    for await (const chunk of response.data) chunks.push(chunk);
    throw new Error(`Muslim AI failed (${response.status}): ${Buffer.concat(chunks).toString()}`);
  }

  const result = { sources: [], text: "" };

  return new Promise((resolve, reject) => {
    let buffer = "";

    response.data.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.type === "sources") {
            result.sources = parsed.data;
          } else if (parsed.type === "text") {
            result.text += parsed.data;
          }
        } catch (_) {}
      }
    });

    response.data.on("end", () => resolve(result));
    response.data.on("error", (err) => reject(err));
  });
}

export default {
  name: "Muslim AI Chat",
  description: "AI berbasis Al-Quran untuk menjawab pertanyaan seputar Islam (streaming)",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["teks"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Pertanyaan seputar Islam",
      example: "Apa hukum sholat tahajud?",
      minLength: 1,
      maxLength: 2000,
    },
  },

  async run(req, res) {
    try {
      const { teks } = { ...req.query, ...req.body };

      if (!teks || typeof teks !== "string" || teks.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'teks' wajib diisi dengan pertanyaan seputar Islam",
        });
      }

      const result = await muslimAIChat(teks.trim());

      res.json({
        status: true,
        model: "Quran-based AI",
        input: teks.trim(),
        result: {
          text: result.text,
          sources: result.sources.length > 0 ? result.sources : undefined,
        },
      });
    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "Muslim AI request failed",
      });
    }
  },
};