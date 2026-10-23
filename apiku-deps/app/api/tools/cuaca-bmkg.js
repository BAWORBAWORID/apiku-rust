import axios from "axios"
import logger from "../../src/utils/logger.js"

const API_BASE = "https://bmkg-restapi.vercel.app/v1"
const OFFICIAL_API = "https://api.bmkg.go.id/publik/prakiraan-cuaca"

function httpGet(url, timeout = 10000) {
  return axios.get(url, {
    timeout,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept": "application/json",
    },
  }).then(r => r.data)
}

async function searchLocation(query) {
  const data = await httpGet(`${API_BASE}/wilayah/search?q=${encodeURIComponent(query)}`)
  return data.data || []
}

async function getProvinces() {
  const data = await httpGet(`${API_BASE}/wilayah/provinces`)
  return data.data || []
}

async function getDistricts(provinceCode) {
  const data = await httpGet(`${API_BASE}/wilayah/districts?province=${provinceCode}`)
  return data.data || []
}

async function getSubdistricts(districtCode) {
  const data = await httpGet(`${API_BASE}/wilayah/subdistricts?district=${districtCode}`)
  return data.data || []
}

async function getVillages(subdistrictCode) {
  const data = await httpGet(`${API_BASE}/wilayah/villages?subdistrict=${subdistrictCode}`)
  return data.data || []
}

async function getWeather(adm4Code) {
  try {
    const data = await httpGet(`${API_BASE}/weather/${adm4Code}`)
    return data.data || null
  } catch (e) {
    const official = await httpGet(`${OFFICIAL_API}?adm4=${adm4Code}`)
    if (!official || !official.data) return null
    const loc = official.lokasi || {}
    const entries = []
    for (const day of official.data || []) {
      for (const w of day.cuaca || []) {
        entries.push({
          local_datetime: w.local_datetime,
          utc_datetime: w.utc_datetime,
          temperature_c: w.t,
          humidity_pct: w.hu,
          weather: w.weather_desc,
          weather_en: w.weather_desc_en,
          weather_code: w.weather,
          wind_speed_kmh: w.ws,
          wind_direction: w.wd,
          wind_direction_deg: w.wd_deg,
          cloud_cover_pct: w.tcc,
          visibility_text: w.vs_text,
          icon_url: w.image,
        })
      }
    }
    const dates = [...new Set(entries.map(e => e.local_datetime?.split(" ")[0]))]
    const forecast = dates.map(date => ({
      date,
      entries: entries.filter(e => e.local_datetime?.startsWith(date)),
    }))
    const now = entries[0] || null
    return {
      location: {
        code: adm4Code,
        province: loc.provinsi || "",
        district: loc.kotkab || "",
        subdistrict: loc.kecamatan || "",
        village: loc.desa || "",
        lat: loc.lat,
        lon: loc.lon,
        timezone: loc.timezone || "+0700",
      },
      current: now,
      forecast,
    }
  }
}

async function getCurrentWeather(adm4Code) {
  try {
    const data = await httpGet(`${API_BASE}/weather/${adm4Code}/current`)
    return data.data || null
  } catch (e) {
    const weather = await getWeather(adm4Code)
    return weather
  }
}

export default {
  name: "BMKG Cuaca",
  description: "Informasi prakiraan cuaca — cari lokasi dan dapatkan data cuaca terkini & 3 harian",
  category: "Tools",
  methods: ["GET", "POST"],

  params: ["action", "query", "kode"],

  paramsSchema: {
    action: {
      type: "string",
      required: true,
      enum: ["search", "weather", "current", "provinces", "districts", "subdistricts", "villages"],
      description: "Aksi: search (cari lokasi), weather (prakiraan 3 hari), current (cuaca terkini), provinces (daftar provinsi), districts (kab/kota), subdistricts (kecamatan), villages (kelurahan)",
      example: "search",
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian lokasi (untuk action=search) atau kode provinsi/distrik (untuk action=districts/subdistricts/villages)",
      example: "jakarta",
    },
    kode: {
      type: "string",
      required: false,
      description: "Kode ADM4 wilayah (untuk action=weather/current). Contoh: 31.71.03.1001",
      example: "31.71.03.1001",
    },
  },

  async run(req, res) {
    try {
      const { action, query, kode } = { ...req.query, ...req.body }

      if (!action) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'action' wajib diisi. Pilihan: search, weather, current, provinces, districts, subdistricts, villages",
        })
      }

      const validActions = ["search", "weather", "current", "provinces", "districts", "subdistricts", "villages"]
      if (!validActions.includes(action)) {
        return res.status(400).json({
          status: false,
          message: `Invalid action '${action}'. Pilihan: ${validActions.join(", ")}`,
        })
      }

      const startTime = Date.now()

      if (action === "provinces") {
        const provinces = await getProvinces()
        return res.json({
          status: true,
          result: {
            count: provinces.length,
            data: provinces,
          },
          responseTime: `${Date.now() - startTime}ms`,
        })
      }

      if (action === "districts") {
        if (!query) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'query' (kode provinsi) wajib diisi. Contoh: query=31 untuk DKI Jakarta",
          })
        }
        const districts = await getDistricts(query)
        return res.json({
          status: true,
          result: {
            province_code: query,
            count: districts.length,
            data: districts,
          },
          responseTime: `${Date.now() - startTime}ms`,
        })
      }

      if (action === "subdistricts") {
        if (!query) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'query' (kode kab/kota) wajib diisi. Contoh: query=31.71 untuk Jakarta Pusat",
          })
        }
        const subdistricts = await getSubdistricts(query)
        return res.json({
          status: true,
          result: {
            district_code: query,
            count: subdistricts.length,
            data: subdistricts,
          },
          responseTime: `${Date.now() - startTime}ms`,
        })
      }

      if (action === "villages") {
        if (!query) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'query' (kode kecamatan) wajib diisi. Contoh: query=31.71.03 untuk Kemayoran",
          })
        }
        const villages = await getVillages(query)
        return res.json({
          status: true,
          result: {
            subdistrict_code: query,
            count: villages.length,
            data: villages,
          },
          responseTime: `${Date.now() - startTime}ms`,
        })
      }

      if (action === "search") {
        if (!query) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'query' (nama lokasi) wajib diisi. Contoh: query=jakarta",
          })
        }
        const results = await searchLocation(query)
        return res.json({
          status: true,
          result: {
            query,
            count: results.length,
            data: results,
          },
          responseTime: `${Date.now() - startTime}ms`,
        })
      }

      if (action === "weather" || action === "current") {
        const code = kode || query
        if (!code) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'kode' (ADM4) wajib diisi. Contoh: kode=31.71.03.1001",
            hint: "Gunakan action=search untuk mencari kode wilayah",
          })
        }

        const result = action === "current" ? await getCurrentWeather(code) : await getWeather(code)

        if (!result) {
          return res.status(404).json({
            status: false,
            message: `Data cuaca tidak ditemukan untuk kode: ${code}`,
            hint: "Pastikan kode ADM4 valid. Gunakan action=search untuk mencari kode wilayah",
          })
        }

        return res.json({
          status: true,
          result,
          responseTime: `${Date.now() - startTime}ms`,
        })
      }
    } catch (error) {
      logger.error(`[CUACA-BMKG] ${error.message}`)
      return res.status(500).json({
        status: false,
        message: error.message || "Gagal memproses permintaan",
      })
    }
  },
}
