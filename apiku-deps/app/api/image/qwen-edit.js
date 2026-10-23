/**
 * Qwen Image Edit — Object Manipulator
 * Base: https://prithivmlmods-qwen-image-edit-object-manipulator.hf.space
 *
 * GET  /api/image/qwen-edit?url=...&prompt=...&model=...
 * POST /api/image/qwen-edit
 */

import fs from "node:fs";
import https from "node:https";
import FormData from "form-data";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import logger from "../../src/utils/logger.js";

const BASE = "https://prithivmlmods-qwen-image-edit-object-manipulator.hf.space";
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";
const PROXY_API = "https://api.ikyyxd.my.id/v2l/proxy-free/ikyy-xsample";

const AVAILABLE_MODELS = [
  "Qwen-Image-Edit-2511-Object-Adder",
  "Qwen-Image-Edit-2511-Object-Remover",
  "QIE-2511-Object-Remover-v2",
  "Zoom-Master",
  "Extract-Outfit",
  "Outfit-Design-Layout"
];

const MODEL_ALIASES = {
  adder: "Qwen-Image-Edit-2511-Object-Adder",
  remover: "Qwen-Image-Edit-2511-Object-Remover",
  "remover-v2": "QIE-2511-Object-Remover-v2",
  remover2: "QIE-2511-Object-Remover-v2",
  zoom: "Zoom-Master",
  extract: "Extract-Outfit",
  "extract-outfit": "Extract-Outfit",
  outfit: "Outfit-Design-Layout",
  "outfit-layout": "Outfit-Design-Layout"
};

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

let proxies = [];
let proxyIndex = 0;
let proxyReady = false;

class QuotaError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "QuotaError";
  }
}

function mimeFromBuffer(buf) {
  if (!buf || buf.length < 4) return "image/png";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.slice(8, 12).toString() === "WEBP") return "image/webp";
  return "image/png";
}

function decodeDataUrl(str) {
  const m = str.match(/^data:(image\/[\w.+-]+);base64,(.+)$/s);
  if (m) return { buffer: Buffer.from(m[2], "base64"), mime: m[1] };
  const buffer = Buffer.from(str, "base64");
  return { buffer, mime: mimeFromBuffer(buffer) };
}

async function fetchProxies() {
  if (proxyReady && proxies.length) return;
  const res = await axios.get(PROXY_API, { timeout: 10000 });
  if (!Array.isArray(res.data)) throw new Error("Format proxy tidak valid");
  proxies = res.data.filter((p) => typeof p === "string" && p.split(":").length === 4);
  proxyReady = true;
}

function rotateProxy() {
  if (proxies.length) proxyIndex = (proxyIndex + 1) % proxies.length;
}

function currentProxy() {
  if (!proxies.length) return null;
  const p = proxies[proxyIndex];
  const parts = p.split(":");
  if (parts.length !== 4) return null;
  return {
    host: parts[0],
    port: parseInt(parts[1], 10),
    auth: { username: parts[2], password: parts[3] },
    protocol: "http"
  };
}

function proxyAgent() {
  if (!proxies.length) return null;
  const p = proxies[proxyIndex];
  const parts = p.split(":");
  if (parts.length !== 4) return null;
  const agentUrl = `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
  try {
    return new HttpsProxyAgent(agentUrl);
  } catch {
    return null;
  }
}

async function callEdit(b64, prompt, model, useProxy = false) {
  const payload = {
    data: [
      JSON.stringify([b64]),
      prompt,
      model,
      0,
      true,
      1.0,
      8
    ]
  };

  const cfg = {
    method: "post",
    url: `${BASE}/gradio_api/call/edit_image`,
    data: payload,
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/json",
      Origin: BASE,
      Referer: `${BASE}/`
    },
    timeout: 60000,
    proxy: false
  };

  if (useProxy) {
    const pc = currentProxy();
    if (pc) cfg.proxy = pc;
  }

  const r = await axios(cfg);
  const eventId = (r.data && r.data.event_id) || r.data;

  if (!eventId || typeof eventId !== "string") {
    throw new Error(`event_id invalid: ${JSON.stringify(r.data).slice(0, 200)}`);
  }

  return eventId;
}

function pollResult(eventId, useProxy = false) {
  return new Promise((resolve, reject) => {
    if (!eventId || typeof eventId !== "string") {
      return reject(new Error(`eventId bukan string: ${eventId}`));
    }

    const full = `${BASE}/gradio_api/call/edit_image/${encodeURIComponent(eventId)}`;
    let urlObj;
    try {
      urlObj = new URL(full);
    } catch {
      return reject(new Error(`Invalid URL saat poll: ${full}`));
    }

    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: {
        "User-Agent": UA,
        Accept: "text/event-stream",
        Origin: BASE,
        Referer: `${BASE}/`
      }
    };

    if (useProxy && proxies.length) {
      const agent = proxyAgent();
      if (agent) opts.agent = agent;
    }

    const req = https.request(opts, (res) => {
      let buf = "";
      let lastEvent = "";

      res.on("data", (chunk) => {
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop();

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          if (line.indexOf("event: ") === 0) {
            lastEvent = line.slice(7).trim();
            continue;
          }

          if (line.indexOf("data: ") !== 0) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const j = JSON.parse(raw);
            const errMsg = (j && (j.error || j.message)) || "";

            if (String(errMsg).toLowerCase().indexOf("quota") !== -1) {
              return reject(new QuotaError(errMsg));
            }
            if (errMsg) return reject(new Error(errMsg));

            if (lastEvent === "complete" || lastEvent === "process_completed") {
              const out = Array.isArray(j) ? j[0] : (j && j.data && j.data[0]);
              if (out && out.image) return resolve(out.image);
              if (out && out.url) return resolve({ url: out.url });
              if (typeof out === "string" && out.length > 100) return resolve(out);
            }

            if (Array.isArray(j)) {
              const out = j[0];
              if (out && out.image) return resolve(out.image);
              if (out && out.url) return resolve({ url: out.url });
              if (typeof out === "string" && out.length > 100) return resolve(out);
            }

            if (j && j.msg === "process_completed") {
              const out = j.output && j.output.data && j.output.data[0];
              if (out && out.image) return resolve(out.image);
              if (out && out.url) return resolve({ url: out.url });
            }
          } catch {}
        }
      });

      res.on("end", () => {
        reject(new Error("stream ended tanpa hasil"));
      });

      res.on("error", (e) => {
        if (/hang|socket|ECONNRESET/i.test(e.message)) return reject(new QuotaError(e.message));
        reject(e);
      });
    });

    req.on("error", (e) => {
      if (/hang|socket|ECONNRESET/i.test(e.message)) return reject(new QuotaError(e.message));
      reject(e);
    });

    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error("poll timeout"));
    });

    req.end();
  });
}

async function downloadBuffer(url) {
  if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    throw new Error(`download URL invalid: ${url}`);
  }
  const r = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    proxy: false
  });
  return Buffer.from(r.data);
}

async function uploadQuax(buffer, filename) {
  const form = new FormData();
  form.append("files[]", buffer, { filename });

  const res = await axios.post("https://qu.ax/upload.php", form, {
    headers: { ...form.getHeaders(), "User-Agent": UA },
    timeout: 30000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    proxy: false
  });

  const url = res.data && res.data.files && res.data.files[0] && res.data.files[0].url;
  if (url) return url;
  throw new Error("Gagal upload ke Quax");
}

async function uploadTmpfiles(buffer, filename) {
  const form = new FormData();
  form.append("file", buffer, { filename });

  const res = await axios.post("https://tmpfiles.org/api/v1/upload", form, {
    headers: { ...form.getHeaders(), "User-Agent": UA },
    timeout: 30000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    proxy: false
  });

  const url = res.data && res.data.data && res.data.data.url;
  if (url) {
    return url.replace("https://tmpfiles.org/", "https://tmpfiles.org/dl/");
  }
  throw new Error("Gagal upload ke Tmpfiles");
}

async function uploadUguu(buffer, filename) {
  const form = new FormData();
  form.append("files[]", buffer, { filename });

  const res = await axios.post("https://uguu.se/upload.php", form, {
    headers: { ...form.getHeaders(), "User-Agent": UA },
    timeout: 10000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true,
    proxy: false
  });

  if (res.status === 200 && res.data?.files?.[0]?.url) {
    return res.data.files[0].url;
  }
  throw new Error("Gagal upload ke Uguu");
}

async function uploadImage(buffer, filename) {
  try {
    return await uploadQuax(buffer, filename);
  } catch (err1) {
    try {
      return await uploadTmpfiles(buffer, filename);
    } catch (err2) {
      return await uploadUguu(buffer, filename);
    }
  }
}

function resolveModel(inputModel) {
  if (!inputModel || typeof inputModel !== "string") {
    return "Qwen-Image-Edit-2511-Object-Adder";
  }
  const trimmed = inputModel.trim();
  if (AVAILABLE_MODELS.includes(trimmed)) {
    return trimmed;
  }
  const alias = MODEL_ALIASES[trimmed.toLowerCase()];
  if (alias) {
    return alias;
  }
  return "Qwen-Image-Edit-2511-Object-Adder";
}

async function processQwenEdit(imageInput, prompt, model) {
  let buf;
  if (Buffer.isBuffer(imageInput)) {
    buf = imageInput;
  } else if (typeof imageInput === "string" && /^https?:\/\//i.test(imageInput)) {
    buf = await downloadBuffer(imageInput);
  } else if (typeof imageInput === "string" && fs.existsSync(imageInput)) {
    buf = fs.readFileSync(imageInput);
  } else if (typeof imageInput === "string" && imageInput.startsWith("data:")) {
    const dec = decodeDataUrl(imageInput);
    buf = dec.buffer;
  } else {
    throw new Error("File atau URL gambar tidak valid");
  }

  const mime = mimeFromBuffer(buf);
  const b64 = `data:${mime};base64,${buf.toString("base64")}`;

  let result;
  let usingProxy = false;
  const maxAttempts = 8;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const eventId = await callEdit(b64, prompt, model, usingProxy);
      result = await pollResult(eventId, usingProxy);
      break;
    } catch (e) {
      if (e instanceof QuotaError) {
        try { await fetchProxies(); } catch {}
        usingProxy = true;
        if (attempt > 1) rotateProxy();
        continue;
      }
      if (attempt >= maxAttempts) throw e;
      if (usingProxy) rotateProxy();
    }
  }

  let resultBuf;
  let filename;

  if (typeof result === "string" && /^https?:\/\//.test(result)) {
    resultBuf = await downloadBuffer(result);
    filename = `qwen_${Date.now()}.${EXT[mimeFromBuffer(resultBuf)] || "png"}`;
  } else if (typeof result === "string") {
    const dec = decodeDataUrl(result);
    resultBuf = dec.buffer;
    filename = `qwen_${Date.now()}.${EXT[dec.mime] || "png"}`;
  } else if (result && result.url) {
    resultBuf = await downloadBuffer(result.url);
    filename = `qwen_${Date.now()}.${EXT[mimeFromBuffer(resultBuf)] || "png"}`;
  } else {
    throw new Error(`Format output tidak dikenali: ${JSON.stringify(result).slice(0, 150)}`);
  }

  const link = await uploadImage(resultBuf, filename);

  return {
    buffer: resultBuf,
    mime: mimeFromBuffer(resultBuf),
    url: link
  };
}

export default {
  name: "Qwen Image Edit",
  description: "Edit dan manipulasi objek pada gambar menggunakan Qwen Image Edit (Object Manipulator)",
  category: "Image",
  methods: ["GET", "POST"],
  params: ["url", "prompt", "model"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL gambar yang akan diedit (atau upload file image jika POST multipart)",
      example: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=500"
    },
    prompt: {
      type: "string",
      required: true,
      description: "Instruksi manipulasi objek/gambar (contoh: add sunglasses, remove necklace, add hat)",
      example: "add sunglasses"
    },
    model: {
      type: "string",
      required: false,
      default: "Qwen-Image-Edit-2511-Object-Adder",
      enum: [
        "Qwen-Image-Edit-2511-Object-Adder",
        "Qwen-Image-Edit-2511-Object-Remover",
        "QIE-2511-Object-Remover-v2",
        "Zoom-Master",
        "Extract-Outfit",
        "Outfit-Design-Layout"
      ],
      description: "Model LoRA adapter yang digunakan untuk manipulasi objek"
    }
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const { url, prompt, model, format, raw } = { ...req.query, ...req.body };

      let imageInput = url;
      const uploadedFile = req.files?.image || req.files?.file;

      if (uploadedFile) {
        const filePath = uploadedFile.tempFilePath || uploadedFile.path;
        if (filePath && fs.existsSync(filePath)) {
          imageInput = fs.readFileSync(filePath);
        } else if (uploadedFile.data) {
          imageInput = uploadedFile.data;
        }
      }

      if (!imageInput || (typeof imageInput === "string" && !imageInput.trim())) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' atau file gambar wajib diisi"
        });
      }

      if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'prompt' wajib diisi"
        });
      }

      const selectedModel = resolveModel(model);
      logger.info(`[QWEN-EDIT] Starting edit with prompt="${prompt}", model="${selectedModel}"`);

      const processed = await processQwenEdit(imageInput, prompt.trim(), selectedModel);

      // Support return image buffer langsung jika format=image atau raw=true
      if (format === "image" || raw === "true" || raw === true) {
        res.setHeader("Content-Type", processed.mime);
        res.setHeader("Content-Length", processed.buffer.length);
        return res.send(processed.buffer);
      }

      return res.json({
        status: true,
        result: {
          prompt: prompt.trim(),
          model: selectedModel,
          url: processed.url,
          responseTime: `${Date.now() - startTime}ms`
        }
      });
    } catch (err) {
      logger.error(`[QWEN-EDIT] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses Qwen Image Edit"
      });
    }
  }
};
