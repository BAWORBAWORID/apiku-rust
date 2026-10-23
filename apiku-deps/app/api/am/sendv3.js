/**
 * AlightMotion Send v3 — v3 relyingparty (klien Android asli)
 *
 *BEDA dari endpoint lain di folder am/:
 *   api/am/send     → membungkus src/utils/amService.js (createAuthUri DULUAN
 *                     lalu getOobConfirmationCode)
 *   api/am/sendv2   → identitytoolkit v1/accounts:sendOobCode (requestType
 *                     EMAIL_SIGNIN, key & UA web berbeda)
 *   api/am/sendv3   → v3/relyingparty langsung TANPA createAuthUri, memakai
 *                     header klien Android com.alightcreative.motion
 *
 * Bedanya nyata dari v1/v2, bukan cuma ganti nama:
 *   1. requestType 6 (v1 memakai EMAIL_SIGNIN)
 *   2. continueUrl tanpa "?" di depan -> "https://alightcreative.com?ui_sid=..."
 *   3. Tidak ada langkah createAuthUri, jadi satu request saja
 *   4. action=extract menerima oobCode telanjang, bukan cuma link lengkap
 *
 * TIDAK memakai header IP palsu (x-forwarded-for / x-real-ip / client-ip /
 * x-originating-ip / x-cluster-client-ip). Header kinduk itu ada di sumber
 * script WhatsApp aslinya, tapi tujuannya membuat tiap request terlihat dari
 * IP berbeda — yaitu毫/defeating rate limit Google. Header di bawah hanya
 * meniru identitas klien Android yang asli.
 *
 * CATATAN KUOTA: endpoint ini dan v1/v2 memanggil Google Identity Toolkit yang
 * SAMA, jadi quota-nya global dan dibagi bersama. QUOTA_EXCEEDED (domain:
 * global) berarti semua jalur gagal sampai reset harian — bukan bug endpoint.
 */

import axios from "axios";
import logger from "../../src/utils/logger.js";

const API_KEY = "AIzaSyDtG1AU22ErnQD60AzBAcaknySiz9_CEq0";
const IDT = "https://www.googleapis.com/identitytoolkit/v3/relyingparty";
const CONTINUE_URL = "https://alightcreative.com?ui_sid=0366624874&ui_sd=0";
const TIMEOUT = 30000;

/** Header klien Android com.alightcreative.motion (tanpa header IP palsu). */
const ANDROID_HEADERS = {
  "content-type": "application/json",
  "x-android-package": "com.alightcreative.motion",
  "x-android-cert": "ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8",
  "user-agent": "dalvik/2.1.0 (linux; u; android 15; 23127pn0cc build/bp1a.250505.005)",
};

/**
 * Baca pesan error Google + deteksi kuota habis.
 */
function describeError(err) {
  const raw = err.response?.data;
  if (raw === undefined || raw === null) {
    return { message: err.message || "Gagal menghubungi Google.", code: null, quota: false };
  }

  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { message: raw.slice(0, 250), code: null, quota: false };
    }
  }

  const e = parsed?.error || parsed;
  const code = e?.code ?? null;
  const message = e?.message || "Gagal mengirim magic link.";

  // Firebase: { error: { code:400, message:"QUOTA_EXCEEDED ...", errors:[{ domain:'global' }] } }
  const quota = /QUOTA_EXCEEDED|quota/i.test(`${message} ${JSON.stringify(e?.errors || [])}`);

  return { message, code, quota };
}

function httpStatusFor(info) {
  if (info.quota) return 429;
  if (info.code === 400) return 400;
  if (info.code === 401 || info.code === 403) return 502;
  if (info.code === 404) return 404;
  return 502;
}

/**
 * Ambil oobCode dari link ATAU dari oobCode telanjang.
 * Handle varian HTML-escape (&amp;), URL bersarang (link=/q=/url=), dan
 * token mentah 10+ karakter tanpa "://".
 */
export function extractOobCode(raw) {
  if (!raw) return null;
  const input = String(raw).trim();

  // (4) oobCode telanjang: 10+ karakter, tanpa skema URL
  if (!input.includes("://") && /^[a-zA-Z0-9_-]{10,}$/.test(input)) return input;

  let s = input.replace(/&amp;/g, "&");
  try {
    s = decodeURIComponent(s);
  } catch {
    /* biarkan kalau bukan URI-encoded */
  }

  try {
    const u = new URL(s);
    let code = u.searchParams.get("oobCode");
    if (!code) {
      const nested = u.searchParams.get("link") || u.searchParams.get("q") || u.searchParams.get("url");
      if (nested) {
        try {
          code = new URL(nested).searchParams.get("oobCode");
        } catch {
          /* nested bukan URL */
        }
      }
    }
    if (code) return code.replace(/[^a-zA-Z0-9_-]/g, "");
  } catch {
    /* bukan URL valid, lanjut ke regex */
  }

  return s.match(/[?&]?oobCode=([a-zA-Z0-9_-]+)/i)?.[1] || null;
}

/** Kirim magic link lewat v3/relyingparty/getOobConfirmationCode. */
async function sendMagicLink(email) {
  const body = {
    requestType: 6,
    email,
    androidInstallApp: true,
    canHandleCodeInApp: true,
    continueUrl: CONTINUE_URL,
    iosBundleId: "com.alightcreative.motion",
    androidPackageName: "com.alightcreative.motion",
    androidMinimumVersion: "585",
    clientType: "CLIENT_TYPE_ANDROID",
  };

  const { data } = await axios.post(
    `${IDT}/getOobConfirmationCode?key=${API_KEY}`,
    body,
    { headers: ANDROID_HEADERS, timeout: TIMEOUT }
  );
  return data;
}

export default {
  name: "AlightMotion Send v3",
  description:
    "Kirim magic link verifikasi Alight Motion lewat v3/relyingparty dengan header klien Android asli (tanpa pre-step createAuthUri), plus ekstraksi oobCode dari link maupun kode telanjang.",
  category: "AlightMotion",
  methods: ["GET", "POST"],
  params: ["email", "action"],
  paramsSchema: {
    email: {
      type: "string",
      required: false,
      description: "Email tujuan (wajib untuk action=send)",
      example: "user@email.com",
    },
    action: {
      type: "string",
      required: false,
      default: "send",
      enum: ["send", "extract"],
      description: "send = kirim magic link, extract = ambil oobCode dari param link",
    },
    link: {
      type: "string",
      required: false,
      description:
        "Link magic link ATAU oobCode telanjang (wajib untuk action=extract). Contoh: UIe3NOSC3EuqnH7L5...",
      example: "https://alightcreative.com/auth_action/?mode=signIn&oobCode=ABC123",
    },
  },

  async run(req, res) {
    const start = Date.now();
    const { email, action, link } = { ...req.query, ...req.body };
    const act = String(action || "send").toLowerCase();

    try {
      // action=extract — parsing lokal, tidak menyentuh jaringan
      if (act === "extract") {
        if (!link || typeof link !== "string" || !link.trim()) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'link' wajib diisi untuk action=extract",
          });
        }

        const oobCode = extractOobCode(link.trim());
        if (!oobCode) {
          return res.status(404).json({
            status: false,
            message: "oobCode tidak ditemukan. Kirim link auth_action lengkap atau kode oobCode telanjang.",
          });
        }

        return res.json({
          status: true,
          result: {
            oobCode,
            source: link.trim().includes("://") ? "link" : "raw-token",
            length: oobCode.length,
          },
        });
      }

      if (!email || typeof email !== "string" || !email.includes("@")) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'email' wajib diisi dan harus valid",
        });
      }

      const addr = email.trim().toLowerCase();

      try {
        const data = await sendMagicLink(addr);
        logger.info(`[am/sendv3] magic link terkirim ke ${addr}`);
        return res.json({
          status: true,
          message: "Link berhasil dikirim.",
          result: {
            email: addr,
            endpoint: "v3/relyingparty/getOobConfirmationCode",
            requestType: 6,
            responseTime: `${Date.now() - start}ms`,
          },
        });
      } catch (e) {
        const info = describeError(e);
        logger.warn(`[am/sendv3] gagal: ${info.message}`);

        const message = info.quota
          ? `Kuota Google habis untuk email sign-in (${info.message}). Batas ini global dan dibagi juga oleh /api/am/send dan /api/am/sendv2 — perlu menunggu reset harian.`
          : info.message;

        return res.status(httpStatusFor(info)).json({
          status: false,
          message,
          result: { email: addr, quota: info.quota, responseTime: `${Date.now() - start}ms` },
        });
      }
    } catch (err) {
      logger.error(`[am/sendv3] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Failed to send magic link",
        result: { responseTime: `${Date.now() - start}ms` },
      });
    }
  },
};
