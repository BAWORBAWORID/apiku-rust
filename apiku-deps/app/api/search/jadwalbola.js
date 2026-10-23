import axios from "axios";
import * as cheerio from "cheerio";
import logger from "../../src/utils/logger.js";

async function fetchJadwalSepakbola() {
  const url = "https://www.jadwaltv.net/jadwal-sepakbola";
  logger.info(`[JADWAL BOLA] Fetching football schedules from: ${url}`);

  const { data } = await axios.get(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    timeout: 10000,
  });

  const $ = cheerio.load(data);
  const result = [];

  $("table.table-bordered tbody tr").each((_, el) => {
    const cells = $(el).find("td");
    if (cells.length === 4) {
      const date = $(cells[0]).text().trim();
      const time = $(cells[1]).text().trim();
      const match = $(cells[2]).text().trim();
      const competition = $(cells[3]).text().trim();

      if (
        date &&
        time &&
        match &&
        competition &&
        date.toLowerCase() !== "tanggal" &&
        time.toLowerCase() !== "jam" &&
        !match.includes("JadwalTV.Net") &&
        !$(el).hasClass("jkllv")
      ) {
        result.push({
          date,
          time,
          match,
          competition,
        });
      }
    }
  });

  return {
    title: "Jadwal Sepakbola Hari Ini",
    url,
    schedules: result,
  };
}

export default {
  name: "Jadwal Sepakbola",
  description: "Dapatkan jadwal acara siaran langsung sepakbola hari ini.",
  category: "Search",
  methods: ["GET"],
  params: [],

  async run(req, res) {
    try {
      const result = await fetchJadwalSepakbola();

      res.json({
        status: true,
        result,
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error(`Jadwal Sepakbola API Error: ${err.message}`);
      res.status(500).json({
        status: false,
        message: err.message || "Gagal mendapatkan jadwal sepakbola",
        timestamp: Date.now(),
      });
    }
  },
};
