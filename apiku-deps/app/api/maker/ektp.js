import { createCanvas, Image, registerFont } from 'canvas'
import path from 'path'
import logger from '../../src/utils/logger.js'

const EKTP_DIR = path.join(process.cwd(), 'api', 'maker', 'assets', 'ektp')

registerFont(path.join(EKTP_DIR, 'Arrial.ttf'), { family: 'Arrial' })
registerFont(path.join(EKTP_DIR, 'Ocr.ttf'), { family: 'Ocr' })
registerFont(path.join(EKTP_DIR, 'Sign.ttf'), { family: 'Sign' })

const FONT = { arrial: 'Arrial', ocr: 'Ocr', sign: 'Sign' }
const DATA_SIZE = { prov: 25, nik: 40, data: 16, sign: 40 }

// Ukuran target eksplisit untuk foto (cover crop, aspect ratio dipertahankan)
const PHOTO = { x: 520, y: 140, width: 173, height: 180 }

// Konfigurasi koordinat terpusat — semua field disesuaikan dari satu tempat
const POS = {
  provinsi:       { x: 380, y: 50, align: 'center', maxWidth: 500 },
  kota:           { x: 380, y: 75, align: 'center', maxWidth: 500 },
  nik:            { x: 170, y: 105, font: FONT.ocr, size: DATA_SIZE.nik, maxWidth: 620 },
  nama:           { x: 190, y: 150, maxWidth: 300 },
  ttl:            { x: 190, y: 173, maxWidth: 300 },
  jenisKelamin:   { x: 190, y: 196, maxWidth: 250 },
  golonganDarah:  { x: 463, y: 195, maxWidth: 80 },
  alamat:         { x: 190, y: 217, maxWidth: 420 },
  rtRw:           { x: 190, y: 239, maxWidth: 420 },
  kelDesa:        { x: 190, y: 262, maxWidth: 420 },
  kecamatan:      { x: 190, y: 284, maxWidth: 420 },
  agama:          { x: 190, y: 305, maxWidth: 420 },
  status:         { x: 190, y: 328, maxWidth: 420 },
  pekerjaan:      { x: 190, y: 351, maxWidth: 420 },
  kewarganegaraan: { x: 190, y: 374, maxWidth: 420 },
  masaBerlaku:    { x: 190, y: 395, maxWidth: 420 },
  kotaBawah:      { x: 553, y: 345, maxWidth: 220 },
  terbuat:        { x: 570, y: 365, maxWidth: 200 },
  sign:           { x: 540, y: 400, font: FONT.sign, size: DATA_SIZE.sign, maxWidth: 220 }
}

// Batas panjang teks per field (untuk mencegah teks keluar canvas)
const MAX_LEN = {
  provinsi: 30,
  kota: 30,
  nama: 40,
  nik: 16,
  ttl: 45,
  jenis_kelamin: 15,
  golongan_darah: 5,
  alamat: 60,
  'rt/rw': 8,
  'kel/desa': 35,
  kecamatan: 35,
  agama: 15,
  status: 20,
  pekerjaan: 30,
  kewarganegaraan: 20,
  masa_berlaku: 20,
  terbuat: 20
}

const DEFAULTS = {
  golongan_darah: 'A',
  'rt/rw': '001/002',
  'kel/desa': '',
  status: 'Belum Menikah',
  pekerjaan: 'Wiraswasta',
  kewarganegaraan: 'WNI',
  masa_berlaku: 'SEUMUR HIDUP'
}

function sanitize(value) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
}

function loadImage(filePathOrBuffer) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = (err) => reject(err)
    img.src = filePathOrBuffer
  })
}

// Helper text — set font/ukuran/alignment/baseline/uppercase/maxWidth setiap panggilan
function drawText(ctx, text, x, y, opts = {}) {
  const {
    font = FONT.arrial,
    size = DATA_SIZE.data,
    minSize = 10,
    align = 'left',
    baseline = 'alphabetic',
    uppercase = false,
    maxLength = Infinity,
    maxWidth = 0,
    color = 'black'
  } = opts

  let t = sanitize(text)
  if (uppercase) t = t.toUpperCase()
  if (Number.isFinite(maxLength) && t.length > maxLength) t = t.slice(0, maxLength)

  let fs = size
  ctx.save()
  ctx.fillStyle = color
  ctx.font = `${fs}px ${font}`
  ctx.textAlign = align
  ctx.textBaseline = baseline

  if (maxWidth > 0 && ctx.measureText(t).width > maxWidth) {
    while (fs > minSize && ctx.measureText(t).width > maxWidth) {
      fs -= 1
      ctx.font = `${fs}px ${font}`
    }
  }

  ctx.fillText(t, x, y)
  ctx.restore()
}

// Cover crop: pertahankan aspect ratio, isi area target penuh tanpa gepeng
function drawCover(ctx, img, dx, dy, dw, dh) {
  const scale = Math.max(dw / img.width, dh / img.height)
  const sw = dw / scale
  const sh = dh / scale
  const sx = (img.width - sw) / 2
  const sy = (img.height - sh) / 2
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
}

// Normalisasi NIK ke format fiktif mockup: XXXX-XXXX-XXXX-XXXX
function normalizeNik(value) {
  const digits = sanitize(value).replace(/\D/g, '').slice(0, 16)
  if (digits.length !== 16) return '0000-0000-0000-0000'
  return digits.replace(/(\d{4})(?=\d)/g, '$1-')
}

// Watermark wajib, diagonal & transparan tetapi jelas terlihat
function drawWatermark(ctx, width, height) {
  const text = 'CONTOH — TIDAK BERLAKU'
  const fs = Math.max(28, Math.round(width / 14))

  ctx.save()
  ctx.globalAlpha = 0.2
  ctx.fillStyle = '#d02136'
  ctx.font = `bold ${fs}px ${FONT.arrial}`
  ctx.textAlign = 'center'
  ctx.translate(Math.round(width / 2), Math.round(height / 2))
  ctx.rotate(-Math.PI / 6)
  const spacing = Math.round(fs * 2.8)
  for (let i = -3; i <= 3; i += 1) {
    ctx.fillText(text, 0, i * spacing)
  }
  ctx.restore()
}

async function generateEKTP(input) {
  const data = { ...DEFAULTS, ...input }

  const template = await loadImage(path.join(EKTP_DIR, 'Template.png'))
  const width = template.width
  const height = template.height

  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(template, 0, 0)

  let photoImg
  try {
    const src = sanitize(data.pas_photo)
    if (/^https?:\/\//i.test(src)) {
      const res = await fetch(src)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      photoImg = await loadImage(buf)
    } else {
      photoImg = await loadImage(path.join(EKTP_DIR, 'default_photo.jpg'))
    }
  } catch {
    photoImg = await loadImage(path.join(EKTP_DIR, 'default_photo.jpg'))
  }

  drawCover(ctx, photoImg, PHOTO.x, PHOTO.y, PHOTO.width, PHOTO.height)

  // Header provinsi / kota (center, Arrial)
  drawText(ctx, data.provinsi, POS.provinsi.x, POS.provinsi.y, {
    size: DATA_SIZE.prov, align: 'center', uppercase: true,
    maxLength: MAX_LEN.provinsi, maxWidth: POS.provinsi.maxWidth
  })
  drawText(ctx, data.kota, POS.kota.x, POS.kota.y, {
    size: DATA_SIZE.prov, align: 'center', uppercase: true,
    maxLength: MAX_LEN.kota, maxWidth: POS.kota.maxWidth
  })

  // NIK mockup (font OCR, format fiktif, konsisten & tidak menempel label)
  drawText(ctx, normalizeNik(data.nik), POS.nik.x, POS.nik.y, {
    font: POS.nik.font, size: POS.nik.size, maxWidth: POS.nik.maxWidth
  })

  // Field data kiri (font Arrial konsisten, uppercase sesuai template)
  const fields = [
    { key: 'nama', pos: POS.nama, max: MAX_LEN.nama },
    { key: 'ttl', pos: POS.ttl, max: MAX_LEN.ttl },
    { key: 'jenis_kelamin', pos: POS.jenisKelamin, max: MAX_LEN.jenis_kelamin },
    { key: 'golongan_darah', pos: POS.golonganDarah, max: MAX_LEN.golongan_darah },
    { key: 'alamat', pos: POS.alamat, max: MAX_LEN.alamat },
    { key: 'rt/rw', pos: POS.rtRw, max: MAX_LEN['rt/rw'] },
    { key: 'kel/desa', pos: POS.kelDesa, max: MAX_LEN['kel/desa'] },
    { key: 'kecamatan', pos: POS.kecamatan, max: MAX_LEN.kecamatan },
    { key: 'agama', pos: POS.agama, max: MAX_LEN.agama },
    { key: 'status', pos: POS.status, max: MAX_LEN.status },
    { key: 'pekerjaan', pos: POS.pekerjaan, max: MAX_LEN.pekerjaan },
    { key: 'kewarganegaraan', pos: POS.kewarganegaraan, max: MAX_LEN.kewarganegaraan },
    { key: 'masa_berlaku', pos: POS.masaBerlaku, max: MAX_LEN.masa_berlaku }
  ]

  for (const f of fields) {
    drawText(ctx, data[f.key], f.pos.x, f.pos.y, {
      size: DATA_SIZE.data, uppercase: true, maxLength: f.max, maxWidth: f.pos.maxWidth
    })
  }

  // Blok kanan: kota pembuatan + tanggal + tanda tangan
  drawText(ctx, data.kota, POS.kotaBawah.x, POS.kotaBawah.y, {
    size: DATA_SIZE.data, uppercase: true, maxLength: MAX_LEN.kota, maxWidth: POS.kotaBawah.maxWidth
  })
  drawText(ctx, data.terbuat, POS.terbuat.x, POS.terbuat.y, {
    size: DATA_SIZE.data, uppercase: true, maxLength: MAX_LEN.terbuat, maxWidth: POS.terbuat.maxWidth
  })

  const sign = (sanitize(data.nama).split(' ')[0] || '').toUpperCase()
  drawText(ctx, sign, POS.sign.x, POS.sign.y, {
    font: POS.sign.font, size: POS.sign.size, maxLength: 20, maxWidth: POS.sign.maxWidth
  })

  drawWatermark(ctx, width, height)

  return canvas.toBuffer('image/png')
}

export default {
  name: "EKTP Generator",
  description: "Generate fake E-KTP (Kartu Tanda Penduduk) Indonesia",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["nama", "nik", "provinsi", "kota", "ttl", "jenis_kelamin", "golongan_darah", "alamat", "rt/rw", "kel/desa", "kecamatan", "agama", "status", "pekerjaan", "kewarganegaraan", "masa_berlaku", "terbuat", "pas_photo"],
  paramsSchema: {
    nama: { type: "string", required: true, description: "Nama lengkap", example: "Budi Santoso" },
    nik: { type: "string", required: true, description: "NIK (16 digit, akan dinormalisasi ke format mockup)", example: "3201010101010001" },
    provinsi: { type: "string", required: true, description: "Provinsi", example: "Jawa Barat" },
    kota: { type: "string", required: true, description: "Kota/Kabupaten", example: "Bandung" },
    ttl: { type: "string", required: true, description: "Tempat, Tanggal Lahir", example: "Bandung, 17-08-1945" },
    jenis_kelamin: { type: "string", required: true, description: "Jenis Kelamin", example: "Laki-Laki" },
    golongan_darah: { type: "string", required: false, default: "A", description: "Golongan Darah" },
    alamat: { type: "string", required: true, description: "Alamat", example: "Jl. Asia Afrika No. 1" },
    "rt/rw": { type: "string", required: false, default: "001/002", description: "RT/RW" },
    "kel/desa": { type: "string", required: false, default: "", description: "Kelurahan/Desa" },
    kecamatan: { type: "string", required: true, description: "Kecamatan", example: "Sumur Bandung" },
    agama: { type: "string", required: true, description: "Agama", example: "Islam" },
    status: { type: "string", required: false, default: "Belum Menikah", description: "Status Perkawinan" },
    pekerjaan: { type: "string", required: false, default: "Wiraswasta", description: "Pekerjaan" },
    kewarganegaraan: { type: "string", required: false, default: "WNI", description: "Kewarganegaraan" },
    masa_berlaku: { type: "string", required: false, default: "SEUMUR HIDUP", description: "Masa Berlaku" },
    terbuat: { type: "string", required: false, description: "Tanggal pembuatan", example: "19-10-2023" },
    pas_photo: { type: "string", required: false, description: "URL foto (opsional, default: template)" }
  },

  async run(req, res) {
    try {
      const data = { ...req.query, ...req.body }

      if (!sanitize(data.nama) || !sanitize(data.nik) || !sanitize(data.provinsi) || !sanitize(data.kota)) {
        return res.status(400).json({
          status: false,
          message: "Parameter wajib: nama, nik, provinsi, kota"
        })
      }

      const buffer = await generateEKTP(data)

      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Content-Disposition', `inline; filename="ektp_${sanitize(data.nama).replace(/\s+/g, '_')}.png"`)
      return res.send(buffer)
    } catch (err) {
      logger.error(`[EKTP] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || 'Gagal generate E-KTP' })
    }
  }
}