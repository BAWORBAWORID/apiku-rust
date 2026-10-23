/**
 * SnapInsta Instagram Story & Profile Downloader
 * Provider : https://snapinsta.im
 * Supports : Instagram Story, Highlights, Posts, Reels, Carousel, Profile Picture
 *
 * GET  /api/downloader/snapinsta?url=<instagram-username-or-url>
 * POST /api/downloader/snapinsta -d {"url": "..."}
 */

import axios from 'axios'
import * as cheerio from 'cheerio'

const BASE_URL = 'https://snapinsta.im'
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'

async function snapinsta(username) {
  const body = new URLSearchParams({
    url: username,
    scope: 'storyDownloader',
    locale: 'id',
    viewerVersion: 'profile-r3'
  })

  const { data: html } = await axios.post(
    `${BASE_URL}/process`,
    body.toString(),
    {
      headers: {
        accept: '*/*',
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        origin: BASE_URL,
        referer: `${BASE_URL}/`,
        'user-agent': UA,
        'x-requested-with': 'XMLHttpRequest'
      },
      timeout: 30000
    }
  )

  const $ = cheerio.load(html)

  const result = {
    username: $('.snap-viewer').attr('data-viewer-username') || null,
    session: $('.snap-viewer').attr('data-viewer-session') || null,
    profile: {
      name: $('.snap-profile h2').first().text().trim() || null,
      username: $('.premium-eyebrow').first().text().trim() || null,
      bio: $('.snap-bio-text').first().text().trim() || null,
      followers: $('.snap-profile-stats span').eq(0).find('strong').text().trim() || null,
      following: $('.snap-profile-stats span').eq(1).find('strong').text().trim() || null,
      image: $('.snap-profile > img').first().attr('src') || null,
      download: $('.snap-profile-actions a.download-media').first().attr('href') || null
    },
    highlights: [],
    stories: [],
    posts: []
  }

  $('.snap-profile-highlight').each((i, el) => {
    const item = $(el)
    result.highlights.push({
      id: item.attr('data-highlight-id') || null,
      title: item.find('span').text().trim() || null,
      image: item.find('img').attr('src') || null
    })
  })

  $('[data-profile-section="stories"] .snap-profile-group').each((i, el) => {
    const group = $(el)
    group.find('.snap-profile-card').each((j, card) => {
      const item = $(card)
      const media = item.find('.snap-open-media')
      result.stories.push({
        group: group.attr('data-profile-group') || null,
        type: media.attr('data-profile-play') || null,
        media: media.attr('data-playback-url') || null,
        thumbnail: media.find('img').attr('src') || null,
        download: item.find('a.download-media').attr('href') || null,
        mediaToken: item.find('.snap-media-options').attr('data-media-token') || null
      })
    })
  })

  $('[data-profile-section="posts"] .snap-profile-group').each((i, el) => {
    const group = $(el)
    const post = {
      id: group.attr('data-profile-group') || null,
      caption: group.find('.snap-post-caption').first().text().trim() || null,
      media: []
    }
    group.find('.snap-profile-card').each((j, card) => {
      const item = $(card)
      const media = item.find('.snap-open-media')
      post.media.push({
        type: media.attr('data-profile-play') || null,
        media: media.attr('data-playback-url') || null,
        thumbnail: media.find('img').attr('src') || null,
        download: item.find('a.download-media').attr('href') || null,
        mediaToken: item.find('.snap-media-options').attr('data-media-token') || null
      })
    })
    result.posts.push(post)
  })

  return result
}

export default {
  name: 'SnapInsta Instagram Story Downloader',
  description: 'Download Story, Highlights, Posts, Reels, Carousel, dan Foto Profil Instagram secara lengkap berdasarkan username atau URL profil. Powered by snapinsta.im.',
  category: 'Downloader',
  methods: ['GET', 'POST'],
  params: ['username', 'url'],
  paramsSchema: {
    username: {
      type: 'string',
      required: true,
      description: 'Username Instagram tanpa @ (contoh: cristiano)',
      example: 'cristiano'
    },
    url: {
      type: 'string',
      required: false,
      description: 'Alias. URL profil Instagram lengkap (contoh: https://instagram.com/cristiano). Dipakai kalau tidak ada username.',
      example: 'https://instagram.com/cristiano'
    }
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body }
    const raw = (params.username || params.user || params.url || '').toString().trim()

    if (!raw) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'username' wajib diisi (contoh: cristiano). Alternatif: 'url' dengan URL profil lengkap."
      })
    }

    // Normalize: jika hanya username (tanpa http), bersihkan simbol @
    const target = raw.startsWith('http') ? raw : raw.replace(/^@/, '')

    try {
      const result = await snapinsta(target)

      const isEmpty =
        !result.profile?.name &&
        !result.stories?.length &&
        !result.posts?.length &&
        !result.highlights?.length

      if (isEmpty) {
        return res.status(404).json({
          status: false,
          message: 'Profil tidak ditemukan, akun mungkin privat, atau tidak memiliki konten yang dapat diambil.'
        })
      }

      return res.json({
        status: true,
        result
      })
    } catch (err) {
      const upstreamStatus = err.response?.status
      if (upstreamStatus === 404 || upstreamStatus === 502 || upstreamStatus === 503) {
        return res.status(404).json({
          status: false,
          message:
            'Profil tidak ditemukan, akun mungkin privat, atau tidak ada konten yang bisa diambil untuk username ini.'
        })
      }
      return res.status(500).json({
        status: false,
        message: err.message || 'Gagal mengambil data Instagram dari SnapInsta'
      })
    }
  }
}
