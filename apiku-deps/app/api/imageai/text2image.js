import axios from "axios"
import WebSocket from "ws"
import logger from "../../src/utils/logger.js"

const SIGNER_URL = "https://prompt-signer.freegen.app"
const GENERATOR_URL = "https://image-generator.freegen.app"
const WEBSOCKET_URL = "wss://websocket-bridge.freegen.app/ws"

const browserHeaders = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36",
  "Content-Type": "application/json",
  "Accept": "*/*",
  "Origin": "https://freegen.app",
  "Referer": "https://freegen.app/",
  "Accept-Language": "id-ID,id;q=0.9"
}

function listenForResults(jobId) {
  return new Promise((resolve, reject) => {
    let done = false
    const ws = new WebSocket(WEBSOCKET_URL, {
      headers: { "Origin": "https://freegen.app", "User-Agent": browserHeaders["User-Agent"] }
    })

    const timeout = setTimeout(() => {
      if (done) return
      done = true
      try { ws.close() } catch {}
      reject(new Error("Timeout menunggu hasil gambar"))
    }, 120000)

    ws.on("open", () => ws.send(JSON.stringify({ type: "subscribe", job_id: jobId })))
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === "result" && msg.image_data) {
          if (done) return
          done = true
          clearTimeout(timeout)
          try { ws.close() } catch {}
          resolve(msg.image_data)
        }
        if (msg.type === "error") {
          if (done) return
          done = true
          clearTimeout(timeout)
          try { ws.close() } catch {}
          reject(new Error(msg.message || "WebSocket error"))
        }
      } catch (err) {
        if (done) return
        done = true
        clearTimeout(timeout)
        try { ws.close() } catch {}
        reject(err)
      }
    })
    ws.on("error", (err) => { if (done) return; done = true; clearTimeout(timeout); reject(err) })
    ws.on("close", () => { if (done) return; done = true; clearTimeout(timeout); reject(new Error("WebSocket closed")) })
  })
}

export default {
  name: "Text to Image (FreeGen)",
  description: "Generate gambar dari teks menggunakan WebSocket",
  category: "Image AI",
  methods: ["GET"],
  params: ["teks", "ratio"],

  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Deskripsi gambar (prompt)",
    },
    ratio: {
      type: "string",
      required: false,
      description: "Rasio gambar (default: 1:1)",
      default: "1:1",
    },
  },

  async run(req, res) {
    try {
      const { teks, ratio = "1:1" } = req.query

      if (!teks || typeof teks !== "string" || teks.trim().length === 0) {
        return res.status(400).json({ status: false, message: "Parameter 'teks' wajib diisi" })
      }

      logger.info(`[TEXT2IMAGE] Generating image for prompt: ${teks.trim().substring(0, 50)}`)

      const signerRes = await axios.post(SIGNER_URL, { prompt: teks.trim() }, { timeout: 30000, headers: browserHeaders })
      const { ts, sig } = signerRes.data || {}
      if (!ts || !sig) throw new Error("Signer gagal")

      const genRes = await axios.post(GENERATOR_URL, { prompt: teks.trim(), ts, sig, ratio_id: ratio }, { timeout: 30000, headers: browserHeaders })
      const jobId = genRes.data?.job_id
      if (!jobId) throw new Error("job_id tidak ditemukan")

      const rawImageBase64 = await listenForResults(jobId)
      if (!rawImageBase64) throw new Error("Image data kosong")

      const base64Data = rawImageBase64.includes("base64,") ? rawImageBase64.split("base64,")[1] : rawImageBase64
      const buffer = Buffer.from(base64Data, "base64")
      if (!buffer.length) throw new Error("Base64 tidak valid")

      logger.info(`[TEXT2IMAGE] Image generated | size=${(buffer.length / 1024).toFixed(2)}KB`)

      res.setHeader("Content-Type", "image/jpeg")
      res.setHeader("Content-Length", buffer.length)
      res.setHeader("Cache-Control", "public, max-age=86400")
      res.setHeader("X-Image-Generator", "freegen.app")
      res.setHeader("X-Prompt", teks.trim())

      return res.send(buffer)

    } catch (err) {
      logger.error(`[TEXT2IMAGE] Error: ${err.message}`)
      res.status(500).json({ status: false, message: err.message || "Text2Image request failed" })
    }
  }
}
