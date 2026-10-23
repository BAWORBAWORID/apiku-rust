import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import os from 'os'
import sharp from 'sharp'
import axios from 'axios'
import logger from "../../src/utils/logger.js"

const API = 'https://a.android.api.remini.ai/v1/mobile'
const ORACLE = 'https://api.remini.ai/v1/mobile/oracle'

function genId() {
  const a = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  return { android_id: a, aaid: crypto.randomUUID(), backup_persistent_id: a + '_com.bigwinepot.nwdn.international', non_backup_persistent_id: crypto.randomUUID() }
}

let dev = genId()
let token = null

function bh(extra) {
  return {
    'bsp-id': 'com.bigwinepot.nwdn.international.android',
    'build-number': '202514479', 'build-version': '3.7.1020',
    'country': 'US', 'device-manufacturer': 'Samsung', 'device-model': 'SM-G998B',
    'device-type': '6.8', 'language': 'en', 'locale': 'en_US',
    'os-version': '33', 'platform': 'Android', 'timezone': 'America/New_York',
    'android-id': dev.android_id, 'aaid': dev.aaid,
    'accept-encoding': 'gzip', 'user-agent': 'okhttp/4.12.0',
    ...(extra || {}),
  }
}

function ah(extra) {
  const h = bh(extra)
  if (token) h['identity-token'] = token
  return h
}

async function auth() {
  dev = genId()
  const r = await fetch(ORACLE + '/setup', {
    headers: bh({
      'first-install-timestamp': Math.floor(Date.now()/1000)+'E9',
      'backup-persistent-id': dev.backup_persistent_id,
      'non-backup-persistent-id': dev.non_backup_persistent_id,
      'environment': 'Production', 'settings-response-version': 'v2',
      'is-app-running-in-background': 'false', 'is-old-user': 'true',
      'app-set-id': 'd44bd45a-a45d-4470-9674-7348a8e3fb71',
    })
  })
  const d = await r.json()
  token = d.settings && d.settings.__identity__ && d.settings.__identity__.token
  if (!token) throw new Error('No token')
  await fetch(API + '/users/@me', { headers: ah() })
}

async function reminiHD(imagePath) {
  if (!fs.existsSync(imagePath)) throw new Error('File not found')
  await auth()
  const ext = path.extname(imagePath).toLowerCase()
  const mm = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.bmp':'image/bmp' }
  const mime = mm[ext] || 'image/jpeg'
  const cont = fs.readFileSync(imagePath)
  const md5 = crypto.createHash('md5').update(cont).digest('base64')
  let meta = { size: fs.statSync(imagePath).size }
  try { const m = await sharp(imagePath).metadata(); meta.width=m.width; meta.height=m.height } catch {}

  const taskR = await fetch(API + '/tasks', {
    method: 'POST',
    headers: ah({'content-type':'application/json; charset=UTF-8'}),
    body: JSON.stringify({
      image_content_type: mime, image_md5: md5,
      feature: { type: 'enhance', models: [] },
      metadata: meta,
      options: { high_quality_output: false, save_input: true },
    })
  })
  const taskD = await taskR.json()
  if (!taskD.task_id || !taskD.upload_url || !taskD.upload_headers) throw new Error('Task response invalid')

  const upRes = await axios.put(taskD.upload_url, cont, {
    headers: { ...taskD.upload_headers, 'Content-Length': String(cont.length), 'User-Agent': 'okhttp/4.12.0' },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 60000,
  })

  await axios.post(API + '/tasks/' + taskD.task_id + '/process', null, {
    headers: ah({'content-length':'0'}),
    timeout: 30000,
  })

  let cdnUrl = null
  for (let i=0; i<40; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const pr = await axios.get(API + '/tasks/' + taskD.task_id, {
      headers: ah(),
      timeout: 30000,
    })
    const pd = pr.data
    if (pd.status === 'completed') {
      const outs = pd.result && pd.result.outputs
      if (outs && Array.isArray(outs) && outs[0] && outs[0].url) cdnUrl = outs[0].url
      break
    }
    if (pd.status === 'failed' || pd.status === 'error') throw new Error('Task failed')
  }
  if (!cdnUrl) throw new Error('No output URL')
  return { url: cdnUrl }
}

function cleanup(...files) {
  for (const f of files) {
    try { if (f && fs.existsSync(f)) fs.unlinkSync(f) } catch {}
  }
}

export default {
  name: "Remini HD",
  description: "Enhance gambar (HD upscale 2-4x) — output langsung berupa gambar",
  category: "Image HD",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
      description: "URL gambar (http/https)",
      example: "https://example.com/image.jpg"
    }
  },

  async run(req, res) {
    let tmpFile = null
    try {
      const { url = "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg" } = { ...req.query, ...req.body }

      if (!url) {
        return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" })
      }

      const dlRes = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 })
      const ext = path.extname(new URL(url).pathname) || '.jpg'
      const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.bmp'].includes(ext.toLowerCase()) ? ext.toLowerCase() : '.jpg'
      tmpFile = path.join(os.tmpdir(), `remini_${Date.now()}${safeExt}`)
      fs.writeFileSync(tmpFile, Buffer.from(dlRes.data))

      const { url: outUrl } = await reminiHD(tmpFile)

      const outRes = await axios.get(outUrl, { responseType: "arraybuffer", timeout: 60000 })
      const buffer = Buffer.from(outRes.data)

      logger.info(`[REMINI] ${fileSize(buffer.length)} | src=${url.slice(0, 60)}`)

      res.setHeader("Content-Type", "image/jpeg")
      res.setHeader("Content-Length", String(buffer.length))
      res.setHeader("X-Enhance-Service", "remini-ai")
      return res.send(buffer)
    } catch (err) {
      logger.error(`[REMINI] Error: ${err.message}${err.cause ? ` | cause=${err.cause.code || err.cause.message}` : ''}`)
      return res.status(500).json({ status: false, message: err.message + (err.cause ? ` | ${err.cause.code || err.cause.message}` : '') })
    } finally {
      cleanup(tmpFile)
    }
  }
}

function fileSize(n) {
  return n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : (n / 1024).toFixed(1) + 'KB'
}