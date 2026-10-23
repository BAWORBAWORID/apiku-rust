import axios from "axios";

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";
const ORIGIN = "https://ezremove.ai";
const API_CREATE = "https://api.ezremove.ai/api/ez-remove/watermark-remove/create-job";
const API_JOB   = "https://api.ezremove.ai/api/ez-remove/watermark-remove/get-job";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function getMime(buf) {
  const hex = buf.slice(0, 4).toString("hex");
  if (hex === "89504e47") return "image/png";
  if (hex.startsWith("52494646")) return "image/webp";
  return "image/jpeg";
}

function extFromMime(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

async function downloadImage(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    headers: { "User-Agent": UA },
    maxContentLength: 10 * 1024 * 1024
  });
  const ct = res.headers["content-type"] || "";
  if (!ct.startsWith("image/")) throw new Error("URL harus mengarah ke file gambar");
  return Buffer.from(res.data);
}

async function createJob(buf) {
  const mime = getMime(buf);
  const ext  = extFromMime(mime);
  const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`;

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image_file"; filename="upload.${ext}"\r\nContent-Type: ${mime}\r\n\r\n`),
    buf,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  const res = await axios.post(API_CREATE, body, {
    headers: {
      "User-Agent": UA,
      "Accept": "application/json, text/plain, */*",
      "Origin": ORIGIN,
      "Referer": `${ORIGIN}/`,
      "product-serial": `sr-${Date.now()}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": body.length
    },
    timeout: 30000,
    validateStatus: () => true,
    maxBodyLength: Infinity,
    maxContentLength: Infinity
  });

  if (res.status < 200 || res.status >= 300) throw new Error(`Create job failed: HTTP ${res.status}`);

  const jobId = res.data?.result?.job_id;
  if (!jobId) throw new Error("Job ID tidak diterima dari API");
  return jobId;
}

async function pollJob(jobId, maxTries = 30) {
  for (let i = 0; i < maxTries; i++) {
    await sleep(2000);

    const res = await axios.get(`${API_JOB}/${jobId}`, {
      headers: {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Origin": ORIGIN,
        "Referer": `${ORIGIN}/`,
        "product-serial": `sr-${Date.now()}`
      },
      timeout: 15000,
      validateStatus: () => true
    });

    if (res.status < 200 || res.status >= 300) throw new Error(`Poll job failed: HTTP ${res.status}`);

    const resultUrl = res.data?.result?.output?.[0];
    if (res.data?.code === 100000 && resultUrl) return resultUrl;

    // 300001 = still processing, anything else = error
    if (res.data?.code !== 300001) throw new Error(`Job error code: ${res.data?.code}`);
  }

  throw new Error("Timeout menunggu hasil ezremove.ai (60 detik)");
}

export default {
  name: "Remove Watermark (EZRemove)",
  description: "Hapus watermark dari gambar.",
  category: "Image",
  methods: ["GET", "POST"],
  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL gambar yang akan dihapus watermarknya",
      example: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg",
      default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg"
    }
  },

  async run(req, res) {
    const { url } = { ...req.query, ...req.body };

    if (!url || typeof url !== "string" || !url.trim()) {
      return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" });
    }

    try { new URL(url); } catch {
      return res.status(400).json({ status: false, message: "Format URL tidak valid" });
    }

    try {
      const imgBuf  = await downloadImage(url.trim());
      const jobId   = await createJob(imgBuf);
      const resultUrl = await pollJob(jobId);

      const result = await axios.get(resultUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
        headers: { "User-Agent": UA }
      });

      const outBuf = Buffer.from(result.data);
      const mime   = getMime(outBuf);

      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Length", outBuf.length);
      res.setHeader("X-Source", "ezremove.ai");
      res.setHeader("X-Job-ID", jobId);
      return res.send(outBuf);

    } catch (err) {
      const msg = err.message || "Gagal menghapus watermark";
      const code = msg.includes("Timeout") ? 504
                 : msg.includes("URL harus") ? 400
                 : 500;
      return res.status(code).json({ status: false, message: msg });
    }
  }
};
