import logger from "../../src/utils/logger.js"

const WILAYAH = {
  A: { provinsi: "BANTEN", kabupaten: "Serang, Cilegon, Tangerang" },
  B: { provinsi: "DKI JAKARTA", kabupaten: "Jakarta, Bekasi, Depok, Tangerang, Tangerang Selatan" },
  D: { provinsi: "JAWA BARAT", kabupaten: "Bandung, Cimahi, Sumedang" },
  E: { provinsi: "JAWA BARAT", kabupaten: "Cirebon, Indramayu, Majalengka, Kuningan" },
  F: { provinsi: "JAWA BARAT", kabupaten: "Bogor, Sukabumi, Cianjur" },
  G: { provinsi: "JAWA TENGAH", kabupaten: "Pekalongan, Pemalang, Batang" },
  H: { provinsi: "JAWA TENGAH", kabupaten: "Semarang, Kendal, Demak" },
  K: { provinsi: "JAWA TENGAH", kabupaten: "Kudus, Jepara, Pati, Rembang" },
  L: { provinsi: "JAWA TIMUR", kabupaten: "Surabaya, Sidoarjo, Gresik" },
  M: { provinsi: "JAWA TIMUR", kabupaten: "Madura, Bangkalan, Sampang, Pamekasan, Sumenep" },
  N: { provinsi: "JAWA TIMUR", kabupaten: "Malang, Batu, Pasuruan, Probolinggo" },
  P: { provinsi: "JAWA TIMUR", kabupaten: "Jember, Banyuwangi, Bondowoso, Situbondo" },
  R: { provinsi: "JAWA TENGAH", kabupaten: "Banyumas, Cilacap, Purbalingga, Banjarnegara" },
  S: { provinsi: "JAWA TIMUR", kabupaten: "Bojonegoro, Tuban, Lamongan" },
  T: { provinsi: "JAWA BARAT", kabupaten: "Purwakarta, Subang, Karawang" },
  W: { provinsi: "JAWA TIMUR", kabupaten: "Madiun, Ngawi, Magetan, Ponorogo, Pacitan" },
  Y: { provinsi: "JAWA TENGAH", kabupaten: "Yogyakarta, Sleman, Bantul, Gunung Kidul, Kulon Progo" },
  Z: { provinsi: "JAWA BARAT", kabupaten: "Garut, Tasikmalaya, Ciamis, Pangandaran" },
  AB: { provinsi: "SUMATERA BARAT", kabupaten: "Padang, Bukittinggi, Payakumbuh" },
  AD: { provinsi: "SUMATERA BARAT", kabupaten: "Solok, Sawahlunto, Sijunjung" },
  BA: { provinsi: "SUMATERA BARAT", kabupaten: "Padang Pariaman" },
  BB: { provinsi: "SUMATERA UTARA", kabupaten: "Medan, Deli Serdang, Binjai" },
  BD: { provinsi: "SUMATERA UTARA", kabupaten: "Tanjung Balai, Asahan, Labuhanbatu" },
  BE: { provinsi: "SUMATERA UTARA", kabupaten: "Lubuk Pakam, Pematang Siantar, Simalungun" },
  BG: { provinsi: "SUMATERA UTARA", kabupaten: "Kisaran, Batubara, Tanjung Balai" },
  BH: { provinsi: "SUMATERA UTARA", kabupaten: "Tebing Tinggi, Serdang Bedagai" },
  BK: { provinsi: "SUMATERA UTARA", kabupaten: "Dairi, Karo, Pakpak Bharat" },
  BL: { provinsi: "ACEH", kabupaten: "Banda Aceh, Aceh Besar, Pidie, Bireuen" },
  BM: { provinsi: "SUMATERA UTARA", kabupaten: "Nias, Gunungsitoli" },
  BN: { provinsi: "SUMATERA UTARA", kabupaten: "Tapanuli Tengah, Sibolga" },
  BP: { provinsi: "KEPULAUAN RIAU", kabupaten: "Batam, Tanjungpinang, Bintan" },
  BT: { provinsi: "SUMATERA UTARA", kabupaten: "Tapanuli Utara, Toba, Humbang Hasundutan" },
  DA: { provinsi: "KALIMANTAN SELATAN", kabupaten: "Banjarmasin, Banjarbaru" },
  DB: { provinsi: "SULAWESI UTARA", kabupaten: "Manado, Bitung, Minahasa" },
  DC: { provinsi: "SULAWESI BARAT", kabupaten: "Mamuju, Polewali Mandar" },
  DD: { provinsi: "SULAWESI SELATAN", kabupaten: "Makassar, Gowa, Maros, Pangkep" },
  DE: { provinsi: "MALUKU", kabupaten: "Ambon, Maluku Tengah" },
  DG: { provinsi: "MALUKU UTARA", kabupaten: "Ternate, Tidore, Halmahera" },
  DH: { provinsi: "NUSA TENGGARA TIMUR", kabupaten: "Kupang, Timor Tengah" },
  DK: { provinsi: "BALI", kabupaten: "Denpasar, Badung, Gianyar" },
  DL: { provinsi: "SULAWESI UTARA", kabupaten: "Kotamobagu, Bolaang Mongondow" },
  DM: { provinsi: "GORONTALO", kabupaten: "Gorontalo, Bone Bolango" },
  DN: { provinsi: "SULAWESI TENGAH", kabupaten: "Palu, Donggala, Parigi Moutong" },
  DP: { provinsi: "SULAWESI TENGGARA", kabupaten: "Kendari, Konawe, Kolaka" },
  DR: { provinsi: "NUSA TENGGARA BARAT", kabupaten: "Mataram, Lombok Timur, Lombok Barat" },
  DS: { provinsi: "PAPUA", kabupaten: "Jayapura, Biak, Merauke" },
  DT: { provinsi: "PAPUA BARAT", kabupaten: "Manokwari, Sorong, Fakfak" },
  DW: { provinsi: "SULAWESI TENGGARA", kabupaten: "Buton, Muna, Wakatobi" },
}

const SPECIAL_TYPE = {
  CD: "Kendaraan Korps Diplomatik",
  CC: "Kendaraan Korps Diplomatik",
  RI: "Kendaraan Dinas Pemerintah",
  RF: "Kendaraan Dinas Pemerintah",
  RG: "Kendaraan Angkutan Umum",
  IH: "Kendaraan Dinas Instansi",
}

function getVehicleType(prefix) {
  return SPECIAL_TYPE[prefix] || "Kendaraan Pribadi"
}

function parsePlate(plate) {
  plate = plate.trim().toUpperCase()
  plate = plate.replace(/\s+/g, " ")

  const parts = plate.split(" ")
  if (parts.length < 2) {
    throw new Error("Format plat tidak valid. Contoh: B 1234 XYZ")
  }

  const prefix = parts[0]
  if (!/^[A-Z]{1,2}$/.test(prefix)) {
    throw new Error(`Kode daerah "${prefix}" tidak valid (harus 1-2 huruf)`)
  }

  const number = parts[1]
  if (!/^\d+$/.test(number)) {
    throw new Error("Nomor plat harus berupa angka")
  }

  let suffix = parts.length > 2 ? parts[2] : ""
  if (suffix && !/^[A-Z]{1,3}$/.test(suffix)) {
    suffix = ""
  }

  const wilayah = WILAYAH[prefix]
  if (!wilayah) {
    throw new Error(`Kode daerah "${prefix}" tidak dikenali`)
  }

  return {
    raw: plate,
    prefix,
    number,
    suffix,
    province: wilayah.provinsi,
    region: wilayah.kabupaten,
    type: getVehicleType(prefix),
  }
}

export default {
  name: "Cek Plat Nomor",
  description: "Cek informasi plat nomor kendaraan Indonesia — dapatkan provinsi, daerah, dan jenis kendaraan dari plat nomor",
  category: "Tools",
  methods: ["GET", "POST"],

  params: ["plate"],

  paramsSchema: {
    plate: {
      type: "string",
      required: true,
      description: "Plat nomor kendaraan (contoh: B 1234 XYZ atau B1234XYZ)",
      example: "B 1234 XYZ",
    },
  },

  run(req, res) {
    try {
      const { plate } = { ...req.query, ...req.body }

      if (!plate || !plate.trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'plate' wajib diisi",
          example: {
            GET: "/api/tools/cekplat?plate=B%201234%20XYZ",
            POST: { plate: "B 1234 XYZ" },
          },
        })
      }

      const result = parsePlate(plate)

      logger.info(`[CEKPLAT] ${plate} -> ${result.province}`)

      return res.json({
        status: true,
        result,
      })
    } catch (error) {
      logger.error(`[CEKPLAT] Error: ${error.message}`)

      return res.status(400).json({
        status: false,
        message: error.message,
      })
    }
  },
}
