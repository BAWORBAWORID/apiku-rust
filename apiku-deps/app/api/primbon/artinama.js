/**
 * Primbon Arti Nama API
 * Provider: primbon.com
 * Parameter: nama
 * NO API KEY
 */

import axios from "axios"
import * as cheerio from "cheerio"

/* ===============================
   PRIMBON ARTINAMA CLIENT FUNCTION
================================ */
async function artinama(nama) {
  try {
    const response = await axios.get(
      `https://primbon.com/arti_nama.php?nama1=${encodeURIComponent(nama)}&proses=+Submit%21+`,
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
      // Coba parse hasil dengan format yang lebih fleksibel
      const artiMatch = fetchText.match(/memiliki arti:\s*(.*?)(?:Nama:|$)/s)
      
      if (!artiMatch || !artiMatch[1]) {
        throw new Error("Arti nama tidak ditemukan")
      }
      
      hasil = {
        status: true,
        nama: nama.trim(),
        arti: artiMatch[1].trim(),
        catatan: "Gunakan juga aplikasi numerologi Kecocokan Nama, untuk melihat sejauh mana keselarasan nama anda dengan diri anda."
      }
    } catch (e) {
      hasil = {
        status: false,
        message: `Tidak ditemukan arti nama "${nama}". Cari dengan kata kunci yang lain.`
      }
    }
    
    return hasil
  } catch (error) {
    console.error("Primbon Error:", error.message)
    throw new Error("Gagal mendapatkan data dari server primbon")
  }
}

/* ===============================
   EXPORT API (STYLE LAMA KAMU)
================================ */
export default {
  name: "Primbon Arti Nama",
  description: "Mencari arti nama berdasarkan primbon Jawa",
  category: "Primbon",
  methods: ["GET"],
  params: ["nama"],
  paramsSchema: {
    nama: {
      type: "string",
      required: true,
    },
  },

  async run(req, res) {
    try {
      const { nama } = req.query

      if (!nama || typeof nama !== "string" || nama.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'nama' wajib diisi"
        })
      }

      const result = await artinama(nama.trim())

      if (result.status) {
        res.json({
          status: true,
          input: nama.trim(),
          arti: result.arti,
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
        message: err.message || "Gagal memproses permintaan arti nama"
      })
    }
  }
}