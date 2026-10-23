const WEIBO_COOKIE = process.env.WEIBO_COOKIE || "SUB=_2AkMdOOs0f8NxqwFRnPEVyW3lZYV_zgDEieKrZBrvJRM3HRl-yT9xqm0mtRB6NrjF2ws6784K5UaFsG-d2l6wRLIjfKfI; SUBP=0033WrSXqPxfM72-Ws9jqgMF55529P9D9WWVYhi7Cl_K6n9h5dsHPg6m; MLOGIN=0; _T_WM=76852741608; XSRF-TOKEN=a84336"

const BASE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15",
  Referer: "https://m.weibo.cn/",
  Cookie: WEIBO_COOKIE,
  "X-Requested-With": "XMLHttpRequest",
  Accept: "application/json, text/plain, */*",
}

function extractPostId(input) {
  let id = input.trim()
  if (id.startsWith("http")) {
    const detailMatch = id.match(/m\.weibo\.cn\/(?:detail|status)\/(\d+)/)
    if (detailMatch) return detailMatch[1]
    const weiboMatch = id.match(/weibo\.com\/\d+\/(\d+)/)
    if (weiboMatch) return weiboMatch[1]
    const statusMatch = id.match(/weibo\.com\/\d+\/status\/(\d+)/)
    if (statusMatch) return statusMatch[1]
    return null
  }
  return /^\d+$/.test(id) ? id : null
}

async function fetchWeiboFeed(mode, keyword = "", sinceId = 0, pageNum = 1) {
  let targetUrl = ""
  if (mode === "home") {
    targetUrl = "https://m.weibo.cn/api/container/getIndex?containerid=102803&openApp=0"
    if (sinceId && sinceId !== "0") targetUrl += `&since_id=${sinceId}`
  } else if (mode === "search") {
    targetUrl = `https://m.weibo.cn/api/container/getIndex?containerid=100103type%3D1%26q%3D${encodeURIComponent(keyword)}&page_type=searchall&page=${pageNum}`
  }

  const res = await fetch(targetUrl, { headers: BASE_HEADERS })
  const json = JSON.parse(await res.text())

  if (json.ok === -100) {
    throw new Error("COOKIE EXPIRED — ambil cookie baru dari browser dan set WEIBO_COOKIE")
  }
  if (json.ok !== 1) {
    throw new Error(`Weibo API error: ${json.msg || "Unknown"}`)
  }

  let cards = json.data.cards || []
  const nextSinceId = mode === "home" ? (json.data.cardlistInfo?.since_id || 0) : null

  let parsedCards = []
  cards.forEach(c => {
    if (c.mblog) parsedCards.push(c)
    else if (c.card_group) c.card_group.forEach(cg => { if (cg.mblog) parsedCards.push(cg) })
  })

  parsedCards = parsedCards.slice(0, 20)

  const results = parsedCards.map(card => {
    const mblog = card.mblog
    const mediaSource = (mblog.page_info || (mblog.pics && mblog.pics.length > 0)) ? mblog : (mblog.retweeted_status || mblog)

    const textContent = mblog.text.replace(/<[^>]*>?/gm, "").trim()
    const rawMp4 = mediaSource.page_info?.media_info?.stream_url_hd || mediaSource.page_info?.media_info?.stream_url || null
    const coverVideoRaw = mediaSource.page_info?.page_pic?.url || null
    const durationRaw = mediaSource.page_info?.media_info?.duration || 0
    const images = (mediaSource.pics || []).map(p => p.large?.url || p.url)

    return {
      id: mblog.id || card.itemid,
      author: {
        name: mblog.user?.screen_name || "Unknown",
        followers: mblog.user?.followers_count_str || "0",
        verified_reason: mblog.user?.verified_reason || null,
      },
      created_at: mblog.created_at,
      location: mblog.region_name ? mblog.region_name.replace("发布于 ", "") : null,
      device: mblog.source || "Web",
      stats: {
        likes: mblog.attitudes_count || 0,
        comments: mblog.comments_count || 0,
        reposts: mblog.reposts_count || 0,
      },
      content: { text: textContent, is_repost: !!mblog.retweeted_status },
      media: {
        type: rawMp4 ? "video" : images.length > 0 ? "image" : "none",
        video: rawMp4 ? {
          views: mediaSource.page_info?.play_count || 0,
          duration_seconds: durationRaw,
          duration_str: durationRaw > 0 ? `${Math.floor(durationRaw / 60)}m ${Math.floor(durationRaw % 60)}s` : "-",
          cover_url: coverVideoRaw,
          mp4_url: rawMp4,
          original_page: mediaSource.page_info?.page_url || null,
        } : null,
        images: images,
      },
      original_post_url: card.scheme,
    }
  })

  return { count: results.length, next_page_token: nextSinceId, data: results }
}

async function fetchWeiboDetail(postId) {
  const res = await fetch(`https://m.weibo.cn/statuses/show?id=${postId}`, { headers: BASE_HEADERS })
  const json = JSON.parse(await res.text())

  if (json.ok !== 1 || !json.data) {
    throw new Error(`Failed to fetch post: ${json.msg || "Post not found"}`)
  }

  const m = json.data
  const textContent = (m.text || "").replace(/<[^>]*>?/gm, "").trim()
  const pi = m.page_info || {}
  const mi = pi.media_info || {}
  const rawMp4 = mi.stream_url_hd || mi.stream_url || null
  const durationRaw = mi.duration || 0
  const images = (m.pics || []).map(p => p.large?.url || p.url)
  const videoUrlMap = pi.urls || {}

  return {
    id: m.id,
    author: {
      name: m.user?.screen_name || "Unknown",
      id: m.user?.id || null,
      avatar: m.user?.avatar_hd || m.user?.profile_image_url || null,
      followers: m.user?.followers_count_str || "0",
      verified_reason: m.user?.verified_reason || null,
      description: m.user?.description || null,
    },
    created_at: m.created_at,
    location: m.region_name ? m.region_name.replace("发布于 ", "") : null,
    device: m.source || "Web",
    stats: {
      likes: m.attitudes_count || 0,
      comments: m.comments_count || 0,
      reposts: m.reposts_count || 0,
    },
    content: { text: textContent, is_repost: !!m.retweeted_status },
    media: {
      type: rawMp4 ? "video" : images.length > 0 ? "image" : "none",
      video: rawMp4 ? {
        views: pi.play_count || 0,
        duration_seconds: durationRaw,
        duration_str: durationRaw > 0 ? `${Math.floor(durationRaw / 60)}m ${Math.floor(durationRaw % 60)}s` : "-",
        cover_url: pi.page_pic?.url || null,
        mp4_url: rawMp4,
        mp4_720p: videoUrlMap.mp4_720p_mp4 || null,
        mp4_hd: videoUrlMap.mp4_hd_mp4 || null,
        mp4_ld: videoUrlMap.mp4_ld_mp4 || null,
        original_page: pi.page_url || null,
      } : null,
      images: images,
    },
    original_post_url: `https://m.weibo.cn/detail/${m.id}`,
  }
}

export default {
  name: "Weibo Downloader",
  description: "Download media dari Weibo China — feed home, search, atau detail post. Support video & gambar.",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["mode", "id", "url", "keyword", "since_id", "page"],
  paramsSchema: {
    mode: {
      type: "string",
      required: true,
      enum: ["home", "search", "detail"],
      description: "Mode: home (feed trending), search (cari keyword), detail (post spesifik via url/id)",
    },
    id: {
      type: "string",
      required: false,
      description: "ID post Weibo untuk mode=detail. Contoh: 5041234567890123",
    },
    url: {
      type: "string",
      required: false,
      description: "URL post Weibo untuk mode=detail. Contoh: https://m.weibo.cn/detail/5041234567890123",
    },
    keyword: {
      type: "string",
      required: false,
      description: "Keyword pencarian (untuk mode=search)",
    },
    since_id: {
      type: "string",
      required: false,
      default: "0",
      description: "Pagination token untuk home feed (dari response sebelumnya)",
    },
    page: {
      type: "number",
      required: false,
      default: 1,
      description: "Nomor halaman untuk mode search",
    },
  },

  async run(req, res) {
    try {
      const { mode, id, url, keyword, since_id, page } = { ...req.query, ...req.body }

      if (!mode || !["home", "search", "detail"].includes(mode)) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'mode' wajib diisi: home, search, atau detail",
        })
      }

      if (mode === "detail") {
        const inputId = id || url
        if (!inputId) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'id' atau 'url' wajib diisi untuk mode detail",
          })
        }
        const postId = extractPostId(inputId)
        if (!postId) {
          return res.status(400).json({
            status: false,
            message: "ID/URL Weibo tidak valid. Gunakan ID numerik, atau URL: https://m.weibo.cn/detail/{id} / https://weibo.com/{user}/{id}",
          })
        }
        const result = await fetchWeiboDetail(postId)
        return res.json({ status: true, mode: "detail", result })
      }

      if (mode === "search") {
        if (!keyword) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'keyword' wajib diisi untuk mode search",
          })
        }
        const result = await fetchWeiboFeed("search", keyword, "0", parseInt(page) || 1)
        return res.json({ status: true, mode: "search", keyword, ...result })
      }

      if (mode === "home") {
        const result = await fetchWeiboFeed("home", "", since_id || "0")
        return res.json({ status: true, mode: "home", ...result })
      }
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Weibo download failed",
      })
    }
  },
}
