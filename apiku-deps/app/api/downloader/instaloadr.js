/**
 * Instaloadr Instagram Downloader
 * Provider : https://www.instaloadr.com
 * Supports : Instagram Reels, Posts, Videos, Photos
 *
 * GET  /api/downloader/instaloadr?url=<instagram-url>
 * POST /api/downloader/instaloadr -d {"url": "..."}
 */

import axios from 'axios'

const BASE_URL = 'https://www.instaloadr.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'

async function igDownloader(link) {
  const response = await axios.post(
    `${BASE_URL}/api/fetch`,
    {
      url: link,
      media_type: 'post'
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        referer: `${BASE_URL}/`,
        origin: BASE_URL
      },
      timeout: 30000
    }
  )
  return response.data
}

export default {
  name: 'Instaloadr Instagram Downloader',
  description: 'Download Reels, Video, dan Foto Instagram dengan mudah dan cepat. Mendukung URL post/reel Instagram publik. Menghasilkan link download langsung, thumbnail, dan audio terpisah.',
  category: 'Downloader',
  methods: ['GET', 'POST'],
  params: ['url'],
  paramsSchema: {
    url: {
      type: 'string',
      required: true,
      description: 'URL post atau reels Instagram yang ingin didownload',
      example: 'https://www.instagram.com/reel/Dc9ikbnT_z-/'
    }
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body }
    const target = (params.url || params.link || '').toString().trim()

    if (!target) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'url' wajib diisi. Masukkan URL post atau reels Instagram."
      })
    }

    if (!/instagram\.com\/(p|reel|tv)\//i.test(target)) {
      return res.status(400).json({
        status: false,
        message: 'URL tidak valid. Contoh yang benar: https://www.instagram.com/reel/xxx/'
      })
    }

    try {
      const data = await igDownloader(target)

      if (!data?.items?.length) {
        return res.status(404).json({
          status: false,
          message: 'Media tidak ditemukan. Pastikan URL benar dan akun tidak privat.'
        })
      }

      return res.json({
        status: true,
        source_url: data.source_url || target,
        total: data.items.length,
        result: data.items.map(item => ({
          type: item.media_type || 'mp4',
          download_url: item.download_url || null,
          thumbnail_url: item.thumbnail_url || null,
          audio_url: item.audio_url || null,
          width: item.width || null,
          height: item.height || null,
          duration: item.duration || null
        }))
      })
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.response?.data?.message || err.message || 'Gagal mengambil media Instagram dari Instaloadr'
      })
    }
  }
}
