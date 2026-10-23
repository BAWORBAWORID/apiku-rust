/**
 * Primbon Tafsir Mimpi API
 * Provider: primbon.com
 * Parameter: mimpi
 * NO API KEY
 */

import axios from "axios"
import * as cheerio from "cheerio"

/* ===============================
   PRIMBON TAFSIR MIMPI CLIENT FUNCTION
================================ */
async function tafsirMimpi(mimpi) {
  try {
    const response = await axios.get(
      "https://www.primbon.com/tafsir_mimpi.php",
      {
        params: {
          mimpi: mimpi,
          submit: "+Submit+",
        },
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        },
        timeout: 10000,
      }
    )

    const $ = cheerio.load(response.data)
    const results = []

    const content = $("#body").text()
    const mimpiRegex = new RegExp(`Mimpi.*?${mimpi}.*?(?=Mimpi|$)`, "gi")
    const matches = content.match(mimpiRegex)

    if (matches) {
      matches.forEach((match) => {
        const cleanText = match
          .trim()
          .replace(/\s+/g, " ")
          .replace(/\n/g, " ")

        const parts = cleanText.split("=")
        if (parts.length === 2) {
          results.push({
            mimpi: parts[0].trim().replace(/^Mimpi\s+/, ""),
            tafsir: parts[1].trim()
          })
        }
      })
    }

    const solusiMatch = $("#body").text().match(/Solusi.*?Amien\.\./s)
    const solusi = solusiMatch ? solusiMatch[0].trim() : null

    const hasil = {
      status: true,
      keyword: mimpi.trim(),
      hasil: results,
      total: results.length,
      solusi: solusi
    }

    return hasil
  } catch (error) {
    console.error("Primbon Error:", error.message)
    throw new Error("Gagal mendapatkan data dari server primbon")
  }
}

/* ===============================
   EXPORT API
================================ */
export default {
  name: "Primbon Tafsir Mimpi",
  description: "Menafsirkan arti mimpi berdasarkan primbon Jawa",
  category: "Primbon",
  methods: ["GET"],
  params: ["mimpi"],
  paramsSchema: {
    mimpi: {
      type: "string",
      required: true,
    },
  },

  async run(req, res) {
    try {
      const { mimpi } = req.query

      if (!mimpi || typeof mimpi !== "string" || mimpi.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'mimpi' wajib diisi"
        })
      }

      const result = await tafsirMimpi(mimpi.trim())

      res.json({
        status: true,
        input: mimpi.trim(),
        keyword: result.keyword,
        hasil: result.hasil,
        total: result.total,
        solusi: result.solusi,
        timestamp: Date.now()
      })

    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses permintaan tafsir mimpi"
      })
    }
  }
}