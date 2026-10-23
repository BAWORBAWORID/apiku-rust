/**
 * Remove Background
 * Provider: iloveimg.com
 * Parameter: url
 * NO API KEY
 */

import axios from "axios"
import FormData from "form-data"

/* ===============================
   KONFIGURASI & HEADER
================================ */
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Origin': 'https://www.iloveimg.com',
  'Referer': 'https://www.iloveimg.com/remove-background'
}
const BASE_URL = 'https://www.iloveimg.com/remove-background'

/* ===============================
   FUNGSI INTERNAL (ILOVEIMG)
================================ */
async function getSessionData() {
  try {
    const { data: html } = await axios.get(BASE_URL, { headers: HEADERS })
    // Ambil konfigurasi utama (token & server)
    const configMatch = html.match(/var ilovepdfConfig = ({.+});/)
    if (!configMatch) throw new Error('Gagal parsing ilovepdfConfig')
    const config = JSON.parse(configMatch[1])
    // Ambil task ID
    const taskMatch = html.match(/ilovepdfConfig\.taskId = '(.+?)';/)
    if (!taskMatch) throw new Error('Gagal parsing Task ID')
    // Pilih server worker secara acak
    const randomServer = config.servers[Math.floor(Math.random() * config.servers.length)]
    return {
      token: config.token,
      taskId: taskMatch[1],
      server: `https://${randomServer}.iloveimg.com`
    }
  } catch (error) {
    throw new Error(`Gagal init session: ${error.message}`)
  }
}

async function uploadFile(session, buffer) {
  try {
    const form = new FormData()
    form.append('task', session.taskId)
    form.append('file', buffer, { filename: 'image.jpg' })
    const url = `${session.server}/v1/upload`
    const { data } = await axios.post(url, form, {
      headers: {
        ...HEADERS,
        ...form.getHeaders(),
        'Authorization': `Bearer ${session.token}`
      }
    })
    return data.server_filename
  } catch (error) {
    throw new Error(`Gagal upload (${error.response?.status || 'Unknown'}): ${error.message}`)
  }
}

async function processImage(session, serverFilename) {
  try {
    const form = new FormData()
    form.append('task', session.taskId)
    form.append('server_filename', serverFilename)
    const url = `${session.server}/v1/removebackground`
    const response = await axios.post(url, form, {
      headers: {
        ...HEADERS,
        ...form.getHeaders(),
        'Authorization': `Bearer ${session.token}`
      },
      responseType: 'arraybuffer'
    })
    return Buffer.from(response.data)
  } catch (error) {
    throw new Error(`Gagal memproses gambar: ${error.message}`)
  }
}

/* ===============================
   FUNGSI UTAMA REMOVE BACKGROUND
================================ */
async function removeBackground(imageUrl) {
  try {
    // 1. Download gambar dari URL
    const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer' })
    const imgBuffer = Buffer.from(imgRes.data)

    // 2. Dapatkan session (token, taskId, server)
    const session = await getSessionData()

    // 3. Upload file ke server iloveimg
    const serverFilename = await uploadFile(session, imgBuffer)

    // 4. Proses hapus background, dapatkan buffer hasil
    const resultBuffer = await processImage(session, serverFilename)

    return resultBuffer
  } catch (error) {
    throw error
  }
}

/* ===============================
   EXPORT API (SESUAI FORMAT AWAL)
================================ */
export default {
  name: "Remove Background v2",
  description: "Remove background from image - No API Key Required",
  category: "Image",
  methods: ["GET"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
      description: "URL gambar yang akan dihapus backgroundnya"
    }
  },

  async run(req, res) {
    try {
      const { url } = req.query

      if (!url || typeof url !== "string" || url.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi (URL gambar)"
        })
      }

      // Validasi URL
      try {
        new URL(url)
      } catch (e) {
        return res.status(400).json({
          status: false,
          message: "URL tidak valid"
        })
      }

      // Proses remove background
      const imageBuffer = await removeBackground(url.trim())

      // Kirim langsung gambar sebagai response (PNG dengan background transparan)
      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Content-Length', imageBuffer.length)
      return res.send(imageBuffer)

    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "Remove background request failed"
      })
    }
  },
}