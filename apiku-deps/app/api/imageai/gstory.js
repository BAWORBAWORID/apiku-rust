import crypto from "node:crypto";
import https from "node:https";
import { URL } from "node:url";
import logger from "../../src/utils/logger.js";

const BASE = "https://www.gstory.ai";
const API = `${BASE}/api/service_v3`;
const SALT = "8rJHEd9vbPs=";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

function serialize(value) {
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serialize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalize(value) {
  if (value === null) return "null";
  if (Array.isArray(value) || typeof value === "object") return serialize(value);
  return String(value);
}

function makeSign(payloadData) {
  const keys = Object.keys(payloadData)
    .filter((key) => key !== "sign" && payloadData[key] !== undefined)
    .sort();
  const data = keys.map((key) => `${key}=${normalize(payloadData[key])}`).join("&");
  return crypto.createHash("md5").update(data + SALT).digest("hex");
}

function djb2(value) {
  let hash = 5381;
  for (let index = 0; index < value.length; index++) {
    hash = (hash << 5) + hash + value.charCodeAt(index);
    hash &= hash;
  }
  return (hash >>> 0).toString(16);
}

function generateDeviceId() {
  const salt = crypto.randomUUID();
  const parts = [
    "1920x1080x24",
    "1920x1080",
    "1",
    "UTC",
    "0",
    "en-US",
    "en-US",
    "Linux x86_64",
    UA,
    "8",
    "0",
    "0",
    "",
    "data:image/png;base64,iVBORw0KGgo=",
    "",
    salt,
  ];
  const raw = parts.join("|");
  const a = djb2(raw);
  const b = djb2([...raw].reverse().join(""));
  const c = djb2(raw + a);
  const d = djb2(b + raw);
  const deviceId =
    `${a.padStart(8, "0")}-${b.padStart(4, "0").slice(0, 4)}-${c.padStart(4, "0").slice(0, 4)}-${d
      .padStart(4, "0")
      .slice(0, 4)}-${(a + b + c).padStart(12, "0").slice(0, 12)}`;
  return { deviceId, salt };
}

function buildPayload(extra = {}) {
  const payloadData = {
    packageName: "ai.gstory.web",
    appVersion: "3.10.6",
    language: "en",
    countryCode: "en",
    region: "en",
    deviceType: UA,
    timestamp: Math.floor(Date.now() / 1000),
    udid: crypto.randomUUID(),
    timezone: "UTC 0",
    platform: "web",
    signVersion: "2.0",
    token: null,
    ...extra,
  };
  payloadData.sign = makeSign(payloadData);
  return payloadData;
}

function post(path, extra, cookie) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(buildPayload(extra));
    const target = new URL(API + path);
    const headers = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "User-Agent": UA,
      Origin: BASE,
      Referer: `${BASE}/`,
    };
    if (cookie) headers.Cookie = cookie;

    const request = https.request(
      {
        hostname: target.hostname,
        path: target.pathname,
        method: "POST",
        headers,
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ code: 500, message: data.slice(0, 200) });
          }
        });
      },
    );

    request.setTimeout(30000, () => {
      request.destroy(new Error("GStory request timeout"));
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function generateImage(prompt, style, ratio) {
  const { deviceId, salt } = generateDeviceId();
  const cookie = `deviceId=${deviceId}; deviceSalt=${salt}; region=en`;

  const free = await post("/user/get_free_attempts", {}, cookie);
  if (free.code !== 200) {
    throw new Error(free.message || "GStory free attempts check failed");
  }

  const batchId = crypto.randomUUID().replace(/-/g, "");
  const taskId = crypto.randomUUID().replace(/-/g, "");
  const submitted = await post(
    "/x2i_v2/batch_submit_v2",
    {
      batchId,
      language: "en",
      tasks: [
        {
          downstreamTaskId: taskId,
          serviceKind: "t2i",
          modelKey: "image_fast_v1.0",
          styleKey: style,
          originalPrompt: prompt,
          ratio,
          seed: -1,
          language: "en",
          originalPromptLanguage: "en",
        },
      ],
    },
    cookie,
  );

  if (submitted.code !== 200) {
    throw new Error(submitted.message || "GStory image submission failed");
  }

  const businessTaskId = submitted.data?.tasks?.[0]?.businessTaskId;
  if (!businessTaskId) throw new Error("GStory task ID missing");

  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(3000);
    const queried = await post(
      "/x2i_v2/query_v2",
      {
        tasks: [{ businessTaskId, includeFileDetails: true }],
        language: "en",
      },
      cookie,
    );
    const task = queried.data?.[0] || {};

    if (task.taskStatus === "SUCCEEDED") {
      return {
        url: task.resultFileInfo?.fileUrl || null,
        thumb: task.resultFileInfo?.fileThumbUrl || null,
        free_remaining: free.data?.t2iRemaining ?? null,
      };
    }

    if (task.taskStatus === "FAILED" || task.taskStatus === "CANCELED") {
      throw new Error(`GStory task ${task.taskStatus.toLowerCase()}`);
    }
  }

  throw new Error("GStory image generation timeout");
}

export default {
  name: "GStory AI Image",
  description: "Generate AI image from text prompt",
  category: "Image AI",
  methods: ["GET", "POST"],
  params: ["prompt", "style", "ratio"],
  paramsSchema: {
    prompt: {
      type: "string",
      required: true,
      description: "Deskripsi gambar yang ingin dibuat",
      example: "a dragon sleeping in the nest",
      minLength: 1,
      maxLength: 500,
    },
    style: {
      type: "string",
      required: false,
      default: "realistic",
      description: "Style gambar",
      example: "realistic",
    },
    ratio: {
      type: "string",
      required: false,
      default: "1:1",
      description: "Rasio gambar, misalnya 1:1, 9:16, atau 16:9",
      example: "1:1",
    },
  },
  async run(req, res) {
    const { prompt: promptInput, style: styleInput, ratio: ratioInput } = { ...req.query, ...req.body };
    const prompt = String(promptInput || "").trim();
    const style = String(styleInput || "realistic").trim() || "realistic";
    const ratio = String(ratioInput || "1:1").trim() || "1:1";

    if (!prompt) {
      return res.status(400).json({ status: false, message: "Parameter prompt wajib diisi" });
    }

    if (prompt.length > 500) {
      return res.status(400).json({ status: false, message: "Prompt maksimal 500 karakter" });
    }

    try {
      logger.info(`[GStory] Generating image | style=${style} | ratio=${ratio}`);
      const result = await generateImage(prompt, style, ratio);
      if (!result.url) throw new Error("GStory result URL missing");
      logger.info("[GStory] Image generated successfully");
      return res.json({ status: true, result: { prompt, style, ratio, ...result } });
    } catch (error) {
      logger.error(`[GStory] Error: ${error.message}`);
      return res.status(500).json({ status: false, message: error.message || "GStory generation failed" });
    }
  },
};
