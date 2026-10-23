/**
 * Primbon Ramalan Jodoh API
 * Provider: primbon.com
 * Parameter: nama1, tgl1, bln1, thn1, nama2, tgl2, bln2, thn2
 * NO API KEY
 */

import axios from "axios"
import * as cheerio from "cheerio"

/* ===============================
   PRIMBON RAMALAN JODOH CLIENT FUNCTION
================================ */
async function ramalanJodoh(nama1, tgl1, bln1, thn1, nama2, tgl2, bln2, thn2) {
  try {
    const response = await axios({
      method: "post",
      url: "https://www.primbon.com/ramalan_jodoh.php",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
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
        submit: " RAMALAN JODOH >> ",
      }),
      timeout: 10000,
    })

    const $ = cheerio.load(response.data)

    const extractPerson = (index) => {
      const elements = $("#body")
        .contents()
        .filter((_, el) => el.type === "tag" && (el.name === "b" || el.name === "i"))

      const nameIndex = index * 2
      const birthIndex = nameIndex + 1

      return {
        nama: elements.eq(nameIndex).text().trim(),
        tanggal_lahir: elements.eq(birthIndex).text().replace("Tgl. Lahir:", "").trim()
      }
    }

    const person1 = extractPerson(0)
    const person2 = extractPerson(1)

    const cleanPredictions = () => {
      let text = $("#body").text()
      text = text.replace(/\(adsbygoogle.*?\);/g, "")
      text = text.replace("RAMALAN JODOH", "")
      text = text.replace(/Konsultasi Hari Baik Akad Nikah >>>/g, "")

      const predictionsStart = text.indexOf("1. Berdasarkan neptu")
      const predictionsEnd = text.indexOf("*Jangan mudah memutuskan")

      if (predictionsStart !== -1 && predictionsEnd !== -1) {
        text = text.substring(predictionsStart, predictionsEnd).trim()
      }

      const predictions = text
        .split(/\d+\.\s+/)
        .filter((item) => item.trim())
        .map((item) => item.trim())

      return predictions
    }

    const predictions = cleanPredictions()

    const peringatanElement = $("#body i")
      .filter((_, el) => $(el).text().includes("Jangan mudah memutuskan"))
      .first()

    const peringatan = peringatanElement.length
      ? peringatanElement.text().split("Konsultasi")[0].trim()
      : "Tidak ada peringatan khusus."

    const result = {
      status: true,
      orang_pertama: person1,
      orang_kedua: person2,
      deskripsi: "Dibawah ini adalah hasil ramalan primbon perjodohan bagi kedua pasangan yang dihitung berdasarkan 6 petung perjodohan dari kitab primbon Betaljemur Adammakna yang disusun oleh Kangjeng Pangeran Harya Tjakraningrat. Hasil ramalan bisa saja saling bertentangan pada setiap petung. Hasil ramalan yang positif (baik) dapat mengurangi pengaruh ramalan yang negatif (buruk), begitu pula sebaliknya.",
      hasil_ramalan: predictions,
      peringatan: peringatan
    }

    return result
  } catch (error) {
    console.error("Primbon Error:", error.message)
    throw new Error("Gagal mendapatkan data dari server primbon")
  }
}

/* ===============================
   EXPORT API
================================ */
export default {
  name: "Primbon Ramalan Jodoh",
  description: "Ramalan kecocokan jodoh berdasarkan primbon Jawa dengan metode 6 petung perjodohan",
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

      const result = await ramalanJodoh(
        nama1.trim(), tgl1, bln1, thn1,
        nama2.trim(), tgl2, bln2, thn2
      )

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
        orang_pertama: result.orang_pertama,
        orang_kedua: result.orang_kedua,
        deskripsi: result.deskripsi,
        hasil_ramalan: result.hasil_ramalan,
        peringatan: result.peringatan,
        timestamp: Date.now()
      })

    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses permintaan ramalan jodoh"
      })
    }
  }
}