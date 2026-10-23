import crypto from "crypto";

let cachedSid = "";

function loadSid() {
  return cachedSid;
}

function saveSid(sid) {
  if (sid) cachedSid = sid;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const BASE = "https://dy.kukutool.com";
const PAGE = "/rednote-downloader";
const RESP_KEY = "12345678901234567890123456789013";

function mapB64(e) {
  return e.split("").map((c) => {
    const t = "ZYXABCDEFGHIJKLMNOPQRSTUVWzyxabcdefghijklmnopqrstuvw9876543210-_".indexOf(c);
    return t === -1 ? c : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[t];
  }).join("");
}

function revBlocks(e, size = 8) {
  let r = "";
  for (let i = 0; i < e.length; i += size) r += e.slice(i, i + size).split("").reverse().join("");
  return r;
}

function xorEach(e, n = 90) {
  let r = "";
  for (let i = 0; i < e.length; i++) r += String.fromCharCode(e.charCodeAt(i) ^ n);
  return r;
}

function decryptResponse(data, iv) {
  let d = xorEach(data);
  let p = xorEach(iv);
  d = revBlocks(d);
  p = revBlocks(p);
  d = mapB64(d);
  p = mapB64(p);
  const key = crypto.createHash("sha256").update(RESP_KEY).digest();
  const dec = crypto.createDecipheriv("aes-256-cbc", key, Buffer.from(p, "base64"));
  const out = Buffer.concat([dec.update(Buffer.from(d, "base64")), dec.final()]);
  return JSON.parse(out.toString("utf8"));
}

async function buildPayload(plaintext, authKey, authSeed) {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash("sha256").update(`${authKey}:${authSeed}`).digest();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { payload: ct.toString("base64"), iv: iv.toString("base64") };
}

const hdr = {
  "Content-Type": "application/json",
  "User-Agent": UA,
  Origin: BASE,
  Referer: BASE + PAGE,
  Accept: "*/*",
  Cookie: "NEXT_LOCALE=en"
};

async function getAuthTicket(rawInput) {
  const sid = loadSid();
  const res = await fetch(BASE + "/api/auth-970b03", {
    method: "POST",
    headers: { ...hdr, Cookie: sid ? hdr.Cookie + "; " + sid : hdr.Cookie },
    body: JSON.stringify({
      requestURL: rawInput,
      pagePath: PAGE,
      mode: "single"
    }),
    signal: AbortSignal.timeout(30000)
  });
  const data = await res.json();
  if (!data?.k_970b03 || !data?.s_970b03) {
    throw new Error("auth ticket kosong: " + JSON.stringify(data).slice(0, 200));
  }
  const fresh = (typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [])
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith("parse_sid="));
  if (fresh) saveSid(fresh);
  return { authKey: data.k_970b03, authSeed: data.s_970b03, parseSid: fresh || sid };
}

async function parseWithTicket(rawInput, ticket, parseSid) {
  const plaintext = JSON.stringify({
    requestURL: rawInput,
    captchaKey: "",
    captchaInput: "",
    totalSuccessCount: "0",
    successCount: "0",
    firstSuccessDate: "",
    pagePath: PAGE,
    isMobile: "false",
    geoipIp: "",
    confirmPurchased: false,
    country_code: null
  });
  const { payload, iv } = await buildPayload(plaintext, ticket.authKey, ticket.authSeed);
  const res = await fetch(BASE + "/api/parse", {
    method: "POST",
    headers: { ...hdr, Cookie: hdr.Cookie + (parseSid ? "; " + parseSid : "") },
    body: JSON.stringify({
      version: 3,
      k_970b03: ticket.authKey,
      p_970b03: payload,
      r_970b03: 1,
      i_970b03: iv
    }),
    signal: AbortSignal.timeout(45000)
  });
  return res.json();
}

async function attempt(rawInput) {
  const ticket = await getAuthTicket(rawInput);
  const res = await parseWithTicket(rawInput, ticket, ticket.parseSid);
  const data = res.encrypt && res.data && res.iv ? decryptResponse(res.data, res.iv) : res;
  if (res.status !== 0 || !data) {
    return { ok: false, code: res.status ?? 200, message: res.message || "" };
  }

  const links = [];
  if (data.type === "video") {
    const vids = data.videos?.[0]?.video_fullinfo?.length
      ? data.videos[0].video_fullinfo
      : [{ url: data.url || data.videos?.[0]?.url }];
    for (const v of vids) {
      if (!v.url) continue;
      links.push({
        type: "video",
        quality: v.type || "HD",
        size: v.size ?? 0,
        url: v.url
      });
    }
  } else {
    for (const p of data.pics || []) {
      links.push({
        type: "picture",
        quality: "HD",
        size: 0,
        url: p
      });
    }
  }

  if (!links.length) {
    return { ok: false, code: 200, message: "Media link kosong atau tidak ditemukan" };
  }

  return {
    ok: true,
    result: {
      title: data.title ?? "",
      type: data.type ?? "",
      cover: data.cover ?? "",
      links
    }
  };
}

async function downloadRedNote(rawInput) {
  const match = String(rawInput || "").match(/https?:\/\/[^\s]+/i);
  const cleanUrl = match ? match[0] : String(rawInput || "").trim();

  if (!cleanUrl.startsWith("http")) {
    throw new Error("URL tidak valid");
  }

  for (let n = 1; n <= 2; n++) {
    try {
      const a = await attempt(cleanUrl);
      if (a.ok) {
        return a.result;
      }
      if (n === 2) {
        throw new Error(a.message || "Gagal mengurai media RedNote");
      }
      cachedSid = "";
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      if (n === 2) {
        throw err;
      }
      cachedSid = "";
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

export default {
  name: "RedNote Downloader",
  description: "Download video atau gambar dari RedNote (Xiaohongshu) tanpa watermark.",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL atau share link post RedNote/Xiaohongshu"
    }
  },

  features: {
    supports_video: true,
    supports_image: true
  },

  async run(req, res) {
    try {
      const url = req.query?.url || req.body?.url;

      if (!url || typeof url !== "string" || url.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi"
        });
      }

      const result = await downloadRedNote(url);

      res.json({
        status: true,
        result,
        timestamp: Date.now()
      });
    } catch (err) {
      console.error("RedNote Downloader Error:", err.message);

      let statusCode = 500;
      let errorMessage = err.message || "Gagal mendownload dari RedNote";

      if (err.message.includes("not found") || err.message.includes("tidak ditemukan") || err.message.includes("失效")) {
        statusCode = 404;
      }

      res.status(statusCode).json({
        status: false,
        message: errorMessage,
        timestamp: Date.now()
      });
    }
  }
};
