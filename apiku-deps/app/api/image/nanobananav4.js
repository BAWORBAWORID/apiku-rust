/**
 * Nano Banana V4 — AI Image Generator & Editor
 *
 * Base   : https://api.photoeditorai.io
 * Support: Text-to-Image & Image-to-Image (Edit)
 * Proxy  : SOCKS5 Auto Rotation
 *
 * GET  /api/image/nanobananav4?prompt=a cute cat
 * GET  /api/image/nanobananav4?url=https://...&prompt=make it smile
 * POST /api/image/nanobananav4
 * Body : { "prompt": "...", "url": "https://...", "model": "photoeditor_3.0", "ratio": "1:1" }
 */

import https from "https";
import crypto from "crypto";
import { SocksProxyAgent } from "socks-proxy-agent";
import logger from "../../src/utils/logger.js";

const BASE = "https://api.photoeditorai.io";
const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36";

const MODELS = {
  photoeditor3: "photoeditor_3.0",
  photoeditor3pro: "photoeditor_3.0_pro",
  photoeditor4: "photoeditor_4.0",
  photoeditor4pro: "photoeditor_4.0_pro",
  gpt: "gpt_image_2",
  nanobanana: "nano_banana",
  nanobanana2: "nano_banana_2",
  nanobanana2lite: "nano_banana_2_lite",
  nanobananapro: "nano_banana_pro",
  qwen: "qwen",
  seedream: "seedream",
  seedream45: "seedream_45",
  seedream5: "seedream_5",
  fluxkontext: "flux_kontext",
};

const DEFAULT_MODEL = MODELS.photoeditor3;

const NO_RESOLUTION_MODELS = [
  MODELS.photoeditor3,
  MODELS.photoeditor3pro,
  MODELS.gpt,
  MODELS.nanobanana2lite,
];

const PROXY_API =
  "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text&protocol=socks5&timeout=3000&country=all";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Proxy Fetcher & Rotation ─────────────────────────────────

let cachedProxies = [];
let proxyFetchedAt = 0;
const PROXY_TTL = 5 * 60 * 1000; // 5 menit

async function getProxies() {
  if (cachedProxies.length && Date.now() - proxyFetchedAt < PROXY_TTL) {
    return cachedProxies;
  }
  try {
    const res = await Promise.race([
      fetch(PROXY_API),
      sleep(8000).then(() => null),
    ]);
    if (!res) return cachedProxies;
    const text = await res.text();
    const list = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^socks5:\/\//.test(l));
    if (list.length > 0) {
      cachedProxies = list;
      proxyFetchedAt = Date.now();
    }
    return cachedProxies;
  } catch {
    return cachedProxies;
  }
}

// ─── Image Download ───────────────────────────────────────────

async function downloadBuffer(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
  const ext =
    (url.split("?")[0].match(/\.(png|jpg|jpeg|webp)$/i)?.[1] || "jpg").toLowerCase();
  return { buffer: Buffer.from(await res.arrayBuffer()), ext };
}

function mimeOf(ext) {
  return (
    { png: "image/png", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg" }[ext] ||
    "image/jpeg"
  );
}

// ─── Multipart & HTTP Request ─────────────────────────────────

function buildMultipart(fields, files) {
  const boundary = `----Boundary${Date.now()}`;
  const parts = [];

  for (const [name, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}`
      )
    );
    parts.push(Buffer.from("\r\n"));
  }

  for (const { name, buffer, filename, mime } of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
      )
    );
    parts.push(buffer);
    parts.push(Buffer.from("\r\n"));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  return { body, boundary };
}

function httpsRequest(url, { method = "POST", headers, body, agent, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method,
      headers,
      timeout: timeoutMs,
      agent,
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, data: null, raw: raw.slice(0, 300) });
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function postCreateJob({ prompt, imageBuffer, imageExt, model, ratio, imageResolution, agent }) {
  const fields = {
    model_name: model,
    feature: "photo_editor",
    prompt,
    ratio,
  };
  if (!NO_RESOLUTION_MODELS.includes(model)) {
    fields.image_resolution = imageResolution || "1K";
  }

  const files = imageBuffer
    ? [{ name: "target_images", buffer: imageBuffer, filename: `input.${imageExt}`, mime: mimeOf(imageExt) }]
    : [];

  const { body, boundary } = buildMultipart(fields, files);

  return httpsRequest(`${BASE}/pe/photo-editor/create-job`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Product-Serial": crypto.randomBytes(16).toString("hex"),
      Referer: "https://photoeditorai.io/",
      Origin: "https://photoeditorai.io",
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": body.length,
    },
    body,
    agent,
    timeoutMs: 30000,
  });
}

async function getJob(jobId, agent) {
  return httpsRequest(`${BASE}/pe/photo-editor/get-job/${jobId}?feature=photo_editor`, {
    method: "GET",
    headers: {
      "User-Agent": UA,
      "Product-Serial": crypto.randomBytes(16).toString("hex"),
      Referer: "https://photoeditorai.io/",
    },
    agent,
    timeoutMs: 15000,
  });
}

// ─── Core Runner with Proxy ───────────────────────────────────

async function runWithProxy(params, proxyUrl) {
  const agent = proxyUrl ? new SocksProxyAgent(proxyUrl) : undefined;
  const tag = proxyUrl ? proxyUrl.slice(0, 35) : "direct";

  logger.info(`[NANOBANANA-V4] Try ${tag}`);

  const createRes = await postCreateJob({ ...params, agent });

  if (!createRes.data) {
    throw new Error(`Empty response (status=${createRes.status}) ${createRes.raw || ""}`);
  }

  const d = createRes.data;
  if (d.code === 400005) throw new Error("CREDITS_EMPTY");
  if (d.code === 400006) throw new Error("DAILY_LIMIT");
  if (d.code === 400008) throw new Error(`Invalid ratio: ${params.ratio}`);
  if (!d.result?.job_id && !d.result?.id) {
    throw new Error(`Create job failed: ${JSON.stringify(d)}`);
  }

  const jobId = d.result.job_id || d.result.id;
  logger.info(`[NANOBANANA-V4] Job ${jobId} created via ${tag}`);

  // Poll
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const pollRes = await getJob(jobId, agent);
    const status = pollRes.data?.result?.status;
    if (status === 2) return pollRes.data.result;
    if (status === 3) throw new Error(`Job failed: ${pollRes.data.result?.error || "unknown"}`);
    await sleep(2500);
  }
  throw new Error("Timeout 90s");
}

function extractUrls(result) {
  const cands = [result.output, result.output_images, result.images, result.result_images, result.url, result.image_url];
  for (const c of cands) {
    if (!c) continue;
    if (typeof c === "string" && c.startsWith("http")) return [c];
    if (Array.isArray(c) && c.length) return c.filter((u) => typeof u === "string" && u.startsWith("http"));
  }
  return [];
}

// ─── API Export ───────────────────────────────────────────────

export default {
  name: "Nano Banana V4",
  description:
    "AI image generator & editor via PhotoEditorAI (Text-to-Image / Image-to-Image) with auto-rotating SOCKS5 proxy",
  category: "Image",
  methods: ["GET", "POST"],
  params: ["prompt", "url", "model", "ratio"],

  paramsSchema: {
    prompt: {
      type: "string",
      required: true,
      description: "Deskripsi gambar atau instruksi editing",
      example: "a futuristic cyberpunk cat in neon city",
    },
    url: {
      type: "string",
      required: false,
      description: "URL gambar sumber untuk mode Image-to-Image / Edit (opsional)",
      example: "https://example.com/photo.jpg",
    },
    model: {
      type: "string",
      required: false,
      default: DEFAULT_MODEL,
      enum: Object.values(MODELS),
      description: `Pilihan model AI: ${Object.values(MODELS).join(", ")}`,
      example: "photoeditor_3.0",
    },
    ratio: {
      type: "string",
      required: false,
      default: "1:1",
      enum: ["1:1", "16:9", "9:16", "3:4", "4:3", "match_input_image"],
      description: "Rasio output gambar (1:1, 16:9, 9:16, 3:4, 4:3, match_input_image)",
      example: "1:1",
    },
  },

  async run(req, res) {
    const startTime = Date.now();
    const params = { ...req.query, ...req.body };
    const { prompt, url: imageUrl, model: modelInput, ratio } = params;

    if (!prompt) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'prompt' wajib diisi",
        example: {
          text2image: "/api/image/nanobananav4?prompt=a futuristic city",
          image2image: "/api/image/nanobananav4?url=https://example.com/photo.jpg&prompt=make it cyber",
        },
      });
    }

    const model =
      MODELS[modelInput] ||
      (Object.values(MODELS).includes(modelInput) ? modelInput : DEFAULT_MODEL);
    const finalRatio = ratio || (imageUrl ? "match_input_image" : "1:1");

    // Download image jika disediakan
    let imageBuffer = null;
    let imageExt = "jpg";
    if (imageUrl) {
      try {
        const dl = await downloadBuffer(imageUrl);
        imageBuffer = dl.buffer;
        imageExt = dl.ext;
      } catch (err) {
        return res.status(400).json({
          status: false,
          message: `Gagal download image: ${err.message}`,
        });
      }
    }

    const jobParams = { prompt, imageBuffer, imageExt, model, ratio: finalRatio };

    // Fetch proxy list
    const proxies = await Promise.race([getProxies(), sleep(8000).then(() => [])]);
    logger.info(`[NANOBANANA-V4] ${proxies.length} proxies loaded | model=${model} prompt="${prompt}"`);

    let result = null;
    let lastErr = null;

    // Coba hingga 10 proxy random
    const tryList = [...proxies].sort(() => Math.random() - 0.5).slice(0, 10);

    for (const proxyUrl of tryList) {
      try {
        result = await runWithProxy(jobParams, proxyUrl);
        break;
      } catch (err) {
        lastErr = err;
        if (err.message === "DAILY_LIMIT") break;
        logger.warn(`[NANOBANANA-V4] Proxy fail: ${err.message.slice(0, 80)}`);
      }
    }

    // Fallback direct jika proxy gagal
    if (!result) {
      logger.info("[NANOBANANA-V4] All proxies failed, trying direct...");
      try {
        result = await runWithProxy(jobParams, null);
      } catch (err) {
        lastErr = err;
      }
    }

    if (!result) {
      const msg =
        lastErr?.message === "CREDITS_EMPTY"
          ? "Insufficient credits — seluruh kuota proxy habis"
          : lastErr?.message === "DAILY_LIMIT"
          ? "Daily limit reached"
          : lastErr?.message || "Generation failed";
      logger.error(`[NANOBANANA-V4] Final fail: ${msg}`);
      return res.status(500).json({
        status: false,
        message: msg,
        result: { responseTime: `${Date.now() - startTime}ms` },
      });
    }

    const images = extractUrls(result);
    if (!images.length) {
      return res.status(500).json({
        status: false,
        message: "Tidak ada URL gambar pada hasil pemrosesan",
      });
    }

    logger.info(`[NANOBANANA-V4] Done — ${images.length} image(s) in ${Date.now() - startTime}ms`);

    return res.json({
      status: true,
      result: {
        prompt,
        model,
        ratio: finalRatio,
        images,
        responseTime: `${Date.now() - startTime}ms`,
      },
    });
  },
};
