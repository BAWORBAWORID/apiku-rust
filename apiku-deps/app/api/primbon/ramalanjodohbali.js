/**
 * Primbon Ramalan Jodoh Bali API
 * Provider: primbon.com
 * Parameter: nama1, tgl1, bln1, thn1, nama2, tgl2, bln2, thn2
 * NO API KEY
 */

import axios from "axios"
import * as cheerio from "cheerio"

/* ===============================
   PRIMBON RAMALAN JODOH BALI CLIENT FUNCTION
================================ */
async function ramalanJodohBali(nama1, tgl1, bln1, thn1, nama2, tgl2, bln2, thn2) {
  try {
    const response = await axios({
      url: "https://www.primbon.com/ramalan_jodoh_bali.php",
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
      data: new URLSearchParams({
        nama1,
        tgl1,
        bln1,
        thn1,
        nama2,
        tgl2,
        bln2,
        thn2,
        submit: " Submit! ",
      }),
      timeout: 30000,
    })

    const $ = cheerio.load(response.data)
    const fetchText = $("#body").text()

    let hasil

    try {
      const tglLahir1 = fetchText.split("Hari Lahir: ")[1].split("Nama")[0].trim()
      const tglLahir2 = fetchText.split(nama2 + "Hari Lahir: ")[1].split("HASILNYA MENURUT PAL SRI SEDANAI")[0].trim()
      const resultText = fetchText.split("HASILNYA MENURUT PAL SRI SEDANAI. ")[1].split("Konsultasi Hari Baik Akad Nikah >>>")[0].trim()

      hasil = {
        status: true,
        nama_anda: {
          nama: nama1.trim(),
          tanggal_lahir: tglLahir1
        },
        nama_pasangan: {
          nama: nama2.trim(),
          tanggal_lahir: tglLahir2
        },
        result: resultText,
        catatan: "Untuk melihat kecocokan jodoh dengan pasangan, dapat dikombinasikan dengan Ramalan Jodoh (Jawa), numerologi Kecocokan Cinta, tingkat keserasian Nama Pasangan, Ramalan Perjalanan Hidup Suami Istri, dan makna dari Tanggal Jadian/Pernikahan."
      }
    } catch (e) {
      hasil = {
        status: false,
        message: `Tidak ditemukan ramalan untuk "${nama1}" dan "${nama2}". Mungkin input yang Anda masukkan salah.`
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
  name: "Primbon Ramalan Jodoh Bali",
  description: "Ramalan kecocokan jodoh berdasarkan primbon Bali dengan metode Pal Sri Sedanai",
  category: "Primbon",
  methods: ["GET"],
  params: ["nama1", "tgl1", "bln1", "thn1", "nama2", "tgl2", "bln2", "thn2"],
  paramsSchema: {
    nama1: {
      type: "string",
      required: true,
    },
    tgl1: {
      type: "string",
      required: true,
      pattern: "^\\d{1,2}$",
    },
    bln1: {
      type: "string",
      required: true,
      pattern: "^\\d{1,2}$",
    },
    thn1: {
      type: "string",
      required: true,
      pattern: "^\\d{4}$",
    },
    nama2: {
      type: "string",
      required: true,
    },
    tgl2: {
      type: "string",
      required: true,
      pattern: "^\\d{1,2}$",
    },
    bln2: {
      type: "string",
      required: true,
      pattern: "^\\d{1,2}$",
    },
    thn2: {
      type: "string",
      required: true,
      pattern: "^\\d{4}$",
    },
  },

  async run(req, res) {
    try {
      const { nama1, tgl1, bln1, thn1, nama2, tgl2, bln2, thn2 } = req.query

      const fields = { nama1, tgl1, bln1, thn1, nama2, tgl2, bln2, thn2 }
      const fieldNames = {
        nama1: "Nama pertama",
        tgl1: "Tanggal lahir pertama",
        bln1: "Bulan lahir pertama",
        thn1: "Tahun lahir pertama",
        nama2: "Nama kedua",
        tgl2: "Tanggal lahir kedua",
        bln2: "Bulan lahir kedua",
        thn2: "Tahun lahir kedua"
      }

      for (const key in fields) {
        const value = fields[key]
        if (!value || (typeof value === "string" && value.trim().length === 0)) {
          return res.status(400).json({
            status: false,
            message: `${fieldNames[key]} wajib diisi`
          })
        }
      }

      const dateFields = { tgl1, bln1, thn1, tgl2, bln2, thn2 }
      for (const key in dateFields) {
        const value = dateFields[key]
        const numValue = parseInt(value)
        
        if (isNaN(numValue)) {
          return res.status(400).json({
            status: false,
            message: `${fieldNames[key]} harus berupa angka valid`
          })
        }

        if (key.startsWith("tgl") && (numValue < 1 || numValue > 31)) {
          return res.status(400).json({
            status: false,
            message: `${fieldNames[key]} harus antara 1-31`
          })
        }

        if (key.startsWith("bln") && (numValue < 1 || numValue > 12)) {
          return res.status(400).json({
            status: false,
            message: `${fieldNames[key]} harus antara 1-12`
          })
        }

        const currentYear = new Date().getFullYear()
        if (key.startsWith("thn") && (numValue < 1900 || numValue > currentYear)) {
          return res.status(400).json({
            status: false,
            message: `${fieldNames[key]} harus antara 1900-${currentYear}`
          })
        }
      }

      const result = await ramalanJodohBali(
        nama1.trim(), tgl1, bln1, thn1,
        nama2.trim(), tgl2, bln2, thn2
      )

      if (result.status) {
        res.json({
          status: true,
          input: {
            pertama: {
              nama: nama1.trim(),
              tanggal_lahir: `${tgl1}-${bln1}-${thn1}`
            },
            kedua: {
              nama: nama2.trim(),
              tanggal_lahir: `${tgl2}-${bln2}-${thn2}`
            }
          },
          nama_anda: result.nama_anda,
          nama_pasangan: result.nama_pasangan,
          result: result.result,
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
        message: err.message || "Gagal memproses permintaan ramalan jodoh bali"
      })
    }
  }
}