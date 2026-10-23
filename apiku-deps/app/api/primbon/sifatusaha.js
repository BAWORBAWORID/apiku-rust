/**
 * Primbon Sifat Usaha Bisnis API
 * Provider: primbon.com
 * Parameter: tgl, bln, thn
 * NO API KEY
 */

import axios from "axios"
import * as cheerio from "cheerio"

/* ===============================
   PRIMBON SIFAT USAHA BISNIS CLIENT FUNCTION
================================ */
async function sifatUsahaBisnis(tgl, bln, thn) {
  try {
    const response = await axios({
      url: "https://primbon.com/sifat_usaha_bisnis.php",
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
      data: new URLSearchParams({
        tgl,
        bln,
        thn,
        submit: " Submit! "
      }),
      timeout: 30000,
    })

    const $ = cheerio.load(response.data)
    const fetchText = $("#body").text()

    let hasil

    try {
      const hariLahir = fetchText.split("Hari Lahir Anda: ")[1].split(thn)[0].trim()
      const usaha = fetchText.split(thn)[1].split("< Hitung Kembali")[0].trim()

      hasil = {
        status: true,
        tanggal_lahir: `${tgl}-${bln}-${thn}`,
        hari_lahir: hariLahir,
        usaha: usaha,
        catatan: "Setiap manusia memiliki sifat atau karakter yang berbeda-beda dalam menjalankan bisnis atau usaha. Dengan memahami sifat bisnis kita, rekan kita, atau bahkan kompetitor kita, akan membantu kita memperbaiki diri atau untuk menjalin hubungan kerjasama yang lebih baik."
      }
    } catch (e) {
      hasil = {
        status: false,
        message: `Tidak ditemukan data untuk tanggal ${tgl}-${bln}-${thn}. Mungkin input yang Anda masukkan salah.`
      }
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
  name: "Primbon Sifat Usaha Bisnis",
  description: "Mengecek sifat dan karakter dalam berbisnis berdasarkan weton kelahiran",
  category: "Primbon",
  methods: ["GET"],
  params: ["tgl", "bln", "thn"],
  paramsSchema: {
    tgl: {
      type: "string",
      required: true,
      pattern: "^\\d{1,2}$",
    },
    bln: {
      type: "string",
      required: true,
      pattern: "^\\d{1,2}$",
    },
    thn: {
      type: "string",
      required: true,
      pattern: "^\\d{4}$",
    },
  },

  async run(req, res) {
    try {
      const { tgl, bln, thn } = req.query

      if (!tgl || !bln || !thn) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'tgl', 'bln', dan 'thn' wajib diisi"
        })
      }

      const parsedTgl = parseInt(tgl)
      const parsedBln = parseInt(bln)
      const parsedThn = parseInt(thn)

      if (isNaN(parsedTgl) || isNaN(parsedBln) || isNaN(parsedThn)) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'tgl', 'bln', dan 'thn' harus berupa angka valid"
        })
      }

      if (parsedTgl < 1 || parsedTgl > 31) {
        return res.status(400).json({
          status: false,
          message: "Tanggal (tgl) harus antara 1-31"
        })
      }

      if (parsedBln < 1 || parsedBln > 12) {
        return res.status(400).json({
          status: false,
          message: "Bulan (bln) harus antara 1-12"
        })
      }

      const currentYear = new Date().getFullYear()
      if (parsedThn < 1900 || parsedThn > currentYear) {
        return res.status(400).json({
          status: false,
          message: `Tahun (thn) harus antara 1900-${currentYear}`
        })
      }

      const result = await sifatUsahaBisnis(
        parsedTgl.toString(),
        parsedBln.toString(),
        parsedThn.toString()
      )

      if (result.status) {
        res.json({
          status: true,
          input: {
            tanggal: parsedTgl,
            bulan: parsedBln,
            tahun: parsedThn
          },
          hari_lahir: result.hari_lahir,
          usaha: result.usaha,
          catatan: result.catatan,
          timestamp: Date.now()
        })
      } else {
        res.json({
          status: false,
          message: result.message,
          timestamp: Date.now()
        })
      }

    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses permintaan sifat usaha bisnis"
      })
    }
  }
}