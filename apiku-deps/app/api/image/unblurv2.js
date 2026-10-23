/**
 * Unblur Image v2 (PicWish AI)
 * GET/POST /api/image/unblurv2?url=https://example.com/blur.jpg
 *
 * AI unblur via PicWish (gw.aoscdn.com) — anonymous login → OSS upload → scale task → poll
 * Base: https://picwish.com/  |  Scraper: RinnScrape
 */

import axios from "axios"
import fs from "fs"
import path from "path"
import os from "os"
import crypto from "crypto"
import logger from "../../src/utils/logger.js"

const BASE_URL = "https://gw.aoscdn.com"
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"

const HEADERS = {
  "content-type": "application/json",
  origin: "https://picwish.com",
  referer: "https://picwish.com/unblur-image-portrait",
  "user-agent": UA,
}

function generateDeviceHash() {
  return crypto.randomBytes(16).toString("hex")
}

async function getPicwishToken() {
  const payload = {
    cli_os: "web",
    os_name: "web",
    os_version: "web",
    device_hash: generateDeviceHash(),
  }
  const { data } = await axios.post(
    `${BASE_URL}/base/passport/v2/login/anonymous?language=en&product_id=482&cli_os=web`,
    payload,
    { headers: HEADERS, timeout: 20000 }
  )
  if (data?.status !== 200) throw new Error(data?.message || "Gagal login anonymous")
  return `Bearer ${data.data.api_token}`
}

async function uploadToOss(token, filePath) {
  const filename = path.basename(filePath)
  const { data: authData } = await axios.post(
    `${BASE_URL}/app/picwish/authorizations/oss?product_id=482&language=en`,
    { filenames: [filename] },
    { headers: { ...HEADERS, authorization: token }, timeout: 20000 }
  )
  if (authData?.status !== 200) throw new Error("Otorisasi OSS gagal")

  const oss = authData.data
  const targetObject = oss.objects[filename]
  const credential = oss.credential
  const realHost = `${oss.bucket}.${oss.accelerate}`
  const gmtDate = new Date().toUTCString()

  const structuralCallback = {
    callbackUrl: oss.callback.url,
    callbackBody: oss.callback.body,
    callbackBodyType: oss.callback.type,
  }
  const callbackBase64 = Buffer.from(JSON.stringify(structuralCallback)).toString("base64")

  const stringToSign = [
    "PUT",
    "",
    "image/jpeg",
    gmtDate,
    `x-oss-callback:${callbackBase64}`,
    `x-oss-date:${gmtDate}`,
    `x-oss-security-token:${credential.security_token}`,
    `/${oss.bucket}/${targetObject}`,
  ].join("\n")

  const signature = crypto
    .createHmac("sha1", credential.access_key_secret)
    .update(stringToSign)
    .digest("base64")

  const fileBuf = fs.readFileSync(filePath)

  const { data: uploadRes } = await axios.put(
    `https://${realHost}/${targetObject}`,
    fileBuf,
    {
      responseType: "text",
      headers: {
        accept: "application/json",
        authorization: `OSS ${credential.access_key_id}:${signature}`,
        "content-type": "image/jpeg",
        host: realHost,
        origin: "https://picwish.com",
        referer: "https://picwish.com/unblur-image-portrait",
        "x-oss-callback": callbackBase64,
        "x-oss-date": gmtDate,
        "x-oss-security-token": credential.security_token,
      },
      timeout: 30000,
    }
  )

  const callbackData = typeof uploadRes === "string" ? JSON.parse(uploadRes) : uploadRes
  if (callbackData?.status !== 200) throw new Error("Callback OSS ditolak server")
  return callbackData.data.resource_id
}

async function triggerTask(token, resourceId) {
  const { data } = await axios.post(
    `${BASE_URL}/app/picwish/tasks/anonymity/scale?product_id=482&language=en`,
    {
      website: "en",
      source_resource_id: resourceId,
      resource_id: resourceId,
      type: 2,
    },
    { headers: { ...HEADERS, authorization: token }, timeout: 20000 }
  )
  if (data?.status !== 200) throw new Error("Gagal memicu AI Task")
  return data.data.task_id
}

async function pollTask(token, taskId, interval = 3000, maxAttempts = 25) {
  for (let i = 0; i < maxAttempts; i++) {
    const { data } = await axios.get(
      `${BASE_URL}/app/picwish/tasks/anonymity/scale/${taskId}?product_id=482&language=en`,
      { headers: { ...HEADERS, authorization: token }, timeout: 20000 }
    )
    const task = data.data
    if (task.state === 1 && task.image) return task
    if (task.state === 2 && task.error)
      throw new Error(`AI gagal memproses gambar: ${task.error}`)
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error("Polling timeout (proses AI terlalu lama)")
}

export default {
  name: "Image Unblur v2 (PicWish AI)",
  description: "AI unblur gambar. Mengembalikan gambar hasil AI.",
  category: "Image",
  methods: ["GET", "POST"],

  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL gambar yang akan di-unblur (AI)",
      example: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
    },
  },

  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body }
      if (!url || typeof url !== "string" || url.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
        })
      }

      // 1. Download input image ke temp file
      const imgRes = await axios.get(url.trim(), {
        responseType: "arraybuffer",
        timeout: 30000,
        headers: { "User-Agent": UA },
        maxContentLength: 15 * 1024 * 1024,
      })
      const contentType = imgRes.headers["content-type"] || ""
      if (!contentType.startsWith("image/")) {
        throw new Error("URL harus mengarah ke file gambar")
      }
      const ext = contentType.includes("png") ? ".png" : ".jpg"
      const tmpPath = path.join(
        os.tmpdir(),
        `unblurv2_${crypto.randomBytes(8).toString("hex")}${ext}`
      )
      fs.writeFileSync(tmpPath, Buffer.from(imgRes.data))

      try {
        // 2. PicWish pipeline
        const token = await getPicwishToken()
        const resourceId = await uploadToOss(token, tmpPath)
        const taskId = await triggerTask(token, resourceId)
        const result = await pollTask(token, taskId)

        const outputUrl = result.image

        // 3. Fetch hasil AI lalu kembalikan sebagai image bytes
        try {
          const outRes = await axios.get(outputUrl, {
            responseType: "arraybuffer",
            timeout: 30000,
            headers: { "User-Agent": UA },
          })
          const buf = Buffer.from(outRes.data)
          res.setHeader("Content-Type", "image/jpeg")
          res.setHeader("X-PicWish-Task", result.task_id)
          return res.send(buf)
        } catch (fetchErr) {
          // Fallback: kembalikan URL kalau gagal fetch hasil
          return res.json({
            status: true,
            result: {
              task_id: result.task_id,
              output_url: outputUrl,
              note: "Gagal fetch hasil, kembalikan URL",
            },
          })
        }
      } finally {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
      }
    } catch (err) {
      logger.error(`[UNBLURV2] Error: ${err.message}`)
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses unblur AI",
      })
    }
  },
}
