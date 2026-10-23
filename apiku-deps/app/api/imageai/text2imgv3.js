import axios from "axios"
import crypto from "node:crypto"
import logger from "../../src/utils/logger.js"

const SPACE_URL = "https://baidu-ernie-image-turbo.hf.space"

const headers = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36",
  "Accept": "*/*",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "Origin": "https://upsampler.com",
  "Referer": "https://upsampler.com/"
}

async function downloadImage(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 30000,
    headers: { 'User-Agent': headers['User-Agent'] }
  })
  return Buffer.from(response.data)
}

function extractUrl(output) {
  const text = JSON.stringify(output || "")
  const fullUrl = text.match(/https:\/\/baidu-ernie-image-turbo\.hf\.space\/gradio_api\/file=[^"'\\\s]+/)
  if (fullUrl) return fullUrl[0].replaceAll("\\u0026", "&").replaceAll("\\/", "/")
  const urlField = text.match(/"url":"(https?:\/\/[^"]+)"/)
  if (urlField) return urlField[1].replaceAll("\\u0026", "&").replaceAll("\\/", "/")
  const path = text.match(/\/tmp\/gradio\/[^"'\\\s]+?\.(webp|png|jpg|jpeg)/)
  if (path) return `${SPACE_URL}/gradio_api/file=${path[0]}`
  return ""
}

export default {
  name: "Text to Image v3 (Baidu Ernie)",
  description: "Generate gambar dari teks menggunakan Baidu Ernie Image Turbo",
  category: "Image AI",
  methods: ["GET"],
  params: ["teks"],

  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Deskripsi gambar (prompt)",
    },
  },

  async run(req, res) {
    try {
      const { teks } = req.query

      if (!teks || typeof teks !== "string" || teks.trim().length === 0) {
        return res.status(400).json({ status: false, message: "Parameter 'teks' wajib diisi" })
      }

      const prompt = teks.trim()
      const sessionHash = crypto.randomBytes(8).toString("hex")

      const joinRes = await axios.post(`${SPACE_URL}/gradio_api/queue/join?`, {
        data: [prompt, "1024x1024", -1, true],
        event_data: null,
        fn_index: 1,
        trigger_id: null,
        session_hash: sessionHash
      }, {
        timeout: 30000,
        headers: { ...headers, "Content-Type": "application/json", "x-gradio-user": "api" }
      })

      const eventId = joinRes.data?.event_id
      if (!eventId) throw new Error("event_id tidak ditemukan")

      const streamRes = await axios.get(`${SPACE_URL}/gradio_api/queue/data?session_hash=${sessionHash}`, {
        timeout: 240000,
        responseType: "stream",
        headers: { ...headers, "Accept": "text/event-stream", "Content-Type": "application/json" }
      })

      const url = await new Promise((resolve, reject) => {
        let buffer = "", done = false
        const timer = setTimeout(() => { if (done) return; done = true; streamRes.data.destroy(); reject(new Error("Timeout")) }, 240000)

        streamRes.data.on("data", (chunk) => {
          if (done) return
          buffer += chunk.toString()
          const blocks = buffer.split("\n\n")
          buffer = blocks.pop() || ""
          for (const block of blocks) {
            const line = block.split("\n").find(item => item.startsWith("data: "))
            if (!line) continue
            const raw = line.replace("data: ", "").trim()
            if (!raw || raw === "[DONE]") continue
            try {
              const json = JSON.parse(raw)
              if (json.event_id && json.event_id !== eventId) continue
              if (json.msg === "process_completed") {
                const resultUrl = extractUrl(json.output)
                if (!resultUrl) throw new Error("URL hasil tidak ditemukan")
                done = true
                clearTimeout(timer)
                streamRes.data.destroy()
                resolve(resultUrl)
                return
              }
              if (json.msg === "process_failed") throw new Error("Generate gagal")
            } catch (err) {
              done = true
              clearTimeout(timer)
              streamRes.data.destroy()
              reject(err)
            }
          }
        })
        streamRes.data.on("error", (err) => { if (done) return; done = true; clearTimeout(timer); reject(err) })
        streamRes.data.on("end", () => { if (done) return; done = true; clearTimeout(timer); reject(new Error("Stream selesai tanpa hasil")) })
      })

      logger.info(`[TEXT2IMAGEV3] Downloading result image...`)
      const buffer = await downloadImage(url)

      logger.info(`[TEXT2IMAGEV3] Image generated | size=${(buffer.length / 1024).toFixed(2)}KB`)

      res.setHeader("Content-Type", "image/webp")
      res.setHeader("Content-Length", buffer.length)
      res.setHeader("Cache-Control", "public, max-age=86400")
      res.setHeader("X-Image-Generator", "Baidu Ernie Image Turbo")
      res.setHeader("X-Prompt", prompt)

      return res.send(buffer)

    } catch (err) {
      logger.error(`[TEXT2IMAGEV3] Error: ${err.message}`)
      res.status(500).json({ status: false, message: err.message || "Text2Image v3 request failed" })
    }
  }
}
