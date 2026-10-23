/**
 * GetContact Stalker API
 * Scrape phone number profile + saved tags via official GetContact API
 * Login & authenticate accounts via WhatsApp (type=login)
 * Supports Indonesian & International numbers (Philippines, Malaysia, US, etc.)
 *
 * GET  /api/stalker/getcontact?phone=628xxx&type=profile
 * GET  /api/stalker/getcontact?phone=628xxx&type=tags
 * GET  /api/stalker/getcontact?phone=639xxx&type=login
 * POST /api/stalker/getcontact -d {"phone": "639xxx", "type": "login"}
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import logger from "../../src/utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GTC_BASE = "https://pbssrv-centralevents.com";
const HMAC_KEY = "31426764382a642f3a6665497235466f3d236d5d785b722b4c657457442a495b494524324866782a2364292478587a78662d7a7b7578593f71703e2b7e365762";

const VFK_BASE = "https://api.verifykit.com";
const VFK_HMAC_KEY = "3452235d713252604a35562d325f765238695738485863672a705e6841544d3c7e6e45463028266f372b544e596f3829236b392825262e534a7e774f37653932";
const VFK_CLIENT_KEY = "bhvbd7ced119dc6ad6a0b35bd3cf836555d6f71930d9e5a405f32105c790d";
const VFK_FINAL_KEY = "bd48d8c25293cfb537619cc93ae3d6e372eb2ddfffff4ab0eb000777144c7bfa";

const WORKER_PROXIES = [
  "https://cors.caliph.my.id/",
  "https://plain-wave-6f5f.apis1.workers.dev/",
  "https://young-hill-815e.apis3.workers.dev/",
  "https://icy-morning-72e2.apis2.workers.dev/",
  "https://cors.fazri.workers.dev/",
  "https://spring-night-57a1.3540746063.workers.dev/",
  "https://cors.sizable.workers.dev/",
  "https://jiashu.1win.eu.org/",
  "https://prox.26bruunjorl.workers.dev/",
];

let proxyIndex = 0;
function getNextWorkerProxy() {
  const p = WORKER_PROXIES[proxyIndex % WORKER_PROXIES.length];
  proxyIndex = (proxyIndex + 1) % WORKER_PROXIES.length;
  return p;
}

const APP_VERSION = "8.4.0";
const ANDROID_OS = "android 9";
const LANG = "en_US";
const COUNTRY = "id";
const DEVICE_NAME = "SM-G977N";
const BUNDLE_ID = "app.source.getcontact";

const DH_P = 900719898367n;
const DH_G = 7n;

const CRED_FILE = path.join(__dirname, "..", "..", ".gtc", "credentials.json");
const PENDING_FILE = path.join(__dirname, "..", "..", ".gtc", "pending_logins.json");

const inFlightLogins = new Map();

class GtcError extends Error {}

const PROTECTED_PHONE_CORES = new Set();

function isProtectedNumber(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return false;
  return [...PROTECTED_PHONE_CORES].some((core) => core && digits.endsWith(core));
}

function maskPhone(val) {
  if (!val || typeof val !== "string") return val;
  const digits = val.replace(/\D/g, "");

  if (digits.length >= 7) {
    const hasPlus = val.startsWith("+");
    const prefixLen = hasPlus ? 3 : 2;
    const suffixLen = 2;
    const prefix = val.slice(0, prefixLen);
    const suffix = val.slice(-suffixLen);
    const maskLen = Math.max(6, val.length - prefixLen - suffixLen);
    return prefix + "*".repeat(maskLen) + suffix;
  }

  if (val.length <= 4) return val.slice(0, 1) + "*".repeat(val.length - 1);
  return val.slice(0, 2) + "*".repeat(val.length - 2);
}

function detectCountry(phone) {
  const clean = String(phone || "").replace(/^\+/, "");
  if (clean.startsWith("62")) return { country: "id", countryUpper: "ID", mcc: "510", mnc: "01", carrier: "Indosat Ooredoo", tz: "Asia/Jakarta", lang: "in_ID" };
  if (clean.startsWith("63")) return { country: "ph", countryUpper: "PH", mcc: "515", mnc: "02", carrier: "Globe", tz: "Asia/Manila", lang: "en_US" };
  if (clean.startsWith("60")) return { country: "my", countryUpper: "MY", mcc: "502", mnc: "12", carrier: "Maxis", tz: "Asia/Kuala_Lumpur", lang: "en_US" };
  if (clean.startsWith("65")) return { country: "sg", countryUpper: "SG", mcc: "525", mnc: "01", carrier: "Singtel", tz: "Asia/Singapore", lang: "en_US" };
  if (clean.startsWith("1"))  return { country: "us", countryUpper: "US", mcc: "310", mnc: "410", carrier: "AT&T", tz: "America/New_York", lang: "en_US" };
  if (clean.startsWith("44")) return { country: "gb", countryUpper: "GB", mcc: "234", mnc: "10", carrier: "O2", tz: "Europe/London", lang: "en_US" };
  if (clean.startsWith("84")) return { country: "vn", countryUpper: "VN", mcc: "452", mnc: "04", carrier: "Viettel", tz: "Asia/Ho_Chi_Minh", lang: "en_US" };
  if (clean.startsWith("66")) return { country: "th", countryUpper: "TH", mcc: "520", mnc: "01", carrier: "AIS", tz: "Asia/Bangkok", lang: "en_US" };
  if (clean.startsWith("91")) return { country: "in", countryUpper: "IN", mcc: "404", mnc: "45", carrier: "Airtel", tz: "Asia/Kolkata", lang: "en_US" };
  if (clean.startsWith("7"))  return { country: "ru", countryUpper: "RU", mcc: "250", mnc: "01", carrier: "MTS", tz: "Europe/Moscow", lang: "en_US" };
  if (clean.startsWith("90")) return { country: "tr", countryUpper: "TR", mcc: "286", mnc: "01", carrier: "Turkcell", tz: "Europe/Istanbul", lang: "en_US" };
  return { country: "id", countryUpper: "ID", mcc: "510", mnc: "01", carrier: "Indosat Ooredoo", tz: "Asia/Jakarta", lang: "in_ID" };
}

function sig(ts, message, keyHex) {
  return crypto.createHmac("sha256", Buffer.from(keyHex, "hex"))
    .update(`${ts}-${message}`)
    .digest("base64");
}

function padPKCS7(buf) {
  const n = 16 - (buf.length % 16);
  return Buffer.concat([buf, Buffer.alloc(n, n)]);
}

function aesAlgo(keyBuf) {
  const size = keyBuf.length * 8;
  return size === 128 ? "aes-128-ecb" : size === 192 ? "aes-192-ecb" : "aes-256-ecb";
}

function encryptAES(data, keyHex) {
  const key = Buffer.from(keyHex, "hex");
  const cipher = crypto.createCipheriv(aesAlgo(key), key, null);
  cipher.setAutoPadding(false);
  const out = Buffer.concat([cipher.update(padPKCS7(Buffer.from(data, "utf8"))), cipher.final()]);
  return out.toString("base64");
}

function decryptAES(data, keyHex) {
  const key = Buffer.from(keyHex, "hex");
  const decipher = crypto.createDecipheriv(aesAlgo(key), key, null);
  decipher.setAutoPadding(false);
  const out = Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]);
  const padLen = out[out.length - 1];
  return out.subarray(0, out.length - padLen).toString("utf8");
}

function ts() {
  return String(Date.now());
}

function modPow(base, exp, mod) {
  let res = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) res = (res * base) % mod;
    base = (base * base) % mod;
    exp = exp / 2n;
  }
  return res;
}

function dhKeypair() {
  const priv = BigInt(Math.floor(Math.random() * (10 ** 8 - 10 ** 6)) + 10 ** 6);
  const pub = modPow(DH_G, priv, DH_P);
  return [priv, Number(pub)];
}

function dhFinalKey(priv, serverPub) {
  const shared = modPow(BigInt(serverPub), priv, DH_P);
  return crypto.createHash("sha256").update(shared.toString()).digest("hex");
}

async function gtcCall(endpoint, payload, { token, finalKey, deviceId, country = COUNTRY }) {
  const raw = JSON.stringify(payload);
  const t = ts();
  const headers = {
    "Content-Type": "application/json",
    "x-os": ANDROID_OS,
    "x-app-version": APP_VERSION,
    "x-client-device-id": deviceId,
    "x-lang": LANG,
    "x-req-timestamp": t,
    "x-country-code": country,
    "x-encrypted": "1",
    "x-req-signature": sig(t, raw, HMAC_KEY),
    "x-token": token,
  };
  const r = await fetch(GTC_BASE + endpoint, {
    method: "POST",
    body: JSON.stringify({ data: encryptAES(raw, finalKey) }),
    headers,
    signal: AbortSignal.timeout(25000),
  });
  let parsed;
  try {
    parsed = await r.json();
  } catch {
    throw new GtcError(`${endpoint}: non-JSON response (HTTP ${r.status})`);
  }
  if (parsed && "data" in parsed) {
    parsed = JSON.parse(decryptAES(parsed.data, finalKey));
  }
  return [r.status, parsed];
}

async function vfkCall(endpoint, payload, deviceId, lang = "in_ID", pinnedProxy = null) {
  const raw = JSON.stringify(payload);
  const t = ts();
  const headers = {
    "Content-Type": "application/json",
    "X-VFK-Client-Device-Id": deviceId,
    "X-VFK-Client-Key": VFK_CLIENT_KEY,
    "X-VFK-Sdk-Version": "0.11.4",
    "X-VFK-Os": "android 9.0",
    "X-VFK-App-Version": "8.16.0",
    "X-VFK-Encrypted": "1",
    "X-VFK-Lang": lang,
    "X-VFK-Req-Timestamp": t,
    "X-VFK-Req-Signature": sig(t, raw, VFK_HMAC_KEY),
  };
  const body = { data: encryptAES(raw, VFK_FINAL_KEY) };

  const candidates = [];
  if (pinnedProxy) {
    candidates.push(pinnedProxy);
  }
  const nextWorker = getNextWorkerProxy();
  if (!candidates.includes(nextWorker)) {
    candidates.push(nextWorker);
  }
  const shuffledWorkers = [...WORKER_PROXIES].sort(() => 0.5 - Math.random());
  for (const w of shuffledWorkers) {
    if (!candidates.includes(w)) candidates.push(w);
  }

  let lastError = null;
  for (const p of candidates) {
    try {
      let res;
      if (/workers\.dev|1win\.eu\.org|\.my\.id\/|cors\./i.test(p)) {
        const prefix = p.endsWith("/") ? p : `${p}/`;
        res = await axios.post(`${prefix}${VFK_BASE}${endpoint}`, body, {
          headers,
          timeout: 15000,
          validateStatus: () => true,
        });
      } else {
        const agent = new HttpsProxyAgent(p);
        res = await axios.post(`${VFK_BASE}${endpoint}`, body, {
          headers,
          httpsAgent: agent,
          timeout: 15000,
          validateStatus: () => true,
        });
      }

      let parsed = res.data;
      if (typeof parsed === "string") {
        try {
          parsed = JSON.parse(parsed);
        } catch {}
      }
      if (parsed && typeof parsed === "object" && "data" in parsed) {
        parsed = JSON.parse(decryptAES(parsed.data, VFK_FINAL_KEY));
      }

      if (res.status === 429 || res.status === 404 || res.status === 502) {
        lastError = new GtcError(`VerifyKit ${endpoint} via proxy ${p} returned HTTP ${res.status}`);
        continue;
      }

      return [res.status, parsed, p];
    } catch (err) {
      lastError = err;
      continue;
    }
  }

  throw lastError || new GtcError(`VerifyKit ${endpoint}: all proxies failed`);
}

function dig(obj, path, def = null) {
  for (const k of path.split(".")) {
    if (!obj || typeof obj !== "object" || !(k in obj)) return def;
    obj = obj[k];
  }
  return obj === undefined ? def : obj;
}

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(CRED_FILE, "utf8"));
  } catch {
    return { active: null, credentials: {} };
  }
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(CRED_FILE), { recursive: true });
  fs.writeFileSync(CRED_FILE, JSON.stringify(store, null, 2), "utf8");
}

function loadPending() {
  try {
    const raw = JSON.parse(fs.readFileSync(PENDING_FILE, "utf8"));
    const now = Date.now();
    const cleaned = {};
    for (const [k, v] of Object.entries(raw)) {
      if (now - (v.timestamp || 0) < 15 * 60 * 1000) {
        cleaned[k] = v;
      }
    }
    return cleaned;
  } catch {
    return {};
  }
}

function savePending(data) {
  try {
    fs.mkdirSync(path.dirname(PENDING_FILE), { recursive: true });
    fs.writeFileSync(PENDING_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    logger.error(`[GETCONTACT] Failed to save pending logins: ${err.message}`);
  }
}

function getPending(phoneKey) {
  const store = loadPending();
  return store[phoneKey] || null;
}

function setPending(phoneKey, session) {
  const store = loadPending();
  store[phoneKey] = { ...session, timestamp: Date.now() };
  savePending(store);
}

function deletePending(phoneKey) {
  const store = loadPending();
  if (store[phoneKey]) {
    delete store[phoneKey];
    savePending(store);
  }
}

function getActiveCred(store) {
  const name = store.active || Object.keys(store.credentials || {})[0];
  const cred = store.credentials?.[name];
  if (!cred || !cred.token || !cred.finalKey || !cred.clientDeviceId) {
    throw new GtcError("No GetContact credential configured. Gunakan type=login untuk login terlebih dahulu.");
  }
  return [name, cred];
}

function normalizePhone(raw) {
  let p = String(raw || "").replace(/[^\d+]/g, "").trim();
  if (!p) throw new GtcError("Nomor telepon tidak boleh kosong");
  if (p.startsWith("+")) return p;
  if (p.startsWith("0")) return "+62" + p.slice(1);
  return "+" + p;
}

async function apiSearch(cred, phone, source) {
  if (isProtectedNumber(phone)) {
    throw new GtcError("Nomor ini dilindungi oleh privasi dan tidak dapat dicari.");
  }
  const cInfo = detectCountry(phone);
  const endpoint = source === "tags" ? "/v2.8/number-detail" : "/v2.8/search";
  const [code, body] = await gtcCall(endpoint, {
    countryCode: cInfo.country,
    phoneNumber: phone,
    source: source === "tags" ? "profile" : "search",
    token: cred.token,
  }, {
    token: cred.token,
    finalKey: cred.finalKey,
    deviceId: cred.clientDeviceId,
    country: cInfo.country,
  });
  const meta = dig(body, "meta.httpStatusCode");
  if (code !== 200 || meta !== 200) {
    throw new GtcError(`HTTP ${code}/${meta}: ${dig(body, "meta.errorMessage", "unknown error")}`);
  }
  return body;
}

async function apiSubscription(cred) {
  const cInfo = detectCountry(cred.phoneNumber || "");
  const [code, body] = await gtcCall("/v2.8/subscription", { token: cred.token }, {
    token: cred.token,
    finalKey: cred.finalKey,
    deviceId: cred.clientDeviceId,
    country: cInfo.country,
  });
  if (code !== 200) {
    throw new GtcError(`HTTP ${code}: ${dig(body, "meta.errorMessage", "unknown error")}`);
  }
  return body;
}

// Akun yang token-nya mati (403001 / Authentication failed) ditempatkan paling
// akhir dalam rotasi supaya tidak membuang satu request di setiap lookup.
const deadAccounts = new Set();

function isAuthFailure(msg) {
  return /403001|Authentication failed|Invalid token|token expired|unauthorized/i.test(msg || "");
}

function buildRotationOrder(names, activeName) {
  const alive = names.filter((n) => !deadAccounts.has(n));
  const dead = names.filter((n) => deadAccounts.has(n));
  const head = alive.includes(activeName)
    ? [activeName, ...alive.filter((n) => n !== activeName)]
    : alive;
  return [...head, ...dead];
}

async function apiSearchWithFallback(phone, source) {
  const store = loadStore();
  const creds = store.credentials || {};
  const names = Object.keys(creds);
  if (!names.length) {
    throw new GtcError("No GetContact credential configured. Gunakan type=login untuk login terlebih dahulu.");
  }

  const activeName = store.active && creds[store.active] ? store.active : names[0];
  const order = buildRotationOrder(names, activeName);

  let lastError = null;
  for (const name of order) {
    const cred = creds[name];
    if (!cred || !cred.token || !cred.finalKey || !cred.clientDeviceId) {
      continue;
    }
    try {
      logger.info(`[GETCONTACT] ${source} lookup for ${phone} (account: ${name})`);
      const body = await apiSearch(cred, phone, source);

      // Self-heal: akun yang aktif ternyata mati, jadikan ini akun aktif.
      if (store.active !== name) {
        store.active = name;
        saveStore(store);
        logger.warn(`[GETCONTACT] Active account rotated -> ${name}`);
      }

      return [name, body];
    } catch (err) {
      lastError = err;
      if (/404.*No result found/i.test(err.message)) {
        throw err;
      }
      if (isAuthFailure(err.message)) {
        deadAccounts.add(name);
        logger.warn(`[GETCONTACT] Account ${name} token dead (${err.message}), demoting in rotation.`);
        continue;
      }
      if (/403|401|limit|quota|QUOTA_EXHAUSTED|query limit|session/i.test(err.message)) {
        logger.warn(`[GETCONTACT] Account ${name} error (${err.message}) on ${source}, trying next account...`);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function formatProfile(profile) {
  if (!profile) return null;
  const pick = ["displayName", "name", "surname", "phoneNumber", "displayNumber",
    "country", "countryCode", "email", "trustScore", "tagCount", "profileImage"];
  const out = {};
  for (const k of pick) out[k] = profile[k] ?? null;
  return out;
}

function formatTags(tags) {
  return (tags || []).map((t) => ({
    tag: t.tag || null,
    count: t.count ?? null,
    isNew: !!t.isNew,
    removable: !!t.removable,
  }));
}

function formatQuota(sub) {
  if (!sub) return null;
  const u = sub.usage || {};
  const pick = (k) => {
    const d = u[k] || {};
    return { limit: d.limit ?? null, remaining: d.remainingCount ?? null };
  };
  return {
    premiumType: sub.premiumType || sub.premiumTypeName || "free",
    renewDate: sub.renewDate || null,
    search: pick("search"),
    numberDetail: pick("numberDetail"),
    biography: pick("biography"),
  };
}

async function startLoginFlow(phone) {
  const cInfo = detectCountry(phone);
  const deviceId = crypto.randomBytes(8).toString("hex");
  const [priv, pub] = dhKeypair();

  const regBody = {
    carrierCountryCode: cInfo.mcc,
    carrierName: cInfo.carrier,
    carrierNetworkCode: cInfo.mnc,
    countryCode: cInfo.country,
    deepLink: null,
    deviceName: DEVICE_NAME,
    deviceType: "Android",
    email: null,
    notificationToken: "",
    oldToken: null,
    peerKey: pub,
    timeZone: cInfo.tz,
    token: "",
  };
  const raw = JSON.stringify(regBody);
  const t = ts();
  const regHeaders = {
    "Content-Type": "application/json",
    "x-os": ANDROID_OS,
    "x-app-version": APP_VERSION,
    "x-client-device-id": deviceId,
    "x-lang": LANG,
    "x-req-timestamp": t,
    "x-country-code": cInfo.country,
    "x-encrypted": "0",
    "x-req-signature": sig(t, raw, HMAC_KEY),
  };

  const regRes = await fetch(GTC_BASE + "/v2.8/register", {
    method: "POST",
    headers: regHeaders,
    body: raw,
    signal: AbortSignal.timeout(25000),
  });
  if (regRes.status !== 201) {
    const errText = await regRes.text();
    throw new GtcError(`GetContact register failed (HTTP ${regRes.status}): ${errText.slice(0, 200)}`);
  }
  const regData = await regRes.json();
  const token = dig(regData, "result.token");
  const serverKey = dig(regData, "result.serverKey");
  if (!token || !serverKey) {
    throw new GtcError("GetContact register: missing token or serverKey");
  }
  const finalKey = dhFinalKey(priv, serverKey);

  const common = { token, finalKey, deviceId, country: cInfo.country };
  const base = {
    carrierCountryCode: cInfo.mcc,
    carrierName: cInfo.carrier,
    carrierNetworkCode: cInfo.mnc,
    countryCode: cInfo.country,
    deviceName: DEVICE_NAME,
    notificationToken: "",
    timeZone: cInfo.tz,
    token,
  };

  const steps = [
    ["/v2.8/init-basic", base, 201],
    ["/v2.8/ad-settings", { source: "init", token }, 200],
    ["/v2.8/init-intro", { ...base, hasRouting: false }, 201],
    [
      "/v2.8/email-code-validate/start",
      {
        email: `user${Math.floor(10000000 + Math.random() * 90000000)}@gmail.com`,
        fullName: `User${Math.floor(1000 + Math.random() * 999000)}`,
        token,
      },
      200,
    ],
    ["/v2.8/country", { countryCode: cInfo.countryUpper, token }, 200],
    [
      "/v2.8/validation-start",
      { app: "verifykit", countryCode: cInfo.country, notificationToken: "", token },
      200,
    ],
  ];

  for (const [endpoint, payload, want] of steps) {
    const [code, body] = await gtcCall(endpoint, payload, common);
    if (code !== want) {
      throw new GtcError(`Init step ${endpoint} failed (HTTP ${code}): ${JSON.stringify(body)}`);
    }
  }

  const rawPhone = phone.replace(/^\+/, "");
  const [initCode, initBody, usedProxy] = await vfkCall("/v2.0/init", {
    isCallPermissionGranted: true,
    countryCode: cInfo.countryUpper,
    deviceName: DEVICE_NAME,
    installedApps: '{"whatsapp":0,"telegram":0,"viber":0}',
    outsideCountryCode: cInfo.countryUpper,
    outsidePhoneNumber: rawPhone,
    timezone: cInfo.tz,
    bundleId: BUNDLE_ID,
  }, deviceId, cInfo.lang);
  if (initCode !== 200) {
    throw new GtcError(`VerifyKit init failed (HTTP ${initCode}): ${JSON.stringify(initBody)}`);
  }

  const [countryCode, countryBody] = await vfkCall("/v2.0/country", {
    countryCode: cInfo.countryUpper,
    bundleId: BUNDLE_ID,
  }, deviceId, cInfo.lang, usedProxy);
  if (countryCode !== 200) {
    throw new GtcError(`VerifyKit country failed (HTTP ${countryCode}): ${JSON.stringify(countryBody)}`);
  }

  const [startCode, startBody] = await vfkCall("/v2.0/start", {
    countryCode: cInfo.countryUpper,
    mcc: cInfo.mcc,
    mnc: cInfo.mnc,
    phoneNumber: phone,
    app: "whatsapp",
    bundleId: BUNDLE_ID,
  }, deviceId, cInfo.lang, usedProxy);

  const deeplink = dig(startBody, "result.deeplink");
  const reference = dig(startBody, "result.reference");
  if (!deeplink || !reference) {
    throw new GtcError(`VerifyKit start failed (HTTP ${startCode}): ${JSON.stringify(startBody)}`);
  }

  const decodedDeeplink = decodeURIComponent(deeplink);
  const codes = [...decodedDeeplink.matchAll(/\*(.*?)\*/g)].map((m) => m[1]);
  const verification = codes.find((c) => /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/.test(c)) || "";

  await gtcCall("/v2.8/validation-start", {
    app: "verifykit",
    countryCode: cInfo.country,
    notificationToken: "",
    token,
  }, common);

  return {
    reference,
    token,
    finalKey,
    deviceId,
    phone,
    country: cInfo.country,
    lang: cInfo.lang,
    deeplink,
    code: verification,
    proxy: usedProxy,
    timestamp: Date.now(),
  };
}

async function checkLoginVerification(pending) {
  const [code, body] = await vfkCall("/v2.0/check", {
    reference: pending.reference,
    bundleId: BUNDLE_ID,
  }, pending.deviceId, pending.lang || "in_ID", pending.proxy);

  const sessionId = dig(body, "result.sessionId");
  if (!sessionId) {
    return { verified: false, body };
  }

  const [resCode, resBody] = await gtcCall("/v2.8/verifykit-result", {
    sessionId,
    token: pending.token,
  }, {
    token: pending.token,
    finalKey: pending.finalKey,
    deviceId: pending.deviceId,
    country: pending.country || "id",
  });

  const validationDate = dig(resBody, "result.validationDate");
  if (!validationDate) {
    throw new GtcError(`GetContact verifykit-result failed (HTTP ${resCode}): ${JSON.stringify(resBody)}`);
  }

  const cleanPhoneKey = pending.phone.replace(/^\+/, "");
  const store = loadStore();
  store.credentials = store.credentials || {};
  store.credentials[cleanPhoneKey] = {
    description: `Generated ${validationDate}`,
    phoneNumber: pending.phone,
    clientDeviceId: pending.deviceId,
    finalKey: pending.finalKey,
    token: pending.token,
    validationDate,
  };
  store.active = cleanPhoneKey;
  saveStore(store);
  deadAccounts.delete(cleanPhoneKey);
  logger.info(`[GETCONTACT] Account ${cleanPhoneKey} re-authenticated, restored in rotation.`);

  let quota = null;
  try {
    const sBody = await apiSubscription({
      token: pending.token,
      finalKey: pending.finalKey,
      clientDeviceId: pending.deviceId,
      phoneNumber: pending.phone,
    });
    quota = formatQuota(dig(sBody, "result.subscriptionInfo") || dig(sBody, "result.quota"));
  } catch {}

  return {
    verified: true,
    validationDate,
    quota,
  };
}

export default {
  name: "GetContact Stalker",
  description: "Scrape phone number identity + saved tags from GetContact (Spam Caller ID) — display name, avatar, and how contacts saved the number. Also supports login & credential generation via WhatsApp (type=login)",
  category: "Stalker",
  methods: ["GET", "POST"],

  params: ["phone", "type"],

  paramsSchema: {
    phone: {
      type: "string",
      required: false,
      default: "",
      example: "",
      description: "Phone number to look up or login (required for type=profile, tags, login). Optional for type=quota.",
      minLength: 8,
      maxLength: 20,
    },
    type: {
      type: "string",
      required: false,
      description: "Action type: profile (lookup identity), tags (saved tags), login (WhatsApp OTP login), quota (check limits of all accounts)",
      enum: ["profile", "tags", "login", "quota"],
      default: "profile",
    },
  },

  async run(req, res) {
    const startTime = Date.now();

    try {
      let { phone, type } = { ...req.query, ...req.body };
      type = (type || "profile").toLowerCase();

      if (!["profile", "tags", "login", "quota"].includes(type)) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'type' harus 'profile', 'tags', 'login', atau 'quota'",
        });
      }

      // -------------------------------------------------------------
      // 0. TYPE = QUOTA (Check Quotas for all Accounts without phone search)
      // -------------------------------------------------------------
      if (type === "quota") {
        const store = loadStore();
        const creds = store.credentials || {};
        const activeName = store.active || Object.keys(creds)[0];
        const accounts = [];

        for (const [name, cred] of Object.entries(creds)) {
          if (!cred.token || !cred.finalKey || !cred.clientDeviceId) continue;
          try {
            const body = await apiSubscription(cred);
            const sub = dig(body, "result.subscriptionInfo") || {};
            const usage = sub.usage || {};
            const search = usage.search || {};
            const numDetail = usage.numberDetail || {};
            const bio = usage.biography || {};

            accounts.push({
              account: maskPhone(name),
              phoneNumber: maskPhone(cred.phoneNumber || name),
              isActive: name === activeName,
              validationDate: cred.validationDate || "-",
              plan: sub.premiumTypeName || "Free",
              renewDate: sub.renewDate || "-",
              search: {
                limit: search.limit ?? 200,
                remaining: search.remainingCount ?? 0,
              },
              tags: {
                limit: numDetail.limit ?? 0,
                remaining: numDetail.remainingCount ?? 0,
                restriction: numDetail.localizations?.description || "Free tier",
              },
              biography: {
                limit: bio.limit ?? 0,
                remaining: bio.remainingCount ?? 0,
              },
            });
          } catch (err) {
            accounts.push({
              account: maskPhone(name),
              phoneNumber: maskPhone(cred.phoneNumber || name),
              isActive: name === activeName,
              error: err.message,
            });
          }
        }

        const totalRemaining = accounts.reduce((acc, a) => acc + (a.search?.remaining || 0), 0);
        const duration = Date.now() - startTime;
        return res.json({
          status: true,
          type: "quota",
          totalAccounts: accounts.length,
          activeAccount: maskPhone(activeName),
          totalSearchRemaining: totalRemaining,
          accounts,
          metadata: { processing_time: `${duration}ms` },
        });
      }

      if (!phone || typeof phone !== "string" || !phone.trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'phone' wajib diisi",
        });
      }

      const normalized = normalizePhone(phone.trim());
      const cleanPhoneKey = normalized.replace(/^\+/, "");

      // -------------------------------------------------------------
      // 1. TYPE = LOGIN (Automatic WhatsApp Verification Flow)
      // -------------------------------------------------------------
      if (type === "login") {
        let pending = getPending(cleanPhoneKey);

        // Jika sudah ada sesi verifikasi yang aktif: periksa status verifikasinya
        if (pending) {
          logger.info(`[GETCONTACT] Checking verification status for ${pending.phone} (ref: ${pending.reference})`);
          const checkRes = await checkLoginVerification(pending);
          const duration = Date.now() - startTime;

          if (checkRes.verified) {
            deletePending(cleanPhoneKey);
            return res.json({
              status: true,
              type: "login",
              message: "Login GetContact berhasil! Akun telah disimpan dan aktif digunakan oleh API.",
              result: {
                account: cleanPhoneKey,
                phone: pending.phone,
                validationDate: checkRes.validationDate,
                active: true,
                quota: checkRes.quota,
              },
              metadata: { processing_time: `${duration}ms` },
            });
          } else {
            return res.json({
              status: false,
              type: "login",
              message: "Verifikasi WhatsApp belum selesai. Pastikan pesan WhatsApp sudah terkirim (centang dua) dari nomor yang didaftarkan, lalu panggil kembali endpoint ini.",
              result: {
                phone: pending.phone,
                reference: pending.reference,
                code: pending.code,
                whatsapp_url: pending.deeplink,
              },
              metadata: { processing_time: `${duration}ms` },
            });
          }
        }

        // Jika tidak ada sesi pending, cek apakah nomor ini sudah terdaftar & aktif di credentials
        const store = loadStore();
        if (store.credentials && store.credentials[cleanPhoneKey]) {
          const cred = store.credentials[cleanPhoneKey];
          const duration = Date.now() - startTime;
          return res.json({
            status: true,
            type: "login",
            message: "Akun ini sudah berhasil login dan aktif digunakan oleh API.",
            result: {
              account: cleanPhoneKey,
              phone: cred.phoneNumber || normalized,
              validationDate: cred.validationDate,
              active: store.active === cleanPhoneKey,
            },
            metadata: { processing_time: `${duration}ms` },
          });
        }

        // Jika belum ada sesi aktif: mulai sesi login baru (dengan lock anti-race condition)
        if (inFlightLogins.has(cleanPhoneKey)) {
          pending = await inFlightLogins.get(cleanPhoneKey);
        } else {
          logger.info(`[GETCONTACT] Starting new login flow for ${normalized} (auto-rotating proxy)`);
          const loginPromise = startLoginFlow(normalized)
            .then((p) => {
              setPending(cleanPhoneKey, p);
              return p;
            })
            .finally(() => {
              inFlightLogins.delete(cleanPhoneKey);
            });

          inFlightLogins.set(cleanPhoneKey, loginPromise);
          pending = await loginPromise;
        }

        const duration = Date.now() - startTime;
        return res.json({
          status: true,
          type: "login",
          message: "Silakan buka tautan WhatsApp dan kirim pesan verifikasi tanpa mengubah teks. Setelah pesan terkirim (centang dua), panggil kembali endpoint ini untuk menyelesaikan login.",
          result: {
            phone: normalized,
            reference: pending.reference,
            code: pending.code,
            whatsapp_url: pending.deeplink,
          },
          metadata: { processing_time: `${duration}ms` },
        });
      }

      // -------------------------------------------------------------
      // 2. TYPE = PROFILE / TAGS (Lookup Phone Number)
      // -------------------------------------------------------------
      if (isProtectedNumber(normalized) || isProtectedNumber(phone)) {
        const duration = Date.now() - startTime;
        logger.warn(`[GETCONTACT] Blocked search for protected owner number: ${normalized}`);
        return res.status(403).json({
          status: false,
          code: "PROTECTED_NUMBER",
          message: "Nomor ini dilindungi oleh privasi dan tidak dapat dicari.",
          metadata: { processing_time: `${duration}ms` },
        });
      }

      const [name, body] = await apiSearchWithFallback(normalized, type);
      const profile = formatProfile(dig(body, "result.profile"));
      const tags = formatTags(dig(body, "result.tags"));
      const quota = formatQuota(dig(body, "result.subscriptionInfo") || dig(body, "result.quota"));

      const duration = Date.now() - startTime;
      logger.info(`[GETCONTACT] ${type} result for ${normalized} | ${duration}ms (served by: ${name})`);

      const payload = {
        status: true,
        query: { phone: normalized, type },
        account: maskPhone(name),
        result: {
          profile,
          tags,
          quota,
        },
        metadata: { processing_time: `${duration}ms` },
      };

      return res.json(payload);
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[GETCONTACT] Error: ${error.message}`);

      if (error.message && error.message.includes("429")) {
        return res.status(429).json({
          status: false,
          code: "RATE_LIMITED",
          message: "Terlalu banyak permintaan verifikasi ke VerifyKit. Harap tunggu beberapa menit (cooldown) sebelum mencoba request login baru.",
          metadata: { processing_time: `${duration}ms` },
        });
      }

      if (error instanceof GtcError) {
        const isNotFound = /404.*No result found/i.test(error.message);
        const isQuota = /maximum query limit|quota/i.test(error.message);
        if (isNotFound) {
          return res.status(404).json({
            status: false,
            code: "NOT_FOUND",
            message: "Nomor tidak ditemukan di database GetContact (tidak ada data profil/tag tersimpan)",
            metadata: { processing_time: `${duration}ms` },
          });
        }
        if (isQuota) {
          return res.status(429).json({
            status: false,
            code: "QUOTA_EXHAUSTED",
            message: "Kuota GetContact habis — coba type=profile atau tunggu reset kuota",
            metadata: { processing_time: `${duration}ms` },
          });
        }
        const isAuth = /credential|Invalid phone|non-JSON/i.test(error.message);
        return res.status(isAuth ? 503 : 502).json({
          status: false,
          message: error.message,
          metadata: { processing_time: `${duration}ms` },
        });
      }

      return res.status(500).json({
        status: false,
        message: error.message,
        metadata: { processing_time: `${duration}ms` },
      });
    }
  },
};