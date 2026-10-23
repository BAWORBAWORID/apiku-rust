import crypto from "node:crypto"
import { loadSession, saveSession } from "../../src/utils/session.js"

const SESSION_BASE = "chatgpt-android"

const BASE = "https://android.chat.openai.com/backend-anon"
const UA = "ChatGPT/1.2026.181 (Android 16; Neo/1.0; build 2222222)"
const DEVICE_TIER = "upper_mid"

function getSessionFile(sessionId) {
  return sessionId ? `${SESSION_BASE}-${sessionId}.json` : `${SESSION_BASE}.json`
}

function parseCookies(setCookies) {
  const map = {}
  const list = typeof setCookies?.getSetCookie === "function"
    ? setCookies.getSetCookie()
    : (setCookies?.get?.("set-cookie") ? [setCookies.get("set-cookie")] : [])
  for (const c of list) {
    const [pair] = c.split(";")
    const idx = pair.indexOf("=")
    if (idx > 0) {
      const name = pair.slice(0, idx).trim()
      const value = pair.slice(idx + 1).trim()
      if (name && value) map[name] = value
    }
  }
  return map
}

function cleanSpecialTags(text) {
  if (!text) return ""
  text = text.replace(/\ue200entity\ue202([^\ue201]+)\ue201/g, (match, p1) => {
    try {
      const arr = JSON.parse(p1)
      return arr[1] || arr[0] || ""
    } catch {
      return ""
    }
  })
  text = text.replace(/\ue200[^\ue201]*\ue201/g, "")
  return text.trim()
}

async function getAuth() {
  const deviceId = crypto.randomUUID()
  const headers = {
    "User-Agent": UA,
    "OAI-Package-Name": "com.openai.chatgpt",
    "OAI-Client-Type": "android",
    "OAI-Device-Id": deviceId,
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8",
    "X-Device-Tier": DEVICE_TIER,
    "X-OpenAI-Target-Path": "/backend-anon/sentinel/chat-requirements",
    "ChatGPT-Account-Id": "default",
    "ChatGPT-Residency-Region": "no_constraint",
    "Accept": "application/json",
    "Content-Type": "application/json"
  }

  const res = await fetch(`${BASE}/sentinel/chat-requirements`, {
    method: "POST",
    headers,
    body: "{}"
  })

  if (!res.ok) {
    throw new Error(`chat-requirements HTTP ${res.status}`)
  }

  const data = await res.json().catch(() => ({}))
  const cookies = parseCookies(res.headers)
  let oaiSc = cookies["oai-sc"]
  if (!oaiSc && data.token) {
    oaiSc = `0${data.token}`
  }

  return {
    cookie: oaiSc ? `oai-sc=${oaiSc}; ${Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")}` : "",
    deviceId,
    parentMessageId: crypto.randomUUID()
  }
}

async function chatCompletion(prompt, auth, chatId = null) {
  if (!auth.deviceId) auth.deviceId = crypto.randomUUID()
  if (!auth.parentMessageId) auth.parentMessageId = crypto.randomUUID()

  const currentMessageId = crypto.randomUUID()
  const parentMessageId = auth.parentMessageId

  const headers = {
    "User-Agent": UA,
    "OAI-Package-Name": "com.openai.chatgpt",
    "OAI-Client-Type": "android",
    "OAI-Device-Id": auth.deviceId,
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8",
    "X-Device-Tier": DEVICE_TIER,
    "X-OpenAI-Target-Path": "/backend-anon/f/conversation",
    "ChatGPT-Account-Id": "default",
    "ChatGPT-Residency-Region": "no_constraint",
    "Content-Type": "application/json",
    "Accept": "text/event-stream",
    "Cookie": auth.cookie || "",
    "Origin": "https://chatgpt.com",
    "Referer": "https://chatgpt.com/"
  }

  const body = {
    action: "next",
    messages: [{
      id: currentMessageId,
      author: { role: "user" },
      content: { content_type: "text", parts: [prompt] },
      status: "finished_successfully",
      recipient: "all"
    }],
    model: "auto",
    history_and_training_disabled: false,
    fork_from_shared_post: false,
    enable_message_followups: true,
    force_use_sse: true,
    force_use_search: null,
    force_paragen: false,
    supported_encodings: ["v1"],
    supports_buffering: true,
    timezone: "Asia/Makassar",
    timezone_offset_min: -480,
    system_hints: [],
    is_onboarding_conversation: false,
    no_auth_ad_preferences: { personalization_enabled: true, history_enabled: true },
    client_prepare_state: "none",
    stream: true
  }

  if (chatId) {
    body.conversation_id = chatId
    body.parent_message_id = parentMessageId
  }

  const res = await fetch(`${BASE}/f/conversation`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    throw new Error(`conversation HTTP ${res.status}${errText ? ` — ${errText.slice(0, 200)}` : ""}`)
  }

  const decoder = new TextDecoder("utf-8")
  let buffer = ""
  let text = ""
  let finalChatId = chatId
  let lastPath = null
  let lastOp = null
  let assistantMessageId = null

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === "data: [DONE]") continue
      if (!trimmed.startsWith("data: ")) continue

      try {
        const data = JSON.parse(trimmed.slice(6))
        if (data.conversation_id) finalChatId = data.conversation_id
        if (data.p !== undefined) lastPath = data.p
        if (data.o !== undefined) lastOp = data.o

        if (lastOp === "add" && data.v?.message?.author?.role === "assistant") {
          assistantMessageId = data.v.message.id
          const parts = data.v.message.content?.parts
          if (parts && parts[0]) text = parts[0]
        } else if (lastOp === "patch" && Array.isArray(data.v)) {
          for (const op of data.v) {
            if (op.o === "append" && op.p?.startsWith("/message/content/parts/")) {
              text += op.v || ""
            }
          }
        } else if (lastOp === "append" && lastPath?.startsWith("/message/content/parts/") && typeof data.v === "string") {
          text += data.v
        }
      } catch {}
    }
  }

  if (assistantMessageId) auth.parentMessageId = assistantMessageId

  return {
    response: cleanSpecialTags(text),
    chatId: finalChatId,
    messageId: assistantMessageId,
    auth
  }
}

export default {
  name: "ChatGPT Android App",
  description: "ChatGPT via official Android app API (model auto, multi-turn dengan session_id)",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["teks", "session"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Pertanyaan atau pesan untuk ChatGPT"
    },
    session: {
      type: "string",
      required: false,
      description: "ID sesi untuk percakapan berkelanjutan (opsional)"
    }
  },

  async run(req, res) {
    try {
      const { teks, session: sessionId } = { ...req.query, ...req.body }

      if (!teks || typeof teks !== "string" || teks.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'teks' wajib diisi"
        })
      }

      const sessionFile = getSessionFile(sessionId?.trim() || "")
      const session = await loadSession(sessionFile, {})

      let auth = session.auth || null
      if (!auth) auth = await getAuth()

      const result = await chatCompletion(teks.trim(), auth, session.chatId || null)

      if (result.response) {
        session.auth = result.auth
        session.chatId = result.chatId
        await saveSession(sessionFile, session)
      }

      res.json({
        status: Boolean(result.response),
        input: teks.trim(),
        result: result.response || "Tidak ada respons dari ChatGPT",
        session_id: sessionId?.trim() || null
      })
    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "ChatGPT request failed"
      })
    }
  }
}
