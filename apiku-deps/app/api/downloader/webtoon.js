import axios from "axios"
import * as cheerio from "cheerio"
import PDFDocument from "pdfkit"
import fs from "fs"
import path from "path"
import sizeOf from "image-size"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': 'https://www.webtoons.com'
}

async function searchWebtoon(query) {
  let { data } = await axios.get(`https://www.webtoons.com/id/search?keyword=${encodeURIComponent(query)}`, { headers: HEADERS })
  let $ = cheerio.load(data)
  let link = $('.card_lst li a, .webtoon_list li a, .search_result li a').first().attr('href')

  if (!link) throw new Error(`Komik "${query}" tidak ditemukan.`)
  let detailUrl = link.startsWith('http') ? link : `https://www.webtoons.com${link}`

  let { data: detailData } = await axios.get(detailUrl, { headers: HEADERS })
  let $$ = cheerio.load(detailData)

  let episodes = $$('#_episodeList li, .detail_lst li').map((i, el) => ({
    index: i + 1,
    title: $$(el).find('.subj span, .subj').first().text().trim() || `Episode ${i + 1}`,
    url: $$(el).find('a').attr('href').startsWith('http') ? $$(el).find('a').attr('href') : `https://www.webtoons.com${$$(el).find('a').attr('href')}`
  })).get().reverse()

  return {
    title: $$('.info .subj').first().text().trim() || $$('meta[property="og:title"]').attr('content').split('|')[0].trim(),
    author: $$('.info .author').first().text().trim() || 'Unknown',
    synopsis: $$('.summary').first().text().trim() || $$('meta[property="og:description"]').attr('content'),
    link: detailUrl,
    episodes: episodes
  }
}

async function downloadWebtoonPDF(query, epIndex, outputDir = './temp') {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

  let webtoon = await searchWebtoon(query)
  let ep = webtoon.episodes[epIndex - 1]

  if (!ep) throw new Error(`Episode ke-${epIndex} tidak tersedia.`)

  let { data } = await axios.get(ep.url, { headers: HEADERS })
  let $ = cheerio.load(data)
  let images = $('#_imageList img, .viewer_img img').map((i, el) => $(el).attr('data-url') || $(el).attr('src')).get().filter(src => src.startsWith('http'))

  if (!images.length) throw new Error('Tidak ada gambar di episode ini.')

  let safeTitle = webtoon.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)
  let fileName = `${safeTitle}_Ep${epIndex}.pdf`
  let outputPath = path.join(outputDir, fileName)

  let doc = new PDFDocument({ autoFirstPage: false, margin: 0 })
  let stream = fs.createWriteStream(outputPath)
  doc.pipe(stream)

  for (let img of images) {
    try {
      let imgRes = await axios.get(img, { responseType: 'arraybuffer', headers: HEADERS, timeout: 30000 })
      let imgBuffer = Buffer.from(imgRes.data)
      let dims = sizeOf(imgBuffer)
      let w = dims.width || 800
      let h = dims.height || 1200

      doc.addPage({ size: [w, h], margin: 0 })
      doc.image(imgBuffer, 0, 0, { width: w, height: h })
    } catch (err) {}
  }

  doc.end()
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve)
    stream.on('error', reject)
  })

  return {
    title: webtoon.title,
    episode: ep.title,
    pages: images.length,
    outputPath,
    fileName
  }
}

async function getWebtoonInfo(query) {
  return await searchWebtoon(query)
}

export default {
  name: "Webtoon Downloader",
  description: "Cari dan download episode Webtoon ke PDF.",
  category: "Downloader",
  methods: ["GET"],
  params: ["query", "action", "episode"],

  paramsSchema: {
    query: {
      type: "string",
      required: true,
      description: "Judul komik Webtoon"
    },
    action: {
      type: "string",
      required: false,
      description: "Tindakan: 'search' (default) atau 'download'"
    },
    episode: {
      type: "number",
      required: false,
      description: "Nomor episode (required jika action=download)"
    }
  },

  features: {
    search: true,
    download_pdf: true
  },

  async run(req, res) {
    try {
      const { query, action, episode } = req.query || {}

      if (!query || typeof query !== "string" || query.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'query' wajib diisi",
        })
      }

      if (action === "download") {
        const ep = parseInt(episode)
        if (!ep || ep < 1) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'episode' wajib diisi (angka positif)",
          })
        }

        const result = await downloadWebtoonPDF(query.trim(), ep)
        res.json({
          status: true,
          result,
          timestamp: Date.now(),
        })
      } else {
        const info = await getWebtoonInfo(query.trim())
        res.json({
          status: true,
          result: {
            title: info.title,
            author: info.author,
            synopsis: info.synopsis?.substring(0, 500),
            link: info.link,
            total_episodes: info.episodes.length,
            episodes: info.episodes.map(e => ({ index: e.index, title: e.title }))
          },
          timestamp: Date.now(),
        })
      }

    } catch (err) {
      console.error("Webtoon Error:", err.message)

      let statusCode = 500
      let errorMessage = err.message || "Gagal memproses Webtoon"

      if (err.message.includes('tidak ditemukan')) {
        statusCode = 404
      }

      res.status(statusCode).json({
        status: false,
        message: errorMessage,
        timestamp: Date.now()
      })
    }
  },
}
