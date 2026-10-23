import * as cheerio from "cheerio";
import { apiCache } from "../../src/utils/apiCache.js";
import logger from "../../src/utils/logger.js";

const BASE = "https://publicholidays.co.id/id/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const CACHE_KEY = "harilibur:data";
const CACHE_TTL = 86400; // 24 jam — data libur nasional statis

const BULAN = { Januari: "01", Februari: "02", Maret: "03", April: "04", Mei: "05", Juni: "06", Juli: "07", Agustus: "08", September: "09", Oktober: "10", November: "11", Desember: "12" };
const HARI_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

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

// tanggal hari ini (YYYY-MM-DD) zona Asia/Jakarta
function todayWIB() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

function hariNameID(yyyyMMdd) {
  const [y, m, d] = yyyyMMdd.split("-").map(Number);
  return HARI_ID[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export default {
  name: "Hari Ini",
  description: "Cek tanggal hari ini (WIB): hari apa & apakah libur nasional",
  category: "Kalender",
  methods: ["GET", "POST"],

  params: [],

  paramsSchema: {},

  async run(req, res) {
    try {
      const { tahun: available, data } = await getHariLibur();
      const today = todayWIB();

      let libur = null;
      for (const y of available) {
        const hit = data[y].find(h => h.tanggal === today);
        if (hit) { libur = hit; break; }
      }

      let next = null;
      for (const y of available) {
        next = data[y].find(h => h.tanggal > today);
        if (next) break;
      }

      return res.json({
        status: true,
        result: {
          tanggal: today,
          hari: hariNameID(today),
          libur_nasional: Boolean(libur),
          ...(libur ? { nama: libur.nama, cuti_bersama: libur.cuti_bersama } : {}),
          libur_berikutnya: next || null
        }
      });
    } catch (e) {
      return res.status(500).json({
        status: false,
        message: e.message || "Gagal mengambil data hari ini"
      });
    }
  }
};
