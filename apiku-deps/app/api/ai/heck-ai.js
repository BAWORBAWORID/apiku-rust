import fetch from "node-fetch";
import logger from "../../src/utils/logger.js";

const MODELS = {
  'deepseek-v4-flash': 'deepseek/deepseek-v4-flash',
  'deepseek-v4-pro': 'deepseek/deepseek-v4-pro',
  'tencent-hy3-preview': 'tencent/hunyuan-t1-preview',
  'qwen-3.7-plus': 'qwen/qwen3-235b-a22b',
  'step-3.7-flash': 'stepfun/step-3-mini',
  'gemini-3.1-flash-lite': 'google/gemini-2.5-flash-lite-preview-06-17',
  'gemini-3.0-flash': 'google/gemini-2.0-flash-001',
  'gpt-5.4-mini': 'openai/gpt-5.4-mini'
};

const sessions = {};

async function heck(prompt, model = 'gpt-5.4-mini', sessionKey = null, search = false, deepThink = false) {
  const headers = {
    'authority': 'api.heckai.weight-wave.com',
    'accept': '*/*',
    'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'authorization': '',
    'content-type': 'application/json',
    'origin': 'https://heck.ai',
    'referer': 'https://heck.ai/',
    'sec-ch-ua': '"Chromium";v="137", "Not/A)Brand";v="24"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
    'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36'
  };

  const resolvedModel = MODELS[model] || model;

  let sessionId;
  let previousQuestion = null;
  let previousAnswer = null;

  if (sessionKey && sessions[sessionKey]) {
    const s = sessions[sessionKey];
    sessionId = s.sessionId;
    previousQuestion = s.previousQuestion;
    previousAnswer = s.previousAnswer;
  } else {
    const sessionRes = await fetch('https://api.heckai.weight-wave.com/api/ha/v1/session/create', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: prompt })
    });
    const session = await sessionRes.json();
    sessionId = session.id;
    if (sessionKey) sessions[sessionKey] = { sessionId, previousQuestion: null, previousAnswer: null };
  }

  const endpoint = search
    ? 'https://api.heckai.weight-wave.com/api/ha/v1/search'
    : 'https://api.heckai.weight-wave.com/api/ha/v1/chat';

  const body = {
    model: resolvedModel,
    question: prompt,
    language: 'English',
    sessionId,
    previousQuestion,
    previousAnswer
  };

  if (deepThink) body.deepThink = true;

  const chatRes = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const text = await chatRes.text();
  const lines = text.split('\n');
  let answer = '';
  let reason = '';
  let sources = [];
  let collectingAnswer = false;
  let collectingReason = false;
  let collectingSource = false;
  let sourceRaw = '';

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const value = line.slice(6);

    if (value === '[ANSWER_START]') { collectingAnswer = true; continue; }
    if (value === '[ANSWER_DONE]') { collectingAnswer = false; continue; }
    if (value === '[REASON_START]') { collectingReason = true; continue; }
    if (value === '[REASON_DONE]') { collectingReason = false; continue; }
    if (value === '[SOURCE_START]') { collectingSource = true; continue; }
    if (value === '[SOURCE_DONE]') {
      collectingSource = false;
      try { sources = JSON.parse(sourceRaw); } catch {}
      continue;
    }

    if (collectingAnswer) answer += value;
    if (collectingReason) reason += value;
    if (collectingSource) sourceRaw += value;
  }

  if (sessionKey && sessions[sessionKey]) {
    sessions[sessionKey].previousQuestion = prompt;
    sessions[sessionKey].previousAnswer = answer;
  }

  return { answer, reason, sources };
}

export default {
  name: "Heck Ai",
  description: "Chat AI with support for multi-models, sessions, real-time search, and deep think.",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["text", "model", "session", "search", "deepThink"],
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Prompt pertanyaan",
      example: "halo"
    },
    model: {
      type: "string",
      required: true,
      description: "Model AI yang ingin digunakan",
      default: "gpt-5.4-mini",
      enum: [
        "gpt-5.4-mini",
        "deepseek-v4-flash",
        "deepseek-v4-pro",
        "tencent-hy3-preview",
        "qwen-3.7-plus",
        "step-3.7-flash",
        "gemini-3.1-flash-lite",
        "gemini-3.0-flash"
      ]
    },
    session: {
      type: "string",
      required: false,
      description: "ID Session untuk mode percakapan (conversation/memory)"
    },
    search: {
      type: "boolean",
      required: true,
      description: "Aktifkan pencarian web (real-time internet)",
      default: false,
      enum: ["true", "false"]
    },
    deepThink: {
      type: "boolean",
      required: true,
      description: "Aktifkan deep think/reasoning log",
      default: false,
      enum: ["true", "false"]
    }
  },

  async run(req, res) {
    const { text, model, session, search, deepThink } = { ...req.query, ...req.body };

    if (!text || !String(text).trim()) {
      return res.status(400).json({ status: false, message: "Parameter 'text' wajib diisi" });
    }

    const startTime = Date.now();
    const useModel = model || "gpt-5.4-mini";
    const useSearch = search === "true" || search === true;
    const useDeepThink = deepThink === "true" || deepThink === true;

    try {
      const result = await heck(text, useModel, session || null, useSearch, useDeepThink);

      const duration = Date.now() - startTime;
      logger.info(`[HECK-AI] Success | model=${useModel} | time=${duration}ms`);

      return res.json({
        status: true,
        model: useModel,
        result: result.answer,
        reasoning: result.reason || null,
        sources: result.sources || [],
        metadata: {
          processing_time: `${duration}ms`,
          session: session || null,
          search_enabled: useSearch,
          deepthink_enabled: useDeepThink
        }
      });
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[HECK-AI] Error | model=${useModel} | time=${duration}ms | msg=${err.message}`);

      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses request dari Heck AI server"
      });
    }
  }
};
