/**
 * QRIS Info & Parser
 * Mengurai string QRIS (EMVCo MPM) dan menampilkan detail merchant, NMID, acquirer, kategori, lokasi, serta validasi checksum CRC16.
 */

import logger from "../../src/utils/logger.js";

function crc16(data) {
  let crc = 0xFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function parseTLV(str) {
  const result = {};
  let i = 0;
  while (i < str.length) {
    const tag = str.substr(i, 2);
    const len = parseInt(str.substr(i + 2, 2), 10);
    if (isNaN(len) || i + 4 + len > str.length) break;
    const val = str.substr(i + 4, len);
    result[tag] = { len, val };
    i += 4 + len;
  }
  return result;
}

const CRITERIA_MAP = {
  UMI: "Usaha Mikro",
  UKE: "Usaha Kecil",
  UME: "Usaha Menengah",
  UBE: "Usaha Besar",
  PSO: "Perusahaan Publik / Sosial"
};

const MCC_MAP = {
  "6540": "POI Funding / Uang Elektronik & Dompet Digital",
  "5411": "Supermarket / Minimarket / Toko Kelontong",
  "5812": "Restoran / Rumah Makan",
  "5814": "Makanan Cepat Saji (Fast Food)",
  "5999": "Toko Retail / Aneka Barang",
  "4111": "Transportasi Umum / Komuter",
  "4121": "Taksi / Layanan Transportasi Online",
  "5311": "Department Store",
  "5541": "SPBU / Bahan Bakar Minyak",
  "8299": "Pendidikan / Kursus & Pelatihan",
  "7999": "Hiburan / Rekreasi",
  "8099": "Layanan Medis & Kesehatan"
};

function detectBrand(acquirerStr) {
  if (!acquirerStr) return "Unknown";
  const up = acquirerStr.toUpperCase();
  if (up.includes("DANA")) return "DANA";
  if (up.includes("GOPAY") || up.includes("GOJEK")) return "GoPay";
  if (up.includes("OVO")) return "OVO";
  if (up.includes("SHOPEE")) return "ShopeePay";
  if (up.includes("LINKAJA")) return "LinkAja";
  if (up.includes("BCA")) return "BCA";
  if (up.includes("BRI")) return "Bank BRI";
  if (up.includes("BNI")) return "Bank BNI";
  if (up.includes("MANDIRI")) return "Bank Mandiri";
  if (up.includes("BSI")) return "Bank Syariah Indonesia";
  if (up.includes("CIMB")) return "CIMB Niaga";
  if (up.includes("PERMATA")) return "Bank Permata";
  if (up.includes("NOBU")) return "Bank Nobu";
  return acquirerStr;
}

function parseQRIS(raw) {
  const str = String(raw || "").trim();
  if (str.length < 25) {
    throw new Error("String QRIS terlalu pendek atau tidak valid.");
  }

  // Verifikasi CRC16
  const calcCrc = crc16(str.slice(0, -4));
  const expectedCrc = str.slice(-4).toUpperCase();
  const isCrcValid = calcCrc === expectedCrc;

  const root = parseTLV(str);
  if (!root["00"] || root["00"].val !== "01") {
    throw new Error("Format QRIS tidak sesuai standar EMVCo MPM (Payload Indicator bukan '01').");
  }

  const pointOfInitiation = root["01"]?.val === "12" ? "Dynamic" : "Static";

  // Merchant Account Information (Tag 26 s/d 45)
  let acquirer = null;
  let merchantPan = null;
  let internalMerchantId = null;
  let merchantCriteria = null;

  for (let tag = 26; tag <= 45; tag++) {
    const tagStr = String(tag).padStart(2, "0");
    if (root[tagStr]) {
      const sub = parseTLV(root[tagStr].val);
      acquirer = sub["00"]?.val || acquirer;
      merchantPan = sub["01"]?.val || merchantPan;
      internalMerchantId = sub["02"]?.val || internalMerchantId;
      merchantCriteria = sub["03"]?.val || merchantCriteria;
    }
  }

  // QRIS Nasional (Tag 51)
  let nmid = null;
  let nationalGui = null;
  if (root["51"]) {
    const sub51 = parseTLV(root["51"].val);
    nationalGui = sub51["00"]?.val || null;
    nmid = sub51["02"]?.val || null;
    merchantCriteria = sub51["03"]?.val || merchantCriteria;
  }

  const mcc = root["52"]?.val || null;
  const currencyCode = root["53"]?.val || "360";
  const amount = root["54"]?.val ? Number(root["54"].val) : null;
  const feeType = root["55"]?.val || null; // Tip / Convenience Fee indicator
  const feeFixed = root["56"]?.val ? Number(root["56"].val) : null;
  const feePercentage = root["57"]?.val ? Number(root["57"].val) : null;
  const countryCode = root["58"]?.val || "ID";
  const merchantName = root["59"]?.val || null;
  const merchantCity = root["60"]?.val || null;
  const postalCode = root["61"]?.val || null;

  // Additional Data (Tag 62)
  let additionalData = null;
  if (root["62"]) {
    const sub62 = parseTLV(root["62"].val);
    additionalData = {
      billNumber: sub62["01"]?.val || null,
      mobileNumber: sub62["02"]?.val || null,
      storeLabel: sub62["03"]?.val || null,
      loyaltyNumber: sub62["04"]?.val || null,
      referenceLabel: sub62["05"]?.val || null,
      customerLabel: sub62["06"]?.val || null,
      terminalLabel: sub62["07"]?.val || null,
      purpose: sub62["08"]?.val || null
    };
  }

  return {
    valid: isCrcValid,
    merchantName,
    nmid,
    brand: detectBrand(acquirer),
    acquirer,
    merchantPan,
    internalMerchantId,
    type: pointOfInitiation,
    amount,
    currency: currencyCode === "360" ? "IDR" : currencyCode,
    fee: {
      indicator: feeType,
      fixed: feeFixed,
      percentage: feePercentage
    },
    criteria: {
      code: merchantCriteria,
      name: CRITERIA_MAP[merchantCriteria] || merchantCriteria
    },
    mcc: {
      code: mcc,
      category: MCC_MAP[mcc] || "Lainnya"
    },
    city: merchantCity,
    postalCode,
    country: countryCode,
    additionalData,
    crc: {
      expected: expectedCrc,
      calculated: calcCrc,
      valid: isCrcValid
    },
    raw: str
  };
}

export default {
  name: "QRIS Info & Parser",
  description: "Cek dan ekstrak info detail string QRIS (NMID, Nama Merchant, Acquirer, Tipe Statis/Dinamis, MCC, Lokasi, dan CRC16)",
  category: "Tools",
  methods: ["GET", "POST"],
  params: ["text"],
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "String kode QRIS yang ingin dicek / di-decode"
    }
  },

  async run(req, res) {
    const rawText = req.query.text || req.body?.text || req.query.qris || req.body?.qris || req.query.string || req.body?.string;

    if (!rawText || typeof rawText !== "string" || !rawText.trim()) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'text' wajib diisi dengan string QRIS."
      });
    }

    try {
      const parsed = parseQRIS(rawText.trim());
      logger.info(`[QRIS-INFO] Parsed merchant='${parsed.merchantName}' nmid='${parsed.nmid}' valid=${parsed.valid}`);

      return res.status(200).json({
        status: true,
        result: parsed
      });
    } catch (err) {
      logger.warn(`[QRIS-INFO] Parse failed: ${err.message}`);
      return res.status(400).json({
        status: false,
        message: err.message || "Gagal mengurai string QRIS"
      });
    }
  }
};
