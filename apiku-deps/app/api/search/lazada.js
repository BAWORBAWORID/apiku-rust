import crypto from "crypto"

async function searchLazada(keyword, page = 1) {
  const randomHex = (bytes) => crypto.randomBytes(bytes).toString("hex")
  const randomBase64 = (bytes) => crypto.randomBytes(bytes).toString("base64")
  const randomBase64URL = (bytes) => crypto.randomBytes(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  const randomAlphaNum = (length) => {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    return Array.from({ length }, () => charset[crypto.randomInt(0, charset.length)]).join("")
  }

  const generateCookies = () => {
    const now = Date.now()
    const cookies = {
      "__wpkreporterwid_": crypto.randomUUID(),
      "t_fv": now.toString(),
      "t_uid": randomAlphaNum(32),
      "hng": "ID|id|IDR|360",
      "userLanguageML": "id",
      "lwrid": randomAlphaNum(28),
      "cna": randomAlphaNum(24),
      "lzd_sid": randomHex(16),
      "__itrace_wid": crypto.randomUUID(),
      "lzd_cid": crypto.randomUUID(),
      "_tb_token_": randomHex(7).substring(0, 13),
      "xlly_s": "1",
      "_m_h5_tk": `${randomHex(16)}_${now}`,
      "_m_h5_tk_enc": randomHex(16),
      "t_sid": randomAlphaNum(32),
      "utm_origin": "https://www.google.com/",
      "utm_channel": "SEO",
      "lwrtk": randomBase64(42),
      "epssw": `12*${randomBase64URL(172)}.`,
      "tfstk": `${randomBase64URL(200)}.`,
      "__lwsc_test__": `${now}${Math.random().toString().substring(1)}`
    }
    return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
  }

  const pathKeyword = encodeURIComponent(keyword).replace(/%20/g, "+")
  const queryKeyword = encodeURIComponent(keyword)

  const targetUrl = `https://www.lazada.co.id/tag/${pathKeyword}/?ajax=true&catalog_redirect_tag=true&isFirstRequest=true&page=${page}&q=${queryKeyword}&spm=a2o4j.homepage.searchbar.diwen`
  const refererUrl = `https://www.lazada.co.id/tag/${pathKeyword}/?q=${queryKeyword}&spm=a2o4j.homepage.searchbar.diwen&catalog_redirect_tag=true`

  const options = {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Linux; Android 16; Infinix X6837) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.137 Mobile Safari/537.36",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "sec-ch-ua-platform": '"Android"',
      "sec-ch-ua": '"Android WebView";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
      "sec-ch-ua-mobile": "?1",
      "x-requested-with": "com.xbrowser.play",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
      "referer": refererUrl,
      "accept-language": "en-ID,en;q=0.9,id-ID;q=0.8,id;q=0.7,en-US;q=0.6",
      "Cookie": generateCookies()
    }
  }

  const fetchAPI = globalThis.fetch || (await import("node-fetch")).default

  const response = await fetchAPI(targetUrl, options)

  if (!response.ok) {
    throw new Error(`HTTP Error! Status: ${response.status}`)
  }

  const result = await response.json()

  if (!result.mods || !result.mods.listItems) {
    throw new Error("Data tidak ditemukan.")
  }

  const products = result.mods.listItems.map(item => ({
    name: item.name,
    price: item.price,
    originalPrice: item.originalPrice || item.price,
    discount: item.discount || "0%",
    rating: item.ratingScore || "0",
    location: item.location || "Unknown",
    seller: item.sellerName || "Unknown",
    image: item.image,
    productUrl: `https:${item.itemUrl}`
  }))

  return {
    total_results: products.length,
    page: page,
    items: products
  }
}

export default {
  name: "Lazada Search",
  description: "Cari produk di Lazada Indonesia.",
  category: "Search",
  methods: ["GET"],
  params: ["keyword", "page"],

  paramsSchema: {
    keyword: {
      type: "string",
      required: true,
      description: "Kata kunci pencarian produk"
    },
    page: {
      type: "number",
      required: false,
      description: "Nomor halaman (default: 1)"
    }
  },

  features: {
    marketplace: "Lazada",
    region: "Indonesia"
  },

  async run(req, res) {
    try {
      const { keyword, page } = req.query || {}

      if (!keyword || typeof keyword !== "string" || keyword.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'keyword' wajib diisi",
        })
      }

      const pageNum = parseInt(page) || 1

      const result = await searchLazada(keyword.trim(), pageNum)

      res.json({
        status: true,
        result,
        timestamp: Date.now(),
      })

    } catch (err) {
      console.error("Lazada Search Error:", err.message)

      let statusCode = 500
      let errorMessage = err.message || "Gagal mencari produk"

      if (err.message.includes("tidak ditemukan")) {
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
