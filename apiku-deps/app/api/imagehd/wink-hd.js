/**
 * Wink HD — AI image enhancer via wink.ai
 * Upload ke Qiniu → delivery task → polling result
 *
 * GET  /api/imagehd/wink-hd?url=https://...jpg
 * POST /api/imagehd/wink-hd
 */

import axios from "axios";
import FormData from "form-data";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { CookieJar } from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";

const BASE_URL = "https://wink.ai";
const STRATEGY_URL = "https://strategy.app.meitudata.com";
const CLIENT_ID = "1189857605";
const VERSION = "5.1.2";
const COUNTRY_CODE = "ID";
const CLIENT_LANGUAGE = "en_US";
const CLIENT_TIMEZONE = "Asia/Jakarta";
const TASK_TYPE = "12";
const CONTENT_TYPE = "1";
const EXT_VALUE = "2";
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

function extToMime(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function fileSuffix(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".jpeg") return ".jpg";
  if (ext) return ext;
  return ".jpg";
}

function makeTrace() {
  return `${crypto.randomBytes(16).toString("hex")}-${crypto.randomBytes(8).toString("hex")}-1`;
}

function traceHeaders(transaction = "GET%20%2F%5Blocale%5D%2Fimage-enhancer%2Fupload") {
  const trace = makeTrace();
  return {
    "sentry-trace": trace,
    baggage: [
      "sentry-environment=release",
      "sentry-release=5.1.2%20(b60d25c477f43c6dfac4107810f26d442320f4f1)",
      "sentry-public_key=e1bf914f3448d9bc8a10c7e499d17d54",
      `sentry-trace_id=${trace.split("-")[0]}`,
      `sentry-transaction=${transaction}`,
      "sentry-sampled=true",
      "sentry-sample_rate=0.75"
    ].join(",")
  };
}

function baseParams(gnum, extra = {}) {
  return new URLSearchParams({
    client_id: CLIENT_ID,
    version: VERSION,
    country_code: COUNTRY_CODE,
    gnum,
    client_language: CLIENT_LANGUAGE,
    client_channel_id: "",
    client_timezone: CLIENT_TIMEZONE,
    ...extra
  });
}

function createApi(jar) {
  return { api: wrapper(axios.create({
    baseURL: BASE_URL,
    jar,
    withCredentials: true,
    validateStatus: () => true,
    headers: {
      accept: "*/*",
      origin: BASE_URL,
      referer: `${BASE_URL}/image-enhancer/upload`,
      "user-agent": UA,
      "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Android"',
      ab_info: JSON.stringify({ ab_codes: [], version: "1.4.4" })
    }
  })) };
}

async function getMaatSign(api, gnum, suffix) {
  const params = baseParams(gnum, { suffix, type: "temp", count: "1" });
  const res = await api.get(`/api/file/get_maat_sign.json?${params.toString()}`, {
    headers: traceHeaders()
  });
  if (res.status >= 400 || res.data?.code !== 0) {
    throw new Error(`get_maat_sign gagal: ${JSON.stringify(res.data)}`);
  }
  return res.data.data;
}

async function getUploadPolicy(sign) {
  const params = new URLSearchParams({
    app: sign.app,
    count: String(sign.count),
    sig: sign.sig,
    sigTime: sign.sig_time,
    sigVersion: sign.sig_version,
    suffix: sign.suffix,
    type: sign.type
  });
  const res = await axios.get(`${STRATEGY_URL}/upload/policy?${params.toString()}`, {
    headers: {
      accept: "*/*",
      origin: BASE_URL,
      referer: `${BASE_URL}/`,
      "user-agent": UA,
      "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Android"'
    },
    validateStatus: () => true
  });
  if (res.status >= 400 || !Array.isArray(res.data) || !res.data[0]?.qiniu) {
    throw new Error(`upload policy gagal: ${JSON.stringify(res.data)}`);
  }
  return res.data[0].qiniu;
}

async function uploadToQiniu(policy, filePath) {
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath), {
    filename: path.basename(filePath),
    contentType: extToMime(filePath)
  });
  form.append("token", policy.token);
  form.append("key", policy.key);
  form.append("fname", path.basename(filePath));

  const res = await axios.post(policy.url, form, {
    headers: form.getHeaders({
      origin: BASE_URL,
      referer: `${BASE_URL}/`,
      "user-agent": UA,
      accept: "*/*"
    }),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true
  });

  if (res.status >= 400) {
    throw new Error(`upload qiniu gagal HTTP ${res.status}: ${typeof res.data === "string" ? res.data : JSON.stringify(res.data)}`);
  }
  if (!res.data?.url && !res.data?.data) {
    throw new Error(`upload qiniu response tidak valid: ${JSON.stringify(res.data)}`);
  }

  return {
    file_key: policy.key,
    source_url: res.data.url || res.data.data || policy.data
  };
}

async function getMetaInfo(api, gnum, fileKey) {
  const body = baseParams(gnum, { file_key: fileKey });
  const res = await api.post("/api/file/meta_info.json", body.toString(), {
    headers: {
      ...traceHeaders(),
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
    }
  });
  if (res.status >= 400 || res.data?.code !== 0) {
    throw new Error(`meta info gagal: ${JSON.stringify(res.data)}`);
  }
  return res.data.data;
}

async function calcNeedBeans(api, gnum) {
  const typeParams = JSON.stringify({
    is_mirror: 0, orientation_tag: 1, j_420_trans: "1", return_ext: "2"
  });
  const rightDetail = JSON.stringify({
    source: "1", touch_type: "4", function_id: "630", material_id: "63011",
    url: "https://wink.ai/image-enhancer/upload"
  });
  const itemList = JSON.stringify([{
    type: Number(TASK_TYPE), ext_value: EXT_VALUE, content_type: Number(CONTENT_TYPE),
    duration: 0, type_params: typeParams, right_detail: rightDetail
  }]);

  const body = baseParams(gnum, { item_list: itemList });
  const res = await api.post("/api/subscribe/batch_calc_need_beans.json", body.toString(), {
    headers: {
      ...traceHeaders(),
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
    }
  });
  if (res.status >= 400 || res.data?.code !== 0) {
    throw new Error(`calc beans gagal: ${JSON.stringify(res.data)}`);
  }
  return res.data.data;
}

async function delivery(api, gnum, sourceUrl, taskName) {
  const body = baseParams(gnum, {
    type: TASK_TYPE,
    content_type: CONTENT_TYPE,
    source_url: sourceUrl,
    type_params: JSON.stringify({
      is_mirror: 0, orientation_tag: 1, j_420_trans: "1", return_ext: "2"
    }),
    right_detail: JSON.stringify({
      source: "1", touch_type: "4", function_id: "630", material_id: "63011",
      url: "https://wink.ai/image-enhancer/upload"
    }),
    ext_params: JSON.stringify({ task_name: taskName, records: TASK_TYPE }),
    with_prepare: "1"
  });

  const res = await api.post("/api/meitu_ai/delivery.json", body.toString(), {
    headers: {
      ...traceHeaders(),
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
    }
  });
  if (res.status >= 400 || res.data?.code !== 0) {
    throw new Error(`delivery gagal: ${JSON.stringify(res.data)}`);
  }

  const data = res.data.data || {};
  return { msg_id: data.msg_id || "", prepare_msg_id: data.prepare_msg_id || "" };
}

async function queryBatch(api, gnum, msgId, referer = `${BASE_URL}/image-enhancer/upload`) {
  const params = baseParams(gnum, { msg_ids: msgId });
  const res = await api.get(`/api/meitu_ai/query_batch.json?${params.toString()}`, {
    headers: {
      ...traceHeaders("%2F%3Alocale%2Feditor%2Frecent-task"),
      referer
    }
  });
  if (res.status >= 400 || res.data?.code !== 0) {
    throw new Error(`query batch gagal: ${JSON.stringify(res.data)}`);
  }
  return res.data.data;
}

function extractResultUrl(data) {
  const item = data?.item_list?.[0];
  const media = item?.result?.media_info_list?.[0];
  return media?.media_data || "";
}

function extractNextMsgId(data, currentMsgId) {
  const item = data?.item_list?.[0];
  const resultValue = item?.result?.result || "";
  const realMsgId = item?.result?.msg_id || item?.msg_id || "";
  if (resultValue && resultValue !== currentMsgId && !resultValue.startsWith("http") && !resultValue.startsWith("https")) {
    return resultValue;
  }
  if (realMsgId && realMsgId !== currentMsgId && !realMsgId.startsWith("wpr_")) {
    return realMsgId;
  }
  return "";
}

async function waitResult(api, gnum, firstMsgId, maxTry = 80, delayMs = 3000) {
  let msgId = firstMsgId;
  let last = null;
  for (let i = 1; i <= maxTry; i++) {
    const data = await queryBatch(api, gnum, msgId);
    last = data;
    const nextMsgId = extractNextMsgId(data, msgId);
    if (nextMsgId) {
      msgId = nextMsgId;
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }
    const url = extractResultUrl(data);
    const errorCode = data?.item_list?.[0]?.result?.error_code;
    const errorMsg = data?.item_list?.[0]?.result?.error_msg;
    if (url && url.startsWith("http") && errorCode === 0) {
      return url;
    }
    if (errorCode && errorCode !== 29901 && errorCode !== 0) {
      throw new Error(`task gagal: ${errorCode} ${errorMsg || ""}`);
    }
    await new Promise(r => setTimeout(r, delayMs));
  }
  throw new Error(`result belum selesai: ${JSON.stringify(last)}`);
}

async function processImage(url) {
  // Download image ke temp
  const imgRes = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
  const buf = Buffer.from(imgRes.data);
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "wink-hd-"));
  const ext = path.extname(new URL(url).pathname) || ".jpg";
  const filePath = path.join(tmpDir, `input${ext}`);
  fs.writeFileSync(filePath, buf);

  try {
    // Setup cookie jar + API client fresh per request
    const GNUM = crypto.randomUUID();
    const jar = new CookieJar();
    await jar.setCookie(`_sm=${GNUM}; Path=/; Domain=wink.ai`, BASE_URL);
    await jar.setCookie(
      `meitustat=${encodeURIComponent(JSON.stringify({ wgid: GNUM }))}; Path=/; Domain=wink.ai`,
      BASE_URL
    );
    const { api } = createApi(jar);

    const taskName = `Enhancer-Ultra HD-${path.parse(filePath).name}`;
    const suffix = fileSuffix(filePath);

    // 1. Get upload signature
    const sign = await getMaatSign(api, GNUM, suffix);
    // 2. Get upload policy
    const policy = await getUploadPolicy(sign);
    // 3. Upload to Qiniu
    const uploaded = await uploadToQiniu(policy, filePath);
    // 4. Get meta info
    await getMetaInfo(api, GNUM, uploaded.file_key);
    // 5. Calculate beans
    await calcNeedBeans(api, GNUM);
    // 6. Submit task
    const task = await delivery(api, GNUM, uploaded.source_url, taskName);
    const firstMsgId = task.msg_id || task.prepare_msg_id;
    if (!firstMsgId) throw new Error("delivery tidak mengembalikan msg_id");
    // 7. Wait for result (polling)
    const resultUrl = await waitResult(api, GNUM, firstMsgId);

    // 8. Download result image
    const resultRes = await axios.get(resultUrl, { responseType: "arraybuffer", timeout: 60000 });
    const resultBuf = Buffer.from(resultRes.data);
    const mime = resultRes.headers["content-type"] || "image/jpeg";

    return { buffer: resultBuf, mime };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export default {
  name: "Wink HD Enhancer",
  description: "Enhance/Upscale gambar menggunakan AI — upload, submit task, polling hasil Ultra HD.",
  category: "Image HD",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string", required: true,
      description: "URL gambar yang akan di-enhance ke kualitas HD",
      example: "https://example.com/photo.jpg"
    }
  },

  async run(req, res) {
    const start = Date.now();
    try {
      const { url } = { ...req.query, ...req.body };

      if (!url || !String(url).trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi"
        });
      }

      try { new URL(url); } catch {
        return res.status(400).json({ status: false, message: "Format URL tidak valid" });
      }

      const { buffer, mime } = await processImage(String(url).trim());

      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("X-Processor", "wink.ai");
      res.setHeader("X-Generated-In", `${Date.now() - start}ms`);
      res.send(buffer);
    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "Gagal enhance gambar",
        responseTime: `${Date.now() - start}ms`
      });
    }
  }
};
