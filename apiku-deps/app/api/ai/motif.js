/**
 * Motif AI Chat (Motif 3)
 * Provider: https://chat.motiftech.io
 * Session : data/motif.json
 *
 * GET  /api/ai/motif?prompt=halo&level=small
 * POST /api/ai/motif
 */

import { readFile, writeFile, access } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import logger from "../../src/utils/logger.js";

const BASE = "https://chat.motiftech.io";
const SESSION_PATH = path.join(process.cwd(), "data", "motif.json");

const LEVEL_MAP = {
  low: "small",
  small: "small",
  medium: "medium",
  high: "high"
};

const MIME_BY_EXT = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/plain",
  ".csv": "text/plain",
  ".json": "text/plain",
  ".xml": "text/plain",
  ".html": "text/plain",
  ".htm": "text/plain",
  ".js": "text/plain",
  ".mjs": "text/plain",
  ".cjs": "text/plain",
  ".ts": "text/plain",
  ".tsx": "text/plain",
  ".jsx": "text/plain",
  ".py": "text/plain",
  ".java": "text/plain",
  ".c": "text/plain",
  ".cpp": "text/plain",
  ".h": "text/plain",
  ".cs": "text/plain",
  ".go": "text/plain",
  ".rs": "text/plain",
  ".rb": "text/plain",
  ".php": "text/plain",
  ".sh": "text/plain",
  ".sql": "text/plain",
  ".yaml": "text/plain",
  ".yml": "text/plain",
  ".toml": "text/plain",
  ".ini": "text/plain",
  ".log": "text/plain",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword"
};

function guessMime(filename) {
  const lower = String(filename).toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot >= 0) {
    const ext = lower.slice(dot);
    if (MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
  }
  return "text/plain";
}

async function loadSession(filePath = SESSION_PATH) {
  try {
    await access(filePath);
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return { cookies: {}, nextAction: null, updatedAt: null };
  }
}

async function saveSession(session, filePath = SESSION_PATH) {
  try {
    session.updatedAt = new Date().toISOString();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await writeFile(filePath, JSON.stringify(session, null, 2));
  } catch (err) {
    logger.error(`[MOTIF-AI] Failed to save session: ${err.message}`);
  }
}

function cookieHeader(cookies = {}) {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function mergeSetCookie(res, cookies = {}) {
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : (res.headers.get("set-cookie") || "").split(/,(?=\s*[^;]+=)/);

  for (const sc of setCookies) {
    if (!sc) continue;
    const [pair] = sc.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) {
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      cookies[name] = value;
    }
  }
  return cookies;
}

async function scrapeActionCandidates(session) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36",
    Accept: "text/html"
  };
  if (Object.keys(session.cookies || {}).length) {
    headers.Cookie = cookieHeader(session.cookies);
  }

  const pageRes = await fetch(`${BASE}/chat`, { headers });
  session.cookies = mergeSetCookie(pageRes, session.cookies || {});
  const html = await pageRes.text();

  const chunkUrls = [
    ...new Set(
      (html.match(/\/_next\/static\/chunks\/[^"'\s]+\.js/g) || []).map((u) =>
        u.startsWith("http") ? u : BASE + u
      )
    )
  ];

  const priority = chunkUrls.filter(
    (u) =>
      u.includes("5890") ||
      u.includes("5813") ||
      u.includes("c16f") ||
      u.includes("main-app") ||
      u.includes("/chat/")
  );
  const toScan = [
    ...priority,
    ...chunkUrls.filter((u) => !priority.includes(u))
  ].slice(0, 10);

  const re = /createServerReference\s*\)?\s*\(\s*["']([a-f0-9]{40,44})["']/g;
  const found = new Set();

  for (const url of toScan) {
    try {
      const jsRes = await fetch(url, { headers });
      if (!jsRes.ok) continue;
      const js = await jsRes.text();
      let m;
      while ((m = re.exec(js)) !== null) {
        found.add(m[1]);
      }
    } catch {
      // skip
    }
  }

  return [...found];
}

async function discoverNextAction(session, sessionPath = SESSION_PATH) {
  if (session.nextAction && session.updatedAt) {
    const age = Date.now() - new Date(session.updatedAt).getTime();
    if (age < 12 * 60 * 60 * 1000) return session.nextAction;
  }

  const candidates = await scrapeActionCandidates(session);

  if (!candidates.length) {
    if (session.nextAction) return session.nextAction;
    throw new Error("Gagal menemukan next-action pada Motif AI.");
  }

  const ordered = [];
  if (session.nextAction && candidates.includes(session.nextAction)) {
    ordered.push(session.nextAction);
  }
  for (const h of candidates) {
    if (h.startsWith("401e") && !ordered.includes(h)) ordered.push(h);
  }
  for (const h of candidates) {
    if (!ordered.includes(h)) ordered.push(h);
  }

  const chosen = ordered[0];
  session.nextAction = chosen;
  session._candidates = ordered;
  await saveSession(session, sessionPath);
  return chosen;
}

export async function uploadFile(filePathOrBuffer, opts = {}) {
  const {
    filename,
    conversationId = null,
    sessionPath = SESSION_PATH
  } = opts;

  if (!conversationId) {
    throw new Error("Upload file memerlukan conversationId");
  }

  const session = opts.session || (await loadSession(sessionPath));

  let buffer;
  let name;
  if (typeof filePathOrBuffer === "string") {
    buffer = await readFile(filePathOrBuffer);
    name = filename || path.basename(filePathOrBuffer);
  } else {
    buffer = filePathOrBuffer;
    name = filename || "file.txt";
  }

  const mime = guessMime(name);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime }), name);
  form.append("conversation_id", conversationId);

  const headers = {
    Referer: `${BASE}/chat`,
    Origin: BASE,
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36"
  };
  if (Object.keys(session.cookies || {}).length) {
    headers.Cookie = cookieHeader(session.cookies);
  }

  const res = await fetch(`${BASE}/api/file/upload/direct`, {
    method: "POST",
    headers,
    body: form
  });

  session.cookies = mergeSetCookie(res, session.cookies || {});
  await saveSession(session, sessionPath);

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Upload gagal (${res.status}): ${txt.slice(0, 300)}`);
  }

  const data = await res.json();
  if (!data.file_id) throw new Error("Response upload tidak berisi file_id");
  return data;
}

export async function motifChat(query, options = {}) {
  const {
    conversationId = null,
    fileIds = [],
    level = "small",
    timezone = "Asia/Jakarta",
    language = "en",
    sessionPath = SESSION_PATH,
    onChunk = null
  } = options;

  const session = options.session || (await loadSession(sessionPath));
  const reasoningEffort = LEVEL_MAP[String(level).toLowerCase()] || "small";

  await discoverNextAction(session, sessionPath);
  let candidates = session._candidates?.length
    ? session._candidates
    : [session.nextAction].filter(Boolean);

  if (!candidates.length) {
    session.nextAction = null;
    session.updatedAt = null;
    await discoverNextAction(session, sessionPath);
    candidates = session._candidates?.length
      ? session._candidates
      : [session.nextAction].filter(Boolean);
  }

  const initBody = [
    {
      brainstormingMode: "auto",
      conversationId,
      documentReference: "$undefined",
      fileIds: fileIds.length ? fileIds : "$undefined",
      language,
      projectId: null,
      query,
      reasoningEffort,
      templateId: null,
      timezone,
      uiLocale: language
    }
  ];

  let payload = null;
  let lastError = null;

  for (const nextAction of candidates) {
    const initHeaders = {
      Accept: "text/x-component",
      "Content-Type": "text/plain;charset=UTF-8",
      "next-action": nextAction,
      "next-router-state-tree":
        "%5B%22%22%2C%7B%22children%22%3A%5B%22(model)%22%2C%7B%22children%22%3A%5B%22chat%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C16%5D",
      Referer: `${BASE}/chat`,
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36"
    };
    if (Object.keys(session.cookies || {}).length) {
      initHeaders.Cookie = cookieHeader(session.cookies);
    }

    try {
      const initRes = await fetch(`${BASE}/chat`, {
        method: "POST",
        headers: initHeaders,
        body: JSON.stringify(initBody)
      });

      session.cookies = mergeSetCookie(initRes, session.cookies || {});

      if (!initRes.ok) {
        lastError = `HTTP ${initRes.status}`;
        continue;
      }

      const initText = await initRes.text();

      let found = null;
      for (const line of initText.split("\n")) {
        const m = line.match(/^\d+:(\{.*\})$/);
        if (!m) continue;
        try {
          const obj = JSON.parse(m[1]);
          if (obj?.url && obj?.body) {
            found = obj;
            break;
          }
        } catch {
          // skip
        }
      }

      if (!found) {
        const m2 = initText.match(/1:(\{[\s\S]*?\})(?:\n|$)/);
        if (m2) {
          try {
            const obj = JSON.parse(m2[1]);
            if (obj?.url && obj?.body) found = obj;
          } catch {}
        }
      }

      if (
        found?.url &&
        found?.body &&
        String(found.url).includes("/api/v1/enterprise/chat")
      ) {
        payload = found;
        session.nextAction = nextAction;
        await saveSession(session, sessionPath);
        break;
      }

      lastError = "payload tidak valid / bukan chat endpoint";
    } catch (err) {
      lastError = err.message;
    }
  }

  if (!payload) {
    session.nextAction = null;
    session._candidates = null;
    await saveSession(session, sessionPath);
    throw new Error(`Gagal inisialisasi chat Motif AI: ${lastError}`);
  }

  const streamUrl = payload.url;
  const streamBody = {};
  for (const [k, v] of Object.entries(payload.body || {})) {
    if (v === "$undefined") continue;
    streamBody[k] = v;
  }
  if (fileIds.length) {
    streamBody.file_ids = fileIds;
  } else {
    delete streamBody.file_ids;
  }

  const streamHeaders = {
    Accept: "text/event-stream",
    "Content-Type": "application/json",
    Referer: `${BASE}/chat`,
    Origin: BASE,
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36"
  };
  if (payload.headers?.["x-request-id"]) {
    streamHeaders["x-request-id"] = payload.headers["x-request-id"];
  }
  if (Object.keys(session.cookies || {}).length) {
    streamHeaders.Cookie = cookieHeader(session.cookies);
  }

  const streamRes = await fetch(streamUrl, {
    method: "POST",
    headers: streamHeaders,
    body: JSON.stringify(streamBody)
  });

  session.cookies = mergeSetCookie(streamRes, session.cookies || {});
  await saveSession(session, sessionPath);

  if (!streamRes.ok) {
    const errText = await streamRes.text().catch(() => "");
    throw new Error(`Stream gagal: ${streamRes.status} ${errText.slice(0, 200)}`);
  }

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let finalConversationId = conversationId;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() || "";

    for (const line of parts) {
      if (!line.startsWith("data: ")) continue;
      const dataStr = line.slice(6).trim();
      if (!dataStr || dataStr === "[[HUB_STOP_SIGN]]") continue;

      try {
        const data = JSON.parse(dataStr);
        if (data.type === "shared.data.conversation_id") {
          finalConversationId = data.data;
        }
        if (data.type === "chat.text") {
          fullText += data.data;
          if (typeof onChunk === "function") {
            onChunk(data.data);
          }
        }
      } catch {
        // skip non-json
      }
    }
  }

  return {
    conversationId: finalConversationId,
    text: fullText.trim()
  };
}

export async function chatWithFile(query, fileBuffer, filename, options = {}) {
  let convId = options.conversationId || null;
  const shared = {
    session: options.session,
    sessionPath: options.sessionPath || SESSION_PATH
  };

  if (!convId) {
    const boot = await motifChat("\u200b", {
      level: "small",
      ...shared
    });
    convId = boot.conversationId;
  }

  const uploaded = await uploadFile(fileBuffer, {
    filename,
    conversationId: convId,
    ...shared
  });

  return motifChat(query, {
    ...options,
    conversationId: convId,
    fileIds: [uploaded.file_id]
  });
}

export default {
  name: "Motif AI",
  description: "Motif 3 AI Chat — reasoning model with multi-level responses, streaming, and conversation memory",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["prompt", "level", "conversationId", "stream"],
  paramsSchema: {
    prompt: {
      type: "string",
      required: true,
      description: "Pertanyaan atau perintah teks untuk Motif AI",
      example: "Halo, jelaskan apa itu quantum computing secara singkat"
    },
    level: {
      type: "string",
      required: false,
      default: "small",
      enum: ["small", "medium", "high"],
      description: "Tingkat kedalaman reasoning (small: cepat/ringkas, medium: seimbang, high: mendalam/detail)"
    },
    conversationId: {
      type: "string",
      required: false,
      description: "ID percakapan untuk melanjutkan thread chat sebelumnya",
      example: "01M3ZJGFKE4T46XCBDA2H1T21E"
    },
    stream: {
      type: "boolean",
      required: false,
      default: false,
      description: "Streaming response via Server-Sent Events (SSE)"
    },
    url: {
      type: "string",
      required: false,
      description: "URL dokumen atau file opsional yang ingin dianalisis oleh AI",
      example: ""
    }
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const {
        prompt,
        text,
        teks,
        query,
        message,
        level = "small",
        conversationId,
        conversation_id,
        conv,
        stream,
        url
      } = { ...req.query, ...req.body };

      const inputQuery = (prompt || text || teks || query || message || "").trim();
      if (!inputQuery) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'prompt' wajib diisi"
        });
      }

      const convId = conversationId || conversation_id || conv || null;
      const isStream = stream === "true" || stream === true;
      const selectedLevel = LEVEL_MAP[String(level).toLowerCase()] || "small";

      // File upload support (multipart or url)
      let fileBuffer = null;
      let fileName = "file.txt";

      const uploadedFile = req.files?.file || req.files?.document || req.files?.image;
      if (uploadedFile) {
        const filePath = uploadedFile.tempFilePath || uploadedFile.path;
        if (filePath && fs.existsSync(filePath)) {
          fileBuffer = fs.readFileSync(filePath);
        } else if (uploadedFile.data) {
          fileBuffer = uploadedFile.data;
        }
        fileName = uploadedFile.name || "file.txt";
      } else if (url && /^https?:\/\//i.test(url)) {
        const r = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
        fileBuffer = Buffer.from(r.data);
        fileName = path.basename(new URL(url).pathname) || "file.txt";
      }

      // Handle streaming mode
      if (isStream) {
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();

        const chatOpts = {
          conversationId: convId,
          level: selectedLevel,
          onChunk: (chunk) => {
            res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
          }
        };

        let result;
        if (fileBuffer) {
          result = await chatWithFile(inputQuery, fileBuffer, fileName, chatOpts);
        } else {
          result = await motifChat(inputQuery, chatOpts);
        }

        res.write(
          `data: ${JSON.stringify({
            done: true,
            conversationId: result.conversationId
          })}\n\n`
        );
        return res.end();
      }

      // Non-streaming response (JSON)
      let result;
      if (fileBuffer) {
        result = await chatWithFile(inputQuery, fileBuffer, fileName, {
          conversationId: convId,
          level: selectedLevel
        });
      } else {
        result = await motifChat(inputQuery, {
          conversationId: convId,
          level: selectedLevel
        });
      }

      return res.json({
        status: true,
        result: {
          prompt: inputQuery,
          level: selectedLevel,
          conversationId: result.conversationId,
          response: result.text,
          responseTime: `${Date.now() - startTime}ms`
        }
      });
    } catch (err) {
      logger.error(`[MOTIF-AI] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses chat Motif AI"
      });
    }
  }
};
