import axios from 'axios'
import crypto from 'node:crypto'
import logger from "../../src/utils/logger.js"

const APP_ID = 'ai-seek'
const PKG = 'ai.chatbot.ask.chat.deep.seek.assistant.search.free'
const VER = '2.9.4-26071777'

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

async function generateImageAISeek(prompt, auth) {
  const payload = {
    sessionId: uuidv7(),
    userMessageId: uuidv7(),
    aiMessageId: uuidv7(),
    model: 'image-generation-guru',
    text: prompt,
    restrictedType: 'FREE_USER',
    sessionType: 'IMAGE'
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
    let text = '', imgs = [], buf = ''

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
            if (Array.isArray(p.images)) imgs.push(...p.images)
          } catch {}
        }
      }
    })

    response.data.on('end', () => resolve({ prompt, images: imgs, caption: text.trim() }))
    response.data.on('error', err => reject(err))
  })
}

export default {
  name: "AI Seek Image",
  description: "AI image generation (text-to-image)",
  category: "Image AI",
  methods: ["GET", "POST"],
  params: ["prompt"],
  paramsSchema: {
    prompt: { type: "string", required: true, description: "Prompt untuk generate gambar", example: "kucing lucu" }
  },

  async run(req, res) {
    try {
      const { prompt } = { ...req.query, ...req.body }

      if (!prompt) return res.status(400).json({ status: false, message: "Parameter 'prompt' wajib" })

      const auth = await getSession()
      const result = await generateImageAISeek(prompt, auth)
      return res.json({ status: true, result })

    } catch (err) {
      logger.error(`[AISEEK-IMAGE] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || "AI Seek Image request failed" })
    }
  }
}