import axios from 'axios'
import crypto from 'node:crypto'
import logger from "../../src/utils/logger.js"

const APP_ID = 'ai-seek'
const PKG = 'ai.chatbot.ask.chat.deep.seek.assistant.search.free'
const VER = '2.9.4-26071777'

const AVAILABLE_MODELS = [
  'deepseek/deepseek-chat',
  'google/gemini-2.5-flash-lite',
  'qwen/qwen-coder-32b'
]

const VISION_MODELS = [
  'google/gemini-2.5-flash-lite'
]

function uuidv7() {
  const ts = BigInt(Date.now()).toString(16).padStart(12, '0')
  const rnd = crypto.randomBytes(10).toString('hex')
  return `${ts.slice(0, 8)}-${ts.slice(8, 12)}-7${rnd.slice(1, 4)}-${rnd.slice(4, 8)}-${rnd.slice(8, 20)}`
}

function getDevInfo(aid) {
  return `appIdentifier=${PKG};appVersion=${VER};deviceType=android;deviceCountry=ID;appCountry=id;local=id_ID;language=id;timezone=Asia/Makassar;brand=Infinix;model=Infinix%20X6833B;androidId=${aid}`
}

async function getSession() {
  const aid = crypto.randomBytes(8).toString('hex')
  const sec = crypto.randomUUID()

  const { data } = await axios.post('https://saas.castbox.fm/auth/api/v1/tokens/provider/secret', { secret: sec }, {
    headers: {
      'User-Agent': 'Zyvor/1.0',
      'Content-Type': 'application/json',
      'x-app-id': APP_ID
    },
    timeout: 15000
  })

  const token = data?.data?.token
  const uid = data?.data?.uid
  if (!token || !uid) throw new Error('Auth failed')

  await axios.post('https://saas.castbox.fm/device/api/v1/devices', {
    androidId: aid,
    appIdentifier: PKG,
    appVersion: VER,
    brand: 'Infinix',
    deviceCountry: 'ID',
    deviceId: crypto.randomUUID(),
    deviceType: 'android',
    language: 'id',
    locale: 'id_ID',
    model: 'Neo X11',
    pushType: 'FCM',
    timezone: 'Asia/Makassar',
    uid,
    deviceToken: 'dpCJFZRhTTmTk_OIFoAG1i:APA91bHr4X9Dg9RpFJvlo9Cd23-OwK2Q3ifFtu5UZ-5WQo5MvohowARyMpYuG4fdLWu9syjIKU9j97ra_V8sPzhkLvmTw3B38KRIvTZ-QHj42UjNRu9BAUo',
    firebaseAppInstanceId: crypto.randomBytes(16).toString('hex')
  }, {
    headers: {
      'User-Agent': 'Zyvor/1.0',
      'x-app-id': APP_ID,
      'x-device-info': getDevInfo(aid),
      'x-access-token': token,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  }).catch(() => {})

  return { token, aid, uid }
}

async function uploadVisionImage(imgBuffer, ext = 'jpg', auth) {
  const { data } = await axios.get(`https://ai-seek.thebetter.ai/v4/token/generate_image_token?count=1&extension=${ext}`, {
    headers: {
      'x-app-id': APP_ID,
      'x-device-info': getDevInfo(auth.aid),
      'x-access-token': auth.token,
      'User-Agent': 'Zyvor/1.0'
    },
    timeout: 15000
  })

  const s3Key = data?.data?.imageS3KeyList?.[0]
  if (!s3Key) throw new Error('Gagal minta s3Key')
  return s3Key
}

async function askAISeek(prompt, auth, sessionId, model, imageS3Keys = []) {
  const payload = {
    sessionId: sessionId || uuidv7(),
    userMessageId: uuidv7(),
    aiMessageId: uuidv7(),
    model,
    text: prompt,
    restrictedType: 'FREE_USER',
    sessionType: 'NORMAL',
    imageS3Keys
  }

  const response = await axios.post('https://ai-seek.thebetter.ai/v4/chat/send', payload, {
    headers: {
      'Accept': 'text/event-stream',
      'Content-Type': 'application/json',
      'x-app-id': APP_ID,
      'x-device-info': getDevInfo(auth.aid),
      'x-access-token': auth.token,
      'User-Agent': 'Zyvor/1.0'
    },
    responseType: 'stream',
    timeout: 60000
  })

  return new Promise((resolve, reject) => {
    let text = ''
    let buf = ''

    response.data.on('data', chunk => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('data:')) {
          const s = trimmed.substring(5).trim()
          if (!s || s === '[DONE]') continue
          try {
            const p = JSON.parse(s)
            if (p.content) text += p.content
          } catch {}
        }
      }
    })

    response.data.on('end', () => resolve({ response: text.trim(), model, sessionId: payload.sessionId }))
    response.data.on('error', err => reject(err))
  })
}

export default {
  name: "AI Seek",
  description: "AI Seek multi-model chat (DeepSeek, Gemini, Qwen) with streaming, vision, conversation memory",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["message", "model", "session_id", "image_url"],
  paramsSchema: {
    message: { type: "string", required: true, description: "Pertanyaan/pesan untuk AI" },
    model: { type: "string", required: false, default: "google/gemini-2.5-flash-lite", enum: ["deepseek/deepseek-chat", "google/gemini-2.5-flash-lite", "qwen/qwen-coder-32b"], description: "Model AI" },
    session_id: { type: "string", required: false, description: "ID sesi untuk memori percakapan (opsional, auto-generate jika kosong)" },
    image_url: { type: "string", required: false, description: "URL gambar untuk vision (opsional, model vision only)" }
  },

  async run(req, res) {
    try {
      const { message, model = "google/gemini-2.5-flash-lite", session_id, image_url } = { ...req.query, ...req.body }

      if (!AVAILABLE_MODELS.includes(model)) {
        return res.status(400).json({ status: false, message: `Model tidak tersedia. Pilihan: ${AVAILABLE_MODELS.join(', ')}` })
      }

      if (!message) return res.status(400).json({ status: false, message: "Parameter 'message' wajib" })

      const auth = await getSession()
      let imageS3Keys = []

      if (image_url) {
        if (!VISION_MODELS.includes(model)) {
          return res.status(400).json({ status: false, message: `Model ${model} tidak support vision. Gunakan: ${VISION_MODELS.join(', ')}` })
        }
        try {
          const imgRes = await axios.get(image_url, { responseType: 'arraybuffer', timeout: 30000 })
          const ext = (image_url.split('.').pop() || 'jpg').split('?')[0]
          const s3Key = await uploadVisionImage(Buffer.from(imgRes.data), ext, auth)
          imageS3Keys = [s3Key]
        } catch (e) {
          logger.warn(`[AISEEK] Vision upload failed: ${e.message}`)
        }
      }

      const result = await askAISeek(message, auth, session_id, model, imageS3Keys)
      return res.json({ status: true, result: { text: result.response, model: result.model, session_id: result.sessionId } })

    } catch (err) {
      logger.error(`[AISEEK] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || "AI Seek request failed" })
    }
  }
}