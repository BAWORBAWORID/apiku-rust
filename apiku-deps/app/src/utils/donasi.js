/**
 * Donasi — QRIS via Sociabuzz
 *
 * Utilitas untuk membuat invoice donasi QRIS pada halaman creator Sociabuzz,
 * menyimpannya ke data/donasi.json, dan membersihkan otomatis record yang
 * sudah kedaluwarsa.
 *
 * Catatan hasil reverse-engineering (2026-09-30):
 *  - Minimum donasi riil di tribe adalah Rp10.000. Nilai di bawah itu ditolak
 *    upstream dengan pesan "Please scroll to the top and check form field" —
 *    pesan itu sama sekali tidak menyuruh cek nominal, sehingga mudah disalahdiagnosis.
 *    Karena itu validasi minimum dilakukan di sini, sebelum request dikirim.
 *  - Endpoint submit: /{username}/popup/get-form-queue
 *  - Field form yang baru dipakai Sociabuzz sekarang: quantity, dukungan_id,
 *    is_shipping, address, is_answer, answer, non-commercial
 */

import axios from "axios"
import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import logger from "./logger.js"

const BASE_URL = "https://sociabuzz.com"
const DATA_PATH = path.join(process.cwd(), "data", "donasi.json")

/** Minimum donasi riil di tribe (diverifikasi 2026-09-30). */
export const MIN_AMOUNT = 10000
export const MAX_AMOUNT = 10_000_000

/** Umur record di file setelah invoice kedaluwarsa, sebelum dihapus. */
const EXPIRY_GRACE_MS = 2 * 60 * 60 * 1000 // 2 jam
/** Batas jumlah record yang disimpan di file. */
const MAX_RECORDS = 500

const UA =
  "Mozilla/5.0 (Linux; Android 13; SM-A057F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

/* ----------------------------- util internal ----------------------------- */

const toInt = (v) => {
  const n = Number(String(v ?? "").replace(/[^\d]/g, ""))
  return Number.isFinite(n) ? n : 0
}

/** Buang karakter kontrol + potong panjang. Mencegah field aneh masuk form. */
const clean = (v, max = 120) =>
  String(v ?? "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, max)

const USERNAME_RE = /^[A-Za-z0-9_-]{2,32}$/
const DEFAULT_USERNAME = "zyvor"

/** Serialisasi akses tulis supaya dua request paralel tidak saling menimpa file. */
let writeLock = Promise.resolve()
function withLock(fn) {
  const run = writeLock.then(fn, fn)
  // Jaga rantai tetap hidup walau fn menolak.
  writeLock = run.then(
    () => {},
    () => {}
  )
  return run
}

async function readStore() {
  try {
    const raw = await fs.readFile(DATA_PATH, "utf-8")
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

async function writeStore(list) {
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true })
  // Tulis ke file sementara lalu rename, supaya tidak ada file setengah ditulis.
  const tmp = `${DATA_PATH}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), "utf-8")
  await fs.rename(tmp, DATA_PATH)
}

/**
 * Buang record yang sudah kedaluwarsa (lewat grace period) dan record yang
 * sudah paid lebih dari 7 hari lalu, lalu batasi jumlahnya.
 */
function prune(list, now = Date.now()) {
  const week = 7 * 24 * 60 * 60 * 1000
  const kept = list.filter((r) => {
    const exp = r?.expiredAt ? Date.parse(r.expiredAt) : 0
    if (r?.status === "paid" && r?.paidAt && now - Date.parse(r.paidAt) > week) return false
    // Aturan kedaluwarsa QRIS hanya untuk yang belum dibayar. Record paid punya
    // expiredAt di masa lalu secara normal, jadi ikut kena aturan ini akan
    // menghapus donasi yang sukses dalam ~2 jam, bukan 7 hari.
    if (r?.status !== "paid" && exp && now > exp + EXPIRY_GRACE_MS) return false
    return true
  })
  return kept.length > MAX_RECORDS ? kept.slice(kept.length - MAX_RECORDS) : kept
}

/** Sweep otomatis: dipanggil setiap kali create/get status. */
export async function cleanupExpired() {
  return withLock(async () => {
    const list = await readStore()
    const cleaned = prune(list)
    if (cleaned.length !== list.length) {
      await writeStore(cleaned)
      const removed = list.length - cleaned.length
      logger.info(`[Donasi] Auto-cleanup: ${removed} record kedaluwarsa dihapus`)
      return removed
    }
    return 0
  })
}

/** Ubah nilai upstream menjadi ISO string.
 *  `countdown` dari gateway bisa berupa string tanggal, epoch milidetik, atau
 *  epoch detik — dan kadang sama sekali tidak ada. Semua fallback ke default
 *  supaya `toISOString()` tidak pernah melempar "Invalid time value". */
function toIso(value, fallbackMs) {
  if (value === null || value === undefined || value === "") return new Date(fallbackMs).toISOString()
  if (typeof value === "number" || /^\d{10,}$/.test(String(value).trim())) {
    const n = Number(value)
    // 10 digit = detik, 13 digit = milidetik
    return new Date(String(value).trim().length <= 10 ? n * 1000 : n).toISOString()
  }
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  return new Date(fallbackMs).toISOString()
}

/** Pesan error ringkas. Objek error axios memuat seluruh request/socket —
 *  kalau dibiarkan mentah, endpoint publik bisa membocorkan internal. */
function errMsg(err, fallback) {
  const r = err?.response
  if (r) {
    const d = r.data
    if (typeof d === "object" && d) {
      return d.content?.form_alert || d.message || d.error || `${fallback} (HTTP ${r.status})`
    }
    if (typeof d === "string" && d.trim()) {
      if (/not allowed/i.test(d)) return `${fallback}: upstream menolak (403)`
      return `${fallback} (HTTP ${r.status})`
    }
    return `${fallback} (HTTP ${r.status})`
  }
  if (err?.code === "ECONNABORTED") return `${fallback}: timeout`
  return err?.message ? `${fallback}: ${err.message}` : fallback
}

/* --------------------------- client Sociabuzz --------------------------- */

function makeClient() {
  let jar = {}
  const cookieHeader = () =>
    Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ")

  const api = axios.create({ timeout: 20000, headers: { "User-Agent": UA } })

  api.interceptors.response.use((r) => {
    for (const c of r.headers["set-cookie"] || []) {
      const [kv] = c.split(";")
      const i = kv.indexOf("=")
      if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim()
    }
    return r
  })
  api.interceptors.request.use((c) => {
    if (Object.keys(jar).length && String(c.url).includes("sociabuzz")) c.headers.Cookie = cookieHeader()
    return c
  })

  return api
}

/* ------------------------------ API publik ------------------------------ */

/**
 * Buat invoice donasi QRIS.
 *
 * @param {object} opts
 * @param {string}  [opts.username]  username creator di Sociabuzz
 * @param {number}  opts.amount      nominal rupiah (min. MIN_AMOUNT)
 * @param {string}  [opts.name]      nama donatur
 * @param {string}  [opts.message]   pesan (opsional)
 * @param {string}  [opts.email]     email donatur (opsional)
 * @param {string}  [opts.phone]     no. HP (opsional)
 * @returns {Promise<object>} record donasi
 */
export async function createDonation(opts = {}) {
  // Halaman donasi tidak selalu mengirim username, jadi default dipakai dulu
  // SEBELUM validasi — kalau tidak, setiap request dari halaman akan ditolak.
  const username = clean(opts.username, 32) || DEFAULT_USERNAME
  if (!USERNAME_RE.test(username)) {
    throw new Error("Username creator tidak valid.")
  }

  const amount = toInt(opts.amount)
  if (!amount) throw new Error("Nominal donasi wajib diisi.")
  if (amount < MIN_AMOUNT) {
    throw new Error(`Minimum donasi Rp${MIN_AMOUNT.toLocaleString("id-ID")}.`)
  }
  if (amount > MAX_AMOUNT) {
    throw new Error(`Maximum donasi Rp${MAX_AMOUNT.toLocaleString("id-ID")}.`)
  }

  const name = clean(opts.name, 60) || "Hamba Allah"
  const message = clean(opts.message, 200)
  const email = clean(opts.email, 80) || `donatur${Date.now()}@mail.com`
  const phone = clean(opts.phone, 20)

  const api = makeClient()
  const donateUrl = `${BASE_URL}/${username}/donate`

  // 1) Ambil halaman donasi + token CSRF.
  let home
  try {
    home = await api.get(donateUrl, {
      headers: { Accept: "text/html" },
      validateStatus: () => true,
    })
  } catch (err) {
    throw new Error(errMsg(err, "Gagal menghubungi halaman donasi"))
  }
  if (home.status === 404) throw new Error("Username creator tidak ditemukan.")

  const html = String(home.data)
  const csrf = html.match(/name="sb_token_csrf"[^>]*value="([^"]+)"/)?.[1]
  if (!csrf) throw new Error("Gagal memuat halaman donasi (token CSRF tidak ditemukan).")

  // 2) Kirim form antrean.
  const form = {
    sb_token_csrf: csrf,
    currency: "IDR",
    amount: String(amount),
    qty: "1",
    quantity: "1",
    support_duration: "30",
    fullname: name,
    email,
    note: message,
    is_agree: "1",
    years18: "1",
    is_vote: "0",
    is_voice: "0",
    is_songshare: "0",
    is_mediashare: "0",
    is_gif: "0",
    is_sound: "0",
    sound_share: "",
    is_voicy: "0",
    vote_id: "",
    ms_maxtime: "",
    start_from: "0",
    ms_starthour: "0",
    ms_startminute: "0",
    ms_startsecond: "0",
    spin_check: "0",
    prev_url: donateUrl,
    hide_email: "0",
    is_tiktok: "0",
    tiktok: "",
    tiktok_duration: "",
    is_instagram: "0",
    instagram: "",
    instagram_duration: "",
    wishlist_id: "",
    quickpay: "0",
    queue: "",
    // Field yang dipakai form Sociabuzz sekarang.
    dukungan_id: "",
    is_shipping: "0",
    address: "",
    is_answer: "0",
    answer: "",
    "non-commercial": "1",
  }
  if (phone) form.phone_number = phone

  const queueUrl = `${BASE_URL}/${username}/popup/get-form-queue`
  let sub
  try {
    sub = await api.post(queueUrl, new URLSearchParams(form).toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: BASE_URL,
        Referer: donateUrl,
        "X-Requested-With": "XMLHttpRequest",
      },
    })
  } catch (err) {
    throw new Error(errMsg(err, "Permintaan antrean donasi gagal"))
  }

  const payload = sub?.data
  if (payload?.success !== "true" && payload?.success !== true) {
    throw new Error(
      payload?.content?.form_alert ||
        (amount < MIN_AMOUNT
          ? `Nominal ditolak upstream. Minimum tribe ini Rp${MIN_AMOUNT.toLocaleString("id-ID")}.`
          : "Permintaan donasi ditolak Sociabuzz.")
    )
  }

  const paymentUrl = payload?.content?.redirect
  if (!paymentUrl) throw new Error("Sociabuzz tidak mengembalikan URL pembayaran.")
  const orderId = String(paymentUrl).split("/payment/x/")[1]?.split(/[?#]/)[0] || ""

  // 3) Buka halaman pembayaran, ambil CSRF kedua.
  let pay
  try {
    pay = await api.get(paymentUrl, { headers: { Accept: "text/html" } })
  } catch (err) {
    throw new Error(errMsg(err, "Gagal membuka halaman pembayaran"))
  }
  const csrf2 = String(pay.data).match(/name="sb_token_csrf"[^>]*value="([^"]+)"/)?.[1]

  await api.get(`${BASE_URL}/payment/pay/setting`, {
    params: {
      amount: String(amount),
      currency: "IDR",
      base_amount: String(amount),
      base_currency: "IDR",
      currency_def: "IDR",
      convertion: "IDR",
      country: "Indonesia",
      feature: "TRIBE",
      is_borne_fee: "1",
      risk: "",
      message: "",
      direct: "",
      service_fee: "1",
      token: orderId,
      country_account: "",
    },
  })

  // 4) Kirim ke gateway QRIS.
  const sendBody = {
    sb_token_csrf: csrf2,
    order_id: orderId,
    final_currency: "IDR",
    currency_def: "IDR",
    payment_method: "qris",
    type_payment: "qris",
    source_payment: "xendit",
    country: "ID",
    country_pay: "Indonesia",
  }
  if (phone) sendBody.phone_number = phone

  let sent
  try {
    sent = await api.post(`${BASE_URL}/payment/send/create`, sendBody, {
      headers: {
        "Content-Type": "application/json",
        Origin: BASE_URL,
        Referer: paymentUrl,
        "X-Requested-With": "XMLHttpRequest",
      },
    })
  } catch (err) {
    throw new Error(errMsg(err, "Gateway QRIS gagal dihubungi"))
  }

  const r = sent?.data
  if (!r?.status) {
    throw new Error(
      `Gateway QRIS menolak: ${r?.message || r?.content?.form_alert || JSON.stringify(r).slice(0, 140)}`
    )
  }

  const total = toInt(r.data?.amount || r.data?.total || amount)
  const expiredAt = toIso(r.data?.countdown, Date.now() + 60 * 60 * 1000)

  const record = {
    id: "DNR-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(2).toString("hex").toUpperCase(),
    username,
    orderId,
    paymentUrl,
    invId: r.inv_id || null,
    amount,
    fee: Math.max(0, total - amount),
    totalAmount: total,
    name,
    message,
    method: "qris",
    source: r.source_payment || "xendit",
    qrString: r.data?.qr_string || null,
    pendingUrl: r.inv_id
      ? `${BASE_URL}/payment/pending?type=qris&inv_id=${encodeURIComponent(r.inv_id)}`
      : null,
    status: "pending",
    createdAt: new Date().toISOString(),
    expiredAt,
    paidAt: null,
  }

  await withLock(async () => {
    const list = prune(await readStore())
    list.push(record)
    await writeStore(list)
  })

  logger.info(
    `[Donasi] Invoice ${record.id} Rp${amount} untuk ${username} | order=${orderId}`
  )
  return record
}

/**
 * Ambil satu record donasi dari storage.
 * @param {string} id
 */
export async function getDonation(id) {
  await cleanupExpired()
  const key = clean(id, 40)
  if (!key) throw new Error("Parameter id wajib diisi.")
  const list = await readStore()
  return list.find((r) => r.id === key) || null
}

/**
 * Cek status pembayaran di Sociabuzz lalu perbarui record lokal.
 *
 * Status yang dibaca dari halaman pending Sociabuzz. Kalau tidak ada informasi
 * baru, status lokal tidak diubah.
 *
 * @param {string} id
 */
export async function checkDonationStatus(id) {
  const record = await getDonation(id)
  if (!record) throw new Error("Invoice tidak ditemukan (atau sudah kedaluwarsa).")

  if (record.status === "paid") return record
  if (Date.parse(record.expiredAt) < Date.now()) {
    record.status = "expired"
    await withLock(async () => {
      const list = await readStore()
      const i = list.findIndex((r) => r.id === record.id)
      if (i > -1) {
        list[i] = record
        await writeStore(prune(list))
      }
    })
    return record
  }

  const url = record.pendingUrl || record.paymentUrl
  try {
    const api = makeClient()
    const res = await api.get(url, {
      headers: { Accept: "text/html" },
      validateStatus: () => true,
      timeout: 15000,
    })
    const html = String(res.data || "")

    // Sociabuzz menandai pembayaran lunas di halaman pending.
    const paid =
      /status.?berhasil|pembayaran.?berhasil|paid|selesai|lunas/i.test(html) &&
      !/belum.?bayar|menunggu.?pembayaran|pending/i.test(html.slice(0, 4000))

    if (paid) {
      record.status = "paid"
      record.paidAt = new Date().toISOString()
      await withLock(async () => {
        const list = await readStore()
        const i = list.findIndex((r) => r.id === record.id)
        if (i > -1) {
          list[i] = record
          await writeStore(list)
        }
      })
      logger.info(`[Donasi] Invoice ${record.id} tercatat lunas`)
    }
  } catch (err) {
    // Gagal cek tidak boleh mengubah status — biarkan pending.
    logger.warn(`[Donasi] Cek status ${record.id} gagal: ${err.message}`)
  }

  return record
}

/** Ringkasan untuk halaman publik (tanpa mengekspos data donatur). */
export async function getDonationSummary(username) {
  await cleanupExpired()
  const list = await readStore()
  const mine = username ? list.filter((r) => r.username === username) : list
  const paid = mine.filter((r) => r.status === "paid")
  return {
    // Hanya donasi yang benar-benar berhasil. Invoice pending belum jadi donasi,
    // jadi tidak ikut dihitung supaya angka publik tidak menyesatkan.
    total: paid.length,
    paidCount: paid.length,
    donorCount: new Set(paid.map((r) => (r.name || "").trim().toLowerCase()).filter(Boolean)).size,
    pendingCount: mine.filter((r) => r.status === "pending").length,
    totalPaid: paid.reduce((s, r) => s + (r.totalAmount || 0), 0),
  }
}

export default {
  MIN_AMOUNT,
  MAX_AMOUNT,
  createDonation,
  getDonation,
  checkDonationStatus,
  getDonationSummary,
  cleanupExpired,
}
