import https from "https";
import axios from "axios";
import { SocksProxyAgent } from "socks-proxy-agent";
import logger from "../../src/utils/logger.js";

const PROXY_API = 'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text&protocol=socks5&timeout=5000';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchProxies() {
  return new Promise((resolve) => {
    const req = https.get(PROXY_API, { timeout: 10000 }, (res) => {
      let c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => {
        try {
          const lines = Buffer.concat(c).toString().split('\n').map(l => l.trim()).filter(Boolean);
          const proxies = lines.map(l => {
            const m = l.match(/([\d.]+):(\d+)/);
            return m ? `socks5://${m[1]}:${m[2]}` : null;
          }).filter(Boolean);
          resolve(proxies);
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

function buildBody(imageBuf, prompt) {
  const boundary = '----Boundary' + Date.now();
  const parts = [];
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`));
  parts.push(imageBuf);
  parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${prompt}`));
  parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="output_format"\r\n\r\njpg`));
  parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="generator_slug"\r\n\r\nai-image-editor`));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(parts) };
}

const HEADERS = {
  'Accept': '*/*',
  'Origin': 'https://banana-nano.ai',
  'Referer': 'https://banana-nano.ai/ai-image-editor',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
};

function postBanana(body, boundary, agent = undefined) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'ibbo.ai',
      port: 443,
      path: '/api/nano-banana-lite-image-to-image',
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      timeout: 60000,
    };
    if (agent) opts.agent = agent;
    const req = https.request(opts, (res) => {
      let c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => {
        const raw = Buffer.concat(c).toString();
        try { resolve(JSON.parse(raw)); } catch { resolve({ _raw: raw.substring(0, 500), _status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout 60s')); });
    req.write(body);
    req.end();
  });
}

async function downloadBuffer(url) {
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 30000, headers: { "User-Agent": "Mozilla/5.0" } });
  return Buffer.from(res.data);
}

export default {
  name: "NanoBanana Lite",
  description: "AI image edit — edit gambar dengan prompt (timeout 60s, auto proxy fallback)",
  category: "Image",
  methods: ["GET", "POST"],
  params: ["url", "prompt"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL gambar yang akan diedit",
      example: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg"
    },
    prompt: {
      type: "string",
      required: false,
      description: "Prompt editing",
      example: "add stylish glasses",
      default: "add stylish glasses"
    }
  },

  async run(req, res) {
    // timeout lama — set 70s
    if (req.setTimeout) req.setTimeout(70000);
    if (res.setTimeout) res.setTimeout(70000);

    const { url, image, prompt } = { ...req.query, ...req.body };
    const imageUrl = url || image;
    const promptVal = prompt || "add stylish glasses";

    if (!imageUrl) {
      return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi", code: "MISSING_URL" });
    }

    try {
      logger.info(`[NANOBANANA-LITE] start url=${imageUrl.slice(0,60)} prompt=${promptVal}`);
      const imgBuf = await downloadBuffer(imageUrl);
      logger.info(`[NANOBANANA-LITE] image ${imgBuf.length} bytes`);

      const { boundary, body } = buildBody(imgBuf, promptVal);

      let result = null;

      // coba fetch proxy dulu (max 5s)
      let proxies = [];
      try {
        proxies = await Promise.race([fetchProxies(), sleep(5000).then(() => [])]);
      } catch { proxies = []; }

      if (proxies.length > 0) {
        const proxy = proxies[Math.floor(Math.random() * proxies.length)];
        logger.info(`[NANOBANANA-LITE] try proxy ${proxy}`);
        try {
          const agent = new SocksProxyAgent(proxy);
          result = await postBanana(body, boundary, agent);
        } catch (e) {
          logger.warn(`[NANOBANANA-LITE] proxy fail: ${e.message}`);
        }
      }

      if (!result || result._raw || !result.success) {
        logger.info(`[NANOBANANA-LITE] try direct`);
        result = await postBanana(body, boundary);
      }

      if (!result?.success || !result?.data?.image_url) {
        throw new Error(result?._raw || result?.msg || JSON.stringify(result).slice(0,300) || "Gagal proses nano-banana");
      }

      const outUrl = result.data.image_url;
      logger.info(`[NANOBANANA-LITE] success ${outUrl.slice(0,80)} model=${result.data.model} remaining=${result.data.free_usage?.remaining}`);

      const outBuf = await downloadBuffer(outUrl);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Content-Length", outBuf.length);
      res.setHeader("X-Image-URL", outUrl);
      res.setHeader("X-Model", result.data.model || "nano-banana-lite");
      return res.send(outBuf);

    } catch (e) {
      logger.error(`[NANOBANANA-LITE] error: ${e.message}`);
      return res.status(500).json({ status: false, message: e.message, code: "NANOBANANA_ERROR" });
    }
  }
};
