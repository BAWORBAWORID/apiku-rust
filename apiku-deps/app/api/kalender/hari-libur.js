import * as cheerio from "cheerio";
import { apiCache } from "../../src/utils/apiCache.js";
import logger from "../../src/utils/logger.js";

const BASE = "https://publicholidays.co.id/id/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const CACHE_KEY = "harilibur:data";
const CACHE_TTL = 86400; // 24 jam — data libur nasional statis

const BULAN = { Januari: "01", Februari: "02", Maret: "03", April: "04", Mei: "05", Juni: "06", Juli: "07", Agustus: "08", September: "09", Oktober: "10", November: "11", Desember: "12" };

async function getHariLibur() {
  const cached = apiCache.get(CACHE_KEY);
  if (cached) return cached;

  const res = await fetch(BASE, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Upstream HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());

  const data = {};
  $("h2").each((_, h) => {
    const m = $(h).text().trim().match(/Libur Nasional (\d{4})/);
    if (!m) return;
    const year = m[1];
    const table = $(h).nextAll("table.publicholidays").first();
    const list = [];
    table.find("tbody tr").each((_, tr) => {
      const tds = $(tr).find("td");
      if (tds.length < 3) return; // baris iklan
      const tanggal = $(tds[0]).text().trim();
      const hari = $(tds[1]).text().trim();
      const nama = $(tds[2]).text().trim().replace(/\s+/g, " ");
      if (!tanggal || !nama) return;
      const [tgl, bln] = tanggal.split(" ");
      list.push({
        tanggal: `${year}-${BULAN[bln] || "??"}-${String(tgl).padStart(2, "0")}`,
        hari,
        nama,
        cuti_bersama: /cuti bersama/i.test(nama)
      });
    });
    data[year] = list;
  });

  if (Object.keys(data).length === 0) throw new Error("Gagal parse data hari libur");
  const payload = { tahun: Object.keys(data).sort(), data };
  apiCache.set(CACHE_KEY, payload, CACHE_TTL);
  logger.info(`[HARILIBUR] Cache refresh | tahun=${payload.tahun.join(",")}`);
  return payload;
}

export default {
  name: "Hari Libur Nasional",
  description: "Daftar hari libur nasional & cuti bersama Indonesia per tahun",
  category: "Kalender",
  methods: ["GET", "POST"],

  params: ["tahun"],

  paramsSchema: {
    tahun: {
      type: "string",
      required: false,
      description: "Tahun (mis. 2026). Kosongkan untuk semua tahun tersedia",
      example: "2026"
    }
  },

  async run(req, res) {
    try {
      const { tahun: rawTahun } = { ...req.query, ...req.body };
      const { tahun: available, data } = await getHariLibur();

      const tahun = String(rawTahun || "").trim();
      if (!tahun) {
        const ringkasan = {};
        for (const y of available) ringkasan[y] = `${data[y].length} hari libur`;
        return res.json({
          status: true,
          result: { tahun_tersedia: available, ringkasan }
        });
      }

      if (!data[tahun]) {
        return res.status(404).json({
          status: false,
          message: `Data tahun ${tahun} tidak tersedia`,
          tahun_tersedia: available
        });
      }

      return res.json({
        status: true,
        result: { tahun, jumlah: data[tahun].length, libur: data[tahun] }
      });
    } catch (e) {
      return res.status(500).json({
        status: false,
        message: e.message || "Gagal mengambil data hari libur"
      });
    }
  }
};
