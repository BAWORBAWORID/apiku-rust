/**
 * XL Check API
 *
 * GET /checknumber/xlcheck?number=081915895220
 * POST /checknumber/xlcheck
 *
 * Base: https://xl-ku.my.id/
 * Creator: Nimzz / Fixed: AI
 */

import axios from "axios"
import logger from "../../src/utils/logger.js"

// Helper function to extract dynamic API key from xl-ku's JS
async function getXlHeaders() {
  const jsRes = await axios.get("https://xl-ku.my.id/xlkujs/check-package", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": "https://xl-ku.my.id/"
    }
  });
  
  let js = jsRes.data;
  
  // Extract the code inside DOMContentLoaded listener
  let codeToRun = js.replace('document.addEventListener("DOMContentLoaded", function () {', '');
  codeToRun = codeToRun.substring(0, codeToRun.lastIndexOf('});'));

  // Mock DOM
  const domMock = `
    const document = {
      getElementById: () => ({ addEventListener: () => {}, value: "" })
    };
    const window = { location: { reload: () => {} } };
    const alert = () => {};
    const $ = () => ({ loadingModal: () => {} });
  `;

  // Find the variable or function that is spread into headers
  const headerMatch = codeToRun.match(/"Content-Type"\s*:\s*"application\/json",\s*\.\.\.([a-zA-Z0-9_]+)/);
  if (!headerMatch) {
    throw new Error("Gagal menemukan fungsi generator API key di script xl-ku");
  }
  
  const varName = headerMatch[1];
  const fullCode = domMock + "\n" + codeToRun + `\nreturn typeof ${varName} === 'function' ? ${varName}() : ${varName};`;
  
  try {
    const result = new Function(fullCode)();
    return result; 
  } catch(e) {
    throw new Error("Gagal mengeksekusi script API key xl-ku: " + e.message);
  }
}

export default {
  name: "XL Check",
  description: "Cek informasi nomor kartu XL/Axis — paket, kuota, masa aktif",
  category: "Check Number",
  methods: ["GET", "POST"],
  params: ["number"],

  paramsSchema: {
    number: {
      type: "string",
      required: true,
      description: "Nomor XL/Axis (format: 08xxx atau 628xxx)",
      example: "081915895220",
    },
  },

  async run(req, res) {
    try {
      const number = req.query?.number || req.body?.number

      if (!number) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'number' wajib diisi",
        })
      }

      const cleanNumber = number.replace(/\D/g, "")
      const formatted = cleanNumber.startsWith("628")
        ? "0" + cleanNumber.slice(2)
        : cleanNumber

      // Extract dynamic headers
      const xlHeaders = await getXlHeaders();

      const { data } = await axios.get(`https://xl-ku.my.id/check/all-info/${formatted}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json",
          "Referer": "https://xl-ku.my.id/",
          ...xlHeaders
        },
        timeout: 15000,
      })

      if (!data.success) {
        return res.status(400).json({
          status: false,
          message: data.message || "Gagal cek paket XL",
        })
      }

      const info = data.data.subs_info
      const packages = data.data.package_info.packages || []

      const result = {
        nomor: info.msisdn,
        operator: info.operator,
        jaringan: info.net_type,
        verif_id: info.id_verified,
        masa_aktif: info.tenure,
        masa_berakhir: info.exp_date,
        tenggang_hingga: info.grace_until,
        volte: info.volte,
        paket: packages.map((pkg) => ({
          nama: pkg.name,
          berakhir: pkg.expiry,
          kuota: (pkg.quotas || [])
            .filter(
              (q) =>
                parseFloat(q.remaining) > 0 ||
                q.remaining.includes("Menit")
            )
            .map((q) => ({
              nama: q.name,
              total: q.total,
              sisa: q.remaining,
              persen: q.percent + "%",
            })),
        })),
      }

      logger.info(`[XL-CHECK] success | ip=${req.ip} | number=${formatted}`)

      return res.json({
        status: true,
        result: result,
      })
    } catch (error) {
      let msg = error.message;
      if (error.response && error.response.data && error.response.data.message) {
        msg = error.response.data.message;
      }
      logger.error(`[XL-CHECK] Error | ip=${req.ip} | error=${msg}`)
      return res.status(500).json({
        status: false,
        message: msg || "Failed to check XL number",
      })
    }
  },
}
