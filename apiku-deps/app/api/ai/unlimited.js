import crypto from "node:crypto"
import { loadSession, saveSession } from "../../src/utils/session.js"

const API = "https://app.unlimitedai.chat/api/chat"
const SESSION_BASE = "unlimitedai"

function getSessionFile(sessionId) {
  return sessionId ? `${SESSION_BASE}-${sessionId}.json` : `${SESSION_BASE}.json`
}

function makeIndonesianPrompt(text) {
  return `Kamu wajib menjawab hanya dalam bahasa Indonesia.\nAbaikan bahasa dari pertanyaan user.\nTerjemahkan maksud user bila perlu, lalu jawab dalam bahasa Indonesia.\nDilarang menjawab dalam bahasa Jerman, Inggris, Spanyol, Prancis, atau bahasa lain.\n\nPertanyaan:\n${text}`
}

function parseSetCookie(headers) {
  const result = {}
  const setCookie = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : headers.get("set-cookie") ? [headers.get("set-cookie")] : []
  for (const item of setCookie) {
    const first = item.split(";")[0]
    const index = first.indexOf("=")
    if (index !== -1) result[first.slice(0, index).trim()] = first.slice(index + 1).trim()
  }
  return result
}

function buildCookie(session) {
  const cookies = { NEXT_LOCALE: "id", u_device_id: session.deviceId, home_chat_id: session.chatId, ...session.cookies }
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
}

export default {
  name: "Unlimited AI Chat",
  description: "AI Chat dengan UnlimitedAI.chat - dipaksa menjawab dalam Bahasa Indonesia",
  category: "AI Chat",
  methods: ["GET"],
  params: ["teks", "session"],

  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Pertanyaan atau perintah untuk AI",
    },
    session: {
      type: "string",
      required: false,
      description: "ID sesi kustom untuk percakapan terpisah (opsional)",
    },
  },

  async run(req, res) {
    try {
      const { teks, session: sessionId } = req.query

      if (!teks || typeof teks !== "string" || teks.trim().length === 0) {
        return res.status(400).json({ status: false, message: "Parameter 'teks' wajib diisi" })
      }

      const session = await loadSession(getSessionFile(sessionId && typeof sessionId === "string" ? sessionId.trim() : ""), {
        chatId: crypto.randomUUID(),
        deviceId: crypto.randomUUID(),
        cookies: {},
        messages: []
      })

      const createdAt = new Date().toISOString()
      const userMessageId = crypto.randomUUID()
      const assistantMessageId = crypto.randomUUID()
      const prompt = makeIndonesianPrompt(teks.trim())

      const userMessage = { id: userMessageId, role: "user", content: prompt, parts: [{ type: "text", text: prompt }], createdAt }
      const assistantPlaceholder = { id: assistantMessageId, role: "assistant", content: "", parts: [{ type: "text", text: "" }], createdAt }

      const body = {
        chatId: session.chatId,
        messages: [...session.messages, userMessage, assistantPlaceholder],
        selectedChatModel: "chat-model-reasoning",
        selectedCharacter: null,
        selectedStory: null,
        deviceId: session.deviceId,
        locale: "id"
      }

      const response = await fetch(API, {
        method: "POST",
        headers: {
          "sec-ch-ua-platform": '"Android"',
          "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36",
          "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
          "content-type": "application/json",
          "sec-ch-ua-mobile": "?1",
          "x-next-intl-locale": "id",
          accept: "*/*",
          origin: "https://app.unlimitedai.chat",
          referer: "https://app.unlimitedai.chat/id",
          "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
          cookie: buildCookie(session),
          priority: "u=1, i"
        },
        body: JSON.stringify(body)
      })

      const newCookies = parseSetCookie(response.headers)
      session.cookies = { ...session.cookies, ...newCookies }

      if (!response.ok) {
        await saveSession(getSessionFile(sessionId && typeof sessionId === "string" ? sessionId.trim() : ""), session)
        return res.status(response.status).json({ status: false, message: `UnlimitedAI error: ${response.status}` })
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = "", answer = ""

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""
        for (const rawLine of lines) {
          const line = rawLine.trim()
          if (!line) continue
          try {
            const json = JSON.parse(line)
            if (json.type === "delta" && typeof json.delta === "string") answer += json.delta
          } catch {}
        }
      }

      session.messages.push(userMessage, { ...assistantPlaceholder, content: answer, parts: [{ type: "text", text: answer }] })
      await saveSession(getSessionFile(sessionId && typeof sessionId === "string" ? sessionId.trim() : ""), session)

      return res.json({
        status: true,
        data: {
          chatId: session.chatId,
          input: teks.trim(),
          result: answer,
          session_id: sessionId?.trim() || null
        }
      })

    } catch (err) {
      res.status(500).json({ status: false, message: err.message || "UnlimitedAI request failed" })
    }
  }
}
