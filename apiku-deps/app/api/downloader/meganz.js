/**
 * MEGA.NZ Downloader API
 * Provider: MEGA.NZ API
 * Parameter: url
 */

import axios from "axios";
import CryptoJS from "crypto-js";

const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
};

/* ===============================
   DECRYPT ATTRIBUTES
================================ */
function decryptAttr(enc, fileKey) {
  try {
    const ab = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), 'base64');
    const kResult = ab(fileKey);
    // Baca 8 kata sebagai big-endian (sesuai spesifikasi MEGA).
    // Wajib pakai byteOffset — Buffer node adalah view dari shared pool!
    const kView = new DataView(kResult.buffer, kResult.byteOffset, kResult.byteLength);
    const words = [];
    for (let i = 0; i < 8; i++) words.push(kView.getUint32(i * 4, false));
    // AES key = 4 kata XOR, ditulis big-endian (bukan native endian Uint32Array)
    const key = new Uint8Array(16);
    const keyView = new DataView(key.buffer);
    for (let i = 0; i < 4; i++) keyView.setUint32(i * 4, (words[i] ^ words[i + 4]) >>> 0, false);

    const decrypted = CryptoJS.AES.decrypt(
      { ciphertext: CryptoJS.enc.Base64.parse(enc.replace(/-/g, "+").replace(/_/g, "/")) },
      CryptoJS.enc.Hex.parse(Buffer.from(key).toString("hex")),
      { iv: CryptoJS.lib.WordArray.create([0, 0, 0, 0]), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.NoPadding }
    );

    const str = CryptoJS.enc.Utf8.stringify(decrypted).replace(/\0/g, "").trim();
    return JSON.parse(str.substring(4));
  } catch (e) { 
    return { n: "[Decryption Error]" }; 
  }
}

/* ===============================
   FETCH MEGA FILE INFO
================================ */
async function fetchMegaInfo(url) {
  try {
    const fileId = url.match(/file\/([a-zA-Z0-9_-]+)/)?.[1];
    const fileKey = url.split('#')[1];

    if (!fileId || !fileKey) {
      throw new Error("URL MEGA tidak valid. Pastikan URL mengandung #key");
    }

    const { data } = await axios.post(
      "https://g.api.mega.co.nz/cs", 
      [{ a: "g", g: 1, p: fileId }], 
      {
        headers: {
          ...headers,
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );

    if (typeof data[0] === 'number') {
      throw new Error(`MEGA API Error: ${data[0]}`);
    }

    const info = data[0];
    const attr = decryptAttr(info.at, fileKey);

    return {
      status: true,
      data: {
        filename: attr.n,
        size: info.s,
        size_formatted: (info.s / (1024 * 1024)).toFixed(2) + " MB",
        download_url: info.g,
        file_id: fileId,
        attributes: attr
      }
    };
  } catch (err) {
    return { 
      status: false, 
      message: err.message 
    };
  }
}

/* ===============================
   MAIN FUNCTION
================================ */
async function megaDownloader(url) {
  return await fetchMegaInfo(url);
}

/* ===============================
   EXPORT API
================================ */

export default {
  name: "MEGA.NZ Downloader",
  description: "Download file dari MEGA.NZ",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: { 
      type: "string", 
      required: true,
      pattern: "mega\\.nz"
    },
  },

  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body };

      if (!url || typeof url !== "string") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
        });
      }

      if (!url.includes("mega.nz/file/")) {
        return res.status(400).json({
          status: false,
          message: "URL harus berupa link MEGA.NZ file (contoh: https://mega.nz/file/...)",
        });
      }

      if (!url.includes("#")) {
        return res.status(400).json({
          status: false,
          message: "URL MEGA harus mengandung key (bagian setelah #)",
        });
      }

      const result = await megaDownloader(url);

      if (!result.status) {
        return res.status(500).json(result);
      }

      res.json({
        status: true,
        provider: "mega.nz",
        input: url,
        result: result.data,
        timestamp: Date.now(),
      });
    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "MEGA download failed",
      });
    }
  },
};

