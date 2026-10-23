/**
 * GPT-4o-mini Chat API
 * Provider: aichatting.net
 * Parameter: teks, image (optional)
 * Support kirim gambar via URL
 */

import crypto from "node:crypto"
import { loadSession, saveSession } from "../../src/utils/session.js"

const API = "https://aga-api.aichatting.net/aigc/chat/v2/professional/stream"
const SESSION_BASE = "aichatting-gpt4o-mini"
const MODEL = "gpt-4o-mini"

const PUBLIC_KEY_BASE64 =
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDCAdf/EyIbLBxjGqmh7qLU6/CPCzru+75+82OSPZ+nf4BFvg88drpZ6KigNW0J8TNgxe6Yms1irCZNVDyu+RXsl4y/7c2KOHc4OGTzHB5fUMiMasFUvcEs2P70e6yA/sKHZfBLG1XPhlb84Ibs3nhD3W5e2SuC+4EuVkaqzN08LQIDAQAB"

function makeRandomIP() {
  return `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
}

function getRandomUserAgent() {
  const versions = ["145", "146", "147", "148", "149"]
  const v = versions[Math.floor(Math.random() * versions.length)]
  return `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Mobile Safari/537.36`
}

function makePublicKey() {
  const wrapped = PUBLIC_KEY_BASE64.match(/.{1,64}/g).join("\n")
  return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----`
}

function encryptVisitorId(visitorId) {
  const encrypted = crypto.publicEncrypt(
    { key: makePublicKey(), padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(visitorId)
  )
  return encrypted.toString("base64")
}

function makeVisitorId() {
  return crypto.randomBytes(16).toString("hex")
}

function makeConversationId() {
  return crypto.randomInt(10000000, 99999999)
}

async function urlToDataUrl(imageUrl, userAgent) {
  const response = await fetch(imageUrl, {
    headers: {
      "user-agent": userAgent,
      accept: "image/jpeg,image/png,*/*;q=0.8",
      referer: "https://www.google.com/",
    },
  })
  if (!response.ok) throw new Error(`Gagal download image: ${response.status}`)
  const contentType = response.headers.get("content-type") || ""
  const type = contentType.split(";")[0].trim().toLowerCase()
  const mime = (type === "image/jpeg" || type === "image/png") ? type : "image/jpeg"
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  return `data:${mime};base64,${buffer.toString("base64")}`
}

function createUserContent(prompt, imageDataUrl = "") {
  const content = [{ type: "text", text: prompt }]
  if (imageDataUrl) content.push({ type: "image_url", image_url: { url: imageDataUrl } })
  return content
}

function trimMessages(messages, max = 12) {
  return messages.slice(-max)
}

function cleanAnswer(text) {
  return String(text || "")
    .replace(/=-=\s*--/g, " ")
    .replace(/-=--=-\s*-+/g, " ")
    .replace(/-=-/g, " ")
    .replace(/--@DONE@--/g, "")
    .replace(/--/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function createNewSession() {
  const visitorId = makeVisitorId()
  return {
    visitorId,
    vtoken: encryptVisitorId(visitorId),
    conversationId: makeConversationId(),
    ip: makeRandomIP(),
    userAgent: getRandomUserAgent(),
    messages: [],
  }
}

function getSessionFile(sessionId) {
  return sessionId ? `${SESSION_BASE}-${sessionId}.json` : `${SESSION_BASE}.json`
}

async function ensureSession(sessionId) {
  const file = getSessionFile(sessionId)
  const session = await loadSession(file, null)
  if (session && session.visitorId) {
    if (!session.ip) session.ip = makeRandomIP()
    if (!session.userAgent) session.userAgent = getRandomUserAgent()
    return session
  }
  const fresh = createNewSession()
  await saveSession(file, fresh)
  return fresh
}

export default {
  name: "GPT-4o-mini",
  description: "OpenAI GPT-4o-mini AI Chat. Support input gambar via URL.",
  category: "AI Chat",
  methods: ["GET"],
  params: ["teks", "image", "session"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Pertanyaan atau perintah untuk AI",
    },
    image: {
      type: "string",
      required: false,
      description: "URL gambar (opsional, untuk analisis visual)",
    },
    session: {
      type: "string",
      required: false,
      description: "ID sesi kustom untuk percakapan terpisah (opsional)",
    },
  },
  async run(req, res) {
    try {
      const { teks, image, session: reqSession } = req.query
      const sessionId = reqSession && typeof reqSession === "string" ? reqSession.trim() : ""

      if (!teks || typeof teks !== "string" || teks.trim().length === 0) {
        return res.status(400).json({ status: false, message: "Parameter 'teks' wajib diisi" })
      }

      let session = await ensureSession(sessionId)
      let imageDataUrl = ""

      if (image && typeof image === "string" && image.trim()) {
        try {
          imageDataUrl = await urlToDataUrl(image.trim(), session.userAgent)
        } catch {
          return res.status(400).json({ status: false, message: "Gagal memproses gambar. Pastikan URL valid dan format JPG/PNG." })
        }
      }

      const userMessage = {
        role: "user",
        content: createUserContent(teks.trim(), imageDataUrl),
      }

      let answer = ""
      let fetchSuccess = false;

      // Auto-Retry system untuk bypass Limit 401
      for (let attempt = 1; attempt <= 2; attempt++) {
        const body = {
          spaceHandle: true,
          roleId: 0,
          messages: [...trimMessages(session.messages), userMessage],
          conversationId: session.conversationId,
          model: MODEL,
        }

        const headers = {
          "sec-ch-ua-platform": '"Android"',
          lang: "en",
          "sec-ch-ua-mobile": "?1",
          vtoken: session.vtoken,
          source: "web",
          "user-agent": session.userAgent,
          "X-Forwarded-For": session.ip,
          "X-Real-IP": session.ip,
          "Client-IP": session.ip,
          accept: "text/event-stream,application/json, text/event-stream",
          "content-type": "application/json",
          origin: "https://www.aichatting.net",
          referer: "https://www.aichatting.net/",
          "sec-fetch-site": "same-site",
          "sec-fetch-mode": "cors",
          "sec-fetch-dest": "empty",
          "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
          priority: "u=1, i",
        }

        const response = await fetch(API, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          const text = await response.text().catch(() => "")
          if (response.status === 401 && attempt === 1) {
            // Jika limit harian tercapai, hapus sesi lama dan buat identitas palsu baru
            session = createNewSession()
            await saveSession(getSessionFile(sessionId), session)
            continue
          }
          
          if (attempt === 2 || response.status !== 401) {
            return res.status(response.status).json({
              status: false,
              message: `AIChatting API error: ${response.status}${text ? ` — ${text}` : ""}`,
            })
          }
        }

        if (!response.body) {
          if (attempt === 1) continue;
          return res.status(502).json({ status: false, message: "Response body kosong" })
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        answer = ""

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split(/\r?\n/)
          buffer = lines.pop() || ""
          for (const rawLine of lines) {
            const line = rawLine.trim()
            if (!line.startsWith("data:")) continue
            const data = line.slice(5)
            if (!data.trim()) continue
            if (data.includes("--@DONE@--")) continue
            answer += data
          }
        }

        answer = cleanAnswer(answer)
        if (answer) {
          fetchSuccess = true;
          break;
        } else if (attempt === 1) {
           // Jika jawaban kosong (shadow-banned limit), buat sesi baru
           session = createNewSession()
           await saveSession(getSessionFile(sessionId), session)
        }
      }

      if (fetchSuccess) {
        session.messages.push(userMessage)
        session.messages.push({
          role: "assistant",
          content: [{ type: "text", text: answer }],
        })
        session.messages = trimMessages(session.messages, 20)
        await saveSession(getSessionFile(sessionId), session)
      }

      res.json({
        status: Boolean(answer),
        model: MODEL,
        input: teks.trim(),
        result: answer || "Tidak ada respons dari AI",
        image: image?.trim() || null,
        session_id: sessionId || null,
      })
    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "GPT-4o-mini request failed",
      })
    }
  },
}
