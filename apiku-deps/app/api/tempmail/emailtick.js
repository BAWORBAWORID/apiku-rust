/**
 * EmailTick API - Using emailtick.com (Create & Inbox)
 * GET /api/tempmail/emailtick?sessionId=user123&action=create
 * GET /api/tempmail/emailtick?sessionId=user123&action=inbox
 */

import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import logger from "../../src/utils/logger.js";

const BASE = "https://www.emailtick.com";
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";
const MAX_AGE = 24 * 60 * 60 * 1000; // 24 jam

const SESSION_DIR = path.join(process.cwd(), "data");
const SESSION_FILE = path.join(SESSION_DIR, "emailtick_session.json");

// In-Memory Session Map
const sessionMap = new Map();

// Load sessions from disk on startup
function loadSessionsFromDisk() {
  try {
    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
    if (fs.existsSync(SESSION_FILE)) {
      const raw = fs.readFileSync(SESSION_FILE, "utf-8");
      const data = JSON.parse(raw);
      const now = Date.now();
      for (const [sid, sess] of Object.entries(data)) {
        if (now - (sess.createdAt || 0) < MAX_AGE) {
          sessionMap.set(sid, sess);
        }
      }
    }
  } catch (e) {
    logger.warn(`Failed to load emailtick sessions: ${e.message}`);
  }
}
loadSessionsFromDisk();

// Save sessions to disk
function saveSessionsToDisk() {
  try {
    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
    const obj = Object.fromEntries(sessionMap);
    fs.writeFileSync(SESSION_FILE + ".tmp", JSON.stringify(obj, null, 2), "utf-8");
    fs.renameSync(SESSION_FILE + ".tmp", SESSION_FILE);
  } catch (e) {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeSetCookie(setCookieHeader) {
  if (!setCookieHeader) return [];
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  return arr.map((v) => String(v).split(";")[0]).filter(Boolean);
}

function mergeCookies(oldCookies, newCookies) {
  const map = new Map();
  for (const c of oldCookies) {
    const [k, ...r] = c.split("=");
    map.set(k.trim(), `${k.trim()}=${r.join("=")}`);
  }
  for (const c of newCookies) {
    const [k, ...r] = c.split("=");
    map.set(k.trim(), `${k.trim()}=${r.join("=")}`);
  }
  return [...map.values()];
}

function cookieHeader(cookies) {
  return cookies.length ? cookies.join("; ") : "";
}

async function request(method, url, { cookies = [], headers = {}, data, referer } = {}) {
  const res = await axios({
    method,
    url,
    headers: {
      "user-agent": UA,
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9,id;q=0.8",
      referer: referer ?? `${BASE}/`,
      ...(cookies.length ? { cookie: cookieHeader(cookies) } : {}),
      ...headers,
    },
    data,
    timeout: 25000,
    validateStatus: () => true,
    transformResponse: [(d) => d],
  });

  const text = typeof res.data === "string" ? res.data : String(res.data ?? "");
  const setCookie = normalizeSetCookie(res.headers["set-cookie"]);
  const finalUrl = res.request?.res?.responseUrl;

  return { status: res.status, text, setCookie, finalUrl };
}

function parseHome(html) {
  const $ = cheerio.load(html);
  const mailbox = $("#mailbox").val() || null;
  const salt = $("#salt").val() || null;
  return { mailbox, salt };
}

function parseInbox(html) {
  const $ = cheerio.load(html);
  const msgs = [];

  $("table tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 3) return;

    const sender = $(tds[0]).text().trim();
    const subjectTd = $(tds[1]);
    const subject = subjectTd.text().trim();
    const time = $(tds[2]).text().trim();

    const link = subjectTd.find("a").attr("href") || null;
    const code = link?.match(/\/mailbox\/code\/([a-z0-9]+)/i)?.[1] || null;

    if (!code) return;
    if ((sender + " " + subject).toLowerCase().includes("inbox is empty")) return;

    msgs.push({
      sender: sender || "Unknown Sender",
      subject: subject || "(No Subject)",
      time,
      link,
      code,
    });
  });

  return msgs;
}

function cleanEmailHtml(html) {
  if (!html) return "";
  let h = html.trim();
  const $ = cheerio.load(h);
  const wrappers = $(".email-content");
  if (wrappers.length >= 2) {
    h = $.html(wrappers.last());
  }
  return h.trim();
}

function htmlToText(html) {
  if (!html) return "";
  const $ = cheerio.load(html);
  return $.root().text().replace(/\s+/g, " ").trim();
}

function looksLikeHtmlPage(s) {
  const t = (s || "").trim().toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html") || t.includes("<head");
}

async function activateMailbox({ cookies, mailbox }) {
  const r = await request("POST", `${BASE}/index/index/goactive.html`, {
    cookies,
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      origin: BASE,
      accept: "application/json, text/plain, */*",
    },
    data: new URLSearchParams({ mailbox }).toString(),
  });

  const raw = r.text.trim();
  let ok = raw === "1";
  if (!ok) {
    try {
      ok = JSON.parse(raw) === 1;
    } catch {}
  }

  return { ok, setCookie: r.setCookie, rawPreview: raw.slice(0, 120) };
}

async function checkMail({ cookies, mailbox, salt }) {
  const r = await request("POST", `${BASE}/index/index/checkmail.html`, {
    cookies,
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      origin: BASE,
      accept: "application/json, text/plain, */*",
    },
    data: new URLSearchParams({ box: mailbox, salt }).toString(),
  });

  return { raw: r.text.trim(), setCookie: r.setCookie };
}

async function warmUpDetail({ cookies, detailUrl }) {
  const r = await request("GET", detailUrl, { cookies, referer: `${BASE}/` });
  return { setCookie: r.setCookie };
}

async function fetchMailContent({ cookies, code, detailUrl, retries = 2 }) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const r = await request("POST", `${BASE}/index/index/mailcontent.html`, {
      cookies,
      referer: detailUrl,
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        origin: BASE,
        accept: "application/json, text/plain, */*",
      },
      data: new URLSearchParams({ code }).toString(),
    });

    const raw = r.text.trim();
    if (looksLikeHtmlPage(raw)) {
      if (attempt < retries) {
        await sleep(600);
        continue;
      }
      return { ok: false, error: "HTML error page returned" };
    }
    let j;
    try {
      j = JSON.parse(raw);
    } catch {
      if (attempt < retries) {
        await sleep(600);
        continue;
      }
      return { ok: false, error: "Invalid JSON" };
    }

    if (j.status === 0) {
      return { ok: false, error: j.msg || "status=0" };
    }

    const contentHtml = j?.msg?.content || "";
    const attachments = Array.isArray(j?.msg?.attachments) ? j.msg.attachments : [];
    const bodyHtml = cleanEmailHtml(contentHtml);
    const bodyText = htmlToText(bodyHtml);

    return { ok: true, bodyHtml, bodyText, attachments };
  }

  return { ok: false, error: "Unknown" };
}

export default {
  name: "TempMail - EmailTick (emailtick.com)",
  description: "Temporary email service (create, inbox)",
  category: "Email",
  methods: ["GET", "POST"],
  params: ["sessionId", "action"],
  paramsSchema: {
    sessionId: {
      type: "string",
      required: true,
      description: "Session ID untuk menyimpan email (custom)",
    },
    action: {
      type: "string",
      required: true,
      description: "'create' untuk generate email baru, 'inbox' untuk cek pesan masuk",
    },
  },

  async run(req, res) {
    const sessionId = (req.method === "POST" ? req.body.sessionId : req.query.sessionId) || "";
    const action = (req.method === "POST" ? req.body.action : req.query.action) || "";

    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({
        status: "error",
        message: "Parameter 'sessionId' wajib diisi (string).",
      });
    }

    if (!action || !["create", "inbox"].includes(action)) {
      return res.status(400).json({
        status: "error",
        message: "Parameter 'action' harus berupa 'create' atau 'inbox'.",
      });
    }

    // CREATE ACTION
    if (action === "create") {
      if (sessionMap.has(sessionId)) {
        const existing = sessionMap.get(sessionId);
        if (Date.now() - (existing.createdAt || 0) < MAX_AGE) {
          return res.status(200).json({
            status: "success",
            sessionId,
            email: existing.mailbox,
            action: "create",
            message: "Menggunakan sesi email yang sudah ada (aktif 24 jam).",
          });
        }
      }

      let cookies = [];
      const home1 = await request("GET", `${BASE}/`, { cookies });
      cookies = mergeCookies(cookies, home1.setCookie);

      const { mailbox, salt } = parseHome(home1.text);
      if (!mailbox || !salt) {
        return res.status(502).json({
          status: "error",
          message: "Gagal menemukan mailbox/salt dari emailtick.com (kemungkinan struktur HTML berubah / diblok).",
        });
      }

      const act = await activateMailbox({ cookies, mailbox });
      cookies = mergeCookies(cookies, act.setCookie);

      if (!act.ok) {
        return res.status(502).json({
          status: "error",
          message: "Aktivasi mailbox emailtick gagal.",
          detail: act.rawPreview,
        });
      }

      sessionMap.set(sessionId, {
        mailbox,
        salt,
        cookies,
        createdAt: Date.now(),
      });
      saveSessionsToDisk();

      return res.status(200).json({
        status: "success",
        sessionId,
        email: mailbox,
        action: "create",
      });
    }

    // INBOX ACTION
    if (action === "inbox") {
      if (!sessionMap.has(sessionId)) {
        return res.status(404).json({
          status: "error",
          message: `Sesi '${sessionId}' tidak ditemukan atau telah kedaluwarsa. Harap panggil action=create terlebih dahulu.`,
        });
      }

      const session = sessionMap.get(sessionId);
      let cookies = session.cookies || [];

      // Checkmail trigger
      const chk = await checkMail({ cookies, mailbox: session.mailbox, salt: session.salt });
      cookies = mergeCookies(cookies, chk.setCookie);

      // Get inbox page
      const home2 = await request("GET", `${BASE}/`, { cookies });
      cookies = mergeCookies(cookies, home2.setCookie);

      const inbox = parseInbox(home2.text);
      const messages = [];

      // Limit fetching content up to 15 latest messages
      for (const msg of inbox.slice(0, 15)) {
        const detailUrl = msg.link ? `${BASE}${msg.link}` : null;
        if (!detailUrl) {
          messages.push({ ...msg, id: msg.code, bodyText: "", bodyHtml: "" });
          continue;
        }
        const warm = await warmUpDetail({ cookies, detailUrl });
        cookies = mergeCookies(cookies, warm.setCookie);
        const content = await fetchMailContent({ cookies, code: msg.code, detailUrl, retries: 2 });
        messages.push({
          id: msg.code,
          sender: msg.sender,
          subject: msg.subject,
          time: msg.time,
          bodyText: content.ok ? content.bodyText : "",
          bodyHtml: content.ok ? content.bodyHtml : "",
          attachments: content.ok ? content.attachments : [],
        });
        await sleep(200);
      }

      // Update stored cookies just in case
      session.cookies = cookies;
      sessionMap.set(sessionId, session);
      saveSessionsToDisk();

      return res.status(200).json({
        status: "success",
        sessionId,
        email: session.mailbox,
        count: messages.length,
        messages,
      });
    }
  },
};
