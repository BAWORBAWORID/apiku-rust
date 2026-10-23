/**
 * AlightMotion Bulk V4 — Auto create CyberMail + send magic link + verify + apply premium
 * Powered by CyberMail (cybermail.us) + Google Identity Toolkit + Alight Creative Cloud Functions
 *
 * GET  /api/am/bulkv4?count=1
 * POST /api/am/bulkv4 -d {"count": 1, "async": true}
 */

import logger from "../../src/utils/logger.js";

const CYBERMAIL_API = "https://api.cybermail.us";
const CYBERMAIL_WEB = "https://cybermail.us";

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
    "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36",
};

const PURCHASE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Accept-Encoding": "gzip",
  "User-Agent": "okhttp/3.12.1",
};

const WORDLIST = [
  "cyber", "retro", "neon", "pixel", "hack", "code", "tech", "digital",
  "matrix", "quantum", "synth", "wave", "glow", "volt", "echo", "nova",
  "flux", "byte", "data", "core", "alpha", "beta", "gamma", "delta",
  "omega", "prime", "nexus", "vertex", "axis", "grid"
];

const FALLBACK_DOMAINS = [
  "cybermail.us",
  "cybermail.biz.id",
  "cybermail.my.id",
  "cyber-mail.site",
  "cybermail.web.id"
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function generateCodeOrder() {
  const r = (len) => {
    let str = "";
    for (let i = 0; i < len; i++) str += Math.floor(Math.random() * 10);
    return str;
  };
  return `GPA.${r(4)}.${r(4)}.${r(4)}.${r(5)}`;
}

// 1. Fetch domain aktif dari CyberMail
async function getDomains() {
  try {
    const res = await fetch(`${CYBERMAIL_API}/api/domains`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        const verified = json.data.filter((d) => d.verified).map((d) => d.name);
        if (verified.length > 0) return verified;
      }
    }
  } catch {}
  return FALLBACK_DOMAINS;
}

// 2. Generate email temporary CyberMail
export async function createEmail() {
  const domains = await getDomains();
  const domain = domains[Math.floor(Math.random() * domains.length)];
  const word = WORDLIST[Math.floor(Math.random() * WORDLIST.length)];
  const num = Math.floor(Math.random() * 999) + 1;
  const username = `${word}${num}`;
  const email = `${username}@${domain}`;
  return { email, username, domain };
}

// 3. Fetch inbox CyberMail
export async function checkInbox(email) {
  const addr = String(email || "").trim();
  if (!addr.includes("@")) throw new Error("Email tidak valid");

  const res = await fetch(`${CYBERMAIL_API}/api/inbox/${encodeURIComponent(addr)}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    throw new Error(`CyberMail inbox HTTP ${res.status}`);
  }

  const json = await res.json();
  return json.data?.emails || [];
}

// 4. Cari magic link dari pesan masuk
export function findVerifyLink(emails) {
  const patterns = [
    /https:\/\/alightcreative\.com\/auth_action\/?\?[^\s"'>]*oobCode=[^\s"'>&]+/,
    /https:\/\/[^"'\s]*alight[^"'\s]*firebaseapp\.com\/__\/auth\/links\?link=[^\s"'>]+/,
    /https:\/\/[^"'\s]*firebaseapp\.com\/__\/auth\/links\?link=[^\s"'>]+/,
    /https:\/\/alight-creative\.firebaseapp\.com\/__\/auth\/links\?link=[^\s"'>]+/
  ];

  for (const msg of emails) {
    const text = `${msg.html || ""}\n${msg.body || ""}`;
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[0].replace(/&amp;/g, "&");
    }
  }
  return null;
}

// 5. Polling inbox mencari verify link
export async function waitForVerifyLink(email, { maxAttempts = 25, intervalMs = 2500 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const emails = await checkInbox(email);
      if (emails.length) {
        const link = findVerifyLink(emails);
        if (link) return { link, attempts: attempt };
      }
    } catch {}
    await sleep(intervalMs);
  }
  return null;
}

// 6. Kirim magic link Firebase Auth
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
  name: "AlightMotion Bulk V4",
  description: "Generate Am Bulk v4",
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
    const total = Math.min(Math.max(parseInt(params.count) || 1, 1), 20);

    try {
      // 1. Buat email CyberMail & orderId untuk semua akun
      const results = [];
      for (let index = 0; index < total; index++) {
        const { email } = await createEmail();
        const orderId = generateCodeOrder();
        results.push({
          email,
          inboxUrl: `${CYBERMAIL_WEB}/?e=${email}`,
          orderId,
        });
        if (index < total - 1) await sleep(300);
      }

      // 2. Jalankan proses verifikasi dan apply premium di latar belakang (background)
      (async () => {
        for (let i = 0; i < results.length; i++) {
          const item = results[i];
          const email = item.email;
          const orderId = item.orderId;

          try {
            logger.info(`[AM BulkV4 BG] [${i + 1}/${total}] ${email}: Mengirim magic link...`);
            await sendMagicLink(email);

            logger.info(`[AM BulkV4 BG] [${i + 1}/${total}] ${email}: Menunggu link verifikasi di CyberMail...`);
            const found = await waitForVerifyLink(email, { maxAttempts: 25, intervalMs: 2500 });
            if (!found) {
              logger.error(`[AM BulkV4 BG] [${i + 1}/${total}] ${email}: Link verifikasi tidak ditemukan di inbox`);
              continue;
            }

            logger.info(`[AM BulkV4 BG] [${i + 1}/${total}] ${email}: Melakukan verifikasi login...`);
            const authData = await verifyMagicLink(email, found.link);
            if (!authData.idToken) {
              logger.error(`[AM BulkV4 BG] [${i + 1}/${total}] ${email}: Gagal memperoleh idToken`);
              continue;
            }

            logger.info(`[AM BulkV4 BG] [${i + 1}/${total}] ${email}: Menerapkan lisensi Premium Alight Motion (${orderId})...`);
            await applyPremium(authData.idToken, orderId);

            let license = { isPro: false, expiresAt: null };
            try {
              license = await getLicenseStatus(authData.idToken);
            } catch (e) {
              logger.warn(`[AM BulkV4 BG] ${email} getLicenseStatus warn: ${e.message}`);
            }

            logger.info(
              `[AM BulkV4 BG] [${i + 1}/${total}] ${email}: SUKSES PREMIUM! | isPro: ${license.isPro} | Order: ${orderId} | Expires: ${license.expiresAt || "-"}`
            );
          } catch (err) {
            logger.error(`[AM BulkV4 BG] [${i + 1}/${total}] ${email} error: ${err.message}`);
          }

          if (i < total - 1) await sleep(1500);
        }
      })();

      // 3. Langsung kirim respon ke client (struktur respon mirip bulkv3)
      return res.json({
        status: true,
        message: "Permintaan bulk berhasil diterima. Proses verifikasi dan aktivasi premium berjalan di latar belakang (background).",
        total,
        results,
      });
    } catch (err) {
      logger.error(`[AM BulkV4] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses bulk request Alight Motion",
      });
    }
  },
};
