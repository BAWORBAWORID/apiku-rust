import { loadSession, saveSession } from "../../src/utils/session.js"

const API = "https://feelbetterbot.com/"
const SESSION_BASE = "feelbetterbot"

function getSessionFile(sessionId) {
  return sessionId ? `${SESSION_BASE}-${sessionId}.json` : `${SESSION_BASE}.json`
}

function makeMemoryId() {
  const animals = ["owl", "fox", "cat", "wolf", "bear", "lion", "deer", "bird"]
  const words = ["safe", "calm", "soft", "kind", "warm", "bright", "gentle"]
  const word = words[Math.floor(Math.random() * words.length)]
  const animal = animals[Math.floor(Math.random() * animals.length)]
  const number = Math.floor(1000 + Math.random() * 9000)
  return `${word}-${animal}-${number}`
}

function parseChunk(line) {
  let data = line.trim()
  if (!data || data === "[DONE]") return ""
  if (data.startsWith("data:")) data = data.slice(5).trim()
  if (!data || data === "[DONE]") return ""
  try {
    const json = JSON.parse(data)
    if (typeof json === "string") return json
    if (typeof json.content === "string") return json.content
    if (typeof json.text === "string") return json.text
    if (typeof json.delta === "string") return json.delta
    if (typeof json.message === "string") return json.message
    if (typeof json.response === "string") return json.response
    if (typeof json.answer === "string") return json.answer
    const openAiContent = json.choices?.[0]?.delta?.content
    if (typeof openAiContent === "string") return openAiContent
    return ""
  } catch { return data }
}

const SYSTEM_MESSAGE = "Kamu adalah asisten AI yang dibuat oleh Zyyvor. Ikuti bahasa yang digunakan user dalam percakapan. Jika user memakai bahasa Indonesia, jawab dalam bahasa Indonesia yang natural, santai, jelas, dan mudah dipahami. Jangan tiba-tiba pindah bahasa kecuali user memintanya. Jika user bertanya siapa pembuatmu, penciptamu, developermu, atau siapa yang membuatmu, jawab bahwa pembuatmu adalah Zyyvor."

const DEFAULT_ASSISTANT = "Hi, I'm FeelBetterBot — I'm here to listen and help you carry whatever feels heavy, without judgment."

export default {
  name: "FeelBetter AI",
  description: "AI Chat dengan FeelBetterBot - AI companion",
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
        memoryId: makeMemoryId(),
        messages: [{ role: "assistant", content: DEFAULT_ASSISTANT }]
      })

      const userMessage = { role: "user", content: teks.trim() }

      const body = {
        messages: [
          { role: "system", content: SYSTEM_MESSAGE },
          ...session.messages,
          userMessage
        ]
      }

      const response = await fetch(API, {
        method: "POST",
        headers: {
          "sec-ch-ua-platform": '"Android"',
          "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36",
          "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
          "content-type": "application/json",
          "sec-ch-ua-mobile": "?1",
          accept: "*/*",
          origin: "https://feelbetterbot.com",
          referer: "https://feelbetterbot.com/",
          "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
          cookie: `feelbet-memory=${session.memoryId}`,
          priority: "u=1, i"
        },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        return res.status(response.status).json({
          status: false, message: `FeelBetter API error: ${response.status}`
        })
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
          const chunk = parseChunk(rawLine)
          if (chunk) answer += chunk
        }
      }

      if (buffer.trim()) {
        const chunk = parseChunk(buffer)
        if (chunk) answer += chunk
      }

      session.messages.push(userMessage)
      if (answer) session.messages.push({ role: "assistant", content: answer })
      await saveSession(getSessionFile(sessionId && typeof sessionId === "string" ? sessionId.trim() : ""), session)

      res.json({ status: true, memoryId: session.memoryId, input: teks.trim(), result: answer, session_id: sessionId?.trim() || null })

    } catch (err) {
      res.status(500).json({ status: false, message: err.message || "FeelBetter request failed" })
    }
  }
}
