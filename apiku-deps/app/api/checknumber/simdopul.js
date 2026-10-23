import axios from "axios"
import logger from "../../src/utils/logger.js"

/* ===============================
   PROVIDER CONFIGURATION
================================ */
const SUPPORTED_PROVIDERS = {
    XL: ['817', '818', '819', '859', '877', '878', '887', '888', '889', '898', '899'],
    AXIS: ['831', '832', '833', '838', '839']
}

/* ===============================
   UTILS
================================ */
function getProviderFromNumber(number) {
    // Bersihkan nomor (ambil 3 digit setelah 62/0)
    let cleanNumber = number.replace(/[^0-9]/g, '')

    // Handle berbagai format nomor
    if (cleanNumber.startsWith('62')) {
        cleanNumber = cleanNumber.substring(2)
    } else if (cleanNumber.startsWith('0')) {
        cleanNumber = cleanNumber.substring(1)
    }

    // Ambil 3 digit pertama
    const prefix = cleanNumber.substring(0, 3)

    // Cek di XL
    if (SUPPORTED_PROVIDERS.XL.includes(prefix)) {
        return 'XL'
    }

    // Cek di AXIS
    if (SUPPORTED_PROVIDERS.AXIS.includes(prefix)) {
        return 'AXIS'
    }

    return null
}

function formatNumber(number) {
    // Format nomor ke format internasional (62xx)
    let cleanNumber = number.replace(/[^0-9]/g, '')

    if (cleanNumber.startsWith('0')) {
        cleanNumber = '62' + cleanNumber.substring(1)
    } else if (!cleanNumber.startsWith('62')) {
        cleanNumber = '62' + cleanNumber
    }

    return cleanNumber
}

/* ===============================
   EXPORT API
================================ */
export default {
    name: "SIDOMPUL CHECKER",
    description: "Cek informasi nomor XL/AXIS (Auto detect provider)",
    category: "Check Number",
    methods: ["GET", "POST"],

    params: ["nomor"],

    paramsSchema: {
        nomor: {
            type: "string",
            required: true,
            example: "6285934417318",
            description: "Nomor telepon yang ingin dicek (otomatis detect provider XL/AXIS)",
        }
    },

    async run(req, res) {
        try {
            // Support GET query params atau POST body
            const { nomor } = req.method === 'GET' ? req.query : req.body

            // Validasi nomor tidak boleh kosong
            if (!nomor) {
                return res.status(400).json({
                    status: false,
                    message: "Parameter 'nomor' wajib diisi",
                    result: null
                })
            }

            const formattedNumber = formatNumber(nomor)

            // Cek provider
            const provider = getProviderFromNumber(nomor)

            // Jika provider tidak didukung (bukan XL/AXIS)
            if (!provider) {
                return res.status(400).json({
                    status: false,
                    message: "Maaf, saat ini hanya mendukung nomor XL dan AXIS saja",
                    result: {
                        nomor: formattedNumber,
                        nomor_asli: nomor,
                        provider: null,
                        provider_didukung: Object.keys(SUPPORTED_PROVIDERS)
                    },
                    timestamp: Date.now()
                })
            }

            try {
                // Panggil API Sidompul
                const { data } = await axios.get('https://bendith.my.id/end.php', {
                    params: {
                        check: 'package',
                        number: formattedNumber,
                        version: 2
                    },
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
                        'Referer': 'https://bendith.my.id/'
                    },
                    timeout: 15000 // Timeout 15 detik
                })

                if (!data || !data.success) {
                    return res.status(400).json({
                        status: false,
                        message: data?.message || "Gagal mendapatkan data dari server",
                        result: {
                            nomor: formattedNumber,
                            provider: provider,
                            detail_error: data
                        },
                        timestamp: Date.now()
                    })
                }

                // Format response sukses
                return res.json({
                    status: true,
                    message: `Berhasil mendapatkan data untuk nomor ${provider}`,
                    result: {
                        nomor: formattedNumber,
                        nomor_asli: nomor,
                        provider: provider,
                        info_pelanggan: {
                            msisdn: data.data?.subs_info?.msisdn,
                            operator: data.data?.subs_info?.operator,
                            verifikasi_id: data.data?.subs_info?.id_verified || 'Tidak diketahui',
                            jenis_jaringan: data.data?.subs_info?.net_type || 'Tidak diketahui',
                            masa_aktif: data.data?.subs_info?.tenure || 'Tidak diketahui',
                            tanggal_kedaluwarsa: data.data?.subs_info?.exp_date || 'Tidak diketahui',
                            masa_tenggang: data.data?.subs_info?.grace_until || 'Tidak diketahui',
                            volte: {
                                perangkat: data.data?.subs_info?.volte?.device || false,
                                area: data.data?.subs_info?.volte?.area || false,
                                kartu: data.data?.subs_info?.volte?.simcard || false
                            }
                        },
                        info_paket: {
                            pesan: data.data?.package_info?.error_message || 'Tidak ada informasi paket',
                            paket_aktif: data.data?.package_info?.packages || []
                        }
                    },
                    timestamp: Date.now()
                })

            } catch (error) {
                logger.error(`[SIDOMPUL] API Error: ${error.message}`)

                let errorMessage = "Gagal terhubung ke server Sidompul"
                if (error.code === 'ECONNABORTED') {
                    errorMessage = "Timeout koneksi ke server"
                } else if (error.response) {
                    errorMessage = error.response.data?.message || `Server merespon dengan status ${error.response.status}`
                }

                return res.status(500).json({
                    status: false,
                    message: errorMessage,
                    result: {
                        nomor: formattedNumber,
                        provider: provider,
                        error: error.message
                    },
                    timestamp: Date.now()
                })
            }

        } catch (err) {
            logger.error(`[SIDOMPUL] Error: ${err.message}`)

            return res.status(500).json({
                status: false,
                message: err.message || "Internal Server Error",
                result: null,
                timestamp: Date.now()
            })
        }
    },
}
