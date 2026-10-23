import axios from "axios"
import fs from "fs"

const FUNCTION_ID = "o2f0jzcdyut2qxhu"
const INVOKE_URL = `https://www.nyckel.com/v1/functions/${FUNCTION_ID}/invoke`
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

const MIME_BY_EXT = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  webp: "image/webp", gif: "image/gif", bmp: "image/bmp",
}

function mimeFromBuffer(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg"
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png"
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46) return "image/webp"
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif"
  if (buf[0] === 0x42 && buf[1] === 0x4d) return "image/bmp"
  return "image/jpeg"
}

async function resolveImage(source) {
  if (!source) throw new Error("Parameter 'url' wajib diisi")

  if (source.startsWith("data:image")) {
    const meta = source.match(/^data:(image\/[a-z+.-]+);base64,([\s\S]+)$/)
    const mime = meta ? meta[1] : "image/jpeg"
    return { buffer: Buffer.from(meta ? meta[2] : source, "base64"), mime, filename: `image.${mime.split("/")[1] || "jpg"}` }
  }

  if (source.startsWith("http://") || source.startsWith("https://")) {
    const res = await axios.get(source, { responseType: "arraybuffer", timeout: 30000 })
    const buf = Buffer.from(res.data)
    return { buffer: buf, mime: mimeFromBuffer(buf), filename: `image.${mimeFromBuffer(buf).split("/")[1]}` }
  }

  try {
    const buf = Buffer.from(source, "base64")
    if (!buf.length) throw new Error("Base64 kosong")
    const mime = mimeFromBuffer(buf)
    return { buffer: buf, mime, filename: `image.${mime.split("/")[1]}` }
  } catch {
    throw new Error("Parameter 'url' harus berupa URL gambar atau base64")
  }
}

export default {
  name: "NSFW Check",
  description: "Deteksi konten NSFW/porn dari sebuah gambar — return label + confidence",
  category: "Image",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL gambar (http/https), dataURL, atau base64",
      example: "https://example.com/image.jpg"
    }
  },

  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body }

      if (!url) {
        return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" })
      }

      const { buffer, mime, filename } = await resolveImage(url)

      const form = new FormData()
      form.append("file", new Blob([buffer], { type: mime }), filename)

      const resApi = await fetch(INVOKE_URL, {
        method: "POST",
        headers: { "User-Agent": UA, "Referer": "https://www.nyckel.com/pretrained-classifiers/nsfw-identifier/" },
        body: form,
        signal: AbortSignal.timeout(15000),
      })
      const data = await resApi.json()

      if (!resApi.ok || !data) {
        return res.status(502).json({ status: false, message: `Nyckel gagal: HTTP ${resApi.status}` })
      }

      const { labelName, labelId, confidence } = data || {}

      if (!labelName || typeof confidence !== "number") {
        return res.status(502).json({ status: false, message: "Response Nyckel tidak valid" })
      }

      const isNsfw = /^NSFW\b/i.test(labelName) || (/\bporn\b/i.test(labelName) && !/^Not\b/i.test(labelName))

      return res.json({
        status: true,
        result: {
          label: labelName,
          labelId,
          confidence,
          safe: !isNsfw,
          nsfw: isNsfw,
        }
      })
    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || "NSFW check failed" })
    }
  }
}