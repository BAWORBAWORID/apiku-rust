import https from "https";
import http from "http";
import { spawn } from "child_process";
import * as cheerio from "cheerio";
import { HttpsProxyAgent } from "https-proxy-agent";

const BASE_URL = "https://cekbansos.kemensos.go.id";
const CHECK_URL = "https://cekbansos.kemensos.go.id/cekbansos_nik";

const PROXY_URL = process.env.CEKBANSOS_PROXY || "https://202.61.105.82:443";

const BASE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "Connection": "keep-alive",
};

function buildProxyAgent() {
  return new HttpsProxyAgent(PROXY_URL, { rejectUnauthorized: false });
}

function httpRequest(opts, cookies = "") {
  const { url, method = "GET", headers = {}, body = null, timeout = 30000 } = opts;
  const u = new URL(url);
  const lib = u.protocol === "https:" ? https : http;

  const finalHeaders = { ...BASE_HEADERS, ...headers };
  if (cookies) finalHeaders["Cookie"] = cookies;

  const agent = buildProxyAgent();

  return new Promise((resolve, reject) => {
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: finalHeaders,
      agent,
      rejectUnauthorized: false,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        let setCookies = res.headers["set-cookie"] || [];
        if (!Array.isArray(setCookies)) setCookies = [setCookies];
        resolve({
          status: res.statusCode,
          setCookies,
          location: res.headers["location"] || null,
          raw: buffer.toString("utf8"),
          buffer,
        });
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error(`Timeout after ${timeout}ms`)));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const OCR_HELPER = `
const { DdddOcr } = require('ddddocr-node');
let chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  try {
    const ocr = new DdddOcr();
    const out = await ocr.classification(Buffer.concat(chunks));
    process.stdout.write(JSON.stringify({ ok: true, result: out }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: e.message }));
  }
});
`;

function ocrImage(buffer) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["-e", OCR_HELPER], {
      stdio: ["pipe", "pipe", "ignore"],
      cwd: process.cwd(),
    });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("error", () => resolve(""));
    child.on("close", () => {
      try {
        const parsed = JSON.parse(out);
        if (parsed.ok) return resolve(parsed.result.replace(/[^a-zA-Z0-9]/g, "").toLowerCase());
        return resolve("");
      } catch {
        return resolve("");
      }
    });
    child.stdin.write(buffer);
    child.stdin.end();
  });
}

function mergeCookies(jar, setCookies) {
  for (const sc of setCookies) {
    const pair = sc.split(";")[0];
    const [name] = pair.split("=");
    jar = jar.split("; ").filter((p) => p && !p.startsWith(name + "=")).concat(pair).filter(Boolean).join("; ");
  }
  return jar;
}

async function scrapeBansos(nik, options = {}) {
  const { max_retries = 5 } = options;

  let jar = "";

  for (let attempt = 1; attempt <= max_retries; attempt++) {
    try {
      const homeRes = await httpRequest({ url: BASE_URL + "/" }, jar);
      if (homeRes.status !== 200) continue;
      jar = mergeCookies(jar, homeRes.setCookies);

      const $ = cheerio.load(homeRes.raw);
      const tokenInput = $("input[name=\"_token\"]");
      if (!tokenInput.length) continue;
      const csrf_token = tokenInput.val() || "";

      const capMatch = homeRes.raw.match(/src="(https:\/\/cekbansos\.kemensos\.go\.id\/captcha\/[^"]+)"/);
      if (!capMatch) continue;
      const captchaUrl = capMatch[1];

      const capRes = await httpRequest({ url: captchaUrl }, jar);
      if (capRes.status !== 200) continue;
      jar = mergeCookies(jar, capRes.setCookies);

      const captchaCode = await ocrImage(capRes.buffer);
      if (!captchaCode) continue;

      const postBody = new URLSearchParams({
        _token: csrf_token,
        nik_input: nik,
        captcha: captchaCode,
      }).toString();

      const postRes = await httpRequest({
        url: CHECK_URL,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Origin": BASE_URL,
          "Referer": BASE_URL + "/",
        },
        body: postBody,
      }, jar);
      jar = mergeCookies(jar, postRes.setCookies);

      if (/tidak sesuai|salah|ulangi|expired/i.test(postRes.raw) || postRes.location === BASE_URL + "/") {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      if (postRes.status === 302 || postRes.status === 301 || postRes.location) {
        const target = postRes.location.startsWith("http") ? postRes.location : BASE_URL + postRes.location;
        const resultRes = await httpRequest({ url: target }, jar);
        return parseResult(resultRes.raw, nik);
      }

      return parseResult(postRes.raw, nik);
    } catch (e) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return { success: false, message: `Gagal menyelesaikan captcha setelah ${max_retries} percobaan. Silakan coba lagi.` };
}

function parseResult(html, nik) {
  const $ = cheerio.load(html);
  if (html.includes("Tidak Ditemukan") || html.toLowerCase().includes("tidak terdaftar")) {
    return { success: true, nik, found: false, message: "Data Penerima Manfaat tidak ditemukan / tidak terdaftar dalam DTKS/DTSEN." };
  }
  const table = $("table").first();
  if (!table.length) return { success: false, message: "Tabel hasil tidak ditemukan pada respons server." };
  const tbody = table.find("tbody");
  if (!tbody.length) return { success: true, nik, found: false, message: "Data tidak ditemukan." };

  const results = [];
  tbody.find("tr").each((_, row) => {
    const tds = $(row).find("td").map((_, td) => $(td).text().trim()).get();
    if (tds.length >= 10) {
      results.push({
        nama: tds[0], desil: tds[1],
        sembako: { status: tds[2], periode: tds[3] },
        pkh: { status: tds[4], periode: tds[5] },
        pbi_jk: { status: tds[6], periode: tds[7], keterangan: tds[8] },
        status_kpd: tds[9],
      });
    }
  });
  return { success: true, nik, found: results.length > 0, data: results };
}

export default {
  name: "Cek Bansos (Kemensos)",
  description: "Cek data penerima bantuan sosial (Bansos) berdasarkan NIK — status DTKS/DTSEN, desil, Sembako, PKH, PBI-JK, dan KPD",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["nik"],
  paramsSchema: {
    nik: { type: "string", required: true, description: "Nomor Induk Kependudukan (16 digit)", example: "3372052106610006", default: "3372052106610006", minLength: 16, maxLength: 16 }
  },
  async run(req, res) {
    const { nik } = { ...req.query, ...req.body };
    if (!nik) {
      return res.status(400).json({ error: "Parameter 'nik' wajib diisi (16 digit)." });
    }
    if (!/^\d{16}$/.test(String(nik))) {
      return res.status(400).json({ error: "NIK harus 16 digit angka." });
    }
    const result = await scrapeBansos(String(nik));
    if (!result.success) {
      return res.status(502).json(result);
    }
    return res.json(result);
  }
};