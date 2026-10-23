/**
 * Web2Apk Service — Powered by Code-V Engine (sdkforge)
 * Endpoint: /api/tools/web2apk
 */

import logger from "../../src/utils/logger.js";

const BASE_URL = "https://code-v-compiler-sr.vercel.app";

/**
 * Request compile Web to APK
 */
async function buildWeb2Apk(config) {
  const payload = {
    url: config.url,
    appName: config.appName,
    packageName: config.packageName,
    versionName: String(config.versionName || "1.0.0"),
    versionCode: Number(config.versionCode) || 1,
    options: {
      splash: true,
      splashType: "default",
      splashText: config.appName || "Loading...",
      splashBg: "#0B0D10",
      splashFg: "#3B82F6",
      splashMs: 2000,
      orientation: "auto",
      js: true,
      zoom: false,
      permissions: ["INTERNET", "WAKE_LOCK"],
    },
  };

  // 1. Submit Build Request
  const createRes = await fetch(`${BASE_URL}/api/build`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    body: JSON.stringify(payload),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Gagal mengirim build request: ${createRes.status} ${errText}`);
  }

  const createData = await createRes.json();
  const buildId = createData.build_id;
  if (!buildId) {
    throw new Error(`Respon server tidak memiliki build_id: ${JSON.stringify(createData)}`);
  }

  // 2. Poll Build Status
  const maxAttempts = 60; // Max ~120 detik
  let attempt = 0;

  while (attempt < maxAttempts) {
    await new Promise((r) => setTimeout(r, 2000));
    attempt++;

    const pollRes = await fetch(`${BASE_URL}/api/build/${buildId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!pollRes.ok) continue;

    const pollData = await pollRes.json();
    const status = pollData.status;

    if (status === "ready" || status === "completed") {
      const downloadPath = pollData.download_url || `/cdn/${buildId}.apk`;
      const downloadUrl = downloadPath.startsWith("http")
        ? downloadPath
        : `${BASE_URL}${downloadPath}`;

      return {
        buildId,
        appName: payload.appName,
        packageName: payload.packageName,
        versionName: payload.versionName,
        versionCode: payload.versionCode,
        targetUrl: payload.url,
        fileSize: pollData.file_size || null,
        downloadUrl,
      };
    }

    if (status === "failed" || status === "error") {
      throw new Error(`Build gagal: ${pollData.error || "Unknown error"}`);
    }
  }

  throw new Error("Build timeout: Proses compile memakan waktu lebih dari 2 menit.");
}

export default {
  name: "Web2Apk",
  description: "Konversi website menjadi APK Android menggunakan engine Code-V / sdkforge",
  category: "Tools",
  methods: ["GET", "POST"],

  params: [
    "url",
    "appName",
    "packageName",
    "versionName",
    "versionCode"
  ],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      example: "https://api.zyvor.my.id/",
      description: "Alamat URL website/web app yang akan dikonversi menjadi aplikasi Android (APK)",
    },
    appName: {
      type: "string",
      required: true,
      example: "Zyvor App",
      description: "Nama label aplikasi Android yang akan tampil di homescreen atau launcher perangkat",
    },
    packageName: {
      type: "string",
      required: true,
      example: "com.zyvor.app",
      description: "Identitas paket aplikasi Android unik (Application ID / Bundle ID). Format: com.domain.app",
    },
    versionName: {
      type: "string",
      required: true,
      example: "1.0.0",
      description: "Nomor versi aplikasi Android yang ditampilkan kepada pengguna (contoh: 1.0.0)",
    },
    versionCode: {
      type: "number",
      required: true,
      example: 1,
      description: "Nomor integer kode versi build internal aplikasi Android untuk tracking update (contoh: 1)",
    },
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      const url = params.url;
      const appName = params.appName || params.appname;
      const packageName = params.packageName || params.package;
      const versionName = params.versionName || params.version;
      const versionCode = params.versionCode || params.versioncode;

      if (!url) {
        return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" });
      }
      if (!appName) {
        return res.status(400).json({ status: false, message: "Parameter 'appName' wajib diisi" });
      }
      if (!packageName) {
        return res.status(400).json({ status: false, message: "Parameter 'packageName' (package) wajib diisi" });
      }
      if (!versionName) {
        return res.status(400).json({ status: false, message: "Parameter 'versionName' (version) wajib diisi" });
      }
      if (versionCode === undefined || versionCode === null || versionCode === "") {
        return res.status(400).json({ status: false, message: "Parameter 'versionCode' wajib diisi" });
      }

      logger.info(`[WEB2APK] Memulai build untuk url=${url} | appName=${appName} | pkg=${packageName}`);
      const result = await buildWeb2Apk({
        url,
        appName,
        packageName,
        versionName,
        versionCode: Number(versionCode) || 1,
      });

      return res.json({
        status: true,
        message: "APK berhasil dibuat",
        result,
      });
    } catch (err) {
      logger.error(`[WEB2APK] error: ${err.message}`);
      return res.status(500).json({ status: false, message: err.message });
    }
  },
};
