/**
 * Primbon Zodiak API
 * Provider: primbon.com
 * Parameter: zodiak
 * NO API KEY
 */

import axios from "axios"
import * as cheerio from "cheerio"

/* ===============================
   PRIMBON ZODIAK CLIENT FUNCTION
================================ */
async function getZodiak(zodiak) {
  try {
    const { data } = await axios.get(
      `https://primbon.com/zodiak/${zodiak}.htm`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        },
        timeout: 10000,
      }
    )

    const $ = cheerio.load(data)

    let fetchText = $("#body")
      .text()
      .replace(/\s{2,}/g, " ")
      .replace(/[\n\r\t]+/g, " ")
      .replace(/\(adsbygoogle.*?\);/g, "")
      .replace(/<<+\s*Kembali/g, "")
      .trim()

    const hasil = {
      status: true,
      zodiak: fetchText.split("Nomor Keberuntungan:")[0].trim(),
      nomor_keberuntungan: fetchText.split("Nomor Keberuntungan: ")[1].split(" Aroma Keberuntungan:")[0].trim(),
      aroma_keberuntungan: fetchText.split("Aroma Keberuntungan: ")[1].split(" Planet Yang Mengitari:")[0].trim(),
      planet_yang_mengitari: fetchText.split("Planet Yang Mengitari: ")[1].split(" Bunga Keberuntungan:")[0].trim(),
      bunga_keberuntungan: fetchText.split("Bunga Keberuntungan: ")[1].split(" Warna Keberuntungan:")[0].trim(),
      warna_keberuntungan: fetchText.split("Warna Keberuntungan: ")[1].split(" Batu Keberuntungan:")[0].trim(),
      batu_keberuntungan: fetchText.split("Batu Keberuntungan: ")[1].split(" Elemen Keberuntungan:")[0].trim(),
      elemen_keberuntungan: fetchText.split("Elemen Keberuntungan: ")[1].split(" Pasangan Serasi:")[0].trim(),
      pasangan_zodiak: fetchText.split("Pasangan Serasi: ")[1].split("<<<< Kembali")[0].trim()
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
  name: "Primbon Zodiak",
  description: "Mendapatkan informasi detail tentang zodiak berdasarkan primbon",
  category: "Primbon",
  methods: ["GET"],
  params: ["zodiak"],
  paramsSchema: {
    zodiak: { 
      type: "string", 
      required: true,
      enum: ["aries", "taurus", "gemini", "cancer", "leo", "virgo", "libra", "scorpio", "sagitarius", "capricorn", "aquarius", "pisces"]
    }
  },

  async run(req, res) {
    try {
      const { zodiak } = req.query

      if (!zodiak || typeof zodiak !== "string" || zodiak.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'zodiak' wajib diisi"
        })
      }

      const lowerCaseZodiak = zodiak.toLowerCase()
      const validZodiacSigns = [
        "aries", "taurus", "gemini", "cancer", "leo", "virgo",
        "libra", "scorpio", "sagitarius", "capricorn", "aquarius", "pisces"
      ]

      if (!validZodiacSigns.includes(lowerCaseZodiak)) {
        return res.status(400).json({
          status: false,
          message: `Zodiak tidak valid. Pilihan: ${validZodiacSigns.join(", ")}`
        })
      }

      const result = await getZodiak(lowerCaseZodiak)

      res.json({
        status: true,
        input: lowerCaseZodiak,
        data: result,
        timestamp: Date.now()
      })

    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses permintaan zodiak"
      })
    }
  }
}