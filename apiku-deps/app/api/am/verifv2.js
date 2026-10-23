import axios from "axios";
import logger from "../../src/utils/logger.js";

const DEFAULT_API_KEY = "AIzaSyDtG1AU22ErnQD60AzBAcaknySiz9_CEq0";
const VERIFY_PURCHASE_URL = "https://us-central1-alight-creative.cloudfunctions.net/verifyPurchase";
const PRODUCT_ID = "am.full.sub.annual.19q4";
const TOKEN = "mmgaobamlahbbeccfplmbkbb.AO-J1OzqG0or_GJJIx-ms8GrTm-jaglCRfhQSRPUZKpl2YspYS-oN7_94uv8RC5vQbvd_Ios2pPDStZ2n7F0hLE3FiOU7HS3R6Fquulv5xLXFECSv4ctElw";
const SKU_TYPE = "subs";
const FIREBASE_INSTANCE_ID_TOKEN = "cSDnCyp3T-uwp07z3tL86T:APA91bFkmvvsHw5nnqa1SBFci-99DRsKClLiETdRrVcJjS5yBx1v_FbCb1d8WhBuea_zmwnYBktyTIzcRhN4b6uNOUur9wPc0gKXmJDoZic0LhNq5V2s0xI";

const androidHeaders = {
  "Content-Type": "application/json",
  "X-Android-Package": "com.alightcreative.motion",
  "X-Android-Cert": "ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8",
  "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 15; 23127PN0CC Build/BP1A.250505.005)"
};

const purchaseHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Accept-Encoding": "gzip",
  "User-Agent": "okhttp/3.12.1"
};

function extractOobCode(fullUrl) {
  if (!fullUrl) return null;
  try {
    let cleanUrl = String(fullUrl).trim();
    // Decode hingga 3 kali untuk menangani nested encoding (%253D, %3D, dll)
    for (let i = 0; i < 3; i++) {
      try {
        const decoded = decodeURIComponent(cleanUrl);
        if (decoded === cleanUrl) break;
        cleanUrl = decoded;
      } catch {
        break;
      }
    }

    // Cek pattern oobCode=
    const match = cleanUrl.match(/[?&]oobCode=([a-zA-Z0-9_-]+)/i) || cleanUrl.match(/oobCode=([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) {
      return match[1].replace(/[^a-zA-Z0-9_-]/g, "");
    }

    // Jika input langsung berupa oobCode murni (panjang > 30 karakter)
    if (/^[a-zA-Z0-9_-]{30,}$/.test(cleanUrl)) {
      return cleanUrl;
    }
  } catch {}
  return null;
}

function extractApiKey(fullUrl) {
  if (!fullUrl) return DEFAULT_API_KEY;
  try {
    let cleanUrl = String(fullUrl);
    for (let i = 0; i < 3; i++) {
      try {
        const decoded = decodeURIComponent(cleanUrl);
        if (decoded === cleanUrl) break;
        cleanUrl = decoded;
      } catch {
        break;
      }
    }
    const match = cleanUrl.match(/[?&]apiKey=([a-zA-Z0-9_-]+)/i) || cleanUrl.match(/apiKey=([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) {
      return match[1];
    }
  } catch {}
  return DEFAULT_API_KEY;
}

function generateCodeOrder() {
  const r = (len) => {
    let str = "";
    for (let i = 0; i < len; i++) str += Math.floor(Math.random() * 10);
    return str;
  };
  return `GPA.${r(4)}.${r(4)}.${r(4)}.${r(5)}`;
}

async function signInEmail(email, oobCode, apiKey) {
  const keysToTry = [apiKey, DEFAULT_API_KEY, "AIzaSyDrZ9jr_Y16ltSBqsQR5IH6I04FRga6Ki0"];
  const uniqueKeys = [...new Set(keysToTry.filter(Boolean))];

  let lastError = null;

  for (const key of uniqueKeys) {
    // Metode 1: v3 relyingparty emailLinkSignin (klien Android resmi)
    try {
      const res = await axios.post(
        `https://www.googleapis.com/identitytoolkit/v3/relyingparty/emailLinkSignin?key=${key}`,
        { email, oobCode, clientType: "CLIENT_TYPE_ANDROID" },
        { headers: androidHeaders, timeout: 30000 }
      );
      if (res.data?.idToken) return res.data;
    } catch (e) {
      lastError = e;
    }

    // Metode 2: v1 accounts:signInWithEmailLink
    try {
      const res = await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink?key=${key}`,
        { email, oobCode },
        {
          headers: {
            ...androidHeaders,
            Referer: "https://alight-creative.firebaseapp.com",
            Origin: "https://alight-creative.firebaseapp.com"
          },
          timeout: 30000
        }
      );
      if (res.data?.idToken) return res.data;
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error("Gagal verifikasi email link");
}

async function applyPremium(idToken, customOrderId) {
  const codeorder = generateCodeOrder();
  const finalOrderId = customOrderId ? customOrderId.trim() : codeorder;
  const headers = {
    ...purchaseHeaders,
    authorization: `Bearer ${idToken}`,
    "firebase-instance-id-token": FIREBASE_INSTANCE_ID_TOKEN
  };

  const response = await axios.post(
    VERIFY_PURCHASE_URL,
    {
      data: {
        productId: PRODUCT_ID,
        token: TOKEN,
        skuType: SKU_TYPE,
        orderId: finalOrderId
      }
    },
    { headers, timeout: 30000 }
  );

  return {
    data: response.data,
    orderId: finalOrderId
  };
}

export default {
  name: "AlightMotion Verify v2",
  description: "Verifikasi email link & apply premium Alight Motion dengan dukungan Custom Order ID",
  category: "AlightMotion",
  methods: ["GET", "POST"],
  params: ["email", "link", "orderid"],
  paramsSchema: {
    email: {
      type: "string",
      required: true,
      description: "Email yang menerima magic link",
      example: "user@email.com"
    },
    link: {
      type: "string",
      required: true,
      description: "Full link verifikasi atau oobCode dari email",
      example: "https://alightcreative.com/auth_action/?mode=signIn&oobCode=xxx"
    },
    orderid: {
      type: "string",
      required: false,
      description: "Custom Order ID untuk Google Play GPA (opsional, auto random GPA)",
      example: "GPA.1234.5678.9012.34567"
    }
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      const { email, link } = params;
      const customOrderId = params.orderid || params.orderId || params.order_id;

      if (!email || typeof email !== "string" || !email.includes("@")) {
        return res.status(400).json({
          status: false,
          error: "Parameter 'email' wajib diisi dan harus valid"
        });
      }

      const rawLink = link || params.oobCode || params.oobcode;
      if (!rawLink || typeof rawLink !== "string") {
        return res.status(400).json({
          status: false,
          error: "Parameter 'link' wajib diisi (bisa full URL atau oobCode langsung)"
        });
      }

      const oobCode = extractOobCode(rawLink);
      if (!oobCode) {
        return res.status(400).json({
          status: false,
          error: "Gagal mengekstrak oobCode dari link. Pastikan link mengandung oobCode valid."
        });
      }

      const apiKey = extractApiKey(rawLink);
      logger.info(`[AM VERIFYv2] Verifying email=${email.trim()} apiKey=${apiKey}`);

      const signinRes = await signInEmail(email.trim(), oobCode, apiKey);
      const idToken = signinRes.idToken;
      if (!idToken) {
        return res.status(502).json({
          status: false,
          error: "Gagal mendapatkan idToken dari hasil verifikasi"
        });
      }

      const premiumRes = await applyPremium(idToken, customOrderId);

      return res.json({
        status: true,
        email: email.trim(),
        message: "Premium berhasil diterapkan",
        orderId: premiumRes.orderId,
        signin: {
          localId: signinRes.localId,
          email: signinRes.email,
          isNewUser: signinRes.isNewUser
        },
        premium: premiumRes.data
      });
    } catch (err) {
      logger.error(`[AM VERIFYv2] Error: ${err.message}`);
      const errMsg =
        err.response?.data?.error?.message ||
        (typeof err.response?.data === "string" ? err.response.data : null) ||
        err.message;
      return res.status(500).json({ status: false, error: errMsg });
    }
  }
};