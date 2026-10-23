/**
 * TikTok Downloader v3 — via snaptik.app (challenge-based API v3)
 * Reverse-engineered from https://snaptik.app/js/core.min.js
 *  1. POST /api/token  -> { id, p }
 *  2. Decrypt p (AES-256-CBC, key = SHA256("sn4pt1k_v3r1fy2026:"+id), 16B IV prefix, rest ciphertext)
 *     -> JSON challenge math { t,a,b,s,r,n,w,i,m,c,_e,_h }
 *  3. Solve challenge -> token = id:<result>:<_e>:<_h>  (dikirim sbg header X-Verify)
 *  4. GET /api/extract?url=<tiktok> -> { data: { downloadUrl, hdDownloadUrl, ... } } (retry sekali saat 403)
 *
 * GET  /api/downloader/tiktokv3?url=https://vt.tiktok.com/ZSbm6fY8P/
 * POST /api/downloader/tiktokv3
 */

import crypto from "node:crypto";

const BASE = "https://snaptik.app";
const PAGE = `${BASE}/en3`;
const SECRET = "sn4pt1k_v3r1fy2026";

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";

function decryptPayload(id, payloadB64) {
  const buf = Buffer.from(payloadB64, "base64");
  const iv = buf.subarray(0, 16);
  const ct = buf.subarray(16);
  const key = crypto.createHash("sha256").update(`${SECRET}:${id}`).digest();
  const dec = crypto.createDecipheriv("aes-256-cbc", key, iv);
  const pt = Buffer.concat([dec.update(ct), dec.final()]);
  return JSON.parse(pt.toString("utf8"));
}

function solveChallenge(A) {
  switch (A.t) {
    case "b": return (A.a ^ A.b) >> A.s & 255;
    case "r": return A.n.reduce((sum, v) => sum + v, 0) * 2 + 1;
    case "c": return A.w.charCodeAt(A.i) * A.m;
    case "m": return (A.a + A.b) % 100 * A.c;
    case "n": return A.a * A.b + A.b * A.c + A.c * A.a - A.a;
    default: throw new Error("Unknown challenge type: " + A.t);
  }
}

function cookieHeader(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

async function getVerifyToken(cookie) {
  const res = await fetch(`${BASE}/api/token`, {
    method: "POST",
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/json",
      "Accept": "application/json, text/plain, */*",
      "User-Agent": UA,
      "Referer": PAGE,
      ...(cookie ? { Cookie: cookie } : {})
    }
  });
  const tok = await res.json();
  const A = decryptPayload(tok.id, tok.p);
  const P = solveChallenge(A);
  return `${tok.id}:${P}:${A._e}:${A._h}`;
}

async function ask(url) {
  const homeRes = await fetch(PAGE, {
    headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }
  });
  const cookie = cookieHeader(homeRes);

  let data = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const verify = await getVerifyToken(cookie);
      const res = await fetch(`${BASE}/api/extract?url=${encodeURIComponent(url)}`, {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "X-Verify": verify,
          "Accept": "application/json, text/plain, */*",
          "User-Agent": UA,
          "Referer": PAGE,
          ...(cookie ? { Cookie: cookie } : {})
        }
      });
      if (res.status === 403) {
        lastErr = new Error(`Challenge rejected (HTTP 403), attempt ${attempt + 1}`);
        continue;
      }
      const json = await res.json();
      data = json.data || json;
      break;
    } catch (e) {
      lastErr = e;
    }
  }

  if (!data) {
    throw new Error(lastErr?.message || "Gagal mendapatkan data TikTok");
  }

  const author = (data.author && (data.author.name || data.author.username)) || "";
  const result = {
    id: data.id || null,
    type: data.type || "video",
    title: data.title || "",
    thumbnail: data.thumbnail || null,
    author,
    stats: data.stats || null,
    duration: data.videoDuration || null,
    downloadUrl: data.downloadUrl || null,
    hdDownloadUrl: data.hdDownloadUrl ? `${BASE}${data.hdDownloadUrl}` : null
  };

  return { Status: true, Code: 200, Result: result };
}

export default {
  name: "TikTok Downloader v3",
  description: "Download video TikTok tanpa watermark",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string", required: true,
      description: "URL video TikTok",
      default: "https://vt.tiktok.com/ZSbm6fY8P/",
      example: "https://vt.tiktok.com/ZSbm6fY8P/"
    }
  },

  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body };

      if (!url || !String(url).trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi"
        });
      }

      const result = await ask(String(url).trim());

      return res.status(result.Code || 200).json({
        status: result.Status,
        ...(result.Status
          ? { input: url.trim(), result: result.Result }
          : { message: "Gagal mendapatkan data TikTok" }
        )
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal mendownload TikTok"
      });
    }
  }
};