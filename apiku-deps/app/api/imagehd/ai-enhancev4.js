import axios from "axios"
import FormData from "form-data"
import logger from "../../src/utils/logger.js"

const PAGE_URL = "https://www.iloveimg.com/upscale-image"
const SERVERS = [
  "api1g.iloveimg.com",
  "api2g.iloveimg.com",
  "api8g.iloveimg.com",
  "api9g.iloveimg.com",
  "api10g.iloveimg.com",
  "api11g.iloveimg.com",
  "api12g.iloveimg.com",
  "api13g.iloveimg.com",
  "api14g.iloveimg.com",
  "api15g.iloveimg.com",
  "api16g.iloveimg.com",
  "api17g.iloveimg.com",
  "api18g.iloveimg.com",
  "api19g.iloveimg.com",
  "api20g.iloveimg.com",
  "api21g.iloveimg.com",
  "api22g.iloveimg.com",
  "api25g.iloveimg.com",
  "api26g.iloveimg.com",
  "api27g.iloveimg.com",
  "api28g.iloveimg.com",
  "api29g.iloveimg.com",
  "api30g.iloveimg.com",
  "api31g.iloveimg.com",
  "api32g.iloveimg.com",
  "api33g.iloveimg.com",
  "api34g.iloveimg.com",
]

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

async function getSession() {
  const { data: html } = await axios.get(PAGE_URL, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
    timeout: 15000,
  })
  const token = html.match(/"token":"([^"]+)"/)
  const taskIdMatch = html.match(/ilovepdfConfig\.taskId\s*=\s*'([^']+)'/)
  if (!token || !taskIdMatch) {
    throw new Error("Gagal mendapatkan session: token=" + !!token + " taskId=" + !!taskIdMatch)
  }
  return { token: token[1], taskId: taskIdMatch[1] }
}

async function uploadImage(server, token, taskId, buffer, filename) {
  const form = new FormData()
  form.append("task", taskId)
  form.append("preview", "1")
  form.append("v", "1.0")
  form.append("file", buffer, { filename, contentType: "image/jpeg" })

  const res = await axios.post(`https://${server}/v1/upload`, form, {
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_UA,
    },
    timeout: 60000,
    validateStatus: () => true,
  })

  if (res.status !== 200 || !res.data.server_filename) {
    throw new Error("Gagal upload (" + res.status + "): " + JSON.stringify(res.data))
  }
  return res.data.server_filename
}

async function upscaleImage(server, token, taskId, serverFilename, scale) {
  const form = new FormData()
  form.append("task", taskId)
  form.append("server_filename", serverFilename)
  form.append("scale", String(scale))

  const res = await axios.post(`https://${server}/v1/upscale`, form, {
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${token}`,
      "User-Agent": BROWSER_UA,
    },
    responseType: "arraybuffer",
    timeout: 120000,
    validateStatus: () => true,
  })

  if (res.status !== 200) {
    const msg = Buffer.from(res.data).toString("utf8")
    throw new Error(`Upscale failed (${res.status}): ${msg}`)
  }

  const contentType = res.headers["content-type"] || ""
  if (contentType.includes("json")) {
    const msg = Buffer.from(res.data).toString("utf8")
    throw new Error(`Upscale returned JSON: ${msg}`)
  }

  return Buffer.from(res.data)
}

async function downloadImage(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    headers: { "User-Agent": BROWSER_UA },
  })
  return Buffer.from(res.data)
}

export default {
  name: "AI Enhance HD v4",
  description: "Upscale 2x/4x — upload, tunggu, hasil",
  category: "Image HD",
  methods: ["GET", "POST"],
  params: ["url", "scale"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
      description: "URL gambar yang akan di-upscale",
    },
    scale: {
      type: "string",
      required: false,
      default: "4",
      enum: ["2", "4"],
      description: "Multiplier upscale (2x atau 4x)",
    },
  },

  async run(req, res) {
    try {
      const { url, scale = "4" } = { ...req.query, ...req.body }

      if (!url) {
        return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" })
      }

      const upscaleScale = scale === "2" ? 2 : 4
      logger.info(`[AI-ENHANCE-V4] Start | ip=${req.ip} | scale=${upscaleScale}x`)

      logger.info("[AI-ENHANCE-V4] Downloading image...")
      const imageBuffer = await downloadImage(url)
      const filename = `upscale-${Date.now()}.jpg`

      logger.info("[AI-ENHANCE-V4] Getting iLoveIMG session...")
      const { token, taskId } = await getSession()

      const server = SERVERS[Math.floor(Math.random() * SERVERS.length)]
      logger.info(`[AI-ENHANCE-V4] Uploading to ${server}...`)
      const serverFilename = await uploadImage(server, token, taskId, imageBuffer, filename)
      logger.info(`[AI-ENHANCE-V4] Uploaded | file=${serverFilename.substring(0, 30)}...`)

      await new Promise(r => setTimeout(r, 2000))

      logger.info(`[AI-ENHANCE-V4] Upscaling ${upscaleScale}x...`)
      const resultBuffer = await upscaleImage(server, token, taskId, serverFilename, upscaleScale)
      logger.info(`[AI-ENHANCE-V4] Done | size=${resultBuffer.length} bytes`)

      res.setHeader("Content-Type", "image/jpeg")
      res.setHeader("X-Enhance-Service", "iloveimg-v4")
      res.setHeader("X-Scale", String(upscaleScale))
      res.setHeader("X-Task-Id", taskId)

      return res.send(resultBuffer)
    } catch (err) {
      logger.error(`[AI-ENHANCE-V4] Error | ip=${req.ip} | ${err.message}`)

      if (err.message.includes("session")) {
        return res.status(502).json({ status: false, message: "Gagal mendapatkan session iLoveIMG" })
      }
      if (err.message.includes("upload")) {
        return res.status(502).json({ status: false, message: "Gagal upload gambar" })
      }

      return res.status(500).json({ status: false, message: err.message || "Gagal memproses" })
    }
  }
}
