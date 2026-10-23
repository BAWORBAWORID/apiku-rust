/**
 * Primbon Kecocokan Nama Pasangan API
 * Provider: primbon.com
 * Parameter: nama1, nama2
 * NO API KEY
 */

import axios from "axios"
import * as cheerio from "cheerio"

/* ===============================
   PRIMBON KECOCOKAN NAMA PASANGAN CLIENT FUNCTION
================================ */
async function kecocokanPasangan(nama1, nama2) {
  try {
    const response = await axios.get(
      `https://primbon.com/kecocokan_nama_pasangan.php?nama1=${encodeURIComponent(nama1)}&nama2=${encodeURIComponent(nama2)}&proses=+Submit%21+`,
      {
        timeout: 30000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
      }
    )
    
    const $ = cheerio.load(response.data)
    const fetchText = $("#body").text()

    let hasil
    
    try {
      const sisiPositifMatch = fetchText.match(/Sisi Positif Anda:\s*(.*?)\s*Sisi Negatif Anda:/s)
      const sisiNegatifMatch = fetchText.match(/Sisi Negatif Anda:\s*(.*?)(?:< Hitung Kembali|$)/s)
      
      if (!sisiPositifMatch || !sisiNegatifMatch) {
        throw new Error("Data tidak ditemukan")
      }
      
      hasil = {
        status: true,
        nama_anda: nama1.trim(),
        nama_pasangan: nama2.trim(),
        sisi_positif: sisiPositifMatch[1].trim(),
        sisi_negatif: sisiNegatifMatch[1].trim(),
        gambar: "https://primbon.com/ramalan_kecocokan_cinta2.png",
        catatan: "Untuk melihat kecocokan jodoh dengan pasangan, dapat dikombinasikan dengan primbon Ramalan Jodoh (Jawa), Ramalan Jodoh (Bali), numerologi Kecocokan Cinta, Ramalan Perjalanan Hidup Suami Istri, dan makna dari Tanggal Jadian/Pernikahan."
      }
    } catch (e) {
      hasil = {
        status: false,
        message: `Tidak ditemukan kecocokan untuk "${nama1}" dan "${nama2}". Mungkin input yang Anda masukkan salah.`
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
  name: "Primbon Kecocokan Nama Pasangan",
  description: "Mencari tingkat kecocokan nama pasangan berdasarkan primbon Jawa",
  category: "Primbon",
  methods: ["GET"],
  params: ["nama1", "nama2"],
  paramsSchema: {
    nama1: {
      type: "string",
      required: true,
    },
    nama2: {
      type: "string",
      required: true,
    },
  },

  async run(req, res) {
    try {
      const { nama1, nama2 } = req.query

      if (!nama1 || typeof nama1 !== "string" || nama1.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'nama1' wajib diisi"
        })
      }

      if (!nama2 || typeof nama2 !== "string" || nama2.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'nama2' wajib diisi"
        })
      }

      const result = await kecocokanPasangan(nama1.trim(), nama2.trim())

      if (result.status) {
        res.json({
          status: true,
          input: {
            nama_anda: nama1.trim(),
            nama_pasangan: nama2.trim()
          },
          sisi_positif: result.sisi_positif,
          sisi_negatif: result.sisi_negatif,
          gambar: result.gambar,
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
        message: err.message || "Gagal memproses permintaan kecocokan nama pasangan"
      })
    }
  }
}