/**
 * Cloud AI Chat - AI Chatbot Assistant
 * Base : https://play.google.com/store/apps/details?id=com.chatassistant.aichatbot.gp
 * Author : Neo
 * Support Streaming Chat, Conversation, WebSearch
 */

import axios from "axios"
import crypto from "crypto"
import https from "https"
const MODELS = [
  'BOLATU:claude-haiku-4-5-20251001'
]

const aesKey = "V7PbuImUgSzpo4Hx"
const aesIv = "yc0q2icx1oq4lijm"
const signSalt = "t6KeG6aKR5pm65oWn5aqS6LWE57O757ufS2V2aW4uWWFuZw"
const baseUrl = "https://api.aichatbotassistant.top"
const bundleId = "com.chatassistant.aichatbot.gp"

function encrypt(text) {
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(aesKey), Buffer.from(aesIv))
  return (cipher.update(text, 'utf8', 'hex') + cipher.final('hex')).toUpperCase()
}

function headers(id, ct = 'application/json') {
  return {
    'User-Agent': 'Neo/1.0',
    'DeviceId': id,
    'AppVersion': '1.0.2',
    'Accept-Encoding': 'gzip',
    'NetworkType': 'Other',
    'UserType': 'app_user',
    'Content-Type': ct,
    'Country': 'Hans',
    'Language': 'en',
    'DeviceType': 'android',
    'SysVersion': '14',
    'BundleId': bundleId,
    'Host': 'api.aichatbotassistant.top',
    'Connection': 'Keep-Alive'
  }
}

async function register(id) {
  try {
    await axios.post(`${baseUrl}/mb/createNewUser`, {
      deviceMac: id,
      bundleId,
      bundleVersion: "1.0.2"
    }, { headers: headers(id, 'application/json;charset=UTF-8') })
  } catch {}
}

async function cloudChat(question, { model = MODELS[0], deviceId = null, conversationId = "", needSearch = 0 } = {}) {
  if (!question) throw new Error('Question is required.')
  if (!MODELS.includes(model)) throw new Error(`Available models: ${MODELS.join(', ')}.`)

  deviceId = deviceId || crypto.randomUUID()
  await register(deviceId)

  const data = {
    question: question.replace(/\u00a0/g, ' '),
    conversationId,
    needSearch,
    bundle: bundleId,
    deviceMac: deviceId,
    timestamp: Math.floor(Date.now() / 1000),
    nonce: crypto.randomBytes(16).toString('hex'),
    aiVersion: model,
    userName: "Anonim"
  }

  const excludeKeys = ["language", "imageUrls", "tonePrompt", "userName", "needSearch"]
  const qs = Object.keys(data)
    .filter(k => !excludeKeys.includes(k))
    .sort()
    .map(k => `${k}=${data[k]}`)
    .join('&')
  data.signature = crypto.createHash('sha1').update(qs + signSalt).digest('hex')

  const res = await axios.post(`${baseUrl}/common/sse/chat`, {
    bundle: bundleId,
    security: encrypt(JSON.stringify(data))
  }, {
    headers: headers(deviceId),
    responseType: 'stream',
    timeout: 60000,
    httpsAgent: new https.Agent({ keepAlive: true })
  })

  return new Promise((resolve, reject) => {
    let text = '', buf = ''
    let convId = conversationId

    res.data.on('data', chunk => {
      buf += chunk.toString('utf8')
      const lines = buf.split('\n')
      buf = lines.pop()

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed === 'data: [DONE]') {
          res.data.destroy()
          resolve({ text: text.trim(), conversationId: convId, deviceId })
          return
        }
        if (trimmed.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(trimmed.slice(6).trim())
            if (parsed.data?.answer) {
              text += parsed.data.answer
            }
            if (parsed.data?.conversation_id) {
              convId = parsed.data.conversation_id
            }
          } catch {}
        }
      }
    })

    res.data.on('end', () => {
      resolve({ text: text.trim(), conversationId: convId, deviceId })
    })

    res.data.on('error', reject)
  })
}

export default {
  name: "Cloud AI Chat",
  description: "AI Chat — Support streaming, conversation, & web search. Model: Claude Haiku 4.5",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["teks", "needSearch", "conversationId"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Pertanyaan atau pesan untuk AI",
      example: "Halo, siapa kamu?",
      minLength: 1,
      maxLength: 10000
    },
    needSearch: {
      type: "boolean",
      required: true,
      default: false,
      enum: ["true","false"],
      description: "Aktifkan web search (true = aktif, false = nonaktif)",
      example: true
    },
    conversationId: {
      type: "string",
      required: false,
      description: "ID percakapan untuk multi-turn chat (opsional)",
      example: ""
    }
  },

  async run(req, res) {
    try {
      const { teks, needSearch, conversationId } = { ...req.query, ...req.body }

      if (!teks || typeof teks !== "string" || teks.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'teks' wajib diisi"
        })
      }

      const searchMode = needSearch === true || needSearch === "true" || needSearch === "1" || needSearch === 1 ? 1 : 0

      const result = await cloudChat(teks.trim(), {
        model: MODELS[0],
        needSearch: searchMode,
        conversationId: conversationId?.trim() || ""
      })

      res.json({
        status: true,
        input: teks.trim(),
        model: MODELS[0],
        webSearch: searchMode === 1,
        result: result.text,
        conversationId: result.conversationId,
        timestamp: Date.now()
      })

    } catch (err) {
      const errMsg = err.message || "Cloud AI request failed"
      res.status(500).json({
        status: false,
        message: errMsg,
        timestamp: Date.now()
      })
    }
  }
}
