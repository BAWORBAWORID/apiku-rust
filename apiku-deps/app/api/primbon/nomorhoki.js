/**
 * Primbon Nomor Hoki API
 * Provider: primbon.com
 * Parameter: phoneNumber
 * NO API KEY
 */

import axios from "axios"
import * as cheerio from "cheerio"

/* ===============================
   PRIMBON NOMOR HOKI CLIENT FUNCTION
================================ */
async function nomorHoki(phoneNumber) {
  try {
    const response = await axios.post(
      "https://www.primbon.com/no_hoki_bagua_shuzi.php",
      `nomer=${phoneNumber}&submit=+Submit%21+`,
      {
        headers: {
          authority: "www.primbon.com",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://www.primbon.com",
          referer: "https://www.primbon.com/no_hoki_bagua_shuzi.php",
          "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        },
        timeout: 10000,
      }
    )

    const $ = cheerio.load(response.data)

    const extractNumber = (text) => {
      const matches = text.match(/\d+(\.\d+)?/)
      return matches ? parseFloat(matches[0]) : 0
    }

    const nomorHPElement = $("b:contains('No. HP')").text()
    const nomorHP = nomorHPElement ? nomorHPElement.replace("No. HP : ", "").trim() : null
    const baguaShuziText = $("b:contains('% Angka Bagua Shuzi')").text()

    if (!nomorHP || !baguaShuziText) {
      throw new Error("Gagal mengekstrak informasi dari response")
    }

    const hasil = {
      status: true,
      nomor: nomorHP,
      angka_bagua_shuzi: {
        value: extractNumber(baguaShuziText),
        description: "Persentase Angka Bagua Shuzi menunjukkan tingkat kecocokan nomor dengan elemen karakter. Nilai minimal yang baik adalah 60%."
      },
      energi_positif: {
        total: extractNumber($("b:contains('%')").first().text()),
        details: {
          kekayaan: extractNumber($("td:contains('Kekayaan =')").text()),
          kesehatan: extractNumber($("td:contains('Kesehatan =')").text()),
          cinta: extractNumber($("td:contains('Cinta/Relasi =')").text()),
          kestabilan: extractNumber($("td:contains('Kestabilan =')").text())
        },
        description: "Energi positif mempengaruhi aspek kekayaan, kesehatan, cinta/relasi, dan kestabilan dalam hidup. Semakin tinggi nilainya, semakin baik."
      },
      energi_negatif: {
        total: extractNumber($("b:contains('%')").last().text()),
        details: {
          perselisihan: extractNumber($("td:contains('Perselisihan =')").text()),
          kehilangan: extractNumber($("td:contains('Kehilangan =')").text()),
          malapetaka: extractNumber($("td:contains('Malapetaka =')").text()),
          kehancuran: extractNumber($("td:contains('Kehancuran =')").text())
        },
        description: "Energi negatif menunjukkan potensi hambatan dalam aspek perselisihan, kehilangan, malapetaka, dan kehancuran. Semakin rendah nilainya, semakin baik."
      }
    }

    const energiPositif = hasil.energi_positif.total
    const baguaShuzi = hasil.angka_bagua_shuzi.value

    hasil.analisis = {
      status: energiPositif > 60 && baguaShuzi >= 60,
      description: "Nomor dianggap hoki jika persentase Energi Positif di atas 60% dan persentase Angka Bagua Shuzi minimal 60%"
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
  name: "Primbon Nomor Hoki",
  description: "Menentukan status 'hoki' dari nomor telepon berdasarkan perhitungan Bagua Shuzi",
  category: "Primbon",
  methods: ["GET"],
  params: ["phoneNumber"],
  paramsSchema: {
    phoneNumber: {
      type: "string",
      required: true,
      pattern: "^\\d+$",
    },
  },

  async run(req, res) {
    try {
      const { phoneNumber } = req.query

      if (!phoneNumber) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'phoneNumber' wajib diisi"
        })
      }

      if (typeof phoneNumber !== "string" || !/^\d+$/.test(phoneNumber.trim())) {
        return res.status(400).json({
          status: false,
          message: "Format nomor telepon tidak valid. Gunakan angka saja"
        })
      }

      if (phoneNumber.trim().length < 8 || phoneNumber.trim().length > 15) {
        return res.status(400).json({
          status: false,
          message: "Nomor telepon harus antara 8-15 digit"
        })
      }

      const result = await nomorHoki(phoneNumber.trim())

      res.json({
        status: true,
        input: phoneNumber.trim(),
        data: result,
        timestamp: Date.now()
      })

    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses permintaan nomor hoki"
      })
    }
  }
}