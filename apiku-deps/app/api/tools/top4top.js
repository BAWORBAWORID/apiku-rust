import https from "https";
import http from "http";
import crypto from "crypto";
import { URL } from "url";

const BASE = "https://top4top.io";
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const SUBMIT_FILE = "[ رفع الملفات ]";
const SUBMIT_URL = "[ سحب الملفات من رابط ]";

const MIME = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".webp": "image/webp", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".ogg": "audio/ogg",
  ".pdf": "application/pdf", ".zip": "application/zip", ".rar": "application/vnd.rar",
  ".txt": "text/plain", ".json": "application/json", ".js": "application/javascript",
  ".apk": "application/vnd.android.package-archive",
};

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const headers = {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Encoding": "identity",
      "Accept-Language": "id-ID,id;q=0.9,ar;q=0.8",
      ...(opts.headers || {}),
    };
    Object.keys(headers).forEach((k) => headers[k] === undefined && delete headers[k]);

    const r = lib.request({
      hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: opts.method || "GET",
      headers,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = new URL(res.headers.location, url).toString();
        res.resume();
        const keep = res.statusCode === 307 || res.statusCode === 308;
        const nextOpts = keep
          ? opts
          : {
              ...opts,
              method: "GET",
              body: undefined,
              headers: { ...(opts.headers || {}), "Content-Type": undefined, "Content-Length": undefined },
            };
        return request(loc, nextOpts).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, buffer, body: buffer.toString() });
      });
    });
    r.setTimeout(opts.timeout || 180000, () => r.destroy(new Error("Timeout")));
    r.on("error", reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

function fileNameFromUrl(url, contentType) {
  const u = new URL(url);
  let name = u.pathname.split("/").pop() || "file";
  if (!name.includes(".") && contentType) {
    const found = Object.entries(MIME).find(([, v]) => contentType.startsWith(v));
    if (found) name += found[0];
  }
  return name;
}

async function loadSource(src) {
  if (!/^https?:\/\//i.test(src)) throw new Error("Hanya mendukung URL (http/https)");
  const res = await request(src);
  if (res.status !== 200) throw new Error(`Gagal download sumber: HTTP ${res.status}`);
  return { buffer: res.buffer, name: fileNameFromUrl(src, res.headers["content-type"]) };
}

async function getSession() {
  const home = await request(BASE + "/");
  if (home.status !== 200) throw new Error(`Homepage HTTP ${home.status}`);
  const sidMatch = home.body.match(/name=["']sid["'][^>]*value=["']([^"']+)["']/i)
    || home.body.match(/value=["']([^"']+)["'][^>]*name=["']sid["']/i);
  if (!sidMatch) throw new Error("Field sid tidak ketemu di homepage");
  const cookies = (home.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");
  return { sid: sidMatch[1], cookies };
}

function buildMultipart(fields, file) {
  const boundary = "----WebKitFormBoundary" + crypto.randomBytes(8).toString("hex");
  const parts = [];

  for (const [key, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
      "utf8"
    ));
  }

  if (file) {
    const ext = file.name.split(".").pop().toLowerCase();
    const mime = MIME[`.${ext}`] || "application/octet-stream";
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name.replace(/"/g, "")}"\r\nContent-Type: ${mime}\r\n\r\n`,
      "utf8"
    ));
    parts.push(file.buffer);
    parts.push(Buffer.from("\r\n", "utf8"));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

function extractLinks(html) {
  const rx = /https?:\/\/[a-z0-9-]+\.top4top\.io\/[^"'\s<>\\]+/gi;
  const all = [...new Set((html.match(rx) || []).map((l) => l.replace(/&/g, "&")))];
  const direct = all.filter((l) => /\/[a-z]_[a-z0-9]+\.[a-z0-9]+$/i.test(l));
  const page = all.filter((l) => /\/downloadf-/i.test(l));
  const other = all.filter((l) => !direct.includes(l) && !page.includes(l));
  return { all, direct, page, other };
}

async function post(body, contentType, session) {
  const res = await request(`${BASE}/index.php`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": contentType,
      "Content-Length": body.length,
      Origin: BASE,
      Referer: BASE + "/",
      ...(session.cookies ? { Cookie: session.cookies } : {}),
    },
  });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

  const links = extractLinks(res.body);
  if (!links.direct.length && !links.page.length) {
    throw new Error(`Link tidak ketemu di response. Cuplikan: ${res.body.replace(/\s+/g, " ").slice(0, 500)}`);
  }
  return links;
}

export default {
  name: "Top4Top Uploader",
  description: "Upload file ke top4top.io via URL remote, dapatkan link CDN langsung",
  category: "Tools",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: { type: "string", required: true, description: "URL file yang ingin di-upload ke top4top (remote fetch)", example: "https://example.com/file.zip" },
  },
  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body };
      if (!url || !/^https?:\/\//i.test(url)) {
        return res.status(400).json({ success: false, error: "Parameter 'url' wajib diisi (format http/https)" });
      }

      const file = await loadSource(url);
      if (!file.buffer.length) throw new Error("File kosong");

      const session = await getSession();
      const { body, contentType } = buildMultipart(
        { sid: session.sid, file_1_: url, submittxt: SUBMIT_URL },
        null
      );
      const links = await post(body, contentType, session);

      const cdn = links.direct[0] || links.page[0];
      res.json({
        success: true,
        source: url,
        filename: file.name,
        size: file.buffer.length,
        cdn: cdn,
        direct: links.direct,
        page: links.page,
        other: links.other,
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  },
};