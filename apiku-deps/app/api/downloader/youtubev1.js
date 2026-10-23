import axios from "axios"
import WebSocket from "ws"

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0'

function waitForRender(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, {
      headers: {
        'User-Agent': UA,
        'Origin': 'https://ssyou.online'
      }
    })

    const timeout = setTimeout(() => {
      ws.terminate()
      reject(new Error('Render timeout (60s).'))
    }, 60000)

    ws.on('message', (msg) => {
      try {
        const data = JSON.parse(msg.toString())
        if (data.status === 'done' && data.output) {
          clearTimeout(timeout)
          ws.terminate()
          resolve(data.output.url)
        } else if (data.error) {
          clearTimeout(timeout)
          ws.terminate()
          reject(new Error(data.error))
        }
      } catch (e) {}
    })

    ws.on('error', (err) => {
      clearTimeout(timeout)
      reject(new Error('WS Error: ' + err.message))
    })
  })
}

async function ssyoutube(url, resolusi = '720p') {
  const isAudio = resolusi.toLowerCase() === 'mp3' || resolusi.toLowerCase() === 'audio'
  const resKey = isAudio ? 'MP3' : (resolusi.endsWith('p') ? resolusi : `${resolusi}p`)

  const headers = {
    'User-Agent': UA,
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://ssyou.online',
    'Referer': 'https://ssyou.online/yt-video-detail/',
    'Connection': 'keep-alive',
    'X-Requested-With': 'XMLHttpRequest'
  }

  const detailRes = await axios.post('https://ssyou.online/yt-video-detail/',
    `videoURL=${encodeURIComponent(url)}`,
    { headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' } }
  )

  const html = detailRes.data
  const nonce = (html.match(/'X-WP-Nonce':\s*'([^']+)'/) || [])[1]
  const videoId = (html.match(/name="video_id" value="([^"]+)"/) || [])[1]
  const title = (html.match(/videoTitle[^>]*>\s*(.*?)\s*<\/div>/) || [])[1]?.trim() || 'video'

  if (!nonce || !videoId) throw new Error("Gagal mendapatkan Nonce/VideoID.")

  let formats = {}
  const formatUrlsMatch = html.match(/let cachedFormatUrls = ({[\s\S]*?});/)
  if (formatUrlsMatch) {
    const urlRegex = /'([^']+)'\s*:\s*'([^']+)'/g
    let m
    while ((m = urlRegex.exec(formatUrlsMatch[1])) !== null) {
      formats[m[1]] = m[2]
    }
  }

  const ajaxHeaders = {
    ...headers,
    'Content-Type': 'application/x-www-form-urlencoded',
    'x-wp-nonce': nonce
  }

  let audioUrl = formats['audio'] || formats['140'] || formats['251'] || formats['250'] || formats['249'] || formats['139']

  if (!audioUrl) {
    const rawAudioMatch = html.match(/https?:\/\/[^"'\s]*googlevideo\.com\/videoplayback[^"'\s]*mime=audio[^"'\s]*/)
    if (rawAudioMatch) {
      audioUrl = rawAudioMatch[0].replace(/\\/g, '')
    }
  }

  if (!audioUrl) throw new Error("Gagal menemukan link Audio YouTube di halaman ini.")

  let mergeData = {}

  if (isAudio) {
    mergeData = {
      id: `${videoId}_MP3`,
      ttl: 3600000,
      inputs: [{
        id: videoId,
        url: audioUrl,
        ext: "m4a",
        chunkDownload: { type: "header", size: 52428800, concurrency: 3 }
      }],
      output: {
        ext: "mp3",
        downloadName: `${title}.mp3`,
        chunkUpload: { size: 209715200, concurrency: 3 }
      },
      operation: { type: "no_process" }
    }
  } else {
    if (!formats[resKey]) throw new Error(`Resolusi ${resKey} tidak tersedia.`)
    mergeData = {
      id: `${videoId}_${resKey}`,
      ttl: 3600000,
      inputs: [
        {
          id: videoId,
          url: formats[resKey],
          ext: "mp4",
          chunkDownload: { type: "header", size: 52428800, concurrency: 3 }
        },
        {
          id: videoId,
          url: audioUrl,
          ext: "m4a",
          chunkDownload: { type: "header", size: 52428800, concurrency: 3 }
        }
      ],
      output: {
        ext: "mp4",
        downloadName: `${title}_${resKey}.mp4`,
        chunkUpload: { size: 209715200, concurrency: 3 }
      },
      operation: { type: "replace_audio_in_video" }
    }
  }

  const jobRes = await axios.post('https://ssyou.online/wp-admin/admin-ajax.php',
    new URLSearchParams({
      action: 'process_video_merge',
      nonce: nonce,
      request_data: JSON.stringify(mergeData)
    }).toString(),
    { headers: ajaxHeaders }
  )

  const jobJson = jobRes.data

  if (!jobJson.success) {
    throw new Error(`Server menolak request: ${jobJson.data || JSON.stringify(jobJson)}`)
  }

  let wsUrl = jobJson.data.result.monitor.websocket
  wsUrl = wsUrl.replace('http://', 'ws://').replace('https://', 'wss://')

  const renderResultUrl = await waitForRender(wsUrl)

  const proxyRes = await axios.post('https://ssyou.online/wp-admin/admin-ajax.php',
    new URLSearchParams({
      action: 'wp_get_proxied_url',
      targetUrl: renderResultUrl
    }).toString(),
    { headers: ajaxHeaders }
  )

  const proxyJson = proxyRes.data

  return {
    title,
    resolusi: isAudio ? 'mp3' : resKey,
    downloadUrl: proxyJson.success ? proxyJson.data.proxiedUrl : renderResultUrl
  }
}

export default {
  name: "YouTube Downloader V2",
  description: "Alternative YouTube downloader. Support MP3 & video up to 2160p.",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url", "quality"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "YouTube video URL"
    },
    quality: {
      type: "string",
      required: false,
      default: "720p",
      enum: ["mp3", "144p", "240p", "360p", "480p", "720p", "1080p", "1440p", "2160p"],
      description: "Kualitas: mp3, 144p, 240p, 360p, 480p, 720p, 1080p, 1440p, 2160p"
    }
  },

  async run(req, res) {
    try {
      const { url, quality = '720p' } = { ...req.query, ...req.body }

      if (!url || typeof url !== "string" || url.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi"
        })
      }

      const allowedQualities = ['mp3', '144p', '240p', '360p', '480p', '720p', '1080p', '1440p', '2160p']
      const q = quality.toLowerCase()
      if (!allowedQualities.includes(q)) {
        return res.status(400).json({
          status: false,
          message: "Kualitas tidak valid. Pilihan: mp3, 144p, 240p, 360p, 480p, 720p, 1080p, 1440p, 2160p"
        })
      }

      const result = await ssyoutube(url.trim(), q)

      res.json({
        status: true,
        result,
        timestamp: Date.now()
      })

    } catch (err) {
      console.error("[YouTube V2 Error]", err.message)

      let statusCode = 500
      let errorMessage = err.message || "Gagal mendownload dari YouTube"

      if (err.message.includes('Nonce') || err.message.includes('VideoID') || err.message.includes('tidak tersedia') || err.message.includes('tidak valid')) {
        statusCode = 400
      } else if (err.message.includes('tidak ditemukan') || err.message.includes('menolak')) {
        statusCode = 404
      }

      res.status(statusCode).json({
        status: false,
        message: errorMessage,
        timestamp: Date.now()
      })
    }
  }
}
