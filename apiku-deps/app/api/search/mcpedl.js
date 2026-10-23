import axios from "axios"
import * as cheerio from "cheerio"

const HEADERS_ORG = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
}

const MCPEDL_COM_API = "https://api.mcpedl.com/api"
const HEADERS_COM = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Origin': 'https://mcpedl.com',
  'Referer': 'https://mcpedl.com/'
}

function normalizeSlug(rawInput) {
  if (!rawInput) return ''
  let clean = rawInput.trim()
  clean = clean.replace(/^https?:\/\/[^\/]+\//, '')
  clean = clean.replace(/^\/+|\/+$/g, '')
  clean = clean.split('?')[0].split('#')[0]
  const parts = clean.split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

// -------------------------------------------------------------
// MCPEDL.ORG Scraping Functions
// -------------------------------------------------------------
async function searchMcpedlOrg(query, maxResult = 10) {
  try {
    const { data } = await axios.get(`https://mcpedl.org/?s=${encodeURIComponent(query)}`, {
      headers: HEADERS_ORG,
      timeout: 10000
    })
    const $ = cheerio.load(data)
    const results = []

    $('.g-block.size-20 article, article.tease-post').each((i, el) => {
      if (results.length >= maxResult) return false

      const title = $(el).find('.entry-title a').text().trim()
      const link = $(el).find('.entry-title a').attr('href') || ''
      const image = $(el).find('.post-thumbnail img').attr('data-srcset')
        || $(el).find('.post-thumbnail img').attr('src')
        || null
      const rating = $(el).find('.rating-wrapper span').text().trim() || null
      const slug = normalizeSlug(link)

      if (title) {
        results.push({
          title,
          slug: slug || null,
          url: link || null,
          thumbnail: image || null,
          rating: rating || null,
          source: "mcpedl.org"
        })
      }
    })

    return results
  } catch (err) {
    console.error("mcpedl.org search error:", err.message)
    return []
  }
}

async function getOrgDetail(targetUrl) {
  const cleanUrl = targetUrl.startsWith('http') ? targetUrl : `https://mcpedl.org/${targetUrl.replace(/^\/+/, '')}/`
  const { data } = await axios.get(cleanUrl, {
    headers: HEADERS_ORG,
    timeout: 12000
  })
  const $ = cheerio.load(data)

  const title = $('h1.entry-title').text().trim() || $('title').text().trim()
  const description = $('.entry-content p').first().text().trim()
  const image = $('.post-thumbnail img').attr('src') || $('meta[property="og:image"]').attr('content') || null
  const rating = $('.vote_block').attr('data-rating')
    || $('.rating-wrapper span').first().text().trim()
    || null

  const downloadForms = []
  $('form[action*="show_file.php"]').each((_, el) => {
    const post_title = $(el).find('input[name="post_title"]').val()
    const file_id = $(el).find('input[name="file_id"]').val()
    const post_url = $(el).find('input[name="post_url"]').val() || cleanUrl
    if (file_id) {
      downloadForms.push({ post_title, file_id, post_url })
    }
  })

  const downloads = []
  for (const form of downloadForms) {
    try {
      const res = await axios.post('https://mcpedl.org/show_file.php',
        new URLSearchParams(form).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': cleanUrl,
            ...HEADERS_ORG
          },
          timeout: 8000
        }
      )
      const $f = cheerio.load(res.data)
      const onclick = $f('button[onclick*="window.location.href"]').attr('onclick') || ''
      const match = onclick.match(/window\.location\.href='([^']+)'/)
      const btnText = $f('button[onclick*="window.location.href"]').text().trim()
      if (match && match[1]) {
        downloads.push({
          name: btnText || form.post_title || "Download File",
          url: match[1]
        })
      }
    } catch (e) {
      console.warn("mcpedl.org file_id resolve warning:", e.message)
    }
  }

  return {
    title,
    slug: normalizeSlug(cleanUrl),
    url: cleanUrl,
    thumbnail: image,
    description: description || null,
    rating,
    source: "mcpedl.org",
    downloads
  }
}

// -------------------------------------------------------------
// MCPEDL.COM API Functions
// -------------------------------------------------------------
async function searchMcpedlCom(query, page = 1, perPage = 10) {
  try {
    const url = `${MCPEDL_COM_API}/search/advanced?q=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}`
    const { data } = await axios.get(url, {
      headers: HEADERS_COM,
      timeout: 10000
    })

    const results = data.results || []
    return results.map(item => ({
      title: item.title,
      slug: item.slug,
      url: `https://mcpedl.com/${item.slug}`,
      thumbnail: item.image || null,
      rating: item.average_rating ? parseFloat(item.average_rating).toFixed(1) : null,
      downloads: item.downloadCount || 0,
      summary: item.summary || null,
      author: item.display_name || item.user_nicename || null,
      tags: (item.cf_tags || []).map(t => t.name),
      source: "mcpedl.com"
    }))
  } catch (err) {
    console.error("mcpedl.com search error:", err.message)
    return []
  }
}

async function getComDetail(rawSlug) {
  const cleanSlug = normalizeSlug(rawSlug)
  if (!cleanSlug) {
    throw new Error("Slug mcpedl.com tidak valid.")
  }

  const url = `${MCPEDL_COM_API}/route/slug/${encodeURIComponent(cleanSlug)}`
  const { data: res } = await axios.get(url, {
    headers: HEADERS_COM,
    timeout: 12000
  })

  if (!res || !res.data) {
    throw new Error(`Data tidak ditemukan untuk slug: "${cleanSlug}"`)
  }

  const raw = res.data
  return {
    id: raw.id,
    title: raw.title,
    slug: cleanSlug,
    url: `https://mcpedl.com/${cleanSlug}`,
    source: "mcpedl.com",
    status: raw.status || "PUBLISHED",
    type_id: raw.type_id,
    rating: {
      average: parseFloat(raw.average_rating) || 0,
      downloads: raw.download_count || 0
    },
    dates: {
      created: raw.created_at || raw.publish_date || null,
      updated: raw.updated_at || raw.update_date || null
    },
    author: raw.user ? {
      name: raw.user.display_name || raw.username,
      username: raw.user.user_nicename || raw.username,
      avatar: raw.user.avatar || null
    } : (raw.username ? { name: raw.username } : null),
    categories: (raw.categories || []).map(c => ({ id: c.id, name: c.name, slug: c.slug })),
    tags: (raw.cf_tags && raw.cf_tags.length > 0)
      ? raw.cf_tags.map(t => ({ id: t.id, name: t.name, slug: t.slug, icon: t.iconUrl }))
      : (raw.tags || []).map(t => ({ id: t.id, name: t.name, slug: t.slug })),
    media: {
      cover: raw.image || null,
      screenshots: raw.submission_images || []
    },
    short_description: raw.short_description || null,
    description: raw.description || null,
    changelog: raw.changelog || null,
    downloads: (raw.downloads || []).map(dl => ({
      id: dl.id,
      name: dl.name || dl.display_name,
      url: dl.file,
      date: dl.fileDate,
      type: dl.type
    })),
    downloads_vip: (raw.downloads_vip || []).map(dl => ({
      id: dl.id,
      name: dl.name || dl.display_name,
      url: dl.file,
      date: dl.fileDate
    })),
    links: {
      curseforge: raw.cf_link || null,
      website: raw.website_link || null
    }
  }
}

async function getComHome() {
  const [fpV2, fpV1, carouselFp] = await Promise.allSettled([
    axios.get(`${MCPEDL_COM_API}/search/frontpage/v2`, { headers: HEADERS_COM, timeout: 10000 }),
    axios.get(`${MCPEDL_COM_API}/search/frontpage`, { headers: HEADERS_COM, timeout: 10000 }),
    axios.get(`${MCPEDL_COM_API}/carousels/fp`, { headers: HEADERS_COM, timeout: 10000 })
  ])

  const v2Data = fpV2.status === 'fulfilled' ? fpV2.value.data : null
  const v1Data = fpV1.status === 'fulfilled' ? fpV1.value.data : null
  const bannerData = carouselFp.status === 'fulfilled' ? carouselFp.value.data : null

  return {
    source: "mcpedl.com",
    featured_banners: bannerData?.data || [],
    shelves: v2Data?.shelves || {},
    category_highlights: v1Data || {}
  }
}

async function getComTags() {
  const { data } = await axios.get(`${MCPEDL_COM_API}/search/tags`, {
    headers: HEADERS_COM,
    timeout: 10000
  })
  const roots = data.roots || []
  return {
    source: "mcpedl.com",
    total_root_categories: roots.length,
    categories: roots
  }
}

// -------------------------------------------------------------
// Export Handler
// -------------------------------------------------------------
export default {
  name: "MCPEDL Search & Downloader",
  description: "Cari mod/addon/texture/map Minecraft Bedrock dari MCPEDL (.com & .org), lihat detail konten, dan dapatkan link direct download file (.mcpack, .mcaddon, .zip).",
  category: "Search",
  methods: ["GET"],
  params: ["query", "url", "slug", "source", "action", "max", "page"],

  paramsSchema: {
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian mod/map/texture"
    },
    url: {
      type: "string",
      required: false,
      description: "URL konten MCPEDL (.com atau .org) untuk mengambil detail & link download"
    },
    slug: {
      type: "string",
      required: false,
      description: "Slug konten mcpedl.com untuk mengambil detail & link download"
    },
    source: {
      type: "string",
      required: false,
      description: "Sumber data: 'all' (gabungan .com & .org, default), 'com', atau 'org'"
    },
    action: {
      type: "string",
      required: false,
      description: "Aksi: 'search' (default), 'detail', 'home' (featured/frontpage), 'tags' (kategori/taxonomy)"
    },
    max: {
      type: "number",
      required: false,
      description: "Jumlah hasil maksimal per sumber (default: 10, max: 30)"
    },
    page: {
      type: "number",
      required: false,
      description: "Nomor halaman pencarian (default: 1)"
    }
  },

  features: {
    platform: "MCPEDL (.com & .org)",
    region: "Global"
  },

  async run(req, res) {
    try {
      const {
        query,
        url,
        slug,
        source = "all",
        action,
        max,
        page
      } = req.query || {}

      const selectedSource = (source || "all").toLowerCase().trim()
      const selectedAction = (action || "").toLowerCase().trim()

      // 1. Home / Frontpage Action
      if (selectedAction === "home" || selectedAction === "frontpage") {
        const homeData = await getComHome()
        return res.json({
          status: true,
          action: "home",
          result: homeData,
          timestamp: Date.now()
        })
      }

      // 2. Tags / Categories Action
      if (selectedAction === "tags" || selectedAction === "categories") {
        const tagsData = await getComTags()
        return res.json({
          status: true,
          action: "tags",
          result: tagsData,
          timestamp: Date.now()
        })
      }

      // 3. Detail Action (Explicit action=detail, or provided url / slug, or query contains url)
      const isUrlQuery = query && typeof query === "string" && (query.startsWith("http://") || query.startsWith("https://"))
      const targetDetail = url || slug || (selectedAction === "detail" ? query : null) || (isUrlQuery ? query : null)

      if (targetDetail && typeof targetDetail === "string") {
        const cleanTarget = targetDetail.trim()
        let detailResult = null

        // Check if it's mcpedl.org
        if (cleanTarget.includes("mcpedl.org")) {
          detailResult = await getOrgDetail(cleanTarget)
        } else {
          // Default to mcpedl.com
          try {
            detailResult = await getComDetail(cleanTarget)
          } catch (comErr) {
            // Fallback attempt to org if com fails and target wasn't explicitly com
            if (!cleanTarget.includes("mcpedl.com")) {
              try {
                detailResult = await getOrgDetail(cleanTarget)
              } catch (orgErr) {
                throw comErr
              }
            } else {
              throw comErr
            }
          }
        }

        return res.json({
          status: true,
          action: "detail",
          result: detailResult,
          timestamp: Date.now()
        })
      }

      // 4. Search Action (Default)
      if (!query || typeof query !== "string" || query.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'query' wajib diisi untuk pencarian, atau gunakan parameter 'url'/'slug' untuk melihat detail & download."
        })
      }

      const q = query.trim()
      const maxResult = Math.min(parseInt(max) || 10, 30)
      const pageNum = Math.max(parseInt(page) || 1, 1)

      let items = []
      let comCount = 0
      let orgCount = 0

      if (selectedSource === "com") {
        const comItems = await searchMcpedlCom(q, pageNum, maxResult)
        items = comItems.slice(0, maxResult)
        comCount = comItems.length
      } else if (selectedSource === "org") {
        const orgItems = await searchMcpedlOrg(q, maxResult)
        items = orgItems.slice(0, maxResult)
        orgCount = orgItems.length
      } else {
        // Source === "all": Gabungkan .com dan .org secara paralel
        const [comSettled, orgSettled] = await Promise.allSettled([
          searchMcpedlCom(q, pageNum, maxResult),
          searchMcpedlOrg(q, maxResult)
        ])

        const comItems = comSettled.status === "fulfilled" ? comSettled.value : []
        const orgItems = orgSettled.status === "fulfilled" ? orgSettled.value : []
        comCount = comItems.length
        orgCount = orgItems.length

        // Interleave kedua sumber agar seimbang
        const maxLength = Math.max(comItems.length, orgItems.length)
        for (let i = 0; i < maxLength; i++) {
          if (i < comItems.length && items.length < maxResult * 2) {
            items.push(comItems[i])
          }
          if (i < orgItems.length && items.length < maxResult * 2) {
            items.push(orgItems[i])
          }
        }
      }

      if (items.length === 0) {
        return res.status(404).json({
          status: false,
          message: `Mod/konten "${q}" tidak ditemukan di MCPEDL (${selectedSource}).`,
          timestamp: Date.now()
        })
      }

      return res.json({
        status: true,
        action: "search",
        result: {
          total: items.length,
          sources: {
            selected: selectedSource,
            com: comCount,
            org: orgCount
          },
          items: items.map((item, i) => ({
            index: i + 1,
            title: item.title,
            slug: item.slug || null,
            url: item.url,
            thumbnail: item.thumbnail,
            rating: item.rating,
            downloads: item.downloads !== undefined ? item.downloads : null,
            summary: item.summary || null,
            author: item.author || null,
            tags: item.tags || [],
            source: item.source
          }))
        },
        timestamp: Date.now()
      })

    } catch (err) {
      console.error("MCPEDL Error:", err.message)

      let statusCode = 500
      let errorMessage = err.message || "Gagal memproses permintaan MCPEDL"

      if (err.message.includes("tidak ditemukan") || err.message.includes("not found") || err.message.includes("404")) {
        statusCode = 404
      }

      return res.status(statusCode).json({
        status: false,
        message: errorMessage,
        timestamp: Date.now()
      })
    }
  }
}
