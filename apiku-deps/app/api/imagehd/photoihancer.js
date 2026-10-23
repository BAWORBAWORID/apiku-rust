/**
 * Photoihancer — AI image enhance
 * Provider: ihancer.com
 * Parameter: url, method
 * NO API KEY
 */

import axios from "axios"

function validateImage(buffer) {
  if (!buffer || buffer.length < 8) throw new Error("Gagal download gambar")
  const sig = buffer.subarray(0, 8).toString("hex")
  if (!/^(ffd8ff|89504e470d0a1a0a|47494638|52494646|00000018667479)/.test(sig)) {
    throw new Error("URL bukan gambar valid (jpg/png/gif/webp)")
  }
  return buffer
}

async function enhance(imageBuffer, method = 1) {
  const blob = new Blob([new Uint8Array(imageBuffer)], { type: "image/jpeg" })
  const form = new FormData()
  form.set("method", String(method))
  form.set("is_pro_version", "true")
  form.set("is_enhancing_more", "false")
  form.set("max_image_size", "high")
  form.set("file", blob, "file.jpg")

  const res = await fetch("https://ihancer.com/api/enhance", {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
      "Referer": "https://ihancer.com/app/",
    },
    body: form,
    timeout: 90000,
  })

  if (!res.ok) throw new Error(`Upstream ${res.status} ${res.statusText}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (!buf || buf.length === 0) throw new Error("Upstream balas kosong")
  return buf
}

export default {
  name: "Photoihancer",
  description: "AI image enhance — perbesar + perhalus gambar (URL), respon langsung file gambar.",
  category: "Image HD",
  methods: ["GET", "POST"],
  params: ["url", "method"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL gambar (http/https)",
      example: "https://example.com/image.jpg"
    },
    method: {
      type: "number",
      required: false,
      description: "Metode enhancement (1 = default)",
      default: 1
    }
  },

  async run(req, res) {
    const { url } = { ...req.query, ...req.body }
    let method = parseInt(req.query.method ?? req.body?.method, 10)
    if (isNaN(method) || method < 1) method = 1

    if (!url || typeof url !== "string") {
      return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" })
    }

    try {
      const dl = await axios.get(url, { responseType: "arraybuffer", timeout: 30000, maxRedirects: 5 })
      const src = validateImage(Buffer.from(dl.data))
      const out = await enhance(src, method)
      res.setHeader("Content-Type", "image/jpeg")
      res.setHeader("X-Enhance-Service", "ihancer")
      res.setHeader("X-Enhance-Method", String(method))
      res.setHeader("Content-Length", out.length)
      return res.status(200).send(out)
    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || String(err) })
    }
  }
}