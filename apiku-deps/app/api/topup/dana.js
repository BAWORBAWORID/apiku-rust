import crypto from "crypto"
import QRCode from "qrcode"
import path from "path"
import fs from "fs"
import logger from "../../src/utils/logger.js"
import { trackQR } from "./assets/topupTraker.js"

const uploadDir = path.join(process.cwd(), "files")
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir)

const TOKOGAKE_BASE = "https://api.tokogame.com/core/v1"

const PRODUCT_ID = "67ca818d93cbad5184377578"

function makeHeaders() {
  const requestId = crypto.randomUUID()
  const secretId = crypto.createHmac("sha256", "tokogame.com").update(requestId).digest("hex")
  const appInstanceId = crypto.randomUUID().replace(/-/g, "")
  return {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "X-Language": "ID",
    "X-Region": "ID",
    "X-Currency": "IDR",
    "X-Request-Id": requestId,
    "X-Secret-Id": secretId,
    "X-App-Instance-Id": appInstanceId,
    Origin: "https://www.tokogame.com",
    Referer: "https://www.tokogame.com/",
  }
}

const PACKAGES = [
  { code: "1000",    nominal: 1000,    label: "DANA 1.000" },
  { code: "10000",   nominal: 10000,   label: "DANA 10.000" },
  { code: "20000",   nominal: 20000,   label: "DANA 20.000" },
  { code: "25000",   nominal: 25000,   label: "DANA 25.000" },
  { code: "30000",   nominal: 30000,   label: "DANA 30.000" },
  { code: "35000",   nominal: 35000,   label: "DANA 35.000" },
  { code: "40000",   nominal: 40000,   label: "DANA 40.000" },
  { code: "45000",   nominal: 45000,   label: "DANA 45.000" },
  { code: "50000",   nominal: 50000,   label: "DANA 50.000" },
  { code: "55000",   nominal: 55000,   label: "DANA 55.000" },
  { code: "60000",   nominal: 60000,   label: "DANA 60.000" },
  { code: "65000",   nominal: 65000,   label: "DANA 65.000" },
  { code: "70000",   nominal: 70000,   label: "DANA 70.000" },
  { code: "75000",   nominal: 75000,   label: "DANA 75.000" },
  { code: "80000",   nominal: 80000,   label: "DANA 80.000" },
  { code: "85000",   nominal: 85000,   label: "DANA 85.000" },
  { code: "90000",   nominal: 90000,   label: "DANA 90.000" },
  { code: "95000",   nominal: 95000,   label: "DANA 95.000" },
  { code: "100000",  nominal: 100000,  label: "DANA 100.000" },
  { code: "125000",  nominal: 125000,  label: "DANA 125.000" },
  { code: "150000",  nominal: 150000,  label: "DANA 150.000" },
  { code: "200000",  nominal: 200000,  label: "DANA 200.000" },
  { code: "250000",  nominal: 250000,  label: "DANA 250.000" },
  { code: "300000",  nominal: 300000,  label: "DANA 300.000" },
  { code: "350000",  nominal: 350000,  label: "DANA 350.000" },
  { code: "400000",  nominal: 400000,  label: "DANA 400.000" },
  { code: "500000",  nominal: 500000,  label: "DANA 500.000" },
  { code: "600000",  nominal: 600000,  label: "DANA 600.000" },
  { code: "700000",  nominal: 700000,  label: "DANA 700.000" },
  { code: "800000",  nominal: 800000,  label: "DANA 800.000" },
  { code: "900000",  nominal: 900000,  label: "DANA 900.000" },
  { code: "1000000", nominal: 1000000, label: "DANA 1.000.000" },
  { code: "2000000", nominal: 2000000, label: "DANA 2.000.000" },
  { code: "3000000", nominal: 3000000, label: "DANA 3.000.000" },
]

const NOMINAL_ENUM = PACKAGES.map(p => String(p.nominal))
const NOMINAL_LABELS = PACKAGES.map(p => `${p.label}`)

function randomName(ext = ".png") {
  return crypto.randomBytes(16).toString("hex") + ext
}

function scheduleDelete(filePath, delayMs = 300000) {
  setTimeout(() => {
    fs.unlink(filePath, err => {
      if (err) logger.warn(`[CLEANUP] Gagal hapus ${filePath}: ${err.message}`)
    })
  }, delayMs)
}

export default {
  name: "DANA TOP UP QRIS",
  description: "Top-up saldo DANA via QRIS",
  category: "Topup",
  methods: ["GET", "POST"],

  params: ["nomor", "nominal"],

  paramsSchema: {
    nomor: {
      type: "string",
      required: true,
      description: "Nomor DANA tujuan (awali 08)",
      example: "08123456789",
      minLength: 10,
      maxLength: 15,
    },
    nominal: {
      type: "string",
      required: true,
      enum: NOMINAL_ENUM,
      default: "50000",
      description: `Nominal top-up DANA. Pilihan:\n${NOMINAL_LABELS.join("\n")}`,
      example: "50000",
    },
  },

  async run(req, res) {
    try {
      const { nomor, nominal } = { ...req.query, ...req.body }

      if (!nomor) {
        return res.status(400).json({ status: false, message: "Parameter 'nomor' wajib diisi" })
      }

      const cleanedNomor = nomor.replace(/[^0-9]/g, "")
      if (cleanedNomor.length < 10 || cleanedNomor.length > 15) {
        return res.status(400).json({ status: false, message: "Nomor harus 10-15 digit" })
      }

      if (!nominal) {
        return res.status(400).json({ status: false, message: "Parameter 'nominal' wajib diisi" })
      }

      const pkg = PACKAGES.find(p => p.code === nominal || String(p.nominal) === String(nominal))
      if (!pkg) {
        return res.status(400).json({
          status: false,
          message: `Nominal '${nominal}' tidak tersedia. Pilihan: ${NOMINAL_ENUM.join(", ")}`,
        })
      }

      const headers = makeHeaders()

      const body = {
        contact: {
          emailAddress: "",
          phoneNumber: "+6283140961614",
        },
        paymentMethod: "QRIS_ID_BNC",
        productId: PRODUCT_ID,
        productPackageCode: pkg.code,
        questionnaireAnswers: [
          {
            questionnaire: {
              code: "userid",
              inputType: "NUMBER",
              regexValidation: {
                regex: "^08\\d{8,12}$",
                errorMessages: [
                  { language: "ID", title: "Format Nomor HP Salah", body: "Format nomor HP salah. Mohon masukkan nomor yang dimulai dengan 08..." },
                ],
              },
              translations: [
                { language: "ID", question: "Masukkan No. HP", description: "Nomor HP", choices: [] },
              ],
            },
            answer: cleanedNomor,
          },
        ],
      }

      logger.info(`[TOPUP-DANA] Creating order | nomor=${cleanedNomor} | package=${pkg.code}`)

      const createRes = await fetch(`${TOKOGAKE_BASE}/orders/create-order`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })

      const createData = await createRes.json()

      if (!createRes.ok || createData.code !== "SUCCESS") {
        logger.error(`[TOPUP-DANA] Tokogame error | status=${createRes.status} | body=${JSON.stringify(createData)}`)
        return res.status(502).json({
          status: false,
            message: createData.message || "Gagal membuat order",
          detail: createData,
        })
      }

      const { id: orderId, code: orderCode, totalPriceInCents, checkoutUrl } = createData.data
      const harga = totalPriceInCents / 100

      let qrImageUrl = null
      const qrisContent = checkoutUrl?.qr || null
      const qrisImageUrl = checkoutUrl?.qrUrl || null

      if (qrisContent) {
        try {
          const filename = randomName(".png")
          const filePath = path.join(uploadDir, filename)
          await QRCode.toFile(filePath, qrisContent, { scale: 8, margin: 1 })
          scheduleDelete(filePath)
          trackQR(orderId, orderCode, "dana", filePath, `${req.protocol}://${req.get("host")}/files/${filename}`)
          qrImageUrl = `${req.protocol}://${req.get("host")}/files/${filename}`
        } catch (qrErr) {
          logger.warn(`[TOPUP-DANA] QR generation failed | ${qrErr.message}`)
        }
      }

      logger.info(
        `[TOPUP-DANA] Order created | id=${orderId} | code=${orderCode} | harga=${harga}`
      )

      return res.json({
        status: true,
        result: {
          orderId,
          orderCode,
          nomor: cleanedNomor,
          nominal: pkg.nominal,
          label: pkg.label,
          harga,
          qr_url: qrImageUrl,
          qris_content: qrisContent,
        },
        timestamp: Date.now(),
      })
    } catch (err) {
      logger.error(`[TOPUP-DANA] Error | ip=${req.ip} | error=${err.message}`)
      return res.status(500).json({ status: false, message: err.message || "Gagal membuat order" })
    }
  },
}
