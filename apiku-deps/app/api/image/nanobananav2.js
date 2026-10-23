import axios from "axios"
import logger from "../../src/utils/logger.js"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
const HEADERS = {
  "user-agent": UA,
  accept: "application/json, text/plain, */*",
  "accept-language": "id,en;q=0.9",
  origin: "https://nanobanana.im",
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function downloadImage(url) {
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 })
  return Buffer.from(res.data)
}

export default {
  name: "Nano Banana V2",
  description: "AI image edit — edit gambar dengan prompt (auto-login via tempmail)",
  category: "Image",
  methods: ["GET", "POST"],
  params: ["url", "prompt"],

  paramsSchema: {
    url: {
      type: "string",
      required: false,
      default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
      description: "URL gambar yang akan diedit",
    },
    prompt: {
      type: "string",
      required: false,
      default: "ubah rambutnya jadi warna merah",
      description: "Prompt editing",
    },
  },

  async run(req, res) {
    try {
      const url = req.query?.url || req.body?.url || "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg"
      const prompt = req.query?.prompt || req.body?.prompt || "ubah rambutnya jadi warna merah"

      logger.info(`[NANOBANANA2] Processing: ${prompt}`)

      const imageBuffer = await downloadImage(url)

      const mailRes = await axios.post("https://api.tempmail.ing/api/generate", {}, { headers: HEADERS })
      if (!mailRes.data?.success) throw new Error("Gagal generate temp mail")
      const email = mailRes.data.email.address
      logger.info(`[NANOBANANA2] Temp mail: ${email}`)

      const initRes = await axios.get("https://nanobanana.im/", { headers: HEADERS })
      let cookies = initRes.headers["set-cookie"] || []
      let cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ")

      await axios.post("https://nanobanana.im/api/auth/sign-in/magic-link", {
        email, callbackURL: "/",
      }, {
        headers: { ...HEADERS, Cookie: cookieHeader, "content-type": "application/json" },
      })

      let magicLink = null
      for (let i = 0; i < 25; i++) {
        const checkRes = await axios.get(
          `https://api.tempmail.ing/api/emails/${encodeURIComponent(email)}`,
          { headers: HEADERS }
        )
        if (checkRes.data?.success && checkRes.data.emails?.length > 0) {
          const text = checkRes.data.emails[0].text || checkRes.data.emails[0].html || ""
          const match = text.match(/https:\/\/nanobanana\.im\/api\/auth\/magic-link\/verify\?token=[^\s"']+/)
          if (match) { magicLink = match[0]; break }
        }
        await sleep(3000)
      }
      if (!magicLink) throw new Error("Gagal mendapatkan magic link email")

      const verifyRes = await axios.get(magicLink, {
        headers: { ...HEADERS, Cookie: cookieHeader },
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 400,
      })
      if (verifyRes.headers["set-cookie"]) {
        cookies = [...cookies, ...verifyRes.headers["set-cookie"]]
        cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ")
      }

      const homeRes = await axios.get("https://nanobanana.im/", {
        headers: { ...HEADERS, Cookie: cookieHeader },
      })
      if (homeRes.headers["set-cookie"]) {
        cookies = [...cookies, ...homeRes.headers["set-cookie"]]
        cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ")
      }

      const urlRes = await axios.post("https://nanobanana.im/api/presigned-urls", {
        count: 1, fileType: "image/jpeg",
      }, {
        headers: { ...HEADERS, Cookie: cookieHeader, "Content-Type": "text/plain;charset=UTF-8" },
      })
      if (!urlRes.data?.success) throw new Error("Gagal mendapatkan presigned URL")
      const { url: uploadUrl, key } = urlRes.data.urls[0]

      await axios.put(uploadUrl, imageBuffer, {
        headers: { "Content-Type": "image/jpeg", "user-agent": UA },
      })

      const taskRes = await axios.post("https://nanobanana.im/api/img/nano-banana5", {
        prompt,
        dimension: "auto",
        aspect_ratio: "auto",
        image_urls: [`https://temp.videostudioai.com/${key}`],
        num_images: "1",
        batchSize: 1,
        turnstileToken: "",
        skipVerification: true,
        image_path: "hero",
        size: "2K",
        resolution: "2K",
        output_format: "png",
      }, {
        headers: { ...HEADERS, Cookie: cookieHeader, "content-type": "application/json" },
      })
      if (!taskRes.data?.taskId) throw new Error("Gagal membuat task editing")

      const taskId = taskRes.data.taskId
      logger.info(`[NANOBANANA2] Task ID: ${taskId}`)

      let resultUrl = null
      for (let i = 0; i < 40; i++) {
        const checkRes = await axios.post(
          "https://nanobanana.im/api/img/nano-banana5/taskResult",
          { taskId },
          { headers: { ...HEADERS, Cookie: cookieHeader, "content-type": "application/json" } }
        )
        if (checkRes.data?.status === 1 && checkRes.data?.imgAfterSrc) {
          resultUrl = checkRes.data.imgAfterSrc
          break
        }
        await sleep(5000)
      }
      if (!resultUrl) throw new Error("Waktu habis, proses editing gagal")

      const resultBuffer = await downloadImage(resultUrl)

      res.setHeader("Content-Type", "image/png")
      res.setHeader("Content-Length", resultBuffer.length)
      res.setHeader("X-Prompt", prompt)
      return res.send(resultBuffer)
    } catch (error) {
      logger.error(`[NANOBANANA2] Error: ${error.message}`)
      return res.status(500).json({ status: false, message: error.message })
    }
  },
}
