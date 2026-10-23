import logger from '../../src/utils/logger.js'

const IA = 'https://archive.org'
const IA_SEARCH = `${IA}/advancedsearch.php`
const IA_META = `${IA}/metadata`
const IA_DOWNLOAD = `${IA}/download`

// Koleksi film yang isinya bebas hak cipta.
const COLLECTIONS = {
  feature_films: 'Film fitur (1930-an, komedi, melodrama)',
  silent_films: 'Film bisu',
  film_noir: 'Film noir',
  classic_cartoons: 'Kartun klasik',
  animationandcartoons: 'Animasi & kartun',
  '16mmfilms': 'Film 16mm',
  Film_Noir: 'Film noir (varian kapital)',
}

// Koleksi film era pra-1940 memuat judul bertema dewasa. Istilah di bawah
// diambil dari field subject yang dipakai pengulupload untuk menandainya.
const ADULT_TERMS = [
  'nudity', 'nudie', 'nude', 'sexploitation', 'sexploition', 'sexploitation',
  'stripping', 'striptease', 'peeping tom', 'erotic', 'pornograph', 'porn',
  'softcore', 'hentai', 'fetish', 'sexual', 'sex ', ' sex', 'burlesque',
  'exploitation', 'venereal', 'prostitut', 'eroticism', 'burlesque show',
  'seduction', 'loose women', 'vice', 'corruption',
]

const hasAdult = (subjects) => {
  const list = (Array.isArray(subjects) ? subjects : [subjects || '']).join(' | ').toLowerCase()
  return ADULT_TERMS.some((t) => list.includes(t))
}

const list = (v) => (Array.isArray(v) ? v : v ? [v] : [])

async function fetchJson(url, timeout = 20000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; apiku/1.0)', Accept: 'application/json' },
    signal: AbortSignal.timeout(timeout),
  })
  if (!res.ok) throw new Error(`Sumber data HTTP ${res.status} — ${res.statusText}`)
  return res.json()
}

async function doSearch({ query = '', collection = 'feature_films', subject = '', year = '', sort = 'downloads', page = 1, rows = 20, adult = false }) {
  const coll = COLLECTIONS[collection] ? collection : 'feature_films'
  const p = Math.max(1, Number(page) || 1)
  const n = Math.min(50, Math.max(1, Number(rows) || 20))

  const clauses = [`collection:${coll}`, 'mediatype:movies']
  if (query) clauses.push(`(${query})`)
  if (subject) clauses.push(`subject:${subject}`)
  if (year) clauses.push(`year:${year}`)

  const sortMap = {
    date: 'publicdate desc',
    title: 'titleSorter asc',
    random: 'random',
    downloads: 'downloads desc',
  }

  const params = new URLSearchParams({
    q: clauses.join(' AND '),
    rows: String(n),
    page: String(p),
    output: 'json',
    sort: sortMap[sort] || sortMap.downloads,
  })
  for (const f of ['identifier', 'title', 'year', 'subject', 'downloads', 'runtime', 'creator', 'description', 'publicdate', 'avg_rating']) {
    params.append('fl[]', f)
  }

  const data = await fetchJson(`${IA_SEARCH}?${params}`)
  const total = data?.response?.numFound ?? 0
  let docs = data?.response?.docs ?? []
  if (!adult) docs = docs.filter((d) => !hasAdult(d.subject))

  return {
    total,
    page: p,
    totalPages: Math.ceil(total / n),
    collection: coll,
    results: docs.map((d) => ({
      identifier: d.identifier,
      title: d.title || d.identifier,
      year: d.year || null,
      runtime: d.runtime || null,
      creator: list(d.creator)[0] || null,
      subjects: list(d.subject).slice(0, 6),
      downloads: d.downloads || 0,
      rating: d.avg_rating || null,
      released: d.publicdate || null,
      page: `${IA}/details/${d.identifier}`,
    })),
  }
}

async function doDetail(identifier, { adult = false } = {}) {
  const id = String(identifier || '').trim()
  if (!id) throw new Error('Parameter "identifier" wajib diisi.')
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('Format identifier tidak valid.')

  const data = await fetchJson(`${IA_META}/${encodeURIComponent(id)}`)
  const m = data?.metadata || {}
  if (!Object.keys(m).length) throw new Error(`Film "${id}" tidak ditemukan.`)

  if (!adult && hasAdult(m.subject)) {
    throw new Error(
      `Film "${id}" ditandai bertema dewasa dan tidak ditampilkan. ` +
      'Kirim adult=true bila memang perlu.'
    )
  }

  const videos = (data.files || [])
    .filter((f) => /\.(mp4|m4v|ogv|mpeg|mpg|webm)$/i.test(f.name) && !f.name.startsWith('.'))
    .map((f) => ({
      name: f.name,
      size: Number(f.size) || 0,
      sizeMB: Math.round(((Number(f.size) || 0) / 1048576) * 10) / 10,
      format: f.format || null,
      height: f.height || null,
      width: f.width || null,
      length: f.length || null,
      url: `${IA_DOWNLOAD}/${id}/${encodeURIComponent(f.name)}`,
    }))
    .sort((a, b) => (a.sizeMB || 0) - (b.sizeMB || 0))

  const thumbs = (data.files || [])
    .filter((f) => /^__ia_thumb|thumb|_\.jpg$/i.test(f.name))
    .map((f) => `${IA_DOWNLOAD}/${id}/${encodeURIComponent(f.name)}`)

  return {
    identifier: id,
    title: m.title || id,
    year: m.year || null,
    date: m.date || null,
    runtime: m.runtime || null,
    creator: list(m.creator),
    description: typeof m.description === 'string' ? m.description : list(m.description)[0] || null,
    subjects: list(m.subject),
    language: list(m.language),
    rights: m.rights || 'Public domain',
    page: `${IA}/details/${id}`,
    thumbnail: thumbs[0] || `${IA}/services/img/${id}`,
    videoCount: videos.length,
    videos,
  }
}

function pickVideo(videos, { maxSizeMB = 0, file = '' } = {}) {
  let pool = videos
  if (file) {
    const picked = videos.find((v) => v.name === file)
    if (!picked) throw new Error(`File "${file}" tidak ada di film ini.`)
    return { best: picked, pool: [picked] }
  }
  let mp4 = pool.filter((v) => /\.mp4$/i.test(v.name))
  if (mp4.length) pool = mp4
  const max = Number(maxSizeMB) || 0
  if (max > 0) {
    const capped = pool.filter((v) => !v.sizeMB || v.sizeMB <= max)
    if (capped.length) pool = capped
  }
  if (!pool.length) throw new Error('Tidak ada file video yang bisa di-stream.')
  return { best: pool[0], pool }
}

async function doStream(identifier, { maxSizeMB = 0, adult = false, file = '' } = {}) {
  const detail = await doDetail(identifier, { adult })
  const { best, pool } = pickVideo(detail.videos, { maxSizeMB, file })

  return {
    identifier: detail.identifier,
    title: detail.title,
    year: detail.year,
    file: best.name,
    sizeMB: best.sizeMB,
    height: best.height,
    width: best.width,
    // Host sumber mendukung Range + seek, tapi tidak mengirim header CORS.
    // URL ini aman dipakai langsung sebagai <video src>. Untuk fetch/XHR dari
    // browser (hls.js, canvas) pakai action=proxy.
    url: best.url,
    embedUrl: `https://archive.org/embed/${encodeURIComponent(detail.identifier)}`,
    directPlay: true,
    corsEnabled: false,
    proxy: `/api/movie/freemovie?action=proxy&identifier=${encodeURIComponent(detail.identifier)}${file ? `&file=${encodeURIComponent(file)}` : ''}`,
    thumbnail: detail.thumbnail,
    page: detail.page,
    alternatives: pool.slice(1, 6).map((v) => ({ file: v.name, sizeMB: v.sizeMB, url: v.url })),
  }
}

/**
 * Sajikan video langsung dari server ini lengkap dengan header streaming.
 *
 * Kenapa perlu: host sumber tidak mengirim Access-Control-Allow-Origin, jadi
 * <video src> boleh memutar tapi fetch/XHR dari browser diblokir. Action ini
 * meneruskan HTTP Range (seek), menambahkan CORS, dan mengirim byte-nya.
 */
async function doProxy(identifier, req, res, { maxSizeMB = 0, adult = false, file = '' } = {}) {
  const detail = await doDetail(identifier, { adult })
  const { best } = pickVideo(detail.videos, { maxSizeMB, file })

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...cors, 'Access-Control-Max-Age': '86400' })
    return res.end()
  }

  const upstreamHeaders = { 'User-Agent': 'Mozilla/5.0 (compatible; apiku/1.0)' }
  if (req.headers.range) upstreamHeaders.Range = req.headers.range

  const upstream = await fetch(best.url, {
    headers: upstreamHeaders,
    redirect: 'follow',
    signal: AbortSignal.timeout(60000),
  })

  if (!upstream.ok && upstream.status !== 206) {
    return res.status(502).json({
      status: false,
      message: `Gagal mengambil video dari sumber (HTTP ${upstream.status})`,
    })
  }

  const headers = {
    ...cors,
    'Content-Type': upstream.headers.get('content-type') || 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400',
    'Content-Disposition': `inline; filename="${best.name.replace(/"/g, '')}"`,
  }
  const len = upstream.headers.get('content-length')
  const range = upstream.headers.get('content-range')
  if (len) headers['Content-Length'] = len
  if (range) headers['Content-Range'] = range

  if (req.method === 'HEAD') {
    res.writeHead(upstream.status, headers)
    return res.end()
  }

  res.writeHead(upstream.status, headers)

  if (!upstream.body) return res.end()
  const reader = upstream.body.getReader()
  let aborted = false
  req.on('close', () => {
    aborted = true
    reader.cancel().catch(() => {})
  })

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done || aborted) break
      if (!res.write(Buffer.from(value))) {
        await new Promise((r) => res.once('drain', r))
      }
    }
  } catch (e) {
    if (!aborted) logger.warn(`[Free Movie] proxy terputus: ${e.message}`)
  }
  res.end()
}

export default {
  name: 'Free Movie',
  description: 'Katalog dan stream film gratis bebas hak cipta (Internet Archive) — list, search, detail, stream',
  category: 'Movie',
  methods: ['GET', 'POST', 'HEAD', 'OPTIONS'],
  params: ['action', 'query', 'identifier', 'collection', 'subject', 'year', 'sort', 'page', 'rows', 'maxSize', 'adult', 'file'],
  paramsSchema: {
    action: {
      type: 'string',
      required: true,
      enum: ['list', 'search', 'detail', 'stream', 'proxy'],
      description: 'Aksi: list, search, detail, stream (URL), proxy (byte video + CORS)',
      default: 'list',
    },
    query: {
      type: 'string',
      required: false,
      description: 'Keyword pencarian judul (action=search)',
      example: 'chaplin',
    },
    identifier: {
      type: 'string',
      required: false,
      description: 'Kode film (action=detail, stream)',
      example: 'CC_1916_10_02_ThePawnshop',
    },
    collection: {
      type: 'string',
      required: false,
      description: 'Koleksi film bebas hak cipta',
      enum: Object.keys(COLLECTIONS),
      default: 'feature_films',
    },
    subject: {
      type: 'string',
      required: false,
      description: 'Filter genre (action=list, search)',
      example: 'comedy',
    },
    year: {
      type: 'string',
      required: false,
      description: 'Filter tahun rilis (action=list, search)',
      example: '1916',
    },
    sort: {
      type: 'string',
      required: false,
      description: 'Urutan hasil',
      enum: ['downloads', 'date', 'title', 'random'],
      default: 'downloads',
    },
    page: {
      type: 'number',
      required: false,
      description: 'Nomor halaman',
      default: 1,
    },
    rows: {
      type: 'number',
      required: false,
      description: 'Jumlah hasil per halaman (maks 50)',
      default: 20,
    },
    maxSize: {
      type: 'number',
      required: false,
      description: 'Batas ukuran file (MB) untuk action=stream',
      example: 200,
    },
    adult: {
      type: 'boolean',
      required: false,
      description: 'Sertakan film bertema dewasa (default: disembunyikan)',
      default: false,
    },
    file: {
      type: 'string',
      required: false,
      description: 'Nama file spesifik (action=stream, proxy). Default: mp4 paling ringan',
      example: 'CC_1916_10_02_ThePawnshop_512kb.mp4',
    },
  },

  async run(req, res) {
    const {
      action, query, identifier, collection, subject, year,
      sort, page, rows, maxSize, adult, file,
    } = { ...req.query, ...req.body }

    const a = String(action || 'list').trim().toLowerCase()
    const adultFlag = adult === true || adult === 'true' || adult === '1'

    try {
      if (a === 'list' || a === 'search') {
        const q = String(query || '').trim()
        if (a === 'search' && !q) {
          return res.status(400).json({
            status: false,
            message: 'Parameter "query" wajib untuk action=search',
          })
        }
        const data = await doSearch({ query: q, collection, subject, year, sort, page, rows, adult: adultFlag })
        return res.json({ status: true, action: a, ...data })
      }

      if (a === 'detail') {
        if (!identifier) {
          return res.status(400).json({
            status: false,
            message: 'Parameter "identifier" wajib untuk action=detail',
          })
        }
        const d = await doDetail(identifier, { adult: adultFlag })
        return res.json({ status: true, action: a, result: d })
      }

      if (a === 'stream') {
        if (!identifier) {
          return res.status(400).json({
            status: false,
            message: 'Parameter "identifier" wajib untuk action=stream',
          })
        }
        const s = await doStream(identifier, { maxSizeMB: maxSize, adult: adultFlag, file })
        return res.json({ status: true, action: a, result: s })
      }

      if (a === 'proxy' || a === 'play') {
        if (!identifier) {
          return res.status(400).json({
            status: false,
            message: 'Parameter "identifier" wajib untuk action=proxy',
          })
        }
        // Balasan berupa byte video, bukan JSON — jangan pakai res.json.
        return doProxy(identifier, req, res, { maxSizeMB: maxSize, adult: adultFlag, file })
      }

      return res.status(400).json({
        status: false,
        message: `Action "${action}" tidak dikenal. Pilihan: list, search, detail, stream, proxy`,
      })
    } catch (err) {
      logger.error(`[Public Domain Films] ${a}: ${err.message}`)
      return res.status(500).json({
        status: false,
        action: a,
        message: err.message,
      })
    }
  },
}
