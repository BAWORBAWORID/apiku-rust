import axios from "axios";
import * as cheerio from "cheerio";

class Scraper {
  constructor() {
    this.baseUrl = "https://www.jadwaltv.net";
    this.path = "/jadwal-sepakbola";
  }

  async fetchJadwal() {
    const response = await axios.get(`${this.baseUrl}${this.path}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml"
      },
      timeout: 15000
    });
    return this.parseHTML(response.data);
  }

  parseHTML(html) {
    const $ = cheerio.load(html);
    const jadwal = [];
    const seenKeys = new Set();

    $("table").each((tableIdx, table) => {
      const rows = $(table).find("tr");

      rows.each((rowIdx, row) => {
        const cols = $(row).find("td");

        if (cols.length === 4) {
          const tanggal = $(cols[0]).text().trim();
          const jam = $(cols[1]).text().trim();
          const pertandingan = $(cols[2]).text().trim();
          const kompetisi = $(cols[3]).text().trim();

          if (tanggal && jam && pertandingan && kompetisi && !tanggal.includes("Tanggal")) {
            const key = `${tanggal}|${jam}|${pertandingan}`;
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              jadwal.push({
                tanggal,
                jam,
                pertandingan,
                kompetisi
              });
            }
          }
        }
      });
    });

    if (jadwal.length === 0) {
      throw new Error("Tidak dapat menemukan tabel jadwal. Mungkin struktur website berubah.");
    }

    const grouped = {};
    jadwal.forEach(item => {
      if (!grouped[item.tanggal]) grouped[item.tanggal] = [];
      grouped[item.tanggal].push({
        jam: item.jam,
        pertandingan: item.pertandingan,
        kompetisi: item.kompetisi
      });
    });

    return {
      total: jadwal.length,
      jadwal: jadwal,
      grouped_by_date: grouped
    };
  }

  filterByDate(jadwalList, targetDate) {
    const filtered = jadwalList.filter(item => item.tanggal.toLowerCase().includes(targetDate.toLowerCase()));
    return {
      tanggal: targetDate,
      total: filtered.length,
      jadwal: filtered
    };
  }
}

export default {
  name: "Jadwal Sepakbola (StarLabs)",
  description: "Dapatkan jadwal pertandingan sepakbola live.",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["date"],

  paramsSchema: {
    date: {
      type: "string",
      required: false,
      description: "Filter berdasarkan tanggal tertentu (e.g. Sabtu, 20 Juni 2026)",
      example: "Sabtu, 20 Juni 2026"
    }
  },

  async run(req, res) {
    const { date } = { ...req.query, ...req.body };
    const scraper = new Scraper();

    try {
      const data = await scraper.fetchJadwal();
      if (date) {
        const filtered = scraper.filterByDate(data.jadwal, date.trim());
        return res.json({
          status: true,
          result: filtered
        });
      }
      return res.json({
        status: true,
        result: data
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal mendapatkan jadwal sepakbola"
      });
    }
  }
};
