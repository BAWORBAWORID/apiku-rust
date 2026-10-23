import https from "https";
import http from "http";
import { URL } from "url";

const PLATFORMS = [
  { id: "facebook", name: "Facebook", mode: "both" },
  { id: "instagram", name: "Instagram", mode: "both" },
  { id: "threads", name: "Threads", mode: "phone" },
  { id: "twitter", name: "Twitter / X", mode: "phone" },
  { id: "ws", name: "WhatsApp", mode: "phone" },
  { id: "viber", name: "Viber", mode: "phone" },
  { id: "zalo", name: "Zalo", mode: "phone" },
  { id: "vk", name: "VK", mode: "phone" },
  { id: "shopee", name: "Shopee", mode: "phone" },
  { id: "telegram", name: "Telegram", mode: "phone" },
  { id: "apple", name: "Apple", mode: "both" },
  { id: "amazon", name: "Amazon", mode: "both" },
  { id: "microsoft", name: "Microsoft", mode: "phone" },
  { id: "netflix", name: "Netflix", mode: "email" },
  { id: "spotify", name: "Spotify", mode: "email" },
  { id: "band", name: "Band (KR)", mode: "phone" },
  { id: "goto", name: "GoTo (ID)", mode: "phone" },
  { id: "indiatimes", name: "Indiatimes (IN)", mode: "phone" },
  { id: "hh", name: "HH (RU)", mode: "phone" },
];

function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededBool(seed, bias) {
  return (seed % 100) < bias * 100;
}

function normalizePhone(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return value.startsWith("+") ? "+" + digits : "+" + digits;
}

function computeScoreAndTag(hits, total) {
  const base = Math.round((hits / total) * 1000);
  const score = Math.max(140, Math.min(980, base));
  let risk = "LOW RISK";
  if (score < 350) risk = "HIGH RISK";
  else if (score < 620) risk = "MEDIUM RISK";
  return { score, risk };
}

async function checkEkyc(inputTarget) {
  if (!inputTarget || typeof inputTarget !== "string" || !inputTarget.trim()) {
    throw new Error("Masukkan nomor telepon atau email target!");
  }

  const raw = inputTarget.trim();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
  const mode = isEmail ? "email" : "phone";
  const identifier = isEmail ? raw.toLowerCase() : normalizePhone(raw);

  if (!isEmail) {
    const digits = identifier.replace(/\D/g, "");
    if (digits.length < 6 || digits.length > 16) {
      throw new Error("Nomor telepon tidak valid! Panjang nomor minimal 6 sampai 16 digit.");
    }
  }

  const relevant = PLATFORMS.filter((p) => p.mode === "both" || p.mode === mode);
  const bias = 0.62;
  let hits = 0;

  const platforms = relevant.map((p) => {
    const seed = hash(identifier + ":" + p.id);
    const registered = seededBool(seed, bias);
    if (registered) hits++;
    return {
      id: p.id,
      name: p.name,
      registered,
      status: registered ? "registered" : "not found",
    };
  });

  const { score, risk } = computeScoreAndTag(hits, relevant.length);

  return {
    status: true,
    type: mode,
    identifier,
    score,
    risk,
    summary: `${hits} of ${relevant.length} platforms matched`,
    matched_count: hits,
    total_platforms: relevant.length,
    platforms,
  };
}

export default {
  name: "eKYC Pro Checker",
  description: "Cek nomor telepon/email di berbagai platform (Facebook, Instagram, WhatsApp, dll) — deterministic mock",
  category: "Tools",
  methods: ["GET", "POST"],
  params: ["query"],
  paramsSchema: {
    query: { type: "string", required: true, description: "Nomor telepon atau email (auto-detect)", example: "08123456789 atau user@example.com" },
  },
  async run(req, res) {
    try {
      const { query } = { ...req.query, ...req.body };
      if (!query) return res.status(400).json({ success: false, error: "Parameter 'query' wajib diisi" });
      const data = await checkEkyc(query);
      res.json(data);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  },
};