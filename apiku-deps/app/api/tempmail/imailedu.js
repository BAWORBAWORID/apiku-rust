import * as cheerio from "cheerio";
import logger from "../../src/utils/logger.js";
import { apiCache } from "../../src/utils/apiCache.js";

const BASE_URL = "https://imail.edu.vn";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const AVAILABLE_DOMAINS = [
  "imail.edu.vn",
  "gddp2018.edu.vn",
  "mailo.edu.pl",
  "nik.edu.pl",
  "apple.edu.pl",
  "itmo.edu.pl",
  "mailer.edu.pl",
  "jakarta.io.vn",
  "newdelhi.io.vn",
  "mailer.io.vn",
  "newyork.io.vn",
  "dulieu.io.vn"
];

// In-memory session store (TTL 30 Menit)
const sessionStore = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 Menit

function saveSessionCookie(email, sessionString) {
  if (!email || !sessionString) return;
  const key = email.toLowerCase();
  sessionStore.set(key, {
    session: sessionString,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  // Juga simpan ke apiCache sistem (1800 detik / 30 menit)
  try {
    apiCache.set(`imailedu_sess_${key}`, sessionString, 1800);
  } catch (e) {}
}

function getSessionCookie(email) {
  if (!email) return null;
  const key = email.toLowerCase();
  
  // Cek local Map terlebih dahulu
  const cached = sessionStore.get(key);
  if (cached) {
    if (Date.now() < cached.expiresAt) {
      return cached.session;
    } else {
      sessionStore.delete(key);
    }
  }

  // Fallback cek apiCache
  try {
    const fromApiCache = apiCache.get(`imailedu_sess_${key}`);
    if (fromApiCache) return fromApiCache;
  } catch (e) {}

  return null;
}

// Helper to extract cookie headers into a Map
function parseCookieHeaders(headers) {
  const cookieMap = {};
  let setCookies = [];
  if (typeof headers.getSetCookie === "function") {
    setCookies = headers.getSetCookie();
  } else {
    const raw = headers.get("set-cookie") || "";
    setCookies = raw.split(/,\s*(?=[A-Za-z0-9_-]+=|XSRF-TOKEN=|_session=|email=|emails=)/);
  }
  for (const item of setCookies) {
    if (!item) continue;
    const parts = item.split(";")[0].split("=");
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join("=").trim();
      if (key && val && key !== "path" && key !== "expires" && key !== "Max-Age" && key !== "samesite") {
        cookieMap[key] = val;
      }
    }
  }
  return cookieMap;
}

function buildCookieString(cookieMap) {
  return Object.entries(cookieMap)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function extractLivewireComponent(html, componentName) {
  const matches = html.match(/wire:initial-data="([^"]+)"/g) || [];
  for (const str of matches) {
    try {
      const jsonStr = str.replace(/wire:initial-data="/, "").replace(/\"$/, "").replace(/&quot;/g, "\"");
      const d = JSON.parse(jsonStr);
      if (d.fingerprint && d.fingerprint.name === componentName) {
        return d;
      }
    } catch (e) {
      continue;
    }
  }
  return null;
}

async function createEmail(customUser = null, customDomain = null) {
  // 1. Visit homepage to grab cookies & csrf token
  const r1 = await fetch(BASE_URL + "/", {
    method: "GET",
    headers: { "User-Agent": USER_AGENT }
  });

  if (!r1.ok) {
    throw new Error(`Gagal menghubungi server imail.edu.vn (HTTP ${r1.status})`);
  }

  const cookieMap = parseCookieHeaders(r1.headers);
  const html = await r1.text();
  const $ = cheerio.load(html);

  const csrfToken = $('meta[name="csrf-token"]').attr("content") || $('input[name="_token"]').val();
  const component = extractLivewireComponent(html, "frontend.actions");

  if (!component || !csrfToken) {
    throw new Error("Gagal menginisialisasi komponen Livewire dari imail.edu.vn");
  }

  // 2. Determine username and domain
  let user = (customUser && customUser.trim()) ? customUser.trim() : Math.random().toString(36).substring(2, 10);
  let domain = (customDomain && customDomain.trim()) ? customDomain.trim() : AVAILABLE_DOMAINS[Math.floor(Math.random() * AVAILABLE_DOMAINS.length)];

  if (!AVAILABLE_DOMAINS.includes(domain)) {
    domain = "imail.edu.vn";
  }

  // 3. Send Livewire create action
  const payload = {
    fingerprint: component.fingerprint,
    serverMemo: component.serverMemo,
    updates: [
      {
        type: "syncInput",
        payload: { id: "u1", name: "user", value: user }
      },
      {
        type: "syncInput",
        payload: { id: "u2", name: "domain", value: domain }
      },
      {
        type: "callMethod",
        payload: { id: "test1", method: "create", params: [] }
      }
    ]
  };

  const r2 = await fetch(BASE_URL + "/livewire/message/frontend.actions", {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
      "X-Livewire": "true",
      "X-CSRF-TOKEN": csrfToken,
      "Cookie": buildCookieString(cookieMap)
    },
    body: JSON.stringify(payload)
  });

  if (!r2.ok) {
    throw new Error(`Gagal membuat email melalui Livewire (HTTP ${r2.status})`);
  }

  const updatedCookies = parseCookieHeaders(r2.headers);
  Object.assign(cookieMap, updatedCookies);

  const resData = await r2.json();
  const email = resData?.serverMemo?.data?.email || `${user}@${domain}`;
  const fullSession = buildCookieString(cookieMap);

  // Simpan cookie sesi secara lokal (30 menit) agar cek inbox cukup input username/email & domain
  saveSessionCookie(email, fullSession);

  return {
    email,
    user,
    domain,
    session: fullSession,
    token: cookieMap["_session"] || null
  };
}

async function checkInbox(sessionString) {
  if (!sessionString) {
    throw new Error("Parameter 'session' wajib disertakan untuk mengecek inbox");
  }

  let cookieStr = sessionString;
  if (!cookieStr.includes("=")) {
    cookieStr = `_session=${sessionString}`;
  }

  const r = await fetch(BASE_URL + "/mailbox", {
    method: "GET",
    headers: {
      "User-Agent": USER_AGENT,
      "Cookie": cookieStr
    }
  });

  if (!r.ok) {
    throw new Error(`Gagal memuat kotak masuk dari server imail.edu.vn (HTTP ${r.status})`);
  }

  const html = await r.text();
  const component = extractLivewireComponent(html, "frontend.app");

  if (!component || !component.serverMemo?.data) {
    throw new Error("Gagal memuat pesan dari sesi yang diberikan atau sesi telah kedaluwarsa.");
  }

  const data = component.serverMemo.data;
  const messages = Array.isArray(data.messages) ? data.messages : [];

  return {
    email: data.email || null,
    total: messages.length,
    messages: messages.map(msg => ({
      id: msg.id || msg.uid,
      from: msg.from || msg.sender || "Unknown",
      subject: msg.subject || "(No Subject)",
      date: msg.date || msg.created_at || new Date().toISOString(),
      body: msg.body || msg.content || msg.text || null
    }))
  };
}

export default {
  name: "iMail Edu VN (.edu.vn Tempmail)",
  description: "Create temporary education email address (.edu.vn, .edu.pl, .io.vn) with custom name/domain support, and check inbox automatically via local cookie memory (30m expiry)",
  category: "Email",
  methods: ["GET", "POST"],
  params: ["action", "sessionId", "domain"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      default: "create",
      enum: ["create", "inbox", "domains"],
      description: "Aksi: create (buat email baru), inbox (cek pesan masuk), atau domains (lihat daftar domain)"
    },
    sessionId: {
      type: "string",
      required: false,
      default: "mahasiswa2026",
      description: "Session ID / Custom Username email (contoh: mahasiswa2026). Otomatis tersimpan di memori lokal 30 menit."
    },
    domain: {
      type: "string",
      required: false,
      default: "imail.edu.vn",
      enum: AVAILABLE_DOMAINS,
      description: "Custom domain untuk email saat action=create (default: imail.edu.vn)"
    }
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const input = { ...req.query, ...req.body };
      const { action, sessionId, name, username, domain, email, session, token, cookie } = input;
      const act = (action || "create").toLowerCase();

      if (act === "domains") {
        return res.json({
          status: true,
          action: "domains",
          total: AVAILABLE_DOMAINS.length,
          result: AVAILABLE_DOMAINS
        });
      }

      if (act === "create") {
        const customUser = sessionId || name || username || null;
        const customDomain = domain || null;

        const result = await createEmail(customUser, customDomain);
        const duration = Date.now() - startTime;

        res.setHeader("X-Generated-In", `${duration}ms`);
        return res.json({
          status: true,
          action: "create",
          sessionId: result.user,
          result: {
            email: result.email,
            username: result.user,
            domain: result.domain,
            expiresIn: "30 Menit (Otomatis tersimpan di memori lokal untuk cek inbox)",
            session: result.session,
            note: `Untuk mengecek inbox, cukup gunakan action=inbox&sessionId=${result.user}&domain=${result.domain} atau action=inbox&sessionId=${result.email}`
          }
        });
      }

      if (act === "inbox") {
        let sess = session || token || cookie;
        const identifier = sessionId || email || name || username;

        if (!sess && identifier) {
          sess = getSessionCookie(identifier);
          if (!sess && !identifier.includes("@")) {
            const fullEmail = `${identifier}@${domain || "imail.edu.vn"}`;
            sess = getSessionCookie(fullEmail);
          }
        }

        if (!sess) {
          return res.status(404).json({
            status: false,
            message: identifier
              ? `Session untuk '${identifier}' tidak ditemukan di memori lokal atau telah kedaluwarsa (> 30 menit). Silakan buat email baru terlebih dahulu dengan action=create.`
              : "Parameter 'sessionId' (atau 'email' / 'session') wajib disertakan untuk mengecek inbox."
          });
        }

        const result = await checkInbox(sess);
        const duration = Date.now() - startTime;

        res.setHeader("X-Generated-In", `${duration}ms`);
        return res.json({
          status: true,
          action: "inbox",
          sessionId: identifier || result.email || "local_cookie",
          result
        });
      }

      return res.status(400).json({
        status: false,
        message: "Action tidak valid. Gunakan: create / inbox / domains"
      });
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[iMailEdu] Error after ${duration}ms: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses layanan imail.edu.vn"
      });
    }
  }
};
