import crypto from "crypto"
import QRCode from "qrcode"
import path from "path"
import fs from "fs"
import logger from "../../src/utils/logger.js"
import { trackQR } from "./assets/topupTraker.js"

const uploadDir = path.join(process.cwd(), "files")
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir)

const TOKOGAKE_BASE = "https://api.tokogame.com/core/v1"

const PRODUCT_ID = "644359b1f61740160ca158ca"

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
  { code: "FF_5--73", label: "5 Diamonds", group: "Diamonds" },
  { code: "FF_10--73", label: "10 Diamonds", group: "Diamonds" },
  { code: "FF12-S29", label: "12 Diamonds", group: "Diamonds" },
  { code: "FF_15--73", label: "15 Diamonds", group: "Diamonds" },
  { code: "FF_20--73", label: "20 Diamonds", group: "Diamonds" },
  { code: "FF_25--73", label: "25 Diamonds", group: "Diamonds" },
  { code: "FF_30--73", label: "30 Diamonds", group: "Diamonds" },
  { code: "FFLUPL6-S24", label: "Level Up Pass - Level 6", group: "Cards & Passes" },
  { code: "FF_40--2", label: "40 Diamonds", group: "Diamonds" },
  { code: "FF_50--2", label: "50 Diamonds", group: "Diamonds" },
  { code: "FF55-S29", label: "55 Diamonds", group: "Diamonds" },
  { code: "FF_60--2", label: "60 Diamonds", group: "Diamonds" },
  { code: "FFLUPL10-S24", label: "Level Up Pass - Level 10", group: "Cards & Passes" },
  { code: "FFLUPL15-S24", label: "Level Up Pass - Level 15", group: "Cards & Passes" },
  { code: "FFLUPL20-S24", label: "Level Up Pass - Level 20", group: "Cards & Passes" },
  { code: "FFLUPL25-S24", label: "Level Up Pass - Level 25", group: "Cards & Passes" },
  { code: "FF70-S29", label: "70 Diamonds", group: "Diamonds" },
  { code: "FF_75--2", label: "75 Diamonds", group: "Diamonds" },
  { code: "FF70", label: "70 Diamods", group: "Diamonds" },
  { code: "FF_80--2", label: "80 Diamonds", group: "Diamonds" },
  { code: "FF_90--2", label: "90 Diamonds", group: "Diamonds" },
  { code: "FF100-S29", label: "100 Diamonds", group: "Diamonds" },
  { code: "FFLUPL30-S24", label: "Level Up Pass - Level 30", group: "Cards & Passes" },
  { code: "FF120-S29", label: "120 Diamonds", group: "Diamonds" },
  { code: "FF130-S29", label: "130 Diamonds", group: "Diamonds" },
  { code: "FF140-S29", label: "140 Diamonds", group: "Diamonds" },
  { code: "FF_145--2", label: "145 Diamonds", group: "Diamonds" },
  { code: "FF_150--2", label: "150 Diamonds", group: "Diamonds" },
  { code: "FF_160--2", label: "160 Diamonds", group: "Diamonds" },
  { code: "FF_180--2", label: "180 Diamonds", group: "Diamonds" },
  { code: "FF190", label: "190 Diamonds", group: "Diamonds" },
  { code: "FF200-S29", label: "200 Diamonds", group: "Diamonds" },
  { code: "FF210", label: "210 Diamonds", group: "Diamonds" },
  { code: "FF_MM--18", label: "Mingguan Membership", group: "Memberships" },
  { code: "FF_250--2", label: "250 Diamonds", group: "Diamonds" },
  { code: "FF_260--2", label: "260 Diamonds", group: "Diamonds" },
  { code: "FF280-S29", label: "280 Diamonds", group: "Diamonds" },
  { code: "FF_300--2", label: "300 DIamonds", group: "Diamonds" },
  { code: "FF_BP--73", label: "BP Card", group: "Cards & Passes" },
  { code: "FF355-S29", label: "355 Diamonds", group: "Diamonds" },
  { code: "FF_360--2", label: "360 Diamonds", group: "Diamonds" },
  { code: "FF_375--2", label: "375 Diamonds", group: "Diamonds" },
  { code: "FF_400--2", label: "400 Diamonds", group: "Diamonds" },
  { code: "FF_405--2", label: "405 Diamonds", group: "Diamonds" },
  { code: "FF420-S29", label: "420 Diamonds", group: "Diamonds" },
  { code: "FF_425--2", label: "425 Diamonds", group: "Diamonds" },
  { code: "FF_MM_2--73", label: "Mingguan Membership x2", group: "Memberships" },
  { code: "FF_475--2", label: "475 DIamonds", group: "Diamonds" },
  { code: "FF_495--2", label: "495 DIamonds", group: "Diamonds" },
  { code: "FF_500--2", label: "500 Diamonds", group: "Diamonds" },
  { code: "FF_512--2", label: "512 Diamonds", group: "Diamonds" },
  { code: "FF_515--2", label: "515 Diamonds", group: "Diamonds" },
  { code: "FF_520--2", label: "520 Diamonds", group: "Diamonds" },
  { code: "FF_545--2", label: "545 Diamonds", group: "Diamonds" },
  { code: "FF565-S29", label: "565 Diamonds", group: "Diamonds" },
  { code: "FF_600--2", label: "600 Diamonds", group: "Diamonds" },
  { code: "FF635-S29", label: "635 Diamonds", group: "Diamonds" },
  { code: "FF_645--2", label: "645 Diamonds", group: "Diamonds" },
  { code: "FF_MB--18", label: "Bulanan Membership", group: "Memberships" },
  { code: "FF_655--2", label: "655 Diamonds", group: "Diamonds" },
  { code: "FF720-S29", label: "720 Diamonds", group: "Diamonds" },
  { code: "FFMx3", label: "Mingguan Membership x3", group: "Memberships" },
  { code: "FF_725--73", label: "725 Diamonds", group: "Diamonds" },
  { code: "FF_740--73", label: "740 Diamonds", group: "Diamonds" },
  { code: "FF_770--73", label: "770 DIamonds", group: "Diamonds" },
  { code: "FF_790--73", label: "790 DIamonds", group: "Diamonds" },
  { code: "FF800-S29", label: "800 Diamonds", group: "Diamonds" },
  { code: "FF860-S29", label: "860 Diamonds", group: "Diamonds" },
  { code: "FF930-S29", label: "930 Diamonds", group: "Diamonds" },
  { code: "FFMx4", label: "Mingguan Membership x4", group: "Memberships" },
  { code: "FF1000-S29", label: "1000 Diamonds", group: "Diamonds" },
  { code: "FF1050-S29", label: "1050 Diamonds", group: "Diamonds" },
  { code: "FF1075-S29", label: "1075 Diamonds", group: "Diamonds" },
  { code: "FF1080-S29", label: "1080 Diamonds", group: "Diamonds" },
  { code: "FFMx5", label: "Mingguan Membership x5", group: "Memberships" },
  { code: "FF_1200--73", label: "1200 Diamonds", group: "Diamonds" },
  { code: "FF_1215--73", label: "1215 Diamonds", group: "Diamonds" },
  { code: "FF_1300--73", label: "1300 Diamonds", group: "Diamonds" },
  { code: "FF_MB_2--91", label: "Bulanan Membership x2", group: "Memberships" },
  { code: "FF_1450--73", label: "1450 Diamonds", group: "Diamonds" },
  { code: "FF_1490--73", label: "1490 Diamonds", group: "Diamonds" },
  { code: "FF_1510--73", label: "1510 DIamonds", group: "Diamonds" },
  { code: "FF1580", label: "1580 Diamonds", group: "Diamonds" },
  { code: "FF_1800--73", label: "1800 Diamonds", group: "Diamonds" },
  { code: "FF_1875--73", label: "1875 Diamonds", group: "Diamonds" },
  { code: "FF_1975--73", label: "1975 Diamonds", group: "Diamonds" },
  { code: "FF_2000--73", label: "2000 Diamonds", group: "Diamonds" },
  { code: "FF_2100--73", label: "2100 Diamonds", group: "Diamonds" },
  { code: "FF_2140--73", label: "2140 Diamonds", group: "Diamonds" },
  { code: "FF_2180--73", label: "2180 Diamonds", group: "Diamonds" },
  { code: "FFBx3", label: "Bulanan Membership x3", group: "Memberships" },
  { code: "FF2200", label: "2200 Diamonds", group: "Diamonds" },
  { code: "FF2210", label: "2210 Diamonds", group: "Diamonds" },
  { code: "FF_2225--2", label: "2225 Diamonds", group: "Diamonds" },
  { code: "FF_2280--73", label: "2280 Diamonds", group: "Diamonds" },
  { code: "FF2355", label: "2355 Diamonds", group: "Diamonds" },
  { code: "FF_2400--2", label: "2400 Diamonds", group: "Diamonds" },
  { code: "FF_2575--73", label: "2575 Diamonds", group: "Diamonds" },
  { code: "FF_2750--73", label: "2750 Diamonds", group: "Diamonds" },
  { code: "FFBx4", label: "Bulanan Membership x4", group: "Memberships" },
  { code: "FF_3000--73", label: "3000 Diamonds", group: "Diamonds" },
  { code: "FF_3310--73", label: "3310 Diamonds", group: "Diamonds" },
  { code: "FF_3620--73", label: "3620 Diamonds", group: "Diamonds" },
  { code: "FF3640", label: "3640 Diamonds", group: "Diamonds" },
  { code: "FFBx5", label: "Bulanan Membership x5", group: "Memberships" },
  { code: "FF_3675--73", label: "3675 Diamonds", group: "Diamonds" },
  { code: "FF_3800--73", label: "3800 Diamonds", group: "Diamonds" },
  { code: "FF_4000--73", label: "4000 Diamonds", group: "Diamonds" },
  { code: "FF_4050--73", label: "4050 Diamonds", group: "Diamonds" },
  { code: "FF_4340--73", label: "4340 Diamonds", group: "Diamonds" },
  { code: "FF_4450--73", label: "4450 Diamonds", group: "Diamonds" },
  { code: "FF_4720--73", label: "4720 Diamonds", group: "Diamonds" },
  { code: "FF_4850--73", label: "4850 Diamonds", group: "Diamonds" },
  { code: "FF5500", label: "5500 Diamonds", group: "Diamonds" },
  { code: "FF_5600--73", label: "5600 Diamonds", group: "Diamonds" },
  { code: "FF_6000--73", label: "6000 Diamonds", group: "Diamonds" },
  { code: "FF_6480--73", label: "6480 Diamonds", group: "Diamonds" },
  { code: "FF_6550--73", label: "6550 Diamonds", group: "Diamonds" },
  { code: "FF_6900--73", label: "6900 Diamonds", group: "Diamonds" },
  { code: "FF_7290--73", label: "7290 Diamonds", group: "Diamonds" },
  { code: "FF_7650--73", label: "7650 Diamonds", group: "Diamonds" },
  { code: "FF_8010--73", label: "8010 Diamonds", group: "Diamonds" },
  { code: "FF_8730--2", label: "8730 Diamonds", group: "Diamonds" },
  { code: "FF_9290--73", label: "9290 Diamonds", group: "Diamonds" },
  { code: "FF_9800--73", label: "9800 Diamonds", group: "Diamonds" },
  { code: "FF_14580--73", label: "14580 Diamonds", group: "Diamonds" },
  { code: "FF_36500--73", label: "36500 DIamonds", group: "Diamonds" },
  { code: "FF_37050--73", label: "37050 Diamonds", group: "Diamonds" },
  { code: "FF_73100--73", label: "73100 Diamonds", group: "Diamonds" },
]

const PAKET_ENUM = [...new Set(PACKAGES.map(p => p.label))]

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
  name: "FREE FIRE TOP UP",
  description: "Top-up Free Fire diamonds, cards & membership via QRIS",
  category: "Topup",
  methods: ["GET", "POST"],

  params: ["user_id", "paket"],

  paramsSchema: {
    user_id: {
      type: "string",
      required: true,
      description: "Free Fire User ID (angka saja)",
      example: "1234567890",
      minLength: 1,
      maxLength: 20,
    },
    paket: {
      type: "string",
      required: true,
      enum: PAKET_ENUM,
      default: "20 Diamonds",
      description: `Nama paket Free Fire.\n\n--- DIAMONDS ---\n${PACKAGES.filter(p => p.group === "Diamonds").map(p => p.label).join("\n")}\n\n--- CARDS & PASSES ---\n${PACKAGES.filter(p => p.group === "Cards & Passes").map(p => p.label).join("\n")}\n\n--- MEMBERSHIPS ---\n${PACKAGES.filter(p => p.group === "Memberships").map(p => p.label).join("\n")}`,
      example: "20 Diamonds",
    },
  },

  async run(req, res) {
    try {
      const { user_id, paket } = { ...req.query, ...req.body }

      if (!user_id) {
        return res.status(400).json({ status: false, message: "Parameter 'user_id' wajib diisi" })
      }

      const cleanedId = user_id.replace(/[^0-9]/g, "")
      if (!cleanedId || cleanedId.length > 20) {
        return res.status(400).json({ status: false, message: "User ID tidak valid — maksimal 20 digit angka" })
      }

      if (!paket) {
        return res.status(400).json({ status: false, message: "Parameter 'paket' wajib diisi" })
      }

      const pkg = PACKAGES.find(p => p.label.toLowerCase() === paket.toLowerCase())
      if (!pkg) {
        const tersedia = PAKET_ENUM.join(", ")
        return res.status(400).json({
          status: false,
          message: `Paket '${paket}' tidak tersedia. Pilihan: ${tersedia}`,
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
              inputType: "STRING",
              regexValidation: {
                regex: "^[0-9]{1,20}$",
                errorMessages: [
                  { language: "ID", title: "Format ID Salah", body: "ID hanya boleh mengandung angka. Silakan periksa kembali dan coba lagi 😊" },
                  { language: "EN", title: "Invalid ID Format", body: "ID must contain numbers only. Please check and try again 😊" },
                ],
              },
              translations: [
                { language: "ID", question: "Masukkan User ID", description: "User ID", choices: [] },
              ],
            },
            answer: cleanedId,
          },
        ],
      }

      logger.info(`[TOPUP-FF] Creating order | user_id=${cleanedId} | package=${pkg.code} | label=${pkg.label}`)

      const createRes = await fetch(`${TOKOGAKE_BASE}/orders/create-order`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })

      const createData = await createRes.json()

      if (!createRes.ok || createData.code !== "SUCCESS") {
        logger.error(`[TOPUP-FF] Tokogame error | status=${createRes.status} | body=${JSON.stringify(createData)}`)
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
          trackQR(orderId, orderCode, "ff", filePath, `${req.protocol}://${req.get("host")}/files/${filename}`)
          qrImageUrl = `https://api.zyvor.my.id/files/${filename}`
        } catch (qrErr) {
          logger.warn(`[TOPUP-FF] QR generation failed | ${qrErr.message}`)
        }
      }

      logger.info(`[TOPUP-FF] Order created | id=${orderId} | code=${orderCode} | harga=${harga}`)

      return res.json({
        status: true,
        result: {
          orderId,
          orderCode,
          user_id: cleanedId,
          paket: pkg.label,
          label: pkg.label,
          group: pkg.group,
          harga,
          qr_url: qrImageUrl,
          qris_content: qrisContent,
        },
        timestamp: Date.now(),
      })
    } catch (err) {
      logger.error(`[TOPUP-FF] Error | ip=${req.ip} | error=${err.message}`)
      return res.status(500).json({ status: false, message: err.message || "Gagal membuat order" })
    }
  },
}
