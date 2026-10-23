/**
 * AlightMotion Bulk V5 — Auto create Maildropy + send magic link + verify + apply premium
 * Powered by Maildropy (maildropy.com) + Google Identity Toolkit + Alight Creative Cloud Functions
 *
 * GET  /api/am/bulkv5?count=1
 * POST /api/am/bulkv5 -d {"count": 1}
 */

import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import logger from "../../src/utils/logger.js";

const MAILDROPY_BASE = "http://maildropy.com";
const MAILDROPY_WEB = "https://maildropy.com";

const FIREBASE_WEB_API_KEY =
  process.env.ALIGHT_API_KEY || "AIzaSyDrZ9jr_Y16ltSBqsQR5IH6I04FRga6Ki0";
const FIREBASE_AUTH_BASE = "https://identitytoolkit.googleapis.com/v1/accounts";
const ALIGHT_CONTINUE_URL = "https://alightcreative.com/am/auth/finish";
const CLOUD_FUNCTIONS_BASE = "https://us-central1-alight-creative.cloudfunctions.net";
const VERIFY_PURCHASE_URL = "https://us-central1-alight-creative.cloudfunctions.net/verifyPurchase";
const PRODUCT_ID = "am.full.sub.annual.19q4";
const TOKEN =
  "mmgaobamlahbbeccfplmbkbb.AO-J1OzqG0or_GJJIx-ms8GrTm-jaglCRfhQSRPUZKpl2YspYS-oN7_94uv8RC5vQbvd_Ios2pPDStZ2n7F0hLE3FiOU7HS3R6Fquulv5xLXFECSv4ctElw";
const SKU_TYPE = "subs";
const FIREBASE_INSTANCE_ID_TOKEN =
  "cSDnCyp3T-uwp07z3tL86T:APA91bFkmvvsHw5nnqa1SBFci-99DRsKClLiETdRrVcJjS5yBx1v_FbCb1d8WhBuea_zmwnYBktyTIzcRhN4b6uNOUur9wPc0gKXmJDoZic0LhNq5V2s0xI";

const NATIVE_HEADERS = {
  "Content-Type": "application/json",
  Origin: "https://alight-creative.firebaseapp.com",
  Referer: "https://alight-creative.firebaseapp.com/",
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36",
};

const PURCHASE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Accept-Encoding": "gzip",
  "User-Agent": "okhttp/3.12.1",
};

const jar = new CookieJar();
const maildropyClient = wrapper(
  axios.create({
    jar,
    baseURL: MAILDROPY_BASE,
    timeout: 20000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    validateStatus: () => true,
  })
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function generateCodeOrder() {
  const r = (len) => {
    let str = "";
    for (let i = 0; i < len; i++) str += Math.floor(Math.random() * 10);
    return str;
  };
  return `GPA.${r(4)}.${r(4)}.${r(4)}.${r(5)}`;
}

export function getDirectUrl(email) {
  if (!email) return null;
  return `${MAILDROPY_WEB}/${email}`;
}

// 1. Generate email temporary via Maildropy
export async function createEmail(domain = "maildropy.com") {
  const res = await maildropyClient.post("/wxapi/generate", { domain });
  const data = res.data || {};
  if (!data.email) {
    throw new Error(`Gagal membuat email Maildropy (${res.status})`);
  }
  return {
    email: data.email,
    domain: data.domain || domain,
    directUrl: getDirectUrl(data.email),
  };
}

// 2. Fetch inbox Maildropy
export async function checkInbox(email) {
  const enc = encodeURIComponent(email);
  const res = await maildropyClient.get(`/wxapi/messages/${enc}`);
  const data = res.data || {};
  return Array.isArray(data.messages) ? data.messages : [];
}

// 3. Detail message Maildropy
export async function getMessage(email, messageId) {
  const encEmail = encodeURIComponent(email);
  const encId = encodeURIComponent(messageId);
  const res = await maildropyClient.get(`/wxapi/message/${encEmail}/${encId}`);
  return res.data || {};
}

// 4. Cari link verifikasi dari isi pesan
export function findVerifyLink(emails) {
  const patterns = [
    /https:\/\/alightcreative\.com\/auth_action\/?\?[^\s"'>]*oobCode=[^\s"'>&]+/,
    /https:\/\/[^"'\s]*alight[^"'\s]*firebaseapp\.com\/__\/auth\/links\?link=[^\s"'>]+/,
    /https:\/\/[^"'\s]*firebaseapp\.com\/__\/auth\/links\?link=[^\s"'>]+/,
    /https:\/\/alight-creative\.firebaseapp\.com\/__\/auth\/links\?link=[^\s"'>]+/,
  ];

  for (const msg of emails) {
    const text = `${msg.html || ""}\n${msg.text || ""}\n${msg.body || ""}\n${msg.preview || ""}`;
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[0].replace(/&amp;/g, "&");
    }
  }
  return null;
}

// 5. Polling inbox mencari verify link
export async function waitForVerifyLink(email, { maxAttempts = 20, intervalMs = 2000 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const messages = await checkInbox(email);
      if (messages.length > 0) {
        for (const msg of messages) {
          let link = findVerifyLink([msg]);
          if (link) return { link, attempts: attempt };

          const msgId = msg.id || msg._id;
          if (msgId) {
            const detail = await getMessage(email, msgId);
            link = findVerifyLink([detail, msg]);
            if (link) return { link, attempts: attempt };
          }
        }
      }
    } catch {}
    await sleep(intervalMs);
  }
  return null;
}

// 6. Kirim magic sign-in link via Firebase Auth
export async function sendMagicLink(email) {
  const payload = {
    requestType: "EMAIL_SIGNIN",
    email: String(email).trim(),
    continueUrl: ALIGHT_CONTINUE_URL,
    canHandleCodeInApp: true,
  };

  const res = await fetch(`${FIREBASE_AUTH_BASE}:sendOobCode?key=${FIREBASE_WEB_API_KEY}`, {
    method: "POST",
    headers: NATIVE_HEADERS,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error || {};
    const quota = /QUOTA_EXCEEDED|quota/i.test(`${e.message || ""}`);
    throw new Error(
      quota
        ? `Kuota Google habis untuk email sign-in (${e.message || "QUOTA_EXCEEDED"}).`
        : e.message || body?.error || `HTTP ${res.status}`
    );
  }

  return {
    status: "success",
    email: body?.email || String(email).trim(),
    kind: body?.kind || null,
  };
}

// 7. Ekstrak oobCode
export function extractOobCode(magicLink) {
  if (!magicLink) return "";
  const input = String(magicLink).trim();
  const direct = input.match(/oobCode=([a-zA-Z0-9_-]+)/);
  if (direct?.[1]) return direct[1];

  try {
    const decoded = decodeURIComponent(input);
    const m = decoded.match(/oobCode=([a-zA-Z0-9_-]+)/);
    if (m?.[1]) return m[1];
  } catch {}

  try {
    const u = new URL(input);
    const code = u.searchParams.get("oobCode");
    if (code) return code;
  } catch {}

  return input;
}

// 8. Verifikasi magic link ke Firebase Auth
export async function verifyMagicLink(email, magicLinkOrOobCode) {
  const oobCode = extractOobCode(magicLinkOrOobCode);
  const res = await fetch(`${FIREBASE_AUTH_BASE}:signInWithEmailLink?key=${FIREBASE_WEB_API_KEY}`, {
    method: "POST",
    headers: NATIVE_HEADERS,
    body: JSON.stringify({ email: String(email).trim(), oobCode }),
    signal: AbortSignal.timeout(20000),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error || {};
    throw new Error(e.message || `Verifikasi gagal (HTTP ${res.status})`);
  }

  return {
    email: body?.email || String(email).trim(),
    localId: body?.localId || null,
    idToken: body?.idToken || null,
    refreshToken: body?.refreshToken || null,
    expiresIn: body?.expiresIn || null,
    isNewUser: Boolean(body?.isNewUser),
  };
}

// 9. Apply Alight Motion Premium
export async function applyPremium(idToken, customOrderId) {
  const finalOrderId = customOrderId || generateCodeOrder();
  const headers = {
    ...PURCHASE_HEADERS,
    authorization: `Bearer ${idToken}`,
    "firebase-instance-id-token": FIREBASE_INSTANCE_ID_TOKEN,
  };

  const response = await fetch(VERIFY_PURCHASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      data: {
        productId: PRODUCT_ID,
        token: TOKEN,
        skuType: SKU_TYPE,
        orderId: finalOrderId,
      },
    }),
    signal: AbortSignal.timeout(30000),
  });

  const resData = await response.json().catch(() => ({}));
  resData.applied_order_id = finalOrderId;
  return resData;
}

// 10. Cek status lisensi akun
export async function getLicenseStatus(idToken) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "user-agent": "okhttp/3.12.1",
    authorization: `Bearer ${String(idToken).trim()}`,
  };

  const res = await fetch(`${CLOUD_FUNCTIONS_BASE}/getAccountStatus`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      data: {
        package: "com.alightcreative.motion",
        version: "5.0.279",
      },
    }),
    signal: AbortSignal.timeout(20000),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error?.message || `Gagal baca lisensi (HTTP ${res.status})`);
  }

  const r = body?.result || {};
  return {
    isPro: Boolean(r.licenseValid),
    expiresAt: r.licenseExpires ? new Date(Number(r.licenseExpires)).toISOString() : null,
    benefits: r.licenseBenefits || [],
    serverTime: r.msTime ? new Date(Number(r.msTime)).toISOString() : null,
  };
}

export default {
  name: "AlightMotion Bulk V5",
  description: "Generate Am Bulk v5",
  category: "AlightMotion",
  methods: ["GET", "POST"],
  params: ["count"],
  paramsSchema: {
    count: {
      type: "number",
      required: false,
      default: 1,
      description: "Jumlah akun Alight Motion Premium yang ingin dibuat (maksimal 20 akun per request)",
      example: 1,
    },
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body };
    const total = Math.min(Math.max(parseInt(params.count, 10) || 1, 1), 20);

    try {
      // 1. Buat email Maildropy & orderId untuk semua akun
      const results = [];
      for (let index = 0; index < total; index++) {
        const { email, directUrl } = await createEmail();
        const orderId = generateCodeOrder();
        results.push({
          email,
          inboxUrl: directUrl,
          orderId,
        });
        if (index < total - 1) await sleep(300);
      }

      // 2. Jalankan proses verifikasi dan aktivasi premium di background
      (async () => {
        for (let i = 0; i < results.length; i++) {
          const item = results[i];
          const email = item.email;
          const orderId = item.orderId;

          try {
            logger.info(`[AM BulkV5 BG] [${i + 1}/${total}] ${email}: Mengirim magic link...`);
            await sendMagicLink(email);

            logger.info(`[AM BulkV5 BG] [${i + 1}/${total}] ${email}: Menunggu link verifikasi di Maildropy...`);
            const found = await waitForVerifyLink(email, { maxAttempts: 20, intervalMs: 2000 });
            if (!found) {
              logger.error(`[AM BulkV5 BG] [${i + 1}/${total}] ${email}: Link verifikasi tidak ditemukan di inbox`);
              continue;
            }

            logger.info(`[AM BulkV5 BG] [${i + 1}/${total}] ${email}: Melakukan verifikasi login...`);
            const authData = await verifyMagicLink(email, found.link);
            if (!authData.idToken) {
              logger.error(`[AM BulkV5 BG] [${i + 1}/${total}] ${email}: Gagal memperoleh idToken`);
              continue;
            }

            logger.info(
              `[AM BulkV5 BG] [${i + 1}/${total}] ${email}: Menerapkan lisensi Premium Alight Motion (${orderId})...`
            );
            await applyPremium(authData.idToken, orderId);

            let license = { isPro: false, expiresAt: null };
            try {
              license = await getLicenseStatus(authData.idToken);
            } catch (e) {
              logger.warn(`[AM BulkV5 BG] ${email} getLicenseStatus warn: ${e.message}`);
            }

            logger.info(
              `[AM BulkV5 BG] [${i + 1}/${total}] ${email}: SUKSES PREMIUM! | isPro: ${license.isPro} | Order: ${orderId} | Expires: ${license.expiresAt || "-"}`
            );
          } catch (err) {
            logger.error(`[AM BulkV5 BG] [${i + 1}/${total}] ${email} error: ${err.message}`);
          }

          if (i < total - 1) await sleep(1500);
        }
      })();

      // 3. Respon instan ke client
      return res.json({
        status: true,
        message:
          "Permintaan bulk berhasil diterima. Proses verifikasi dan aktivasi premium berjalan di latar belakang (background).",
        total,
        results,
      });
    } catch (err) {
      logger.error(`[AM BulkV5] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses bulk request Alight Motion",
      });
    }
  },
};
