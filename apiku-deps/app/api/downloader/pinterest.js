import axios from "axios"

const WORKER_NAMES = [
  "caliph", "eu", "rpoxy", "prox", "aged", "wave",
  "hill", "icy", "fazri", "spring", "sizable", "jiashu",
]

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

const HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,id-ID;q=0.8",
}

function getProxy() {
  const pm = global.PROXY_MANAGER
  const url = pm ? pm.getProxy(WORKER_NAMES) : null
  return url && /workers\.dev|1win\.eu\.org|\.my\.id\/|\/cors\//.test(url) ? url : null
}

function getMeta(html, property) {
  const contentFirst = new RegExp(`<meta[^>]*content="([^"]+)"[^>]*(?:property|name)="${property}"`, "i")
  const propertyFirst = new RegExp(`<meta[^>]*(?:property|name)="${property}"[^>]*content="([^"]+)"`, "i")
  return (html.match(contentFirst) || html.match(propertyFirst))?.[1] || null
}

function decodeHtml(value) {
  return value
    ? value
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&#x0?27;/gi, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
    : null
}

function listQualities(html) {
  const matches = [
    ...html.matchAll(/https:\/\/v\d+\.pinimg\.com\/videos\/[a-zA-Z0-9/._-]+_(\d{3,4})w\.mp4/gi),
  ].map((match) => ({ width: Number(match[1]), url: match[0] }))

  const byWidth = new Map()

  for (const item of matches) {
    if (!byWidth.has(item.width)) {
      byWidth.set(item.width, item.url)
      continue
    }
    const current = byWidth.get(item.width)
    const penalize = (url) => /av1Mp4|hevc|control-v2/i.test(url)
    if (!penalize(item.url) && penalize(current)) {
      byWidth.set(item.width, item.url)
    }
  }

  return [...byWidth.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([width, url]) => ({ quality: `${width}p`, url }))
}

function findVideoUrl(html) {
  const metaVideo =
    decodeHtml(getMeta(html, "og:video:secure_url")) ||
    decodeHtml(getMeta(html, "og:video:url")) ||
    decodeHtml(getMeta(html, "og:video"))

  if (metaVideo) return metaVideo

  const m3u8 = html.match(/https:\/\/v\d+\.pinimg\.com\/videos\/[a-zA-Z0-9/._-]+\.m3u8/i)?.[0]
  if (m3u8) return m3u8

  const mp4s = [
    ...new Set(
      [...html.matchAll(/https:\/\/v\d+\.pinimg\.com\/videos\/[a-zA-Z0-9/._-]+_(\d{3,4})w\.mp4/gi)].map(
        (match) => match[0],
      ),
    ),
  ]
  if (mp4s.length) {
    mp4s.sort((a, b) => {
      const wa = Number(a.match(/_(\d{3,4})w\.mp4/)?.[1] || 0)
      const wb = Number(b.match(/_(\d{3,4})w\.mp4/)?.[1] || 0)
      return wb - wa
    })
    return mp4s[0]
  }

  return null
}

async function fetchText(url, useProxy) {
  const target = useProxy ? `${getProxy()}${url}` : url
  const res = await axios.get(target, {
    headers: HEADERS,
    timeout: 30000,
    maxRedirects: 5,
    validateStatus: (status) => status < 400,
    responseType: "text",
  })
  return { html: String(res.data || ""), finalUrl: res.request?.res?.responseUrl || url }
}

async function loadPinPage(url) {
  try {
    const direct = await fetchText(url, false)
    if (direct.html.length > 500) return direct
  } catch {}

  const proxyUrl = getProxy()
  if (proxyUrl) {
    const viaProxy = await fetchText(url, true)
    if (viaProxy.html.length > 500) return viaProxy
  }

  throw new Error("Gagal memuat halaman Pinterest")
}

function extractPinId(url) {
  return (
    url.match(/pin\.it\/([a-zA-Z0-9]+)/)?.[1] ||
    url.match(/\/pin\/(\d+)/)?.[1] ||
    null
  )
}

async function scrapePinterest(url) {
  if (/i\.pinimg\.com\/.*\.(jpe?g|png|gif|webp|mp4|m3u8)/i.test(url)) {
    const isVideo = /\.(mp4|m3u8)/i.test(url)
    return {
      type: isVideo ? "video" : "image",
      title: url.split("/").pop(),
      image: isVideo ? null : url,
      video: isVideo ? url : null,
      directUrl: url,
      sourceUrl: url,
    }
  }

  const { html, finalUrl } = await loadPinPage(url)

  const image = decodeHtml(getMeta(html, "og:image"))
  const video = findVideoUrl(html)
  const title =
    decodeHtml(getMeta(html, "og:title")) ||
    decodeHtml(html.match(/<title>([^<]*)<\/title>/i)?.[1]) ||
    null

  const directUrl = video || image

  if (!directUrl) {
    throw new Error("Media tidak ditemukan di halaman Pinterest")
  }

  return {
    type: video ? "video" : "image",
    title,
    image: image || null,
    video: video || null,
    qualities: video ? listQualities(html) : [],
    directUrl,
    sourceUrl: finalUrl,
    pinId: extractPinId(finalUrl) || extractPinId(url),
  }
}

export default {
  name: "Pinterest",
  description: "Download media dari Pinterest (image & video pin)",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "Link Pinterest (pin URL, pin.it, atau i.pinimg.com langsung)",
      example: "https://id.pinterest.com/pin/39336196741076247/",
      minLength: 1,
      maxLength: 500,
    },
  },

  async run(req, res) {
    const { url } = { ...req.query, ...req.body }
    const target = typeof url === "string" ? url.trim() : ""

    if (!target) {
      return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" })
    }

    if (!/^https?:\/\//i.test(target)) {
      return res.status(400).json({ status: false, message: "URL harus diawali http:// atau https://" })
    }

    try {
      const data = await scrapePinterest(target)
      return res.json({ status: true, result: data })
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message || "Gagal scrape Pinterest" })
    }
  },
}
