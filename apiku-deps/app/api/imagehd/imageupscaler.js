import axios from "axios"
import logger from "../../src/utils/logger.js"

const _base = "https://imageupscaler.com"
const _ajax = `${_base}/wp-admin/admin-ajax.php`

const _hdrs = (extra = {}) => ({
  accept: "*/*",
  "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  priority: "u=1, i",
  "sec-ch-ua": '"Mises";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
  "sec-ch-ua-mobile": "?1",
  "sec-ch-ua-platform": '"Android"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  ...extra,
})

function _pid() {
  const a = Date.now().toString()
  const b = Math.random().toString().slice(2).padEnd(20, "0")
  return (a + b).slice(0, 30)
}

async function _session() {
  const res = await axios.get(`${_base}/upscale-image-4x/`, {
    headers: _hdrs({ referer: _base }),
  })
  const m = res.data.match(/name="process_nonce"\s+value="([^"]+)"/)
  if (!m) throw new Error("nonce not found")

  const pidMatch = res.data.match(/["\s]pid["']?\s*[:=]\s*["']?([0-9]{20,35})/)
  const pid = pidMatch ? pidMatch[1] : null
  const cookies = res.headers["set-cookie"]?.map(c => c.split(";")[0]).join("; ") ?? ""
  return { nonce: m[1], cookies, pid }
}

export default {
  name: "Image Upscaler",
  description: "Upscale gambar 2x/4x/6x. Upload URL gambar dan dapatkan hasil upscaled.",
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
      default: "4x",
      enum: ["2x", "4x", "6x"],
      description: "Skala upscale (2x, 4x, atau 6x)",
    },
  },

  async run(req, res) {
    try {
      const url = req.query?.url || req.body?.url
      const scale = (req.query?.scale || req.body?.scale || "4x").toLowerCase()

      if (!url) {
        return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" })
      }

      const increase = scale === "2x" || scale === "2" ? "2" : scale === "6x" || scale === "6" ? "6" : "4"

      logger.info(`[IMAGEUPSCALER] start | ip=${req.ip}`)

      const imgRes = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 30000,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      })

      const ext = url.split(".").pop()?.split("?")[0]?.toLowerCase() || "jpg"
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg"
      const b64 = `data:${mime};base64,${Buffer.from(imgRes.data).toString("base64")}`
      const fname = `upscale_${Date.now()}.${ext}`
      const fileId = `${Date.now()}_${fname}`

      const { nonce, cookies, pid: pagePid } = await _session()
      const pid = pagePid ?? _pid()

      const mediaData = JSON.stringify([{ fileSrc: b64, fileName: fname, fileId }])
      const parameters = JSON.stringify({ "upscale-type": "standard", increase, "save-format": "auto" })

      const body = new URLSearchParams({
        action: "processing_images_adv",
        nonce,
        pid,
        function: "upscale-image-4x",
        batch_number: "1",
        total_batches: "1",
        mediaData,
        parameters,
      })

      const { data } = await axios.post(_ajax, body.toString(), {
        headers: _hdrs({
          "content-type": "application/x-www-form-urlencoded",
          referer: `${_base}/upscale-image-4x/`,
          ...(cookies ? { cookie: cookies } : {}),
        }),
        timeout: 120000,
      })

      if (!data.success || !data.data?.items?.length) {
        throw new Error("Gagal upscale: " + JSON.stringify(data))
      }

      const item = data.data.items[0]

      logger.info(`[IMAGEUPSCALER] done | ip=${req.ip} | scale=${increase}x`)

      res.json({
        status: true,
        result: {
          url: item.url,
          name: item.name,
          credits_remaining: data.data.remainingCredits,
          scale: increase + "x",
        },
      })
    } catch (err) {
      logger.error(`[IMAGEUPSCALER] Error | ip=${req.ip} | ${err.message}`)
      res.status(500).json({ status: false, message: err.message || "Gagal upscale gambar" })
    }
  },
}
