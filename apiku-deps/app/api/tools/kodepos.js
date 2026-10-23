import axios from "axios"
import * as cheerio from "cheerio"
import logger from "../../src/utils/logger.js"

/* ===============================
   POSTAL CODE SCRAPER
================================ */
async function scrapeKodepos(location) {
  try {
    const response = await axios.post(
      "https://kodepos.posindonesia.co.id/CariKodepos",
      new URLSearchParams({ kodepos: location }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          "Cache-Control": "max-age=0",
          "Origin": "https://kodepos.posindonesia.co.id",
          "Referer": "https://kodepos.posindonesia.co.id/",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        timeout: 15000,
      }
    )

    const html = response.data
    const $ = cheerio.load(html)
    
    // Cari tabel hasil
    const results = []
    
    $("tbody > tr").each((index, element) => {
      const $td = $(element).find("td")
      
      // Pastikan ada cukup kolom
      if ($td.length >= 5) {
        const kodepos = $td.eq(1).text().trim()
        const desa = $td.eq(2).text().trim()
        const kecamatan = $td.eq(3).text().trim()
        const kota = $td.eq(4).text().trim()
        const provinsi = $td.eq(5).text().trim()
        
        // Hanya tambahkan jika ada kode pos
        if (kodepos && desa) {
          results.push({
            kodepos,
            desa,
            kecamatan,
            kota,
            provinsi
          })
        }
      }
    })
    
    return results
    
  } catch (error) {
    logger.error(`[KODEPOS] Scraping error: ${error.message}`)
    
    if (error.response) {
      throw new Error(`Website responded with status: ${error.response.status}`)
    } else if (error.request) {
      throw new Error("No response from postal code website")
    } else {
      throw new Error(`Scraping failed: ${error.message}`)
    }
  }
}

/* ===============================
   PROVINCE & CITY DATA
================================ */
const provinces = [
  "Aceh", "Sumatera Utara", "Sumatera Barat", "Riau", "Jambi", 
  "Sumatera Selatan", "Bengkulu", "Lampung", "Kepulauan Bangka Belitung", 
  "Kepulauan Riau", "DKI Jakarta", "Jawa Barat", "Jawa Tengah", 
  "DI Yogyakarta", "Jawa Timur", "Banten", "Bali", 
  "Nusa Tenggara Barat", "Nusa Tenggara Timur", "Kalimantan Barat", 
  "Kalimantan Tengah", "Kalimantan Selatan", "Kalimantan Timur", 
  "Kalimantan Utara", "Sulawesi Utara", "Sulawesi Tengah", 
  "Sulawesi Selatan", "Sulawesi Tenggara", "Gorontalo", 
  "Sulawesi Barat", "Maluku", "Maluku Utara", 
  "Papua Barat", "Papua"
]

export default {
  name: "Postal Code Lookup",
  description: "Search Indonesian postal codes by location name (village, district, city, or province)",
  category: "Tools",
  methods: ["GET", "POST"],
  
  params: ["location", "type"],
  
  paramsSchema: {
    location: {
      type: "string",
      required: true,
      description: "Location name to search (village, district, city, or province)",
      example: "pasiran jaya"
    },
    type: {
      type: "string",
      required: false,
      enum: ["all", "province", "city", "district", "village"],
      default: "all",
      description: "Filter results by location type"
    }
  },
  
  async run(req, res) {
    try {
      // Get parameters
      let location, type
      
      if (req.method === 'GET') {
        location = req.query.location
        type = req.query.type || "all"
      } else {
        location = req.body?.location
        type = req.body?.type || "all"
      }
      
      // Validation
      if (!location) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'location' is required",
          example: {
            GET: "/api/tools/kodepos?location=pasiran%20jaya",
            POST: { "location": "pasiran jaya" }
          }
        })
      }
      
      if (typeof location !== 'string' || location.trim() === '') {
        return res.status(400).json({
          status: false,
          message: "Location must be a non-empty string"
        })
      }
      
      const validTypes = ["all", "province", "city", "district", "village"]
      if (!validTypes.includes(type)) {
        return res.status(400).json({
          status: false,
          message: `Invalid type '${type}'`,
          valid_types: validTypes
        })
      }
      
      logger.info(`[KODEPOS] Searching for: "${location}" | type: ${type}`)
      
      // Scrape postal codes
      const results = await scrapeKodepos(location.trim())
      
      if (!results || results.length === 0) {
        logger.warn(`[KODEPOS] No results found for: "${location}"`)
        return res.status(404).json({
          status: false,
          message: "No postal codes found for the given location",
          suggestion: "Try a more specific location name or check spelling"
        })
      }
      
      logger.info(`[KODEPOS] Found ${results.length} results for: "${location}"`)
      
      // Filter by type if specified
      let filteredResults = results
      if (type !== "all") {
        filteredResults = results.filter(item => {
          const locationLower = location.toLowerCase()
          switch (type) {
            case "province":
              return item.provinsi.toLowerCase().includes(locationLower)
            case "city":
              return item.kota.toLowerCase().includes(locationLower)
            case "district":
              return item.kecamatan.toLowerCase().includes(locationLower)
            case "village":
              return item.desa.toLowerCase().includes(locationLower)
            default:
              return true
          }
        })
      }
      
      // Generate summary
      const summary = {
        total_results: filteredResults.length,
        unique_provinces: [...new Set(filteredResults.map(r => r.provinsi))],
        unique_cities: [...new Set(filteredResults.map(r => r.kota))],
        unique_districts: [...new Set(filteredResults.map(r => r.kecamatan))],
        postal_codes: [...new Set(filteredResults.map(r => r.kodepos))],
        search_query: location,
        search_type: type
      }
      
      return res.json({
        status: true,
        result: {
          query: location,
          type: type,
          timestamp: new Date().toISOString(),
          data: filteredResults,
          summary: summary,
          note: "Official Indonesian postal code database"
        }
      })
      
    } catch (error) {
      logger.error(`[KODEPOS] Error: ${error.message}`)
      
      const statusCode = error.message.includes('No results') ? 404 : 500
      
      return res.status(statusCode).json({
        status: false,
        message: error.message,
        suggestion: "Try again later or use a different search term"
      })
    }
  }
}