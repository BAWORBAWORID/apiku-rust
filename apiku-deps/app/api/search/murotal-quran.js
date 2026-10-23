import axios from "axios";
import logger from "../../src/utils/logger.js";

const MUROTAL_TXT = "https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/murotal-list.txt";
const SURAT_TXT = "https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/surat-list-sds.txt";
const BASE = "https://www.mp3quran.net";
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

const client = axios.create({
  timeout: 15000,
  headers: {
    "user-agent": UA,
    "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7"
  },
  validateStatus: () => true
});

let murotalCache = null;
let suratCache = null;

function normalize(str = "") {
  return String(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[''`´']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, "")
    .trim();
}

function levenshtein(a, b) {
  a = normalize(a);
  b = normalize(b);
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function score(input, target) {
  const a = normalize(input);
  const b = normalize(target);
  if (!a || !b) return 999999;
  if (a === b) return 0;
  if (b.includes(a) || a.includes(b)) return 1;
  return levenshtein(a, b) / Math.max(a.length, b.length, 1);
}

function findBest(input, list, keys) {
  let best = null;
  for (const item of list) {
    const values = keys.map(k => item[k]).filter(Boolean);
    const current = Math.min(...values.map(v => score(input, v)));
    if (!best || current < best.score) best = { score: current, item };
  }
  return best;
}

function parseMurotalList(text) {
  const blocks = text.split(/\n(?=\d+\.\s+)/g).map(x => x.trim()).filter(Boolean);
  return blocks.map(block => {
    const name = block.match(/^\d+\.\s+(.+)$/m)?.[1]?.trim() || null;
    const slug = block.match(/^\s*Slug:\s*(.+)$/m)?.[1]?.trim() || null;
    return { name, slug };
  }).filter(x => x.name && x.slug);
}

function parseSuratList(text) {
  const lines = text.split(/\r?\n/g).map(x => x.trim()).filter(Boolean);
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const simple = line.match(/^(\d{3})\.\s*(.+?)\s*\|\s*(https?:\/\/\S+)$/);
    const detail = line.match(/^(\d{3})\.\s*(.+)$/);
    if (simple) {
      const name = simple[2].trim();
      result.push({
        number: simple[1],
        name,
        clean_name: name.replace(/\s*\(.+?\)\s*$/g, "").trim(),
        meaning: name.match(/\((.+?)\)\s*$/)?.[1]?.trim() || null,
        download: simple[3].trim()
      });
      continue;
    }
    if (detail) {
      const number = detail[1];
      const name = detail[2].trim();
      const next = lines.slice(i + 1, i + 5);
      const downloadLine = next.find(x => /^(Download|Audio):\s*/i.test(x));
      const download = downloadLine?.replace(/^(Download|Audio):\s*/i, "").trim() || null;
      if (download && /^https?:\/\//i.test(download)) {
        result.push({
          number,
          name,
          clean_name: name.replace(/\s*\(.+?\)\s*$/g, "").trim(),
          meaning: name.match(/\((.+?)\)\s*$/)?.[1]?.trim() || null,
          download
        });
      }
    }
  }
  const unique = [];
  const seen = new Set();
  for (const item of result) {
    if (seen.has(item.number)) continue;
    seen.add(item.number);
    unique.push(item);
  }
  return unique;
}

async function loadLists() {
  if (murotalCache && suratCache) return;
  const [mRes, sRes] = await Promise.all([
    client.get(MUROTAL_TXT, { responseType: "text" }),
    client.get(SURAT_TXT, { responseType: "text" })
  ]);
  if (mRes.status >= 200 && mRes.status < 300) {
    murotalCache = parseMurotalList(String(mRes.data));
  }
  if (sRes.status >= 200 && sRes.status < 300) {
    suratCache = parseSuratList(String(sRes.data));
  }
  if (!murotalCache?.length) throw new Error("Gagal memuat daftar murotal");
  if (!suratCache?.length) throw new Error("Gagal memuat daftar surat");
}

export default {
  name: "Murotal Quran",
  description: "Search and stream Quran recitation audio by reciter and surah",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["murotal", "surat"],
  paramsSchema: {
    murotal: {
      type: "string",
      required: true,
      description: "Nama qari / reciter (fuzzy search, misal: abdul rahman sudais, mishary rashid)",
      example: "abdul rahman sudais"
    },
    surat: {
      type: "string",
      required: true,
      description: "Nama surat atau nomor surat (misal: al-waqiah, 56)",
      example: "al-waqiah"
    }
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const data = { ...req.query, ...req.body };
      const murotalInput = data.murotal || data.qari || data.reciter || "";
      const suratInput = data.surat || data.surah || data.ayat || "";

      if (!murotalInput || !suratInput) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'murotal' dan 'surat' wajib diisi"
        });
      }

      await loadLists();

      const murotalMatch = findBest(murotalInput, murotalCache, ["name", "slug"]);
      if (!murotalMatch?.item) {
        return res.status(404).json({
          status: false,
          message: "Qari tidak ditemukan"
        });
      }

      let suratMatch;
      if (/^\d+$/.test(suratInput)) {
        suratMatch = { score: 0, item: suratCache.find(x => Number(x.number) === Number(suratInput)) };
      } else {
        suratMatch = findBest(suratInput, suratCache, ["name", "clean_name", "meaning", "number"]);
      }

      if (!suratMatch?.item) {
        return res.status(404).json({
          status: false,
          message: "Surat tidak ditemukan"
        });
      }

      const audioRes = await client.get(suratMatch.item.download, {
        responseType: "stream",
        headers: { referer: BASE, range: "bytes=0-" }
      });

      if (audioRes.status < 200 || audioRes.status >= 300) {
        throw new Error("Gagal memuat audio dari upstream");
      }

      const duration = Date.now() - startTime;
      res.setHeader("Content-Type", audioRes.headers["content-type"] || "audio/mpeg");
      res.setHeader("Content-Length", audioRes.headers["content-length"] || "");
      res.setHeader("X-Generated-In", `${duration}ms`);
      res.setHeader("X-Qari", encodeURIComponent(murotalMatch.item.name));
      res.setHeader("X-Surat", encodeURIComponent(suratMatch.item.name));
      audioRes.data.pipe(res);
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[MUROTAL-QURAN] Error after ${duration}ms: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal mengambil data murotal"
      });
    }
  }
};
