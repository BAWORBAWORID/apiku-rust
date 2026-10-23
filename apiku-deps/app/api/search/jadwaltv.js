import axios from "axios";
import * as cheerio from "cheerio";
import logger from "../../src/utils/logger.js";

const CHANNELS = {
  tvri: "tvri",
  antv: "antv",
  transtv: "transtv",
  gtv: "gtv",
  indosiar: "indosiar",
  inewstv: "inewstv",
  kompastv: "kompastv",
  moji: "moji",
  rtv: "rtv",
  rctv: "rtv", // Alias rctv -> rtv
  rcti: "rcti",
  sctv: "sctv",
  tvone: "tvone",
  trans7: "trans7",
  metrotv: "metrotv",
  mnctv: "mnctv",
};

async function fetchJadwalTV(channel) {
  const cleanChannel = channel.toLowerCase().trim();
  const targetChannel = CHANNELS[cleanChannel];

  if (!targetChannel) {
    throw new Error(
      `Channel '${channel}' tidak didukung. Channel yang tersedia: ${Object.keys(CHANNELS).filter(c => c !== "rctv").join(", ")}`
    );
  }

  const url = `https://www.jadwaltv.net/channel/${targetChannel}`;
  logger.info(`[JADWALTV] Fetching schedule from: ${url}`);

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
    if (cells.length === 2) {
      const time = $(cells[0]).text().trim();
      const event = $(cells[1]).text().trim();

      if (
        time &&
        event &&
        time.toLowerCase() !== "jam" &&
        event.toLowerCase() !== "acara" &&
        !event.includes("JadwalTV.Net") &&
        !$(el).hasClass("jkllv")
      ) {
        result.push({
          time,
          event,
        });
      }
    }
  });

  if (result.length === 0) {
    throw new Error(`Gagal mendapatkan jadwal acara untuk channel ${channel}.`);
  }

  return {
    channel: targetChannel,
    title: `Jadwal ${targetChannel.toUpperCase()} Hari Ini`,
    url,
    schedule: result,
  };
}

export default {
  name: "Jadwal TV",
  description: "Dapatkan jadwal acara TV nasional hari ini.",
  category: "Search",
  methods: ["GET"],
  params: ["channel"],

  paramsSchema: {
    channel: {
      type: "string",
      required: true,
      description: "Nama channel TV (e.g. rcti, sctv, transtv, rtv, gtv, dll)",
      enum: Object.keys(CHANNELS),
    },
  },

  async run(req, res) {
    try {
      const { channel } = req.query || {};

      if (!channel || typeof channel !== "string" || channel.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'channel' wajib diisi",
          available_channels: Object.keys(CHANNELS).filter(c => c !== "rctv"),
        });
      }

      const cleanChannel = channel.toLowerCase().trim();
      if (!CHANNELS[cleanChannel]) {
        return res.status(400).json({
          status: false,
          message: `Channel '${channel}' tidak ditemukan`,
          available_channels: Object.keys(CHANNELS).filter(c => c !== "rctv"),
        });
      }

      const result = await fetchJadwalTV(cleanChannel);

      res.json({
        status: true,
        result,
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error(`Jadwal TV API Error: ${err.message}`);
      res.status(500).json({
        status: false,
        message: err.message || "Gagal mendapatkan jadwal TV",
        timestamp: Date.now(),
      });
    }
  },
};
