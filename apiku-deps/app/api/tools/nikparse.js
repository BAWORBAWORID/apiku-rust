import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import logger from "../../src/utils/logger.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WILAYAH_PATH = path.resolve(__dirname, "assets/nikparse/wilayah.json")

let wilayahCache = null

function loadWilayah() {
  if (wilayahCache) return wilayahCache
  const raw = fs.readFileSync(WILAYAH_PATH, "utf-8")
  wilayahCache = JSON.parse(raw)
  return wilayahCache
}

const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"]

const ZODIAK = [
  { name: "Capricorn", start: [12, 22], end: [1, 19] },
  { name: "Aquarius", start: [1, 20], end: [2, 18] },
  { name: "Pisces", start: [2, 19], end: [3, 20] },
  { name: "Aries", start: [3, 21], end: [4, 19] },
  { name: "Taurus", start: [4, 20], end: [5, 20] },
  { name: "Gemini", start: [5, 21], end: [6, 20] },
  { name: "Cancer", start: [6, 21], end: [7, 22] },
  { name: "Leo", start: [7, 23], end: [8, 22] },
  { name: "Virgo", start: [8, 23], end: [9, 22] },
  { name: "Libra", start: [9, 23], end: [10, 22] },
  { name: "Scorpio", start: [10, 23], end: [11, 21] },
  { name: "Sagittarius", start: [11, 22], end: [12, 21] },
]

function getZodiak(day, month) {
  for (const z of ZODIAK) {
    const [sm, sd] = z.start
    const [em, ed] = z.end
    if (sm === em) {
      if (month === sm && day >= sd && day <= ed) return z.name
    } else {
      if ((month === sm && day >= sd) || (month === em && day <= ed)) return z.name
    }
  }
  return "Unknown"
}

function parseNIK(nik) {
  const wilayah = loadWilayah()
  const { provinsi, kabkot, kecamatan } = wilayah

  const provinceId = nik.slice(0, 2)
  const regencyId = nik.slice(0, 4)
  const districtId = nik.slice(0, 6)

  if (nik.length !== 16) throw new Error("NIK harus 16 digit")
  if (!provinsi[provinceId]) throw new Error("Kode provinsi tidak valid")
  if (!kabkot[regencyId]) throw new Error("Kode kabupaten/kota tidak valid")
  if (!kecamatan[districtId]) throw new Error("Kode kecamatan tidak valid")

  const dayRaw = parseInt(nik.slice(6, 8))
  const month = parseInt(nik.slice(8, 10))
  const yearCode = parseInt(nik.slice(10, 12))

  const gender = dayRaw > 40 ? "PEREMPUAN" : "LAKI-LAKI"
  const dayAdjusted = dayRaw > 40 ? dayRaw - 40 : dayRaw

  const currentYear = new Date().getFullYear()
  const currentYearShort = currentYear % 100
  const year = yearCode <= currentYearShort ? 2000 + yearCode : 1900 + yearCode

  const birthDate = new Date(year, month - 1, dayAdjusted)
  if (isNaN(birthDate.getTime())) throw new Error("Tanggal lahir tidak valid")

  const today = new Date()
  let ageYears = today.getFullYear() - birthDate.getFullYear()
  let ageMonths = today.getMonth() - birthDate.getMonth()
  let ageDays = today.getDate() - birthDate.getDate()

  if (ageDays < 0) {
    ageMonths--
    const prevMonth = new Date(today.getFullYear(), today.getMonth(), 0)
    ageDays += prevMonth.getDate()
  }
  if (ageMonths < 0) {
    ageYears--
    ageMonths += 12
  }

  const hari = HARI[birthDate.getDay()]
  const zodiak = getZodiak(dayAdjusted, month)
  const kodepos = parseInt(kecamatan[districtId].slice(-5))

  const kecamatanName = kecamatan[districtId].split(" -- ")[0]
  const kabkotName = kabkot[regencyId]
  const provinsiName = provinsi[provinceId]

  return {
    nik,
    valid: true,
    kelamin: gender,
    lahir: `${String(dayAdjusted).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`,
    hari,
    zodiak,
    usia: `${ageYears} Tahun ${ageMonths} Bulan ${ageDays} Hari`,
    usia_tahun: ageYears,
    provinsi: { kode: provinceId, nama: provinsiName },
    kotakab: {
      kode: regencyId,
      nama: kabkotName,
      jenis: kabkotName.startsWith("KOTA") ? "Kota" : "Kabupaten",
    },
    kecamatan: { kode: districtId, nama: kecamatanName },
    kodepos,
    nomor_urut: nik.slice(12, 16),
  }
}

export default {
  name: "NIK Parse",
  description: "Parse NIK Indonesia - provinsi, kota/kab, kecamatan, kodepos, hari lahir, zodiak, usia detail",
  category: "Tools",
  methods: ["GET"],

  params: ["nik"],

  paramsSchema: {
    nik: {
      type: "string",
      required: true,
      example: "3202285909840005",
      description: "16 digit NIK",
    },
  },

  async run(req, res) {
    try {
      const { nik } = req.query || {}

      if (!nik || !/^[0-9]{16}$/.test(nik)) {
        return res.status(400).json({
          status: false,
          message: "NIK harus 16 digit angka",
        })
      }

      const result = parseNIK(nik)

      logger.info(`[NIK] parsed | ip=${req.ip}`)

      return res.json({
        status: true,
        result,
        timestamp: Date.now(),
      })
    } catch (err) {
      logger.error(`[NIK] error | ${err.message}`)
      return res.status(500).json({
        status: false,
        message: err.message,
      })
    }
  },
}
