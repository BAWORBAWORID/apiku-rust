import logger from "../../src/utils/logger.js"

const BASE_URL = "https://deezdownloaders.com"
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"

function clean(str) {
  return String(str || "")
    .replace(/['"]/g, "")
    .trim()
}

export async function searchDeezer(query, limit = 5) {
  if (!query) throw new Error("Query pencarian lagu diperlukan")
  const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${limit}`, {
    headers: { "User-Agent": USER_AGENT },
  })
  if (!res.ok) throw new Error(`Deezer API HTTP Error: ${res.status}`)
  const data = await res.json()
  return (data.data || []).map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist?.name,
    album: t.album?.title,
    duration: t.duration,
    link: t.link,
    thumbnail: t.album?.cover_big || t.album?.cover,
  }))
}

export async function expandUrl(url) {
  if (!url) throw new Error("URL diperlukan")
  try {
    const res = await fetch(`${BASE_URL}/api/expandUrl.php?url=${encodeURIComponent(url)}`, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: `${BASE_URL}/`,
      },
    })
    if (!res.ok) return url
    const data = await res.json()
    return data?.success && data?.url ? data.url : url
  } catch {
    return url
  }
}

export async function normalizeUrl(input) {
  if (!input) throw new Error("URL atau judul lagu Deezer diperlukan")
  let str = String(input).trim()
  if (/^\d+$/.test(str)) {
    return `https://www.deezer.com/track/${str}`
  }
  if (str.includes("deezer.page.link")) {
    str = await expandUrl(str)
  }
  if (str.includes("deezer.com")) {
    if (str.includes("?")) str = str.split("?")[0]
    return str
  }
  const searchResults = await searchDeezer(str, 1)
  if (searchResults.length && searchResults[0].link) {
    return searchResults[0].link
  }
  return str
}

export async function getTrackInfo(urlOrId) {
  const url = await normalizeUrl(urlOrId)
  const res = await fetch(`${BASE_URL}/api/track.php?url=${encodeURIComponent(url)}`, {
    headers: {
      "User-Agent": USER_AGENT,
      Referer: `${BASE_URL}/`,
    },
  })

  if (!res.ok) throw new Error(`HTTP Error ${res.status}: Gagal mengambil info track`)
  const data = await res.json()
  if (!data || !data.name) throw new Error("Track tidak ditemukan atau link tidak didukung")

  return {
    name: data.name,
    artist: data.artist,
    album: data.album,
    duration: data.duration,
    releaseDate: data.release_date || null,
    thumbnail: data.thumb || null,
    trackPosition: data.track_position || 1,
    url: data.url || url,
  }
}

export async function downloadTrack(urlOrId, quality = "MP3_128") {
  const trackInfo = await getTrackInfo(urlOrId)

  const payload = new URLSearchParams({
    name: clean(trackInfo.name),
    artist: clean(trackInfo.artist),
    url: trackInfo.url,
    token: "none",
    zip_download: "false",
    quality,
  })

  const res = await fetch(`${BASE_URL}/api/downloader.php`, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Referer: `${BASE_URL}/track.php`,
      Origin: BASE_URL,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: payload.toString(),
  })

  if (!res.ok) throw new Error(`Downloader HTTP Error: ${res.status}`)
  const data = await res.json()

  if (!data || !data.success || !data.dlink) {
    throw new Error(data?.reason || "Gagal menghasilkan download link dari deezdownloaders.com")
  }

  return {
    title: trackInfo.name,
    artist: trackInfo.artist,
    album: trackInfo.album,
    duration: trackInfo.duration,
    thumbnail: trackInfo.thumbnail,
    download_url: data.dlink,
    source_url: trackInfo.url,
  }
}

export default {
  name: "Deezer Downloader",
  description: "Download lagu & audio MP3 dari Deezer serta pencarian lagu dan informasi metadata track Deezer.",
  category: "Downloader",
  methods: ["GET", "POST"],

  params: ["url", "query", "action", "quality", "limit"],

  paramsSchema: {
    url: {
      type: "string",
      required: false,
      description: "URL lagu Deezer (https://www.deezer.com/track/...) atau shortlink (deezer.page.link)",
      example: "https://www.deezer.com/track/2743578151",
    },
    query: {
      type: "string",
      required: false,
      description: "Judul lagu, nama artis, atau ID track Deezer",
      example: "espresso sabrina carpenter",
    },
    action: {
      type: "string",
      required: false,
      default: "download",
      enum: ["download", "search", "info"],
      description: "Aksi: 'download' (ambil link download MP3), 'search' (cari daftar lagu), 'info' (metadata lagu)",
      example: "download",
    },
    quality: {
      type: "string",
      required: false,
      default: "MP3_128",
      enum: ["MP3_128", "MP3_320", "FLAC"],
      description: "Kualitas audio MP3 yang diinginkan. Default: MP3_128",
      example: "MP3_128",
    },
    limit: {
      type: "number",
      required: false,
      default: 5,
      description: "Batas jumlah hasil pencarian untuk action=search",
      example: 5,
    },
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body }
      const action = (params.action || "").toLowerCase()
      const input = params.url || params.query || params.id || params.q
      const quality = params.quality || "MP3_128"

      // Mode 1: Search
      if (action === "search") {
        if (!input) {
          return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi untuk pencarian lagu Deezer" })
        }
        const limit = parseInt(params.limit, 10) || 5
        logger.info(`[DEEZER] Search | query=${input} | limit=${limit} | ip=${req.ip}`)
        const results = await searchDeezer(input, limit)
        return res.json({
          status: true,
          action: "search",
          query: input,
          total: results.length,
          result: results,
        })
      }

      // Mode 2: Info metadata
      if (action === "info") {
        if (!input) {
          return res.status(400).json({ status: false, message: "Parameter 'url', 'query', atau 'id' wajib diisi untuk cek info track" })
        }
        logger.info(`[DEEZER] Track Info | input=${input} | ip=${req.ip}`)
        const trackInfo = await getTrackInfo(input)
        return res.json({
          status: true,
          action: "info",
          result: trackInfo,
        })
      }

      // Mode 3: Default Download
      if (!input) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' atau 'query' wajib diisi",
          usage: {
            download_by_url: "/api/downloader/deezer?url=https://www.deezer.com/track/2743578151",
            download_by_title: "/api/downloader/deezer?query=espresso+sabrina+carpenter",
            search_songs: "/api/downloader/deezer?action=search&query=sabrina+carpenter",
            track_info: "/api/downloader/deezer?action=info&url=https://www.deezer.com/track/2743578151",
          },
        })
      }

      logger.info(`[DEEZER] Download | input=${input} | quality=${quality} | ip=${req.ip}`)
      const downloadResult = await downloadTrack(input, quality)

      return res.json({
        status: true,
        action: "download",
        result: downloadResult,
      })
    } catch (err) {
      logger.error(`[DEEZER] Error: ${err.message}`)
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses download lagu Deezer",
      })
    }
  },
}
