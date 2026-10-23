/**
 * Primbon Cek Potensi Penyakit API
 * Provider: primbon.com
 * Parameter: tgl, bln, thn
 * NO API KEY
 */

import axios from "axios"
import * as cheerio from "cheerio"

/* ===============================
   PRIMBON CEK POTENSI PENYAKIT CLIENT FUNCTION
================================ */
async function cekPotensiPenyakit(tgl, bln, thn) {
  try {
    const { data } = await axios({
      url: "https://primbon.com/cek_potensi_penyakit.php",
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
      data: new URLSearchParams({
        tanggal: tgl,
        bulan: bln,
        tahun: thn,
        hitung: " Submit! ",
      }),
      timeout: 30000,
    })

    let $ = cheerio.load(data)
    let fetchText = $("#body")
      .text()
      .replace(/\s{2,}/g, " ")
      .replace(/[\n\r\t]+/g, " ")
      .replace(/\(adsbygoogle.*?\);/g, "")
      .replace(/<<+\s*Kembali/g, "")
      .trim()

    if (!fetchText.includes("CEK POTENSI PENYAKIT (METODE PITAGORAS)")) {
      throw new Error("Data tidak ditemukan atau format tanggal tidak valid")
    }

    const hasil = {
      status: true,
      tanggal_lahir: `${tgl}-${bln}-${thn}`,
      analisa: fetchText.split("CEK POTENSI PENYAKIT (METODE PITAGORAS)")[1].split("Sektor yg dianalisa:")[0].trim(),
      sektor: fetchText.split("Sektor yg dianalisa:")[1].split("Anda tidak memiliki elemen")[0].trim(),
      elemen: "Anda tidak memiliki elemen " + fetchText.split("Anda tidak memiliki elemen")[1].split("*")[0].trim(),
      catatan: "Potensi penyakit harus dipandang secara positif. Sakit pada daftar tidak berarti anda akan mengalami semuanya. Anda mungkin hanya akan mengalami 1 atau 2 macam penyakit. Pencegahan adalah yang terbaik, makanan yang sehat, olahraga teratur, istirahat yang cukup, hidup bahagia, adalah resep paling manjur untuk menghindari segala penyakit."
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
  name: "Primbon Cek Potensi Penyakit",
  description: "Mengecek potensi penyakit berdasarkan tanggal lahir dengan metode Pitagoras",
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

      const result = await cekPotensiPenyakit(
        parsedTgl.toString(),
        parsedBln.toString(),
        parsedThn.toString()
      )

      res.json({
        status: true,
        input: {
          tanggal: parsedTgl,
          bulan: parsedBln,
          tahun: parsedThn
        },
        analisa: result.analisa,
        sektor: result.sektor,
        elemen: result.elemen,
        catatan: result.catatan,
        timestamp: Date.now()
      })

    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses permintaan cek potensi penyakit"
      })
    }
  }
}