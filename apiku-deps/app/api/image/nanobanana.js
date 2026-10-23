import axios from "axios"
import FormData from "form-data"
import { Readable } from "stream"
import logger from "../../src/utils/logger.js"

const API_UPLOAD = "https://api.pixnova.ai/aitools/upload-img"
const API_CREATE = "https://api.pixnova.ai/aitools/of/create"
const API_STATUS = "https://api.pixnova.ai/aitools/of/check-status"

const headersBase = {
  fp: "c74f54010942b009eaa50cd58a1f4419",
  fp1: "3LXezMA2LSO2kESzl2EYNEQBUWOCDQ/oQMQaeP5kWWHbtCWoiTptGi2EUCOLjkdD",
  origin: "https://pixnova.ai",
  referer: "https://pixnova.ai/",
  "theme-version": "83EmcUoQTUv50LhNx0VrdcK8rcGexcP35FcZDcpgWsAXEyO4xqL5shCY6sFIWB2Q",
  "x-code": "1752930995556",
  "x-guide": "SjwMWX+LcTqkoPt48PIOgZzt3eQ93zxCGvzs1VpdikRR9b9+HvKM0Qiceq6Zusjrv8bUEtDGZdVqjQf/bdOXBb0vEaUUDRZ29EXYW0kt047grMMceXzd3zppZoHZj9DeXZOTGaG50PpTHxTjX3gb0D1wmfjol2oh7d5jJFSIsY0=",
  "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  accept: "application/json, text/plain, */*",
}

const UAs = [
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Android 12; Mobile; rv:102.0) Gecko/102.0 Firefox/102.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15",
]

function randomUA() { return UAs[Math.floor(Math.random() * UAs.length)] }
function randomIP() { return Array(4).fill(0).map(() => Math.floor(Math.random() * 256)).join(".") }
const h = () => ({ "user-agent": randomUA(), "X-Forwarded-For": randomIP(), "Client-IP": randomIP() })

async function downloadImage(url) {
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 30000, headers: { "User-Agent": randomUA() } })
  return Buffer.from(res.data)
}

export default {
  name: "Nano Banana",
  description: "AI image edit — edit gambar dengan prompt text",
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
      default: "ubah kulitnya jadi agak lebih putih",
      description: "Prompt editing",
    },
  },

  async run(req, res) {
    try {
      const url = req.query?.url || req.body?.url || "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg"
      const prompt = req.query?.prompt || req.body?.prompt || "ubah kulitnya jadi agak lebih putih"

      logger.info(`[NANOBANANA] Processing: ${prompt}`)

      const imageBuffer = await downloadImage(url)

      const stream = Readable.from(imageBuffer)
      const form = new FormData()
      form.append("file", stream, { filename: "image.jpg" })
      form.append("fn_name", "demo-photo2anime")
      form.append("request_from", "2")
      form.append("origin_from", "111977c0d5def647")

      const upRes = await axios.post(API_UPLOAD, form, {
        headers: { ...headersBase, ...form.getHeaders(), ...h() },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: () => true,
      })

      const sourcePath = upRes.data?.data?.path
      if (!sourcePath) throw new Error("Gagal upload gambar ke PixNova")

      const taskPayload = {
        fn_name: "demo-photo2anime",
        call_type: 3,
        input: {
          source_image: sourcePath,
          strength: 0.6,
          prompt: prompt + ", high quality, hd, detailed",
          negative_prompt: "(worst quality, low quality:1.4), (greyscale, monochrome:1.1), cropped, lowres, blurry, watermark, text",
          request_from: 2,
        },
        request_from: 2,
        origin_from: "111977c0d5def647",
      }

      const taskRes = await axios.post(API_CREATE, taskPayload, {
        headers: { ...headersBase, "content-type": "application/json", ...h() },
        validateStatus: () => true,
      })

      const taskId = taskRes.data?.data?.task_id
      if (!taskId) throw new Error("Gagal membuat task editing")

      for (let i = 0; i < 30; i++) {
        const statusRes = await axios.post(API_STATUS, {
          task_id: taskId,
          fn_name: "demo-photo2anime",
          call_type: 3,
          request_from: 2,
          origin_from: "111977c0d5def647",
        }, {
          headers: { ...headersBase, "content-type": "application/json", ...h() },
          validateStatus: () => true,
        })

        const st = statusRes.data?.data
        if (st?.status === 2 && st?.result_image) {
          const resultPath = st.result_image.startsWith("http")
            ? st.result_image
            : `https://oss-global.pixnova.ai/${st.result_image}`

          const resultBuffer = await downloadImage(resultPath)

          res.setHeader("Content-Type", "image/png")
          res.setHeader("Content-Length", resultBuffer.length)
          res.setHeader("X-Prompt", prompt)
          return res.send(resultBuffer)
        }

        await new Promise((r) => setTimeout(r, 2000))
      }

      throw new Error("Waktu habis, proses editing gagal")
    } catch (error) {
      logger.error(`[NANOBANANA] Error: ${error.message}`)
      return res.status(500).json({
        status: false,
        message: error.message,
      })
    }
  },
}
