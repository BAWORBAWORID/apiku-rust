import path from "path"
import fs from "fs"
import crypto from "crypto"
import sharp from "sharp"
import logger from "../../src/utils/logger.js"

const uploadDir = path.join(process.cwd(), "files")
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

const BASE_URL = "https://www.unipin.com"
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

function randomName(ext = ".png") {
  return crypto.randomBytes(16).toString("hex") + ext
}

const EXPIRY_DB = path.join(process.cwd(), "data", "exp.json")
if (!fs.existsSync(path.dirname(EXPIRY_DB))) fs.mkdirSync(path.dirname(EXPIRY_DB), { recursive: true })
if (!fs.existsSync(EXPIRY_DB)) fs.writeFileSync(EXPIRY_DB, "[]")

function readExpiryDb() {
  try {
    const raw = fs.readFileSync(EXPIRY_DB, "utf-8").trim()
    return raw ? JSON.parse(raw) : []
  } catch (e) {
    logger.warn(`[UNIPIN-Exp] Failed to read exp.json: ${e.message}`)
    return []
  }
}

function writeExpiryDb(entries) {
  try {
    fs.writeFileSync(EXPIRY_DB, JSON.stringify(entries, null, 2))
  } catch (e) {
    logger.warn(`[UNIPIN-Exp] Failed to write exp.json: ${e.message}`)
  }
}

function addExpiryEntry(entry) {
  const entries = readExpiryDb()
  entries.push(entry)
  writeExpiryDb(entries)
}

function removeExpiryEntry(filename) {
  const entries = readExpiryDb().filter((e) => e.filename !== filename)
  writeExpiryDb(entries)
}

function scheduleDelete(filePath, filename, delayMs = 300000) {
  setTimeout(() => {
    fs.unlink(filePath, (err) => {
      if (!err || err.code === "ENOENT") {
        if (filename) removeExpiryEntry(filename)
        logger.info(`[UNIPIN-TOPUP] File expired & deleted | file=${filename || path.basename(filePath)}`)
      } else {
        logger.warn(`[CLEANUP] Gagal hapus ${filePath}: ${err.message}`)
      }
    })
  }, delayMs)
}

function getBaseUrl(req) {
  if (!req) return "https://api.zyvor.my.id"
  const host = req.get("x-forwarded-host") || req.get("host") || ""
  const isLocal = !host || host.includes("localhost") || host.includes("127.0.0.1")
  return isLocal ? "https://api.zyvor.my.id" : `${req.get("x-forwarded-proto") || "https"}://${host}`
}

function isUnionPay(name = "") {
  return /union\s*pay/i.test(name) || /union\s*payment/i.test(name) || /^cup$/i.test(name)
}

const PAYMENT_ALIASES = {
  qris: "522",
  gopay: "104",
  "gopay-later": "619",
  dana: "103",
  shopeepay: "432",
  spaylater: "432",
  ovo: "56",
  linkaja: "131",
  isaku: "756",
  jenius: "125",
  indodana: "207",
  sakuku: "92",
  bca: "43",
  "bca-va": "43",
  bri: "476",
  "bri-va": "476",
  bni: "42",
  "bni-va": "42",
  mandiri: "474",
  "mandiri-va": "474",
  permata: "857",
  "permata-va": "857",
  cimb: "478",
  "cimb-va": "478",
  danamon: "137",
  "danamon-va": "137",
  indomaret: "41",
  alfamart: "48",
  alfamidi: "1131",
  telkomsel: "118",
  xl: "172",
  axis: "172",
  "xl-axis": "172",
  indosat: "592",
  tri: "54",
  smartfren: "622",
}

function resolvePaymentChannel(inputPid, pageHtml = "") {
  if (!inputPid) return { id: "522", name: "QRIS" }
  const str = String(inputPid).trim().toLowerCase()

  // 1. Direct alias match
  let targetId = PAYMENT_ALIASES[str] || null

  // 2. Direct numeric ID
  if (!targetId && /^[0-9]+$/.test(str)) {
    targetId = str
  }

  // 3. Search in channels from page HTML
  const channels = []
  if (pageHtml) {
    for (const m of pageHtml.matchAll(/pc_amounts\s*\[\s*['"]([0-9]+)['"]\s*\]\s*=\s*(\{[\s\S]*?\});/g)) {
      try {
        const parsed = JSON.parse(m[2].replace(/'/g, '"'))
        channels.push({ id: m[1], name: parsed.name })
      } catch {}
    }
  }

  if (!targetId && channels.length) {
    const cleanStr = str.replace(/[^a-z0-9]/g, "")
    const matched = channels.find((ch) => {
      const chClean = ch.name.toLowerCase().replace(/[^a-z0-9]/g, "")
      return chClean.includes(cleanStr) || cleanStr.includes(chClean)
    })
    if (matched) {
      targetId = matched.id
    }
  }

  targetId = targetId || "522"
  const matchedObj = channels.find((ch) => ch.id === targetId)

  return {
    id: targetId,
    name: matchedObj ? matchedObj.name : targetId === "522" ? "QRIS" : targetId,
  }
}

async function fetchWithCookies(url, options = {}, cookieMap = { region: "id" }) {
  const cookieHeader = Object.entries(cookieMap)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
  const headers = {
    "User-Agent": USER_AGENT,
    Cookie: cookieHeader,
    ...options.headers,
  }
  const res = await fetch(url, { ...options, headers })
  if (res.headers.getSetCookie) {
    for (const c of res.headers.getSetCookie()) {
      const [k, v] = c.split(";")[0].split("=")
      if (k && v) cookieMap[k] = v
    }
  }
  return { res, cookieMap }
}

async function resolveGameUrl(game = "") {
  if (game.startsWith("http")) return game
  const cleanPath = game.startsWith("/") ? game : `/${game}`
  const candidates = [
    `${BASE_URL}/id${cleanPath}`,
    `${BASE_URL}/id/game${cleanPath}`,
    `${BASE_URL}${cleanPath}`,
  ]
  for (const url of candidates) {
    const { res } = await fetchWithCookies(url)
    if (res.ok) return url
  }
  return candidates[0]
}

// ─── Scraper Functions ──────────────────────────────────────────────────────

async function getHome() {
  const { res } = await fetchWithCookies(`${BASE_URL}/`)
  if (!res.ok) throw new Error(`Gagal mengambil halaman utama UniPin (${res.status})`)
  const html = await res.text()

  const banners = []
  for (const m of html.matchAll(/<li[^>]*class="[^"]*splide__slide[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)) {
    const inner = m[1]
    if (inner.includes("<img") && inner.includes("<a")) {
      const href = inner.match(/href="([^"]+)"/)?.[1]
      const src = inner.match(/src="([^"]+)"/)?.[1] || inner.match(/data-splide-lazy="([^"]+)"/)?.[1]
      const title = href ? href.split("/").pop().replace(/-/g, " ") : ""
      if (href && src) {
        banners.push({
          url: href,
          image: src,
          title,
        })
      }
    }
  }

  const popular = []
  for (const m of html.matchAll(/<a[^>]*href="([^"]*)"[^>]*class="[^"]*nextgen-product-card[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = m[1]
    const inner = m[2]
    const imgMatch =
      inner.match(/<img[^>]*alt="([^"]*)"[^>]*data-src="([^"]*)"/i) ||
      inner.match(/<img[^>]*data-src="([^"]*)"[^>]*alt="([^"]*)"/i)
    let title = ""
    let img = ""
    if (imgMatch) {
      if (imgMatch[1].startsWith("http")) {
        img = imgMatch[1]
        title = imgMatch[2]
      } else {
        title = imgMatch[1]
        img = imgMatch[2]
      }
    }
    if (url && title) {
      popular.push({
        title: title.trim(),
        url: url.startsWith("http") ? url : `${BASE_URL}${url}`,
        slug: url.replace(new RegExp("^/id/", "i"), "").replace(new RegExp("^/"), ""),
        icon: img || null,
      })
    }
  }

  return { banners, popular }
}

async function searchGames(query) {
  if (!query || typeof query !== "string") {
    throw new Error("Parameter 'query' wajib diisi untuk pencarian game")
  }

  const { res } = await fetchWithCookies(`${BASE_URL}/games/search?search=${encodeURIComponent(query)}`)
  if (!res.ok) throw new Error(`Gagal mencari game (${res.status})`)
  const html = await res.text()

  const results = []
  for (const m of html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = m[1]
    const inner = m[2]
    if (inner.includes("cdn.unipin.com/images/icon_product_pages/")) {
      const img = inner.match(/src="([^"]*)"/)?.[1]
      const alt = inner.match(/alt="([^"]*)"/)?.[1] || ""
      const titleMatch =
        inner.match(/<span[^>]*class="[^"]*product-name[^"]*"[^>]*>([^<]+)<\/span>/i) ||
        inner.match(/<span[^>]*>([^<]+)<\/span>/i)
      const title = alt || (titleMatch ? titleMatch[1].trim() : "")
      if (title && url) {
        results.push({
          title: title.trim(),
          url: url.startsWith("http") ? url : `${BASE_URL}${url}`,
          slug: url.replace(new RegExp("^/id/", "i"), "").replace(new RegExp("^/"), ""),
          icon: img || null,
        })
      }
    }
  }

  return {
    query,
    total: results.length,
    results,
  }
}

async function getGameDetail(gamePathOrUrl) {
  if (!gamePathOrUrl || typeof gamePathOrUrl !== "string") {
    throw new Error("Parameter 'game' (slug atau URL) wajib diisi")
  }

  const targetUrl = await resolveGameUrl(gamePathOrUrl)
  const { res } = await fetchWithCookies(targetUrl)
  if (!res.ok) throw new Error(`Gagal memuat detail game (${res.status})`)
  const html = await res.text()

  const ogTitle =
    html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1] ||
    html.match(/<title>([^<]+)<\/title>/i)?.[1] ||
    ""
  const cleanTitle = ogTitle.replace(/^UniPin\s*-\s*/i, "").replace(/\(New\)/i, "").trim()
  const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/i)
  const description = descMatch ? descMatch[1].trim() : ""

  const fields = []
  const formMatch = html.match(/<form[^>]*id="form-webtopup"[^>]*>([\s\S]*?)<\/form>/i)
  if (formMatch) {
    for (const input of formMatch[1].matchAll(/<input[^>]*name="([^"]+)"[^>]*>/gi)) {
      const name = input[1]
      const type = input[0].match(/type="([^"]+)"/i)?.[1] || "text"
      if (type.toLowerCase() !== "hidden" && name !== "_token" && name !== "influencer" && name !== "source") {
        const placeholder = input[0].match(/placeholder="([^"]+)"/)?.[1] || ""
        fields.push({ name, label: placeholder.trim() || name })
      }
    }
  }

  const denoms = []
  for (const m of html.matchAll(/data-id="([0-9]+)"\s+data-name="([^"]+)"(?:\s+data-amount="([0-9]+)")?/g)) {
    denoms.push({
      id: m[1],
      name: m[2],
      amount: m[3] ? parseInt(m[3], 10) : null,
    })
  }

  const channels = []
  for (const m of html.matchAll(/pc_amounts\s*\[\s*['"]([0-9]+)['"]\s*\]\s*=\s*(\{[\s\S]*?\});/g)) {
    try {
      const rawObjStr = m[2].replace(/'/g, '"')
      const parsed = JSON.parse(rawObjStr)
      if (!isUnionPay(parsed.name)) {
        channels.push({
          id: m[1],
          name: parsed.name,
          currency: parsed.currency,
          status: parsed.status,
          amounts: parsed.amt ? parsed.amt.split(",").map(Number) : [],
        })
      }
    } catch {}
  }

  return {
    title: cleanTitle,
    description,
    url: targetUrl,
    fields,
    denominations: denoms,
    payment_channels: channels,
  }
}

async function checkId(gamePathOrUrl, userInputs = {}, zoneIdParam = null) {
  let inputs = {}
  if (typeof userInputs === "object" && userInputs !== null) {
    inputs = { ...userInputs }
  } else if (typeof userInputs === "string" || typeof userInputs === "number") {
    inputs = { userid: String(userInputs) }
    if (zoneIdParam) inputs.zoneid = String(zoneIdParam)
  }

  const targetUrl = await resolveGameUrl(gamePathOrUrl)
  const cookieMap = { region: "id" }
  const { res: pageRes } = await fetchWithCookies(targetUrl, {}, cookieMap)
  if (!pageRes.ok) throw new Error(`Gagal membuka halaman game (${pageRes.status})`)
  const html = await pageRes.text()

  const tokenMatch = html.match(/name="_token" type="hidden" value="([^"]+)"/)
  const rgidMatch = html.match(/'rgid':\s*'([^']+)'/)
  const csrfMatch = html.match(/'X-CSRF-TOKEN':\s*'([^']+)'/)
  const inqUrlMatch = html.match(/url:\s*['"]([^'"]*inquiry[^'"]*)['"]/)

  if (!inqUrlMatch) {
    throw new Error("Game ini tidak memerlukan verifikasi User ID / Inquiry pada UniPin")
  }

  const didMatch = html.match(/data-id="([0-9]+)"/)
  const defaultDid = didMatch ? didMatch[1] : "8227"
  const defaultGame = html.match(/<input[^>]*name="game"[^>]*value="([^"]+)"/i)?.[1]
  const playerIdVal = inputs.player_id || inputs.playerid || inputs.userid || inputs.userId || inputs.id

  const cleanInputs = { ...inputs }
  delete cleanInputs.action
  delete cleanInputs.game
  delete cleanInputs.slug

  const postParams = {
    _token: tokenMatch ? tokenMatch[1] : "",
    rgid: rgidMatch ? rgidMatch[1] : "",
    did: defaultDid,
    pid: "103",
    influencer: "",
    source: "",
    cust_email: "customer@unipin.com",
    ...cleanInputs,
    ...(defaultGame ? { game: defaultGame } : {}),
    ...(playerIdVal ? { playerid: playerIdVal, userid: playerIdVal } : {}),
  }

  const params = new URLSearchParams(postParams)

  const cookieHeader = Object.entries(cookieMap)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
  const inqRes = await fetch(inqUrlMatch[1], {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Cookie: cookieHeader,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "X-CSRF-TOKEN": csrfMatch ? csrfMatch[1] : tokenMatch ? tokenMatch[1] : "",
      Origin: BASE_URL,
      Referer: targetUrl,
    },
    body: params.toString(),
  })

  if (!inqRes.ok) {
    const errText = await inqRes.text()
    throw new Error(`Inquiry request failed (${inqRes.status}): ${errText}`)
  }

  const json = await inqRes.json()
  return {
    valid: json.status === "1",
    code: json.status,
    message: json.message || "",
    raw: json,
  }
}

async function createOrder({
  game,
  did,
  pid = "522",
  userInputs = {},
  email = "customer@unipin.com",
  phone = "081234567890",
  req = null,
} = {}) {
  if (!game) throw new Error("Parameter 'game' (slug atau URL) wajib diisi")
  if (!did) throw new Error("Parameter 'did' (ID item/diamond) wajib diisi")
  pid = String(pid || "522")

  const targetUrl = await resolveGameUrl(game)
  const cookieMap = { region: "id" }
  const { res: pageRes } = await fetchWithCookies(targetUrl, {}, cookieMap)
  if (!pageRes.ok) throw new Error(`Gagal membuka halaman game (${pageRes.status})`)
  const pageHtml = await pageRes.text()

  const { id: finalPid, name: finalPaymentName } = resolvePaymentChannel(pid, pageHtml)
  pid = finalPid

  const channelMatch = pageHtml.match(
    new RegExp(`pc_amounts\\s*\\[\\s*['"]${pid}['"]\\s*\\]\\s*=\\s*(\\{[\\s\\S]*?\\});`)
  )
  if (channelMatch) {
    try {
      const channelObj = JSON.parse(channelMatch[1].replace(/'/g, '"'))
      if (isUnionPay(channelObj.name)) {
        throw new Error("Metode pembayaran UnionPay tidak didukung.")
      }
    } catch (e) {
      if (e.message.includes("UnionPay")) throw e
    }
  }

  const csrf = pageHtml.match(/'X-CSRF-TOKEN':\s*'([^']+)'/)?.[1]
  const tokenMatch = pageHtml.match(/name="_token" type="hidden" value="([^"]+)"/)
  const rgidMatch = pageHtml.match(/'rgid':\s*'([^']+)'/)
  const inqUrlMatch = pageHtml.match(/url:\s*['"]([^'"]*inquiry[^'"]*)['"]/)
  const gameIdMatch =
    pageHtml.match(/name="gameid"[^>]*value="([^"]+)"/i) || pageHtml.match(/gameid\s*=\s*['"]?([0-9]+)/i)

  let checkoutUrl = ""

  if (inqUrlMatch) {
    const defaultGame = pageHtml.match(/<input[^>]*name="game"[^>]*value="([^"]+)"/i)?.[1]
    const playerIdVal =
      userInputs.player_id || userInputs.playerid || userInputs.userid || userInputs.userId || userInputs.id

    const cleanInputs = { ...userInputs }
    delete cleanInputs.action
    delete cleanInputs.game
    delete cleanInputs.slug
    delete cleanInputs.did
    delete cleanInputs.pid

    const cookieHeader = Object.entries(cookieMap)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ")
    const inqParams = new URLSearchParams({
      _token: tokenMatch ? tokenMatch[1] : "",
      rgid: rgidMatch ? rgidMatch[1] : "",
      did: String(did),
      pid: String(pid),
      influencer: "",
      source: "",
      cust_email: email,
      ...cleanInputs,
      ...(defaultGame ? { game: defaultGame } : {}),
      ...(playerIdVal ? { playerid: playerIdVal, userid: playerIdVal } : {}),
    })

    const inqRes = await fetch(inqUrlMatch[1], {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        Cookie: cookieHeader,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRF-TOKEN": csrf || (tokenMatch ? tokenMatch[1] : ""),
        Origin: BASE_URL,
        Referer: targetUrl,
      },
      body: inqParams.toString(),
    })

    if (inqRes.headers.getSetCookie) {
      for (const c of inqRes.headers.getSetCookie()) {
        const [k, v] = c.split(";")[0].split("=")
        if (k && v) cookieMap[k] = v
      }
    }

    const inqJson = await inqRes.json()
    if (inqJson.status !== "1") {
      throw new Error(`Inquiry gagal: ${inqJson.message || "Data akun atau pilihan item tidak valid"}`)
    }

    const inqBase = inqUrlMatch[1].replace(new RegExp("/inquiry.*$"), "")
    checkoutUrl = `${inqBase}/checkout/${inqJson.message}`
  } else {
    const checkEmailParams = new URLSearchParams({
      pid: String(pid),
      did: String(did),
      gameid: gameIdMatch ? gameIdMatch[1] : "159",
      email,
      offer: "",
    })

    const cookieHeader = Object.entries(cookieMap)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ")
    const checkEmailRes = await fetch(`${BASE_URL}/game/check-email`, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        Cookie: cookieHeader,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRF-TOKEN": csrf || "",
        Origin: BASE_URL,
        Referer: targetUrl,
      },
      body: checkEmailParams.toString(),
    })

    if (checkEmailRes.headers.getSetCookie) {
      for (const c of checkEmailRes.headers.getSetCookie()) {
        const [k, v] = c.split(";")[0].split("=")
        if (k && v) cookieMap[k] = v
      }
    }

    const checkEmailJson = await checkEmailRes.json()
    if (checkEmailJson.status !== "1") {
      throw new Error(`Verifikasi email gagal: ${checkEmailJson.message || "Periksa format email"}`)
    }

    const gid = gameIdMatch ? gameIdMatch[1] : "159"
    checkoutUrl = `${BASE_URL}/game/checkout/${gid}/${pid}/${did}?ifc=`
  }

  let checkoutResObj = await fetchWithCookies(
    checkoutUrl,
    {
      headers: { Referer: targetUrl },
    },
    cookieMap
  )

  if (!checkoutResObj.res.ok && checkoutResObj.res.status === 404) {
    const candidates = []
    if (inqUrlMatch) {
      const inqBase = inqUrlMatch[1].replace(new RegExp("/inquiry.*$"), "")
      const gameSlug = targetUrl.replace(BASE_URL, "").replace(/^\/id\//i, "").replace(/^\//, "")
      candidates.push(`${inqBase}/checkout/${checkoutUrl.split("/").pop()}`)
      candidates.push(`${BASE_URL}/id/${gameSlug}/checkout/${checkoutUrl.split("/").pop()}`)
      candidates.push(`${BASE_URL}/${gameSlug}/checkout/${checkoutUrl.split("/").pop()}`)
    } else {
      const gidMatch = pageHtml.match(/game\/checkout\/([0-9]+)/i) || pageHtml.match(/gameid\s*=\s*['"]?([0-9]+)/i)
      const gid = gidMatch ? gidMatch[1] : "159"
      candidates.push(`${BASE_URL}/id/game/checkout/${gid}/${pid}/${did}?ifc=`)
      candidates.push(`${BASE_URL}/game/checkout/${gid}/${pid}/${did}?ifc=`)
    }
    for (const altUrl of candidates) {
      if (altUrl === checkoutUrl) continue
      const altTry = await fetchWithCookies(altUrl, { headers: { Referer: targetUrl } }, cookieMap)
      if (altTry.res.ok) {
        checkoutResObj = altTry
        checkoutUrl = altUrl
        break
      }
    }
  }

  const checkoutRes = checkoutResObj.res
  if (!checkoutRes.ok) {
    throw new Error(`Gagal membuka halaman checkout (${checkoutRes.status})`)
  }

  const checkoutHtml = await checkoutRes.text()
  const formToken =
    checkoutHtml.match(/name="_token"[^>]*value="([^"]*)"/i)?.[1] ||
    checkoutHtml.match(/value="([^"]*)"[^>]*name="_token"/i)?.[1]
  const formActionMatch = checkoutHtml.match(/<form[^>]*action="([^"]*)"[^>]*>/i)
  const formAction = formActionMatch ? formActionMatch[1] : checkoutUrl.split("?")[0]

  const submitParams = new URLSearchParams({
    _token: formToken || "",
    customer_email: email,
    customer_tel: phone,
    remember_me: "1",
    ifc: "",
  })

  const cookieHeaderPost = Object.entries(cookieMap)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
  const submitRes = await fetch(formAction, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Cookie: cookieHeaderPost,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: checkoutUrl,
      Origin: BASE_URL,
    },
    body: submitParams.toString(),
    redirect: "manual",
  })

  if (submitRes.headers.getSetCookie) {
    for (const c of submitRes.headers.getSetCookie()) {
      const [k, v] = c.split(";")[0].split("=")
      if (k && v) cookieMap[k] = v
    }
  }

  const peLocation = submitRes.headers.get("location")
  if (!peLocation) {
    throw new Error("Gagal melanjutkan ke payment engine UniPin")
  }

  if (peLocation.includes("/timeout")) {
    throw new Error("Metode pembayaran atau nominal tidak didukung untuk produk ini")
  }

  if (String(pid) !== "522") {
    return {
      type: "redirect",
      payment_method: finalPaymentName,
      payment_channel_id: finalPid,
      payment_url: peLocation,
      instruction: "Buka tautan pembayaran untuk menyelesaikan transaksi.",
    }
  }

  const { res: peRes } = await fetchWithCookies(
    peLocation,
    {
      headers: { Referer: checkoutUrl },
    },
    cookieMap
  )

  const peHtml = await peRes.text()
  const apiAction = peHtml.match(/action='([^']+)'/)?.[1] || peHtml.match(/action="([^"]+)"/)?.[1]
  const pVal = peHtml.match(/name='p'\s+value='([^']+)'/)?.[1] || peHtml.match(/name="p"\s+value="([^"]+)"/)?.[1]

  if (!apiAction || !pVal) {
    return {
      type: "redirect",
      payment_method: finalPaymentName,
      payment_channel_id: finalPid,
      payment_url: peLocation,
      instruction: "Buka tautan pembayaran untuk menyelesaikan transaksi.",
    }
  }

  const apiRes = await fetch(apiAction, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: peLocation,
    },
    body: new URLSearchParams({ p: pVal }).toString(),
    redirect: "manual",
  })

  const finalPaymentUrl = apiRes.headers.get("location") || apiAction

  const peCookieMap = {}
  if (apiRes.headers.getSetCookie) {
    for (const c of apiRes.headers.getSetCookie()) {
      const [k, v] = c.split(";")[0].split("=")
      if (k && v) peCookieMap[k] = v
    }
  }
  const peCookieHeader = Object.entries(peCookieMap)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")

  if (finalPaymentUrl.includes("doku_qris")) {
    const qrisRes = await fetch(finalPaymentUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: apiAction,
        ...(peCookieHeader ? { Cookie: peCookieHeader } : {}),
      },
    })
    const qrisHtml = await qrisRes.text()
    const trxIdMatch = qrisHtml.match(/data:\s*\{\s*id:\s*"([0-9]+)"\s*\}/) || qrisHtml.match(/id:\s*"([0-9]+)"/)
    const trxId = trxIdMatch ? trxIdMatch[1] : null

    const containerMatch = qrisHtml.match(/width:([0-9]+)px;height:([0-9]+)px;">([\s\S]*?)<\/div>\s*<\/div>/i)
    let svg = null
    let dataUrl = null
    let qrFileUrl = null
    let pngFilename = null
    let expires_at = null
    const TTL = 180000 // 3 menit (180 detik, persis sesuai masa berlaku DOKU QRIS)

    if (containerMatch) {
      const width = containerMatch[1]
      const height = containerMatch[2]
      const inner = containerMatch[3]
      const rects = []
      for (const m of inner.matchAll(/left:([0-9]+)px;top:([0-9]+)px;/g)) {
        rects.push(`<rect x="${m[1]}" y="${m[2]}" width="5" height="5" fill="#000000"/>`)
      }
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#ffffff"/>${rects.join("")}</svg>`
      dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`

      try {
        pngFilename = randomName(".png")
        const pngFilePath = path.join(uploadDir, pngFilename)
        const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer()
        fs.writeFileSync(pngFilePath, pngBuffer)

        expires_at = new Date(Date.now() + TTL).toISOString()
        addExpiryEntry({
          filename: pngFilename,
          expiresAt: expires_at,
          filePath: pngFilePath,
          originalName: `qris-${trxId || "order"}.png`,
          size: pngBuffer.length,
          mimetype: "image/png",
        })
        scheduleDelete(pngFilePath, pngFilename, TTL)

        const baseUrl = getBaseUrl(req)
        qrFileUrl = `${baseUrl}/files/${pngFilename}`
      } catch (sharpErr) {
        logger.warn(`[UNIPIN-TOPUP] Sharp PNG conversion error: ${sharpErr.message}`)
      }
    }

    const baseUrl = getBaseUrl(req)

    return {
      type: "qris",
      payment_method: finalPaymentName,
      payment_channel_id: finalPid,
      transaction_id: trxId,
      payment_url: finalPaymentUrl,
      qr_url: qrFileUrl,
      filename: pngFilename,
      qr_data_url: dataUrl,
      check_url: trxId ? `https://www.paymentengine.online/doku_qris/redis_inquiry?id=${trxId}` : null,
      expires_in: "3 menit",
      expires_in_seconds: 180,
      expires_at: expires_at || new Date(Date.now() + 180000).toISOString(),
      instruction: "Scan QRIS berikut menggunakan aplikasi m-Banking atau E-Wallet mana pun untuk menyelesaikan pembayaran.",
    }
  }

  return {
    type: "redirect",
    payment_method: finalPaymentName,
    payment_channel_id: finalPid,
    payment_url: finalPaymentUrl || peLocation,
    instruction: "Buka tautan pembayaran untuk menyelesaikan transaksi.",
  }
}

async function checkPaymentStatus(transactionId) {
  if (!transactionId) throw new Error("Parameter 'trx_id' (Transaction ID DOKU QRIS) wajib diisi")

  const url = `https://www.paymentengine.online/doku_qris/redis_inquiry?id=${encodeURIComponent(transactionId)}`
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "X-Requested-With": "XMLHttpRequest",
    },
  })

  if (!res.ok) throw new Error(`Gagal memeriksa status pembayaran (${res.status})`)
  const json = await res.json()

  return {
    transaction_id: transactionId,
    paid: json.status === true,
    status: json.status === true ? "SUCCESS" : json.redis === "valid" ? "PENDING" : "EXPIRED_OR_FAILED",
    raw: json,
  }
}

// ─── API Module Definition ───────────────────────────────────────────────────

export default {
  name: "UniPin Topup",
  description: "Scraper & auto checkout topup game UniPin: katalog game populer, pencarian, detail nominal item/voucher, validasi User ID (Inquiry), pembuatan order (QRIS & redirect payment), serta cek status pembayaran real-time.",
  category: "Topup",
  methods: ["GET", "POST"],

  params: ["action", "query", "game", "user_id", "zone_id", "did", "pid", "email", "phone", "trx_id"],

  paramsSchema: {
    action: {
      type: "string",
      required: true,
      description: "Aksi yang ingin dijalankan",
      example: "home",
      enum: ["home", "search", "detail", "check", "order", "status"],
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci game untuk action=search",
      example: "free fire",
    },
    game: {
      type: "string",
      required: false,
      description: "Slug atau URL game untuk action=detail, check, atau order",
      example: "garena/free-fire",
    },
    user_id: {
      type: "string",
      required: false,
      description: "User ID / Player ID akun game untuk action=check atau order",
      example: "4668586613",
    },
    zone_id: {
      type: "string",
      required: false,
      description: "Zone ID / Server ID akun game (jika ada, e.g. Mobile Legends)",
      example: "1234",
    },
    did: {
      type: "string",
      required: false,
      description: "ID nominal diamond/item dari action=detail",
      example: "238",
    },
    pid: {
      type: "string",
      required: false,
      default: "qris",
      enum: [
        "qris",
        "gopay",
        "dana",
        "ovo",
        "shopeepay",
        "linkaja",
        "isaku",
        "jenius",
        "bca-va",
        "bri-va",
        "bni-va",
        "mandiri-va",
        "cimb-va",
        "permata-va",
        "indomaret",
        "alfamart",
        "telkomsel",
        "xl-axis",
        "indosat",
        "tri",
        "smartfren",
      ],
      description: "Pilihan metode pembayaran (bisa pakai nama/alias atau ID numerik). Default: qris",
      example: "qris",
    },
    email: {
      type: "string",
      required: false,
      description: "Email pembeli / bukti transaksi (default: customer@unipin.com)",
      example: "customer@unipin.com",
    },
    phone: {
      type: "string",
      required: false,
      description: "Nomor HP / WhatsApp pembeli (default: 081234567890)",
      example: "081234567890",
    },
    trx_id: {
      type: "string",
      required: false,
      description: "Transaction ID QRIS untuk action=status",
      example: "2029661766486",
    },
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body }
      const {
        action,
        query,
        game,
        user_id,
        zone_id,
        did,
        pid,
        email = "customer@unipin.com",
        phone = "081234567890",
        trx_id,
      } = params

      if (!action) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'action' wajib diisi",
          available_actions: {
            home: "Ambil banner promosi dan daftar game populer UniPin",
            search: "Cari katalog game berdasarkan nama (?action=search&query=mobile+legends)",
            detail: "Ambil denominasi (diamond/voucher), form input ID, dan channel pembayaran (?action=detail&game=garena/free-fire)",
            check: "Cek / validasi User ID & Zone ID akun game (?action=check&game=garena/free-fire&user_id=4668586613)",
            order: "Buat pesanan top-up & generate QRIS (?action=order&game=garena/free-fire&did=238&pid=522&user_id=4668586613)",
            status: "Cek status real-time pembayaran QRIS (?action=status&trx_id=2029661766486)",
          },
        })
      }

      const host = req.get("host") || "localhost:3000"
      const protocol = req.protocol || "http"
      const baseUrlReq = `${protocol}://${host}`

      switch (action.toLowerCase()) {
        case "home": {
          logger.info(`[UNIPIN-TOPUP] Action: home | ip=${req.ip}`)
          const result = await getHome()
          return res.json({ status: true, action: "home", result })
        }

        case "search": {
          if (!query) {
            return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi untuk action=search" })
          }
          logger.info(`[UNIPIN-TOPUP] Action: search | query=${query} | ip=${req.ip}`)
          const result = await searchGames(query)
          return res.json({ status: true, action: "search", result })
        }

        case "detail": {
          const gameTarget = game || query
          if (!gameTarget) {
            return res.status(400).json({ status: false, message: "Parameter 'game' wajib diisi untuk action=detail" })
          }
          logger.info(`[UNIPIN-TOPUP] Action: detail | game=${gameTarget} | ip=${req.ip}`)
          const result = await getGameDetail(gameTarget)
          return res.json({ status: true, action: "detail", result })
        }

        case "check": {
          const gameTarget = game || params.slug
          if (!gameTarget) {
            return res.status(400).json({ status: false, message: "Parameter 'game' wajib diisi untuk action=check" })
          }
          const playerId = user_id || params.player_id || params.userid || params.id
          if (!playerId) {
            return res.status(400).json({ status: false, message: "Parameter 'user_id' wajib diisi untuk action=check" })
          }

          const userInputs = {
            player_id: playerId,
            playerid: playerId,
            userid: playerId,
            ...(zone_id ? { zone_id, zoneid: zone_id, serverid: zone_id } : {}),
            ...params,
          }

          logger.info(`[UNIPIN-TOPUP] Action: check | game=${gameTarget} | user_id=${playerId} | ip=${req.ip}`)
          const result = await checkId(gameTarget, userInputs, zone_id)
          return res.json({ status: true, action: "check", result })
        }

        case "order": {
          const gameTarget = game || params.slug
          if (!gameTarget) {
            return res.status(400).json({ status: false, message: "Parameter 'game' wajib diisi untuk action=order" })
          }
          if (!did) {
            return res.status(400).json({ status: false, message: "Parameter 'did' (ID item) wajib diisi untuk action=order" })
          }

          const paymentId = String(pid || "522")
          const playerId = user_id || params.player_id || params.userid || params.id
          const userInputs = {
            ...(playerId ? { player_id: playerId, playerid: playerId, userid: playerId, id: playerId } : {}),
            ...(zone_id ? { zone_id, zoneid: zone_id, serverid: zone_id } : {}),
            ...params,
          }

          logger.info(`[UNIPIN-TOPUP] Action: order | game=${gameTarget} | did=${did} | pid=${paymentId} | user_id=${playerId || "-"} | ip=${req.ip}`)
          const result = await createOrder({
            game: gameTarget,
            did,
            pid: paymentId,
            userInputs,
            email,
            phone,
            req,
          })

          return res.json({
            status: true,
            action: "order",
            game: gameTarget,
            did,
            pid: result.payment_channel_id || paymentId,
            payment_method: result.payment_method || "QRIS",
            user_id: playerId || null,
            result,
          })
        }

        case "status": {
          const transactionId = trx_id || params.id || params.orderId || params.transaction_id
          if (!transactionId) {
            return res.status(400).json({ status: false, message: "Parameter 'trx_id' wajib diisi untuk action=status" })
          }

          logger.info(`[UNIPIN-TOPUP] Action: status | trx_id=${transactionId} | ip=${req.ip}`)
          const result = await checkPaymentStatus(transactionId)
          return res.json({ status: true, action: "status", result })
        }

        default: {
          return res.status(400).json({
            status: false,
            message: `Action '${action}' tidak valid`,
            available_actions: ["home", "search", "detail", "check", "order", "status"],
          })
        }
      }
    } catch (err) {
      logger.error(`[UNIPIN-TOPUP] Error: ${err.message}`)
      return res.status(500).json({
        status: false,
        message: err.message || "Terjadi kesalahan internal pada UniPin topup",
      })
    }
  },
}
