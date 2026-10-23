import crypto from "node:crypto";
import * as cheerio from "cheerio";

const BASE = "https://generator.email";
const TIMEOUT = 25000;
const RETRIES = 3;
const RETRYABLE = new Set([408, 425, 429, 500, 502, 504]);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function checkLeadingZeros(hexStr, n) {
  let i = 0;
  while (n >= 4) {
    if (hexStr[i] !== "0") return false;
    i++;
    n -= 4;
  }
  if (n === 0) return true;
  return (parseInt(hexStr[i], 16) >> (4 - n)) === 0;
}

export class GeneratorEmailClient {
  constructor() {
    this.cookies = new Map();
  }

  setCookie(name, value) {
    this.cookies.set(name, value);
  }

  getCookie(name) {
    return this.cookies.get(name);
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async solveInterstitial({ log } = {}) {
    log?.("🧩 Anti-bot interstitial terdeteksi, menyelesaikan challenge PoW...");
    const res1 = await fetch(`${BASE}/unblock`, {
      headers: { "User-Agent": UA, Cookie: this.cookieHeader() }
    });
    const getSet1 = res1.headers.getSetCookie?.() ?? [];
    for (const c of getSet1) {
      const [p] = c.split(";");
      const idx = p.indexOf("=");
      if (idx > 0) this.setCookie(p.slice(0, idx).trim(), p.slice(idx + 1).trim());
    }
    const html1 = await res1.text();
    const matchC = html1.match(/var C="([^"]+)"/);
    const matchN = html1.match(/N=(\d+)/);
    if (!matchC) throw new Error("Challenge C tidak ditemukan pada /unblock");
    const C = matchC[1];
    const N = matchN ? parseInt(matchN[1], 10) : 15;

    let x = 0;
    while (true) {
      const hash = crypto.createHash("sha256").update(`${C}:${x}`).digest("hex");
      if (checkLeadingZeros(hash, N)) break;
      x++;
      if (x > 2000000) throw new Error("Batas iterasi PoW terlampaui");
    }

    await fetch(`${BASE}/__ab_sig/0/420`, {
      method: "POST",
      headers: { "User-Agent": UA, Cookie: this.cookieHeader() }
    }).catch(() => {});

    await sleep(1600);

    const verifyUrl = `${BASE}/unblock?c=${encodeURIComponent(C)}&n=${x}&t=${encodeURIComponent("/")}&b=0&z=420&g=1&gm=1550&gp=5`;
    const res2 = await fetch(verifyUrl, {
      headers: { "User-Agent": UA, Cookie: this.cookieHeader(), Referer: `${BASE}/unblock` },
      redirect: "manual"
    });
    const getSet2 = res2.headers.getSetCookie?.() ?? [];
    for (const c of getSet2) {
      const [p] = c.split(";");
      const idx = p.indexOf("=");
      if (idx > 0) this.setCookie(p.slice(0, idx).trim(), p.slice(idx + 1).trim());
    }
    log?.("✅ Anti-bot berhasil di-bypass, session cookie tersimpan.");
  }

  async req(url, { method = "GET", body, headers = {}, log } = {}) {
    let lastErr;
    for (let i = 0; i <= RETRIES; i++) {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), TIMEOUT);
      try {
        const res = await fetch(url, {
          method,
          headers: {
            "User-Agent": UA,
            Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
            Cookie: this.cookieHeader(),
            ...headers
          },
          body,
          signal: ac.signal,
          redirect: "follow",
        });

        const getSet = res.headers.getSetCookie?.() ?? [];
        for (const c of getSet) {
          const [p] = c.split(";");
          const idx = p.indexOf("=");
          if (idx > 0) this.setCookie(p.slice(0, idx).trim(), p.slice(idx + 1).trim());
        }

        const txt = await res.text();
        log?.(`[${res.status}] ${method} ${url.slice(0, 80)} (try ${i + 1})`);

        if ((res.status === 503 || res.headers.get("x-ab-interstitial") === "1" || txt.includes("/unblock")) && !url.includes("/unblock")) {
          await this.solveInterstitial({ log });
          continue;
        }

        if (RETRYABLE.has(res.status) && i < RETRIES) {
          const ra = Number(res.headers.get("retry-after"));
          await sleep(ra > 0 ? Math.min(ra * 1000, 5000) : Math.min(1000 * 2 ** i, 8000) + Math.random() * 400);
          lastErr = new Error(`HTTP ${res.status}`);
          continue;
        }

        return { res, txt };
      } catch (e) {
        lastErr = e;
        if (e.name !== "AbortError" && !(e instanceof TypeError)) break;
        await sleep(Math.min(1000 * 2 ** i, 8000));
      } finally {
        clearTimeout(t);
      }
    }
    throw lastErr || new Error(`Fetch gagal: ${url}`);
  }

  pathTo(email) {
    const [user, domain] = email.split("@");
    return `${domain}/${user.replace(/[^a-zA-Z0-9._-]/g, "")}`;
  }

  parseSiteData(html) {
    const m = html.match(/SITE_DATA\s*=\s*({[\s\S]*?});?\s*<\/script>/);
    if (!m) return {};
    try {
      return JSON.parse(m[1].replace(/,(\s*[}\]])/g, "$1"));
    } catch {
      const g = (k) => html.match(new RegExp(`${k}:"([^"]*)"`))?.[1] ?? null;
      const n = (k) => Number(html.match(new RegExp(`${k}:(\\d+)`))?.[1] ?? 0);
      return {
        cur_user: g("cur_user"),
        cur_domain: g("cur_domain"),
        num_mess: n("num_mess"),
        mess_id_raw: g("mess_id_raw"),
        secret_del_mess: g("secret_del_mess")
      };
    }
  }

  async newEmail({ log } = {}) {
    const { txt } = await this.req(`${BASE}/email-generator`, { log });
    const $ = cheerio.load(txt);
    const user = $("#userName").attr("value") || $("#userName").val();
    const domain = $("#domainName2").attr("value") || $("#domainName2").val();
    if (!user || !domain) throw new Error("Gagal membuat email: user/domain tidak ditemukan.");
    const email = `${user}@${domain}`.toLowerCase();
    const path = this.pathTo(email);
    this.setCookie("surl", path);
    this.setCookie("embx", encodeURIComponent(JSON.stringify([email])));
    await this.req(`${BASE}/check_adres_validation3.php`, {
      method: "POST",
      log,
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
      body: `usr=${encodeURIComponent(user)}&dmn=${encodeURIComponent(domain)}`,
    }).catch(() => {});
    return { email, username: user, domain, inboxUrl: `${BASE}/${path}` };
  }

  async fetchInbox(email, { log } = {}) {
    if (!email?.includes("@")) throw new Error("Email tidak valid.");
    const [user, domain] = email.split("@");
    this.setCookie("inbox_ctx", encodeURIComponent(`${domain}/${user}/`));
    const { txt } = await this.req(`${BASE}/${domain}/${user}`, { log });
    const $ = cheerio.load(txt);
    const sd = this.parseSiteData(txt);
    const seenIds = new Set();
    const messages = [];

    const head = $("#mail-summary-head");
    if (head.length && sd.mess_id_raw) {
      const from = head.find('[class*="from_div"]').first().text().trim();
      const subj = head.find('[class*="subj_div"]').first().text().trim();
      const date = head.find('[class*="time_div"]').first().text().trim();
      if (from || subj) {
        messages.push({
          id: sd.mess_id_raw,
          from: from || null,
          subject: subj || null,
          date: date || null
        });
        seenIds.add(sd.mess_id_raw);
      }
    }

    $("#email-table .list-group-item, #email-table .list-group-item2").each((_, el) => {
      const $el = $(el);
      if ($el.attr("id") === "mail-summary-head") return;
      const click = $el.attr("onclick") || "";
      const id = click.match(/loadInboxClientSide\('([^']+)'\)/)?.[1]?.replace(/\/$/, "").split("/").pop() || null;
      if (id && seenIds.has(id)) return;
      const from = $el.find('[class*="from_div"]').first().text().trim();
      const subj = $el.find('[class*="subj_div"]').first().text().trim();
      const date = $el.find('[class*="time_div"]').first().text().trim();
      if (id || (from && from !== "From")) {
        if (id) seenIds.add(id);
        messages.push({ id, from: from || null, subject: subj || null, date: date || null });
      }
    });

    const count = parseInt($("#mess_number").text(), 10) || (sd.num_mess ?? messages.length);
    return { email, count, messages };
  }

  async getRawSource(email, id, { log } = {}) {
    const [user, domain] = email.split("@");
    this.setCookie("inbox_ctx", encodeURIComponent(`${domain}/${user}/${id}`));
    let { res, txt } = await this.req(`${BASE}/inbox4/?src=${encodeURIComponent(id)}`, { log });
    if (res.status !== 403) return res.ok ? txt : (() => { throw new Error(`Raw gagal: HTTP ${res.status}`); })();
    log?.("  🧩 captcha, solving...");
    const capRes = await this.req(`${BASE}/inbox4/?src_captcha=1`, { log });
    const cap = JSON.parse(capRes.txt);
    const code = String(cap.svg || "").replace(/<[^>]+>/g, "").replace(/\s+/g, "");
    ({ res, txt } = await this.req(`${BASE}/inbox4/?src=${encodeURIComponent(id)}&cap=${encodeURIComponent(code)}&capt=${encodeURIComponent(cap.token)}`, { log }));
    if (!res.ok) throw new Error(`Captcha gagal (HTTP ${res.status})`);
    return txt;
  }

  async readMessage(email, id, { raw = false, log } = {}) {
    if (!email?.includes("@")) throw new Error("Email tidak valid.");
    const [user, domain] = email.split("@");
    this.setCookie("inbox_ctx", encodeURIComponent(`${domain}/${user}/${id}`));
    const { txt } = await this.req(`${BASE}/inbox4/`, { log });
    const $ = cheerio.load(txt);
    const from = $("#mail-summary-head [class*=\"from_div\"]").first().text().trim() || null;
    const subject = $("#mail-summary-head [class*=\"subj_div\"] h1, #mail-summary-head [class*=\"subj_div\"]").first().text().trim() || null;
    const date = $("#mail-summary-head [class*=\"time_div\"]").first().text().trim() || null;
    let bodyHtml = null;
    for (const sel of [".mess_bodiyy", "#mail-summary-body", ".mailsrc-body"]) {
      const el = $(sel).first();
      if (el.length) { bodyHtml = el.html()?.trim() || null; break; }
    }
    const rawSrc = raw ? await this.getRawSource(email, id, { log }) : null;
    return {
      id,
      from,
      subject,
      date,
      bodyHtml,
      bodyText: bodyHtml ? cheerio.load(`<div>${bodyHtml}</div>`)("div").text().trim() : null,
      raw: rawSrc
    };
  }

  async deleteAll(email, { log } = {}) {
    const [user, domain] = email.split("@");
    this.setCookie("inbox_ctx", encodeURIComponent(`${domain}/${user}/`));
    const { txt } = await this.req(`${BASE}/inbox4/`, { log });
    const sd = this.parseSiteData(txt);
    if (!sd.secret_del_mess) throw new Error("secret_del_mess tidak ditemukan (inbox mungkin sudah kosong).");
    const out = await this.req(`${BASE}/mark_remove.php`, {
      method: "POST",
      log,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `delete_all=${encodeURIComponent(sd.secret_del_mess)}`,
    });
    return { success: true, message: out.txt.trim() };
  }

  async waitForVerifyLink(email, { maxAttempts = 20, intervalMs = 3000, pattern = /alight-creative\.firebaseapp\.com\/__\/auth\/links\?link=[^\s"'<>]+/i, log } = {}) {
    for (let i = 0; i < maxAttempts; i++) {
      if (i > 0) await sleep(intervalMs);
      log?.(`[VerifyLink] Polling inbox ${email} (${i + 1}/${maxAttempts})...`);
      try {
        const inbox = await this.fetchInbox(email, { log });
        if (inbox.messages && inbox.messages.length > 0) {
          for (const msg of inbox.messages) {
            const detail = await this.readMessage(email, msg.id, { raw: false, log });
            const content = `${detail.bodyHtml || ""} ${detail.bodyText || ""}`;
            const match = content.match(pattern);
            if (match) return match[0];
          }
        }
      } catch (err) {
        log?.(`[VerifyLink] Error polling inbox: ${err.message}`);
      }
    }
    return null;
  }
}

const defaultClient = new GeneratorEmailClient();
export const newEmail = (opts) => defaultClient.newEmail(opts);
export const fetchInbox = (email, opts) => defaultClient.fetchInbox(email, opts);
export const readMessage = (email, id, opts) => defaultClient.readMessage(email, id, opts);
export const deleteAll = (email, opts) => defaultClient.deleteAll(email, opts);
export const waitForVerifyLink = (email, opts) => defaultClient.waitForVerifyLink(email, opts);

export default GeneratorEmailClient;
