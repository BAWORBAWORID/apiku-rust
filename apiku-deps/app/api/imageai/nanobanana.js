import logger from "../../src/utils/logger.js"

const BASE_URL = 'https://nanobanana.io'
const MAILTM = 'https://api.mail.tm'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Origin': BASE_URL,
  'Referer': `${BASE_URL}/create`,
}

async function getDomains() {
  const res = await fetch(`${MAILTM}/domains?page=1`)
  const data = await res.json()
  const domains = data['hydra:member'] || data
  const domain = domains.find(d => d.isActive)?.domain || domains[0]?.domain
  if (!domain) throw new Error('No mail.tm domains available')
  return domain
}

async function tempMailCreate() {
  const domain = await getDomains()
  const local = Math.random().toString(36).slice(2, 9)
  const email = `${local}@${domain}`
  const password = Math.random().toString(36).slice(2, 10)

  const accRes = await fetch(`${MAILTM}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: email, password })
  })
  if (!accRes.ok) throw new Error(`mail.tm create failed: ${accRes.status}`)

  const tokRes = await fetch(`${MAILTM}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: email, password })
  })
  const tok = await tokRes.json()

  return { email, password, token: tok.token }
}

async function tempMailInbox(token) {
  const res = await fetch(`${MAILTM}/messages`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  return res.json()
}

async function tempMailDetail(token, msgId) {
  const res = await fetch(`${MAILTM}/messages/${msgId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  return res.json()
}

async function autoProvisionSession() {
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`, { headers: HEADERS })
  const csrfData = await csrfRes.json()
  const csrfCookies = (csrfRes.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ')
  const csrfToken = csrfData.csrfToken
  if (!csrfToken) throw new Error('Gagal dapat CSRF Token')

  const account = await tempMailCreate()

  await fetch(`${BASE_URL}/api/auth/magic-link`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json', Cookie: csrfCookies },
    body: JSON.stringify({ email: account.email })
  })

  let token = null
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 3000))
    const inbox = await tempMailInbox(account.token)
    if (inbox['hydra:member']?.length > 0) {
      const detail = await tempMailDetail(account.token, inbox['hydra:member'][0].id)
      const html = detail.html?.[0] || detail.text || ''
      const match = html.match(/token=([a-zA-Z0-9_\-\.]+)/i)
      if (match) { token = match[1]; break }
    }
  }

  if (!token) throw new Error('Timeout menunggu email verifikasi')

  const params = new URLSearchParams()
  params.append('token', token)
  params.append('csrfToken', csrfToken)
  params.append('json', 'true')

  const callbackRes = await fetch(`${BASE_URL}/api/auth/callback/magic-link`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: csrfCookies },
    body: params.toString(),
    redirect: 'manual'
  })

  const sessionCookies = (callbackRes.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ')
  return `${csrfCookies}; ${sessionCookies}`
}

async function generate(prompt, options = {}) {
  let cookie = options.cookie || null
  if (!cookie) cookie = await autoProvisionSession()

  const aspectRatio = options.aspectRatio || '1:1'
  const resolution = options.resolution || '1K'

  const createRes = await fetch(`${BASE_URL}/api/task/create`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      model: 'nano-banana',
      prompt: prompt.trim(),
      params: { aspect_ratio: aspectRatio, max_images: 1, resolution }
    })
  })
  const createData = await createRes.json()
  const predictionId = createData?.data?.predictionId || createData?.predictionId || createData?.data?.taskId
  if (!predictionId) throw new Error(createData?.message || 'Gagal membuat task')

  let result = []
  for (let i = 0; i < 35; i++) {
    await new Promise(r => setTimeout(r, 4000))
    const checkRes = await fetch(`${BASE_URL}/api/task/check`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ predictionId })
    })
    const check = await checkRes.json()
    const d = check?.data
    if (d?.result?.length > 0) { result = d.result; break }
    if (d?.state === 'failed') throw new Error(d.failMsg || 'Generasi gagal')
  }

  if (!result.length) throw new Error('Timeout menunggu hasil')

  const url = typeof result[0] === 'string' ? result[0] : result[0].url
  const imgRes = await fetch(url)
  if (!imgRes.ok) throw new Error('Gagal download gambar hasil')
  const arrayBuf = await imgRes.arrayBuffer()

  return { buffer: Buffer.from(arrayBuf), url }
}

export default {
  name: "Nano Banana AI",
  description: "Generate gambar AI — auto free credits, zero-login",
  category: "Image AI",
  methods: ["GET", "POST"],
  params: ["prompt", "ratio", "resolution"],
  paramsSchema: {
    prompt: { type: "string", required: true, description: "Deskripsi gambar", example: "a cute cat wearing sunglasses" },
    ratio: { type: "string", required: false, default: "1:1", description: "Aspect ratio (1:1, 16:9, 9:16, 4:3, 3:4)" },
    resolution: { type: "string", required: false, default: "1K", description: "Resolusi (1K, 2K)" }
  },

  async run(req, res) {
    try {
      const { prompt, ratio, resolution } = { ...req.query, ...req.body }
      if (!prompt) return res.status(400).json({ status: false, message: "Parameter 'prompt' wajib diisi" })

      logger.info(`[NanoBanana] Generating: "${prompt}"`)
      const { buffer, url } = await generate(prompt, { aspectRatio: ratio, resolution })

      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Content-Disposition', `inline; filename="nanobanana.png"`)
      res.setHeader('X-Source-URL', url)
      return res.send(buffer)
    } catch (err) {
      logger.error(`[NanoBanana] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || 'Gagal generate gambar' })
    }
  }
}
