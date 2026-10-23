import axios from "axios";

const BASE_URL = "https://www.turboseek.io/api";
const HEADERS = {
  "Content-Type": "application/json",
  "Accept": "application/json, text/plain, */*",
  "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36",
  "Origin": "https://www.turboseek.io",
  "Referer": "https://www.turboseek.io/"
};

async function source(query) {
  try {
    const { data } = await axios.post(`${BASE_URL}/getSources`, { question: query }, { headers: HEADERS, timeout: 15000 });
    return data || [];
  } catch {
    return [];
  }
}

async function answer(query, sources) {
  try {
    const { data } = await axios.post(`${BASE_URL}/getAnswer`, { question: query, sources }, { headers: HEADERS, timeout: 20000 });
    return data || "";
  } catch {
    return "";
  }
}

async function getSimilarQuestions(query, sources) {
  try {
    const { data } = await axios.post(`${BASE_URL}/getSimilarQuestions`, { question: query, sources }, { headers: HEADERS, timeout: 15000 });
    return data || [];
  } catch {
    return [];
  }
}

export default {
  name: "TurboSeek AI",
  description: "AI Web Research with Sources using TurboSeek",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["text"],
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Pertanyaan atau query riset",
      example: "Berita Korupsi Indonesia"
    }
  },

  async run(req, res) {
    const { text } = { ...req.query, ...req.body };
    const query = String(text || "").trim();

    if (!query) {
      return res.status(400).json({ status: false, message: "Parameter 'text' wajib diisi" });
    }

    try {
      const sources = await source(query);
      
      if (!sources || sources.length === 0) {
        return res.status(404).json({
          status: false,
          message: "No sources found for the given query"
        });
      }

      const [rawAnswer, similarQuestions] = await Promise.all([
        answer(query, sources),
        getSimilarQuestions(query, sources)
      ]);

      const answerString = typeof rawAnswer === 'object' ? JSON.stringify(rawAnswer) : String(rawAnswer);
      const cleanAnswer = answerString.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

      return res.json({
        status: true,
        result: {
          answer: cleanAnswer,
          sources: sources.map(src => ({
            title: src.title,
            url: src.url
          })),
          similarQuestions: Array.isArray(similarQuestions) ? similarQuestions : []
        }
      });

    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Failed to fetch from TurboSeek API"
      });
    }
  }
};
