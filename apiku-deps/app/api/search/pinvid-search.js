import { CookieJar } from "tough-cookie"
import { PROXY_MANAGER } from "../../src/app/index.js"

const UA_FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0"
const HOST = "id.pinterest.com"

// Pinterest soft-blocks datacenter IPs (Aragon returns 200 + empty results).
const WORKER_NAMES = ['caliph', 'rpoxy', 'prox', 'aged', 'wave', 'hill', 'icy', 'fazri', 'spring', 'sizable', 'jiashu', 'eu']

function getProxy() {
  const url = PROXY_MANAGER.getProxy(WORKER_NAMES)
  return url && /workers\.dev|1win\.eu\.org|\.my\.id\/|\/cors\//.test(url) ? url : null
}

async function searchPinterestVideos(q, proxyUrl = null) {
  const base = proxyUrl ? proxyUrl : ""
  const jar = new CookieJar()
  const initRes = await fetch(base + "https://" + HOST + "/", {
    headers: {
      "user-agent": UA_FIREFOX,
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
  })
  if (!initRes.ok) throw new Error(`handshake HTTP ${initRes.status}`)
  for (const cookie of initRes.headers.getSetCookie()) {
    await jar.setCookie(cookie, "https://" + HOST)
  }
  const cookieString = await jar.getCookieString("https://" + HOST)
  const sourceUrl = "/search/videos/?q=" + encodeURIComponent(q) + "&rs=content_type_filter&filter_location=1"
  const dataPayload = JSON.stringify({
    options: {
      query: q, scope: "videos", appliedProductFilters: "---", domains: null, user: null,
      seoDrawerEnabled: false, applied_unified_filters: null, auto_correction_disabled: false,
      journey_depth: null, source_id: null, source_module_id: null, source_url: sourceUrl,
      static_feed: false, selected_one_bar_modules: null, query_pin_sigs: null, page_size: null,
      price_max: null, price_min: null, query_image_pins: null, request_params: null,
      top_pin_ids: null, article: null, corpus: null, customized_rerank_type: null,
      filters: null, rs: "content_type_filter", redux_normalize_feed: true,
    },
    context: {},
  })
  const searchUrl = base + "https://" + HOST + "/resource/BaseSearchResource/get/?source_url=" + encodeURIComponent(sourceUrl) + "&data=" + encodeURIComponent(dataPayload) + "&_=" + Date.now()
  const searchRes = await fetch(searchUrl, {
    headers: {
      "user-agent": UA_FIREFOX,
      "accept": "application/json, text/javascript, */*; q=0.01",
      "accept-language": "en-US,en;q=0.9",
      "referer": base + "https://" + HOST + "/search/videos/?q=" + encodeURIComponent(q) + "&rs=content_type_filter&filter_location=1",
      "x-requested-with": "XMLHttpRequest",
      "x-app-version": "8048c97",
      "x-pinterest-appstate": "active",
      "x-pinterest-source-url": sourceUrl,
      "x-pinterest-pws-handler": "www/search/[scope].js",
      "cookie": cookieString,
    },
  })
  const data = JSON.parse(await searchRes.text())
  const results = data?.resource_response?.data?.results || []
  const videos = results
    .filter(p => p.videos?.video_list)
    .map(p => {
      const vList = p.videos.video_list
      const videoUrl = vList.V_HLSV4?.url || vList.V_HLSV3_MOBILE?.url || null
      return {
        id: p.id,
        title: p.grid_title || p.title || null,
        description: p.description || null,
        video: videoUrl,
        thumbnail: p.images?.orig?.url || null,
        duration: p.videos?.duration || null,
        link: "https://www.pinterest.com/pin/" + p.id,
        pinner: p.pinner?.full_name || null,
        username: p.pinner?.username || null,
        likes: p.reaction_counts?.["1"] || 0,
      }
    })
    .filter(p => p.video)
  return { query: q, total: videos.length, results: videos }
}

export default {
  name: "Pinterest Video Search",
  description: "Cari video dari Pinterest. Hasil berupa metadata video (URL .m3u8) yang bisa digunakan di endpoint /api/downloader/pinvid untuk diunduh.",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["query"],

  paramsSchema: {
    query: {
      type: "string",
      required: true,
      description: "Kata kunci pencarian video Pinterest",
    },
  },

  async run(req, res) {
    try {
      const query = req.query?.query || req.body?.query
      if (!query || typeof query !== "string" || query.trim().length === 0) {
        return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi" })
      }
      const clean = query.trim()
      let lastError = null
      for (let attempt = 0; attempt < 3; attempt++) {
        const proxyUrl = getProxy()
        try {
          const result = await searchPinterestVideos(clean, proxyUrl)
          if (result.total > 0) {
            return res.json({ status: true, ...result })
          }
          lastError = new Error("empty")
        } catch (err) {
          lastError = err
        }
      }
      if (lastError?.message === "empty") {
        return res.status(404).json({ status: false, message: "Pinterest memblokir IP ini (soft-block datacenter). Coba lagi nanti.", query: clean, total: 0, results: [] })
      }
      throw lastError
    } catch (err) {
      res.status(500).json({ status: false, message: err.message || "Gagal mencari video Pinterest" })
    }
  },
}
