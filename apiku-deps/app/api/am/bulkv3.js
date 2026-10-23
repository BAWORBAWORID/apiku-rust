/**
 * AlightMotion Bulk V3 — Auto create tempmail + send magic link + verify + apply premium
 * Powered by tempmail-donz + Google Identity Toolkit + Alight Creative Cloud Functions
 *
 * GET  /api/am/bulkv3?count=1
 * POST /api/am/bulkv3 -d {"count": 1, "async": false}
 */

import axios from "axios";
import logger from "../../src/utils/logger.js";

const DONZ_BASE = "https://tempmail-donz.vercel.app";

const FIREBASE_WEB_API_KEY =
  process.env.ALIGHT_API_KEY || "AIzaSyDrZ9jr_Y16ltSBqsQR5IH6I04FRga6Ki0";
const FIREBASE_AUTH_BASE = "https://identitytoolkit.googleapis.com/v1/accounts";
const ALIGHT_CONTINUE_URL = "https://alightcreative.com/am/auth/finish";
const CLOUD_FUNCTIONS_BASE = "https://us-central1-alight-creative.cloudfunctions.net";
const VERIFY_PURCHASE_URL = "https://us-central1-alight-creative.cloudfunctions.net/verifyPurchase";
const PRODUCT_ID = "am.full.sub.annual.19q4";
const TOKEN = "mmgaobamlahbbeccfplmbkbb.AO-J1OzqG0or_GJJIx-ms8GrTm-jaglCRfhQSRPUZKpl2YspYS-oN7_94uv8RC5vQbvd_Ios2pPDStZ2n7F0hLE3FiOU7HS3R6Fquulv5xLXFECSv4ctElw";
const SKU_TYPE = "subs";
const FIREBASE_INSTANCE_ID_TOKEN = "cSDnCyp3T-uwp07z3tL86T:APA91bFkmvvsHw5nnqa1SBFci-99DRsKClLiETdRrVcJjS5yBx1v_FbCb1d8WhBuea_zmwnYBktyTIzcRhN4b6uNOUur9wPc0gKXmJDoZic0LhNq5V2s0xI";

const NATIVE_HEADERS = {
  "Content-Type": "application/json",
  Origin: "https://alight-creative.firebaseapp.com",
  Referer: "https://alight-creative.firebaseapp.com/",
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13; Redmi Note 7 Build/TQ3A.230901.001.B1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36",
};

const DONZ_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: `${DONZ_BASE}/`,
};

const purchaseHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Accept-Encoding": "gzip",
  "User-Agent": "okhttp/3.12.1",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function donzRequest(path, options = {}) {
  const res = await fetch(`${DONZ_BASE}${path}`, {
    ...options,
    headers: { ...DONZ_HEADERS, ...(options.headers || {}) },
    signal: AbortSignal.timeout(30000),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Respons bukan JSON (HTTP ${res.status}): ${text.slice(0, 120)}`);
  }
  if (!res.ok) throw new Error(json.message || json.error || `HTTP ${res.status}`);
  return json;
}

export async function createEmail() {
  const data = await donzRequest("/api/create", { method: "POST" });
  if (!data.email) throw new Error("Gagal membuat email sementara");
  return { email: data.email, token: data.token || null };
}

export async function checkInbox(email) {
  const addr = String(email || "").trim();
  if (!addr.includes("@")) throw new Error("Email tidak valid");
  const data = await donzRequest(`/api/inbox/${encodeURIComponent(addr)}`);
  return Array.isArray(data) ? data : [];
}

const bodyOf = (m) => m?.body_html || m?.html || m?.body_text || m?.text || "";

export function findVerifyLink(emails) {
  const patterns = [
    /https:\/\/alight-creative\.firebaseapp\.com\/__\/auth\/links\?link=[^\s"'>]+/,
    /https:\/\/[^"'\s]*alight[^"'\s]*firebaseapp\.com\/__\/auth\/links\?link=[^\s"'>]+/,
    /https:\/\/[^"'\s]*firebaseapp\.com\/__\/auth\/links\?link=[^\s"'>]+/,
    /https:\/\/alightcreative\.com\/auth_action\/?\?[^"'\s]*oobCode=[^"'\s&]+/,
    /https:\/\/[^"'\s]*alightcreative\.com\/auth_action\/?\?[^"'\s]*oobCode=[^"'\s&]+/,
  ];
  for (const msg of emails) {
    const body = bodyOf(msg);
    for (const p of patterns) {
      const m = body.match(p);
      if (m) return m[0].replace(/&amp;/g, "&");
    }
  }
  return null;
}

export async function waitForVerifyLink(email, { maxAttempts = 20, intervalMs = 4000 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let emails = [];
    try {
      emails = await checkInbox(email);
    } catch {
      /* mailbox baru */
    }
    if (emails.length) {
      const link = findVerifyLink(emails);
      if (link) return { link, attempts: attempt };
    }
    await sleep(intervalMs);
  }
  return null;
}

export async function sendMagicLink(email) {
  const payload = {
    requestType: "EMAIL_SIGNIN",
    email: String(email).trim(),
    continueUrl: ALIGHT_CONTINUE_URL,
    canHandleCodeInApp: true,
  };

  const res = await fetch(
    `${FIREBASE_AUTH_BASE}:sendOobCode?key=${FIREBASE_WEB_API_KEY}`,
    {
      method: "POST",
      headers: NATIVE_HEADERS,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    }
  );

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

export function extractOobCode(magicLink) {
  if (!magicLink) return "";
  const input = String(magicLink).trim();
  if (!input.includes("http") && !input.includes("=")) return input;

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

export async function verifyMagicLink(email, magicLinkOrOobCode) {
  const oobCode = extractOobCode(magicLinkOrOobCode);
  const res = await fetch(
    `${FIREBASE_AUTH_BASE}:signInWithEmailLink?key=${FIREBASE_WEB_API_KEY}`,
    {
      method: "POST",
      headers: NATIVE_HEADERS,
      body: JSON.stringify({ email: String(email).trim(), oobCode }),
      signal: AbortSignal.timeout(20000),
    }
  );

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

function generateCodeOrder() {
  const r = (len) => {
    let str = "";
    for (let i = 0; i < len; i++) str += Math.floor(Math.random() * 10);
    return str;
  };
  return `GPA.${r(4)}.${r(4)}.${r(4)}.${r(5)}`;
}

export async function applyPremium(idToken, customOrderId) {
  const finalOrderId = customOrderId || generateCodeOrder();
  const headers = {
    ...purchaseHeaders,
    authorization: `Bearer ${idToken}`,
    "firebase-instance-id-token": FIREBASE_INSTANCE_ID_TOKEN,
  };
  const response = await axios.post(
    VERIFY_PURCHASE_URL,
    {
      data: {
        productId: PRODUCT_ID,
        token: TOKEN,
        skuType: SKU_TYPE,
        orderId: finalOrderId,
      },
    },
    { headers, timeout: 30000 }
  );

  const resData = response.data || {};
  resData.applied_order_id = finalOrderId;
  return resData;
}

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

async function processFullAccount(customOrderId) {
  // 1. Buat email
  const { email, token } = await createEmail();

  // 2. Kirim magic link
  await sendMagicLink(email);

  // 3. Tunggu masuk inbox
  const found = await waitForVerifyLink(email, { maxAttempts: 25, intervalMs: 3000 });
  if (!found) {
    throw new Error(`Link verifikasi tidak masuk ke inbox (${email})`);
  }

  // 4. Verifikasi & login
  const authData = await verifyMagicLink(email, found.link);
  if (!authData.idToken) {
    throw new Error("Gagal memperoleh idToken saat login");
  }

  // 5. Apply Premium
  const premResult = await applyPremium(authData.idToken, customOrderId);

  // 6. Cek status lisensi
  let license = { isPro: false, expiresAt: null, benefits: [] };
  try {
    license = await getLicenseStatus(authData.idToken);
  } catch (e) {
    logger.warn(`[AM BulkV3] getLicenseStatus warn: ${e.message}`);
  }

  return {
    email,
    token,
    inboxUrl: `${DONZ_BASE}/${email}`,
    isPro: license.isPro,
    expiresAt: license.expiresAt,
    benefits: license.benefits,
    orderId: premResult.applied_order_id,
    idToken: authData.idToken,
    refreshToken: authData.refreshToken,
    localId: authData.localId,
    isNewUser: authData.isNewUser,
  };
}

export default {
  name: "AlightMotion Bulk V3",
  description: "Generate Am Bulk v3",
  category: "AlightMotion",
  methods: ["GET", "POST"],
  params: ["count"],
  paramsSchema: {
    count: {
      type: "number",
      required: true,
      default: 1,
      description: "Jumlah akun Alight Motion Premium yang ingin dibuat (maksimal 3 akun per request)",
      example: 1,
    },
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body };
    const total = Math.min(Math.max(parseInt(params.count) || 1, 1), 3);

    try {
      // 1. Buat email sementara untuk semua akun
      const results = [];
      for (let index = 0; index < total; index++) {
        const { email, token } = await createEmail();
        results.push({
          email,
          inboxUrl: `${DONZ_BASE}/${email}`,
        });
        if (index < total - 1) await sleep(500);
      }

      // 2. Jalankan proses verifikasi dan apply premium di latar belakang (background)
      (async () => {
        for (let i = 0; i < results.length; i++) {
          const item = results[i];
          const email = item.email;
          try {
            logger.info(`[AM BulkV3 BG] [${i + 1}/${total}] ${email}: Mengirim magic link...`);
            await sendMagicLink(email);

            logger.info(`[AM BulkV3 BG] [${i + 1}/${total}] ${email}: Menunggu link verifikasi masuk inbox...`);
            const found = await waitForVerifyLink(email, { maxAttempts: 25, intervalMs: 3000 });
            if (!found) {
              logger.error(`[AM BulkV3 BG] [${i + 1}/${total}] ${email}: Link verifikasi tidak ditemukan`);
              continue;
            }

            logger.info(`[AM BulkV3 BG] [${i + 1}/${total}] ${email}: Melakukan verifikasi login...`);
            const authData = await verifyMagicLink(email, found.link);
            if (!authData.idToken) {
              logger.error(`[AM BulkV3 BG] [${i + 1}/${total}] ${email}: Gagal memperoleh idToken`);
              continue;
            }

            logger.info(`[AM BulkV3 BG] [${i + 1}/${total}] ${email}: Menerapkan lisensi Premium...`);
            const premResult = await applyPremium(authData.idToken);

            let license = { isPro: false, expiresAt: null };
            try {
              license = await getLicenseStatus(authData.idToken);
            } catch (e) {
              logger.warn(`[AM BulkV3 BG] ${email} getLicenseStatus warn: ${e.message}`);
            }

            logger.info(
              `[AM BulkV3 BG] [${i + 1}/${total}] ${email}: SUKSES PREMIUM! | isPro: ${license.isPro} | Order: ${premResult.applied_order_id} | Expires: ${license.expiresAt || "-"}`
            );
          } catch (err) {
            logger.error(`[AM BulkV3 BG] [${i + 1}/${total}] ${email} error: ${err.message}`);
          }

          if (i < total - 1) await sleep(2000);
        }
      })();

      // 3. Langsung kirim respon ke client bahwa proses berjalan di latar belakang
      return res.json({
        status: true,
        message: "Permintaan bulk berhasil diterima. Proses verifikasi dan aktivasi premium berjalan di latar belakang (background).",
        total,
        results,
      });
    } catch (err) {
      logger.error(`[AM BulkV3] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses bulk request Alight Motion",
      });
    }
  },
};
