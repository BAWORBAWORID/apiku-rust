import * as cheerio from "cheerio";
import https from "node:https";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function postCariKodepos(kodepos) {
  return new Promise((resolve, reject) => {
    const data = `kodepos=${encodeURIComponent(kodepos)}`;
    const options = {
      hostname: "kodepos.posindonesia.co.id",
      path: "/CariKodepos",
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        resolve(body);
      });
    });

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function cariKodepos(query) {
  const html = await postCariKodepos(query);
  const $ = cheerio.load(html);

  const rows = $("#list-data tbody tr");
  if (rows.length === 0) {
    // Cek apakah ada hasil nol
    if (
      $("body")
        .text()
        .includes("tidak ditemukan") ||
      $("body").text().includes("Data tidak ditemukan")
    ) {
      return null;
    }
    return null;
  }

  const row = $(rows[0]);
  const cols = row.find("td");

  if (cols.length < 6) {
    return null;
  }

  return {
    kodepos: $(cols[1]).text().trim(),
    desa_kelurahan: $(cols[2]).text().trim(),
    kecamatan: $(cols[3]).text().trim(),
    kota_kabupaten: $(cols[4]).text().trim(),
    provinsi: $(cols[5]).text().trim(),
  };
}

export default {
  name: "Search KodePos",
  description: "Cari kode pos berdasarkan kode pos atau nama desa/kelurahan",
  category: "Search",
  methods: ["GET", "POST"],

  params: ["kodepos"],

  paramsSchema: {
    kodepos: {
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 10,
      description: "Kode pos 5 digit (contoh: 21141)",
      example: "21141",
    }
  },

  async run(req, res) {
    try {
      let { kodepos } = { ...req.query, ...req.body };

      if (!kodepos || typeof kodepos !== "string" || !kodepos.trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'kodepos' wajib diisi",
        });
      }

      kodepos = kodepos.trim();

      if (!/^\d{5}$/.test(kodepos)) {
        return res.status(400).json({
          status: false,
          message: "Kode pos harus terdiri dari 5 digit angka",
        });
      }

      const result = await cariKodepos(kodepos);

      if (!result) {
        return res.status(404).json({
          status: false,
          message: "Kodepos tidak ditemukan di database Pos Indonesia",
        });
      }

      return res.json({
        status: true,
        result: {
          kodepos: result.kodepos,
          desa_kelurahan: result.desa_kelurahan,
          kecamatan: result.kecamatan,
          kota_kabupaten: result.kota_kabupaten,
          provinsi: result.provinsi,
        },
      });
    } catch (e) {
      return res.status(500).json({
        status: false,
        message: e.message || "Gagal mencari kodepos",
      });
    }
  }
};