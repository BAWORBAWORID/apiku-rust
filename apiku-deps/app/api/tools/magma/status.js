/**
 * MAGMA API — Endpoint Status Realtime Gunung Api
 * Sumber data: magma.esdm.go.id (POST /v1/json/var dengan signature)
 * Metode: POST
 */

const BASE_URL = "https://magma.esdm.go.id"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

let csrfToken = null
let signature = null
let bootstrapped = false
let cookieJar = {}

function mergeCookies(setCookies) {
  if (!setCookies) return
  const list = Array.isArray(setCookies) ? setCookies : [setCookies]
  for (const c of list) {
    const kv = String(c).split(";")[0]
    const idx = kv.indexOf("=")
    if (idx > 0) cookieJar[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim()
  }
}

function cookieString() {
  return Object.entries(cookieJar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
}

function resetSession() {
  csrfToken = null
  signature = null
  bootstrapped = false
}

async function fetchHtml(path, opts = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch(BASE_URL + path, {
      method: opts.method || "GET",
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
        ...(cookieString() ? { Cookie: cookieString() } : {}),
        ...(opts.headers || {}),
      },
      body: opts.body,
      redirect: "follow",
      signal: controller.signal,
    })
    clearTimeout(timer)
    mergeCookies(typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : res.headers.get("set-cookie"))
    return res
  } catch (e) {
    clearTimeout(timer)
    throw e
  }
}

async function bootstrap() {
  if (bootstrapped) return
  const res = await fetchHtml("/")
  const html = await res.text()
  const mCsrf = html.match(/name="csrf-token"\s+content="([^"]+)"/)
  const mSig = html.match(/\/v1\/json\/var\?signature=([a-f0-9]{64})/)
  if (mCsrf) csrfToken = mCsrf[1]
  if (mSig) signature = mSig[1]
  if (csrfToken && signature) bootstrapped = true
}

async function requestRealtime(volcanoCode) {
  // 1. GET home -> csrf + signature + XSRF-TOKEN cookie
  await resetSession()
  await bootstrap()
  const postHeaders = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-CSRF-TOKEN": csrfToken || "",
    "X-Requested-With": "XMLHttpRequest",
    Referer: BASE_URL + "/",
  }
  // 2. Warm POST -> server set session cookie (reply 419 ignored, but cookie saved)
  await fetchHtml("/v1/json/var" + (signature ? "?signature=" + signature : ""), {
    method: "POST",
    headers: postHeaders,
    body: new URLSearchParams({ ga_code: volcanoCode }).toString(),
  })
  // 3. Re-bootstrap with session cookie -> fresh CSRF bound to session
  await resetSession()
  await bootstrap()
  // 4. Real POST with fresh csrf + full cookies
  const res = await fetchHtml("/v1/json/var" + (signature ? "?signature=" + signature : ""), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-CSRF-TOKEN": csrfToken || "",
      "X-Requested-With": "XMLHttpRequest",
      Referer: BASE_URL + "/",
    },
    body: new URLSearchParams({ ga_code: volcanoCode }).toString(),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} - realtime ${volcanoCode}`)
  return res.json()
}

export default {
  name: "MAGMA Status Realtime",
  description: "Status aktivitas realtime satu gunung api (Level I/II/III/IV)",
  category: "Tools",
  methods: ["POST"],
  params: ["volcanoCode"],
  paramsSchema: {
    volcanoCode: {
      type: "string",
      required: true,
      description: "Kode gunung (AGU, SMR, BRO, dll)",
      example: "SMR",
    },
  },
  async run(req, res) {
    try {
      const { volcanoCode } = { ...req.query, ...req.body }
      if (!volcanoCode || typeof volcanoCode !== "string" || volcanoCode.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'volcanoCode' wajib diisi",
          timestamp: Date.now(),
        })
      }

      const data = await requestRealtime(volcanoCode.trim())
      if (!data || !data.data) {
        return res.json({
          status: false,
          message: "Tidak dapat mengambil status realtime",
          timestamp: Date.now(),
        })
      }

      const status = {
        code: volcanoCode,
        name: data.data.gunungapi?.nama || volcanoCode || "",
        status: Number(data.data.gunungapi?.status) || null,
        statusLabel:
          data.data.gunungapi?.status &&
          [1, 2, 3, 4].includes(Number(data.data.gunungapi?.status))
            ? [ "Level I (Normal)", "Level II (Waspada)", "Level III (Siaga)", "Level IV (Awas)" ][Number(data.data.gunungapi.status) - 1]
            : "Unknown",
        coordinates: Array.isArray(data.data.gunungapi?.koordinat)
          ? data.data.gunungapi.koordinat.map(Number)
          : null,
        hasVona: String(data.data.gunungapi?.has_vona) === "1",
        reportPeriod: data.data.laporan ? data.data.laporan.tanggal || null : null,
        reportAuthor: data.data.laporan ? data.data.laporan.pembuat || null : null,
        visual: data.data.visual ? data.data.visual.deskripsi || null : null,
        visualOther: data.data.visual ? data.data.visual.lainnya || null : null,
        visualPhoto: data.data.visual ? data.data.visual.foto || null : null,
        climatology: data.data.klimatologi ? data.data.klimatologi.deskripsi || null : null,
        seismic: data.data.gempa ? (Array.isArray(data.data.gempa.deskripsi) ? data.data.gempa.deskripsi : [data.data.gempa.deskripsi]) : null,
        seismicChart: data.data.gempa ? data.data.gempa.grafik || null : null,
        recommendation: data.data.rekomendasi || null,
        vona: data.data.vona || null,
        scrapedAt: new Date().toISOString(),
      }

      res.json({ status: true, timestamp: Date.now(), data: status })
    } catch (err) {
      console.error("[MAGMA Status Realtime Error]", err.message)
      res.status(500).json({
        status: false,
        message: err.message || "Gagal mengambil status realtime",
        timestamp: Date.now(),
      })
    }
  },
}