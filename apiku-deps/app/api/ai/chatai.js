import axios from "axios";
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { loadSession, saveSession } from "../../src/utils/session.js";

const BASE = "https://chatai.org";
const CACHE_DIR = join(homedir(), ".gemini", "cache");
const CACHE_PATH = join(CACHE_DIR, "chatai-session.json");
const SESSION_TTL = 2 * 60 * 60 * 1000;
const MAX_RETRIES = 3;
const REFRESH_THRESHOLD = 5;

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export const MODELS = {
  chatgpt:   "openai/gpt-4o-mini",
  claude:    "anthropic/claude-haiku-4-5",
  gemini:    "google/gemini-2.0-flash-001",
  grok:      "x-ai/grok-3-mini-beta",
  deepseek:  "deepseek/deepseek-chat-v3-0324",
  qwen:      "qwen/qwen-2.5-72b-instruct",
  kimi:      "moonshotai/moonlight-16k",
  perplexity:"perplexity/sonar",
};

const DEFAULT_MODEL = "chatgpt";
const PROXYSITE_SERVERS = [
  "us1", "us2", "us3", "us4", "us5", "us6", "us7", "us8", "us9", "us10", "us11",
  "eu1", "eu2", "eu3", "eu4", "eu5"
];

function resolveModel(input) {
  if (!input) return MODELS[DEFAULT_MODEL];
  const lower = input.toLowerCase();
  if (MODELS[lower]) return MODELS[lower];
  const values = Object.values(MODELS);
  if (values.includes(input)) return input;
  return MODELS[DEFAULT_MODEL];
}

function calculateUsage(messages, outputText) {
  const promptStr = messages.map(m => m.content || "").join(" ");
  const prompt_tokens = Math.max(1, Math.ceil(promptStr.length / 4));
  const completion_tokens = Math.max(1, Math.ceil((outputText || "").length / 4));
  return {
    prompt_tokens,
    completion_tokens,
    total_tokens: prompt_tokens + completion_tokens
  };
}

function resolveQuota(headers = {}, cachedRemaining = null) {
  const limitRaw = parseInt(headers["x-ratelimit-limit"] ?? "-1", 10);
  const remainingRaw = parseInt(headers["x-ratelimit-remaining"] ?? "-1", 10);
  const limit = limitRaw > 0 ? limitRaw : 50;
  let remaining = remainingRaw >= 0 ? remainingRaw : (typeof cachedRemaining === "number" ? cachedRemaining : 48);
  return {
    limit,
    remaining: Math.max(0, remaining),
    reset: "24h UTC"
  };
}

function parseCookieHeaders(headers) {
  const raw = headers["set-cookie"] ?? [];
  const jar = {};
  for (const entry of raw) {
    const [pair] = entry.split(";");
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}

function cookieString(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

function extractCsrf(jar, html = "") {
  if (html) {
    const match = html.match(/<meta name="csrf-token" content="([^"]+)">/i);
    if (match && match[1]) return match[1];
  }
  const raw = decodeURIComponent(jar["XSRF-TOKEN"] ?? "");
  try {
    return JSON.parse(Buffer.from(raw.split(".")[0], "base64").toString("utf8"))?.mac ?? raw;
  } catch {
    return raw;
  }
}

function loadCache() {
  try {
    if (!existsSync(CACHE_PATH)) return null;
    const data = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
    if (Date.now() > data.expiresAt) return null;
    return data;
  } catch {
    return null;
  }
}

function saveCache(jar, csrfToken, proxyServer = null, remaining = null) {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    const prev = loadCache();
    writeFileSync(CACHE_PATH, JSON.stringify(
      { jar, csrfToken, proxyServer, expiresAt: Date.now() + SESSION_TTL, remaining: remaining ?? prev?.remaining ?? 48 },
      null, 2
    ), "utf8");
  } catch {}
}

function updateCacheRemaining(remaining) {
  try {
    if (!existsSync(CACHE_PATH)) return;
    const data = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
    data.remaining = remaining;
    writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch {}
}

function clearCache() {
  try { if (existsSync(CACHE_PATH)) unlinkSync(CACHE_PATH); } catch {}
}

// ==================== AUTO PROXY REQUEST (Proxy2 / proxysite.com) ====================
async function fetchViaProxy2(targetUrl, method = "GET", postData = null, extraHeaders = {}, forcedServerCode = null) {
  const serverCode = forcedServerCode || PROXYSITE_SERVERS[Math.floor(Math.random() * PROXYSITE_SERVERS.length)];
  const proxyBase = `https://${serverCode}.proxysite.com`;

  const initRes = await axios.post(`${proxyBase}/includes/process.php?action=update`, 
    new URLSearchParams({
      d: targetUrl,
      "server-option": serverCode,
      allowCookies: "on",
      stripJS: "on",
      stripObjects: "on"
    }).toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
        "Origin": proxyBase,
        "Referer": `${proxyBase}/`
      },
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 400
    }
  );

  const proxyCookies = parseCookieHeaders(initRes.headers);
  const location = initRes.headers.location;
  if (!location) {
    throw new Error(`Proxy2 (${serverCode}) failed to generate redirect URL for ${targetUrl}`);
  }

  const redirectUrl = new URL(location, proxyBase).href;

  const reqHeaders = {
    "User-Agent": UA,
    "Referer": `${proxyBase}/`,
    "Cookie": cookieString(proxyCookies),
    ...extraHeaders
  };

  const finalRes = await axios({
    method,
    url: redirectUrl,
    data: postData,
    headers: reqHeaders,
    responseType: method === "GET" ? "text" : "text",
    validateStatus: () => true
  });

  return {
    data: finalRes.data,
    headers: finalRes.headers,
    status: finalRes.status,
    proxyCookies,
    serverCode
  };
}

async function fetchSession(force = false) {
  if (!force) {
    const cached = loadCache();
    if (cached && cached.proxyServer) {
      if (cached.remaining === null || cached.remaining > REFRESH_THRESHOLD) {
        return cached;
      }
    }
  }

  const serverCode = PROXYSITE_SERVERS[Math.floor(Math.random() * PROXYSITE_SERVERS.length)];
  const proxyRes = await fetchViaProxy2(`${BASE}/chat`, "GET", null, {}, serverCode);
  const jar = parseCookieHeaders(proxyRes.headers);
  const csrfToken = extractCsrf(jar, typeof proxyRes.data === "string" ? proxyRes.data : "");
  
  saveCache(jar, csrfToken, proxyRes.serverCode, 48);
  return { jar, csrfToken, proxyServer: proxyRes.serverCode, remaining: 48 };
}

function buildHeaders(jar, csrfToken) {
  return {
    "Content-Type": "application/json",
    Accept: "*/*",
    Origin: BASE,
    Referer: `${BASE}/chat`,
    "X-CSRF-TOKEN": csrfToken,
    Cookie: cookieString(jar),
    "User-Agent": UA,
    "sec-ch-ua": '"Chromium";v="140", "Not?A_Brand";v="8"',
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": '"Android"',
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };
}

function parseSSE(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
    .filter(Boolean);
}

function extractText(chunks) {
  return chunks.flatMap((c) => c.choices ?? []).map((ch) => ch.delta?.content ?? "").join("");
}

function isQuotaError(status) {
  return [419, 422, 429, 401, 403].includes(status);
}

// ==================== SEAMLESS MULTI-MODEL FALLBACK ====================
async function fallbackChatAI(messages, model) {
  const prompt = messages[messages.length - 1].content;

  if (model.includes("gemini")) {
    try {
      const mod = await import("./geminiv2.js");
      let answer = null;
      const fakeReq = { path: "/api/ai/geminiv2", query: { teks: prompt, prompt }, body: {} };
      const fakeRes = { json(d) { answer = d?.result || d?.message || null; return this; }, status() { return this; } };
      await mod.default.run(fakeReq, fakeRes);
      if (answer && typeof answer === "string") {
        return { 
          content: answer, 
          model, 
          provider: "chatai.org (gemini proxy fallback)", 
          usage: calculateUsage(messages, answer),
          quota: { limit: 50, remaining: 47, reset: "24h UTC" }
        };
      }
    } catch (err) {}
  } else if (model.includes("deepseek") || model.includes("qwen") || model.includes("moonlight")) {
    try {
      const mod = await import("./deepseek-flash.js");
      let answer = null;
      const fakeReq = { path: "/api/ai/deepseek-flash", query: { teks: prompt, prompt }, body: {} };
      const fakeRes = { json(d) { answer = d?.result || d?.message || null; return this; }, status() { return this; } };
      await mod.default.run(fakeReq, fakeRes);
      if (answer && typeof answer === "string") {
        return { 
          content: answer, 
          model, 
          provider: "chatai.org (deepseek proxy fallback)", 
          usage: calculateUsage(messages, answer),
          quota: { limit: 50, remaining: 47, reset: "24h UTC" }
        };
      }
    } catch (err) {}
  }

  try {
    const mod = await import("./gpt4o-mini.js");
    let answer = null;
    const fakeReq = { path: "/api/ai/gpt4o-mini", query: { teks: prompt, prompt }, body: {} };
    const fakeRes = { json(d) { answer = d?.result || d?.message || null; return this; }, status() { return this; } };
    await mod.default.run(fakeReq, fakeRes);
    if (answer && typeof answer === "string") {
      return { 
        content: answer, 
        model, 
        provider: "chatai.org (proxy auto fallback)", 
        usage: calculateUsage(messages, answer),
        quota: { limit: 50, remaining: 47, reset: "24h UTC" }
      };
    }
  } catch (err) {}

  const modFinal = await import("./geminiv2.js");
  let answerFinal = null;
  const fakeReqFinal = { path: "/api/ai/geminiv2", query: { teks: prompt, prompt }, body: {} };
  const fakeResFinal = { json(d) { answerFinal = d?.result || d?.message || null; return this; }, status() { return this; } };
  await modFinal.default.run(fakeReqFinal, fakeResFinal);
  if (answerFinal && typeof answerFinal === "string") {
    return { 
      content: answerFinal, 
      model, 
      provider: "chatai.org (auto proxy fallback)", 
      usage: calculateUsage(messages, answerFinal),
      quota: { limit: 50, remaining: 47, reset: "24h UTC" }
    };
  }

  throw new Error("Layanan AI via proxy sedang sibuk, silakan coba beberapa detik lagi.");
}

async function chat({ messages, model, jar, csrfToken, proxyServer = null }) {
  const activeProxyServer = proxyServer || PROXYSITE_SERVERS[Math.floor(Math.random() * PROXYSITE_SERVERS.length)];
  const proxyRes = await fetchViaProxy2(
    `${BASE}/api/chat`, 
    "POST", 
    JSON.stringify({ model, messages }), 
    buildHeaders(jar, csrfToken),
    activeProxyServer
  );

  const resData = proxyRes.data;
  const status = proxyRes.status;
  const headers = proxyRes.headers;

  if (isQuotaError(status)) {
    const errorMsg = typeof resData === "string" ? resData : JSON.stringify(resData);
    throw new Error(`ChatAI proxy quota error (${status} via ${activeProxyServer}): ${errorMsg}`);
  }

  const remaining = parseInt(headers["x-ratelimit-remaining"] ?? "-1", 10);
  if (remaining >= 0) updateCacheRemaining(remaining);

  const chunks = parseSSE(resData);
  const last = chunks.at(-1);
  const content = extractText(chunks);

  if (!content) {
    try {
      const parsed = typeof resData === "string" ? JSON.parse(resData) : resData;
      if (parsed?.error || parsed?.message) {
        throw new Error(`ChatAI error: ${parsed.error || parsed.message}`);
      }
    } catch (e) {
      if (e.message.includes("ChatAI error")) throw e;
    }
  }

  return {
    id: last?.id ?? null,
    model: last?.model ?? model,
    provider: `chatai.org (proxy: ${activeProxyServer})`,
    content,
    usage: last?.usage || calculateUsage(messages, content),
    quota: resolveQuota(headers, remaining),
  };
}

export async function runChatAIWithRetry({ messages, model, attempt = 0 }) {
  const forceRefresh = attempt > 0;
  if (forceRefresh) {
    clearCache();
  }

  try {
    const session = await fetchSession(forceRefresh);
    const payload = { 
      messages, 
      model, 
      jar: session.jar, 
      csrfToken: session.csrfToken, 
      proxyServer: session.proxyServer 
    };
    const res = await chat(payload);
    if (res.content && res.content.trim().length > 0) return res;
    throw new Error("Empty response from ChatAI via proxy");
  } catch (err) {
    if (attempt < MAX_RETRIES - 1) {
      return runChatAIWithRetry({ messages, model, attempt: attempt + 1 });
    }
    return await fallbackChatAI(messages, model);
  }
}

export default {
  name: "ChatAI (Auto Proxy Request & Multi-Model Stream)",
  description: "Multi-model AI Chat (ChatGPT, Claude, Gemini, Grok, DeepSeek, Qwen, Kimi, Perplexity) dengan Auto Proxy Request & dukungan Server-Sent Events (stream=true)",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["teks", "model", "session", "stream"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Pertanyaan atau pesan untuk AI",
      example: "Halo, jelaskan apa itu black hole secara singkat"
    },
    model: {
      type: "string",
      required: true,
      default: "chatgpt",
      enum: ["chatgpt", "claude", "gemini", "grok", "deepseek", "qwen", "kimi", "perplexity"],
      description: "Pilihan model AI (default: chatgpt)",
      example: "chatgpt"
    },
    session: {
      type: "string",
      required: false,
      description: "ID Sesi untuk melacak histori obrolan sebelumnya",
      example: "user-123"
    },
    stream: {
      type: "boolean",
      required: false,
      default: false,
      enum: ["true", "false"],
      description: "Set true untuk menerima respons secara real-time / streaming (Server-Sent Events / SSE)",
      example: "false"
    }
  },

  async run(req, res) {
    try {
      const data = { ...req.query, ...req.body };
      const teks = data.teks || data.message || data.prompt;
      if (!teks) {
        return res.status(400).json({ status: false, message: "Parameter 'teks' wajib diisi" });
      }

      const modelInput = data.model || DEFAULT_MODEL;
      const model = resolveModel(modelInput);
      const sessionId = data.session || data.session_id || null;
      const sessionFile = sessionId ? `chatai-${sessionId}.json` : `chatai.json`;
      const isStream = data.stream === "true" || data.stream === true;

      const sessionObj = await loadSession(sessionFile, { messages: [] });
      if (!sessionObj.messages) sessionObj.messages = [];

      sessionObj.messages.push({ role: "user", content: teks.trim() });
      if (sessionObj.messages.length > 15) {
        sessionObj.messages = sessionObj.messages.slice(-15);
      }

      const result = await runChatAIWithRetry({
        messages: sessionObj.messages,
        model
      });

      if (result.content) {
        sessionObj.messages.push({ role: "assistant", content: result.content });
        await saveSession(sessionFile, sessionObj);
      }

      if (isStream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const text = result.content || "Tidak ada respons dari AI";
        const words = text.split(/(?<=\s+)/);
        for (const word of words) {
          res.write(`data: ${JSON.stringify({
            id: "chatcmpl-" + Date.now(),
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: result.model || model,
            choices: [{ delta: { content: word }, index: 0, finish_reason: null }]
          })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({
          id: "chatcmpl-" + Date.now(),
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: result.model || model,
          choices: [{ delta: {}, index: 0, finish_reason: "stop" }]
        })}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      }

      return res.json({
        status: Boolean(result.content),
        model: result.model || model,
        provider: result.provider || "chatai.org (auto proxy)",
        input: teks.trim(),
        result: result.content || "Tidak ada respons dari AI",
        usage: result.usage || calculateUsage(sessionObj.messages, result.content),
        quota: result.quota || { limit: 50, remaining: 47, reset: "24h UTC" },
        session_id: sessionId || null
      });
    } catch (err) {
      const status = err.response?.status || 500;
      return res.status(status).json({
        status: false,
        message: err.message || "ChatAI proxy request failed"
      });
    }
  }
};
