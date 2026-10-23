/**
 * WellBypass Link Bypass API  (api/bypass/wellbypass)
 *
 * Memakai backend upstream wellbypass.my.id.
 *
 * Kontrak upstream (dicek dari bundle frontend -r6eay789pe9.js / 3zjghdb29mej6.js):
 *   GET  /api/captcha-config  -> { status, mode: "cf" | "hc", siteKey }
 *        "cf" = Cloudflare Turnstile, "hc" = hCaptcha
 *   POST /api/bypass  { url, turnstileToken }
 *        -> sync  : { status:true, bypassedUrl, ... }
 *        -> async : { status:true, async:true, jobId, deviceId }
 *        -> error : { status:false, code, message }
 *           code ∈ INVALID_URL | UNSUPPORTED_DOMAIN | RATE_LIMITED
 *                 | CAPTCHA_FAILED | CAPTCHA_TOKEN_REUSED | CAPTCHA_REQUIRED
 *   GET  /api/bypass/status?jobId=..&deviceId=..
 *        -> { jobStatus: "processing"|"done"|"failed", progress,
 *             originalUrl, bypassedUrl, isDirectUrl, executionTimeMs, fromCache }
 *
 * Catatan penting:
 *  - Field request tetap bernama `turnstileToken` walaupun mode-nya hCaptcha.
 *  - Auto-solve hanya mungkin untuk mode "cf". Untuk mode "hc" hCaptcha diam-diam
 *    mentok di IP datacenter (widget render, tapi token & error-callback tidak
 *    pernah keluar), jadi token harus dikirim manual lewat parameter.
 *
 * GET  /api/bypass/wellbypass?url=...&turnstileToken=...
 * POST /api/bypass/wellbypass   Body: { url, turnstileToken }
 */

import logger from "../../src/utils/logger.js";

const WELLBYPASS_URL = "https://wellbypass.my.id";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CAPTCHA_CONFIG_TTL = 10 * 60 * 1000;
let captchaConfigCache = null;

const UPSTREAM_CODES = {
  INVALID_URL: "URL tidak valid",
  UNSUPPORTED_DOMAIN: "Domain ini belum didukung wellbypass.my.id",
  RATE_LIMITED: "Rate limited upstream — tunggu sebentar lalu coba lagi",
  CAPTCHA_FAILED: "Token captcha ditolak upstream",
  CAPTCHA_TOKEN_REUSED: "Token captcha sudah pernah dipakai — generate token baru",
  CAPTCHA_REQUIRED: "Token captcha wajib diisi",
};

function generateDeviceId() {
  const fingerprint = [UA, "en-US", "1920x1080x24", "Asia/Jakarta", "8"].join("::");
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    hash = (hash << 5) - hash + fingerprint.charCodeAt(i) | 0;
  }
  return `wb_${Math.abs(hash).toString(36)}_${Date.now().toString(36)}`;
}

function baseHeaders(deviceId) {
  return {
    "Content-Type": "application/json",
    "User-Agent": UA,
    "x-device-id": deviceId,
    Origin: WELLBYPASS_URL,
    Referer: `${WELLBYPASS_URL}/id`,
  };
}

async function getCaptchaConfig() {
  if (captchaConfigCache && Date.now() - captchaConfigCache.at < CAPTCHA_CONFIG_TTL) {
    return captchaConfigCache.config;
  }

  const res = await fetch(`${WELLBYPASS_URL}/api/captcha-config`, {
    headers: { "User-Agent": UA, Referer: `${WELLBYPASS_URL}/id` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Gagal membaca konfigurasi captcha upstream (HTTP ${res.status})`);

  const data = await res.json().catch(() => null);
  if (!data?.siteKey) throw new Error("Upstream tidak mengembalikan siteKey");

  const config = { mode: data.mode || "unknown", siteKey: data.siteKey };
  captchaConfigCache = { config, at: Date.now() };
  return config;
}

async function solveTurnstile(siteKey) {
  const { exec } = await import("node:child_process");
  const pageUrl = `${WELLBYPASS_URL}/id`;
  const { stdout } = await new Promise((resolve, reject) => {
    exec(
      `npx --yes haidarcf turnstile-min --url ${pageUrl} --sitekey ${siteKey}`,
      { timeout: 35000, maxBuffer: 4 * 1024 * 1024 },
      (err, out) => (err ? reject(err) : resolve(out))
    );
  });
  const idx = stdout.indexOf("{");
  if (idx === -1) throw new Error("Solver output invalid");
  const data = JSON.parse(stdout.slice(idx));
  if (!data.token) throw new Error("Failed to obtain captcha token");
  return data.token;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Job async perlu dipolling. Kode lama sama sekali tidak menangani ini sehingga
 * job yang diproses di background dilaporkan sebagai "Gagal bypass link".
 */
async function pollJob(jobId, deviceId, maxWaitMs = 45000) {
  const deadline = Date.now() + maxWaitMs;
  let last = null;

  while (Date.now() < deadline) {
    const res = await fetch(
      `${WELLBYPASS_URL}/api/bypass/status?jobId=${encodeURIComponent(jobId)}&deviceId=${encodeURIComponent(deviceId)}`,
      { headers: { "User-Agent": UA, "x-device-id": deviceId, Referer: `${WELLBYPASS_URL}/id` }, signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) throw new Error(`Polling job gagal (HTTP ${res.status})`);

    const data = await res.json();
    last = data;

    if (data.jobStatus === "done") return { done: true, data };
    if (data.jobStatus === "failed") {
      throw new Error(UPSTREAM_CODES[data.code] || data.message || `Job gagal (${data.code || "unknown"})`);
    }
    await sleep(2000);
  }

  return { done: false, data: last, timedOut: true };
}

export default {
  name: "WellBypass Link Bypass",
  description:
    "Bypass shortlink (Linkvertise, Lootlabs, Workink, dll) lewat backend wellbypass.my.id. Butuh token captcha bila upstream memakai hCaptcha.",
  category: "Bypass",
  methods: ["GET", "POST"],
  params: ["url", "turnstileToken", "wait"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL shortlink yang ingin di-bypass (Linkvertise, Lootlabs, Workink, dll)",
      example: "https://linkvertise.com/546946/mYoUbm5Ro7gU",
    },
    turnstileToken: {
      type: "string",
      required: false,
      description:
        "Token captcha. Wajib bila upstream memakai hCaptcha (mode 'hc'). Ambil dari widget hCaptcha di wellbypass.my.id/id. Untuk mode 'cf' (Turnstile) boleh dikosongkan karena auto-solve.",
      example: "0x4AAAAAAA...",
    },
    wait: {
      type: "boolean",
      required: false,
      default: true,
      description: "Tunggu job async sampai selesai (maks 45 detik). Kalau false, jobId dikembalikan agar bisa dipoll ulang.",
    },
  },

  async run(req, res) {
    const started = Date.now();
    const { url } = { ...req.query, ...req.body };
    let token = req.query?.turnstileToken || req.body?.turnstileToken;
    const doWait = String(req.query?.wait ?? req.body?.wait ?? "true") !== "false";

    if (!url || typeof url !== "string" || url.trim().length === 0) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'url' wajib diisi",
        example: {
          get: "/api/bypass/wellbypass?url=https://linkvertise.com/546946/mYoUbm5Ro7gU",
          post: { url: "https://linkvertise.com/546946/mYoUbm5Ro7gU" },
        },
      });
    }

    const deviceId = generateDeviceId();

    try {
      // registrasi device (opsional, best-effort)
      await fetch(`${WELLBYPASS_URL}/api/device/register`, {
        method: "POST",
        headers: { ...baseHeaders(deviceId) },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(10000),
      }).catch(() => {});

      let captcha = null;
      if (!token) {
        try {
          captcha = await getCaptchaConfig();
        } catch (e) {
          logger.warn(`[WELLBYPASS] captcha-config gagal: ${e.message}`);
          return res.status(502).json({
            status: false,
            message: `Tidak bisa menentukan jenis captcha upstream: ${e.message}`,
            result: { originalUrl: url, responseTime: `${Date.now() - started}ms` },
          });
        }

        // nilai mode upstream adalah "cf" (turnstile) atau "hc" (hcaptcha) —
        // bukan "tf" seperti versi lama kode ini.
        if (captcha.mode !== "cf") {
          return res.status(501).json({
            status: false,
            message:
              captcha.mode === "hc"
                ? "Upstream memakai hCaptcha. Auto-solve tidak tersedia dari IP server, jadi kirim token manual lewat parameter 'turnstileToken' (ambil dari widget hCaptcha di wellbypass.my.id/id)."
                : `Upstream memakai captcha mode '${captcha.mode}' yang belum didukung. Kirim token manual lewat parameter 'turnstileToken'.`,
            result: {
              originalUrl: url,
              captchaMode: captcha.mode,
              siteKey: captcha.siteKey,
              supported: false,
              hint: {
                step1: `buka https://wellbypass.my.id/id`,
                step2: "paste URL, selesaikan checkbox hCaptcha",
                step3: "ambil token dari console: document.querySelector('[name=h-captcha-response]').value",
                step4: `panggil /api/bypass/wellbypass?url=<url>&turnstileToken=<token>`,
              },
              responseTime: `${Date.now() - started}ms`,
            },
          });
        }

        try {
          token = await solveTurnstile(captcha.siteKey);
        } catch (e) {
          logger.warn(`[WELLBYPASS] Turnstile solver gagal: ${e.message}`);
          return res.status(502).json({
            status: false,
            message: `Auto-solve Turnstile gagal: ${e.message}. Coba kirim token manual.`,
            result: { originalUrl: url, captchaMode: captcha.mode, responseTime: `${Date.now() - started}ms` },
          });
        }
      }

      const bypassRes = await fetch(`${WELLBYPASS_URL}/api/bypass`, {
        method: "POST",
        headers: baseHeaders(deviceId),
        body: JSON.stringify({ url: url.trim(), turnstileToken: token }),
        signal: AbortSignal.timeout(60000),
      });

      const data = await bypassRes.json().catch(() => ({ status: false, message: bypassRes.statusText }));
      const elapsed = () => `${Date.now() - started}ms`;

      if (!data.status) {
        const msg = UPSTREAM_CODES[data.code] || data.message || "Gagal bypass link";
        return res.status(bypassRes.status >= 400 ? bypassRes.status : 400).json({
          status: false,
          message: msg,
          code: data.code || null,
          result: { originalUrl: url, responseTime: elapsed() },
        });
      }

      // job async → poll sampai selesai
      if (data.async && data.jobId) {
        if (!doWait) {
          return res.json({
            status: true,
            pending: true,
            message: "Job diproses upstream. Poll /api/bypass/wellbypass dengan jobId + deviceId di bawah.",
            jobId: data.jobId,
            deviceId: data.deviceId || deviceId,
            result: { originalUrl: url, responseTime: elapsed() },
          });
        }

        try {
          const { done, data: jd, timedOut } = await pollJob(data.jobId, data.deviceId || deviceId);
          if (done && jd?.bypassedUrl) {
            return res.json({
              status: true,
              result: {
                originalUrl: jd.originalUrl || url,
                bypassedUrl: jd.bypassedUrl,
                isDirectUrl: jd.isDirectUrl ?? null,
                fromCache: jd.fromCache ?? null,
                executionTimeMs: jd.executionTimeMs ?? null,
                responseTime: elapsed(),
              },
            });
          }
          return res.status(202).json({
            status: true,
            pending: true,
            message: timedOut ? "Job masih berjalan setelah 45 detik." : "Job belum selesai.",
            jobId: data.jobId,
            deviceId: data.deviceId || deviceId,
            progress: jd?.progress ?? null,
            result: { originalUrl: url, responseTime: elapsed() },
          });
        } catch (e) {
          return res.status(502).json({
            status: false,
            message: e.message,
            jobId: data.jobId,
            result: { originalUrl: url, responseTime: elapsed() },
          });
        }
      }

      // respons sinkron
      return res.json({
        status: true,
        result: {
          originalUrl: url,
          bypassedUrl: data.bypassedUrl || null,
          isDirectUrl: data.isDirectUrl ?? null,
          service: data.service || null,
          responseTime: elapsed(),
        },
      });
    } catch (err) {
      logger.error(`[WELLBYPASS] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Failed to bypass URL",
        result: { responseTime: `${Date.now() - started}ms` },
      });
    }
  },
};
