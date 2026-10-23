/**
 * NGL Send Message Tool - Simplified Version
 * GET /tools/ngl-send?url=NGL_URL&question=TEXT&count=1&delay=5
 */

import axios from "axios";

/* ===============================
   UTILITIES
================================ */
function generateDeviceId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function validateNglUrl(urlString) {
  try {
    const parsed = new URL(urlString);

    if (!parsed.hostname.endsWith("ngl.link")) {
      throw new Error("Invalid NGL URL (domain must be ngl.link)");
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    const username = parts.pop();

    if (!username) {
      throw new Error("Invalid NGL URL (username not found)");
    }

    return { username, fullUrl: urlString };
  } catch (error) {
    throw new Error("Invalid URL format");
  }
}

function validateQuestion(question) {
  if (!question || !question.trim()) {
    throw new Error("Question cannot be empty");
  }
  if (question.length > 1000) {
    throw new Error("Question too long (max 1000 chars)");
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ===============================
   DELAY ENUM CONVERTER
================================ */
function parseDelay(delayParam) {
  const delayMap = {
    "2": 2000,
    "5": 5000,
    "10": 10000,
    "20": 20000,
    "30": 30000,
  };

  // Convert to string and check if valid
  const delayStr = String(delayParam).trim();
  
  if (!Object.prototype.hasOwnProperty.call(delayMap, delayStr)) {
    throw new Error("Invalid delay value. Allowed values: 2, 5, 10, 20, 30 seconds");
  }

  return delayMap[delayStr];
}

/* ===============================
   CORE SEND ONCE
================================ */
async function sendOnce(question, url) {
  validateQuestion(question);
  const { username, fullUrl } = validateNglUrl(url);

  const payload = new URLSearchParams({
    username,
    question,
    deviceId: generateDeviceId(),
    gameSlug: "",
    referrer: "",
  });

  const res = await axios.post(
    "https://ngl.link/api/submit",
    payload.toString(),
    {
      timeout: 30000,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": fullUrl,
        "Origin": "https://ngl.link",
        "Accept": "*/*",
        "X-Requested-With": "XMLHttpRequest",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
      },
    }
  );

  return {
    ok: true,
    response: res.data,
    sentAt: new Date().toISOString(),
  };
}

/* ===============================
   BACKGROUND PROCESS
================================ */
async function runBackgroundProcess(question, url, count, delayMs) {
  const results = [];
  
  for (let i = 0; i < count; i++) {
    try {
      // Send message
      const r = await sendOnce(question, url);
      results.push({
        attempt: i + 1,
        status: "success",
        sentAt: r.sentAt,
      });
    } catch (err) {
      results.push({
        attempt: i + 1,
        status: "failed",
        error: err.message,
      });
      break; // Stop if failed
    }

    // Delay between sends (except for last iteration)
    if (i < count - 1) {
      await sleep(delayMs);
    }
  }

  return results;
}

/* ===============================
   EXPORT TOOL
================================ */
export default {
  name: "NGL Send Message",
  description: "Kirim pesan ke NGL dengan pengaturan delay enum dan background processing",
  category: "Tools",
  methods: ["GET"],

  params: ["url", "question", "count"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL profil NGL (harus ngl.link)",
      example: "https://ngl.link/username",
    },
    question: {
      type: "string",
      required: true,
      description: "Pesan/pertanyaan yang akan dikirim (max 1000 karakter)",
      example: "Halo, apa kabar?",
    },
    count: {
      type: "number",
      required: true,
      default: 100,
      description: "Jumlah kirim pesan (min 1, max 10000)",
      example: 100,
      minimum: 1,
      maximum: 10000,
    },
  },

  async run(req, res) {
    try {
      const { url, question, count } = { ...req.query, ...req.body };

      if (!url || !question) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' dan 'question' wajib diisi",
        });
      }

      const c = parseInt(count, 10);
      if (isNaN(c) || c < 1) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'count' harus angka minimal 1",
        });
      }
      if (c > 10000) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'count' maksimal 10000",
        });
      }

      const DELAY_MS = 2000;

      setTimeout(async () => {
        try {
          await runBackgroundProcess(question, url, c, DELAY_MS);
        } catch (error) {
          console.error("Background NGL error:", error.message);
        }
      }, 0);

      return res.json({
        status: true,
        result: {
          totalMessages: c,
          delay: "2 detik",
          estimatedTime: `${((c * DELAY_MS) / 60000).toFixed(1)} menit`,
          note: "Proses berjalan di latar belakang",
        },
      });

    } catch (err) {
      return res.status(400).json({
        status: false,
        message: err.message || "Gagal memulai proses NGL",
      });
    }
  },
};