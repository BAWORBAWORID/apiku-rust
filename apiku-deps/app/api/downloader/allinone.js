/**
 * All-In-One Downloader — via downr.org
 * Scrape TikTok, Instagram, YouTube, Facebook, Twitter dll
 *
 * GET  /api/downloader/allinone?url=https://vt.tiktok.com/ZSbm6fY8P/
 * POST /api/downloader/allinone
 */

import axios from "axios";
import { parse } from "node-html-parser";

const BASE = "https://downr.org";
const ANALYTICS = `${BASE}/.netlify/functions/analytics`;
const DOWNLOAD = `${BASE}/.netlify/functions/download`;
const NYT = `${BASE}/.netlify/functions/nyt`;

const RETATUBE = "https://retatube.com";
const RETATUBE_HTML = `${RETATUBE}/api/v1/aio/html`;
const RETATUBE_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36",
  Referer: `${RETATUBE}/`,
  Origin: RETATUBE
};

const UA = "Mozilla/5.0 (Linux; Android 15; SM-F958 Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36";

function parseCookie(setCookie = []) {
  return setCookie.map(v => v.split(";")[0]).join("; ");
}

function parseData(data) {
  if (typeof data !== "string") return data;
  const text = data.trim();
  try { return JSON.parse(text); }
  catch { return text; }
}

function isOk(status, data) {
  const isObject = data && typeof data === "object";
  if (status < 200 || status >= 300) return false;
  if (data === null || data === undefined) return false;
  if (data === "") return false;
  if (data === "error") return false;
  if (data === "failed") return false;
  if (data === "user_retry_required") return false;
  if (isObject && data.error === true) return false;
  if (isObject && data.status === false) return false;
  if (isObject && data.success === false) return false;
  return true;
}

function getError(data, status) {
  if (typeof data === "string") return data || `HTTP ${status}`;
  if (data && typeof data === "object") {
    return data.message || data.error || data.status || data.reason || `HTTP ${status}`;
  }
  return `HTTP ${status}`;
}

async function retatubeFallback(url) {
  const res = await axios.post(
    RETATUBE_HTML,
    { vid: url, prefix: "retatube.com", ex: "", format: "" },
    { headers: RETATUBE_HEADERS, timeout: 60000, validateStatus: () => true }
  );

  const root = parse(res.data);
  const section = root.querySelector(".download-section");
  if (!section) {
    throw new Error("No download results found");
  }

  const title =
    section.querySelector("h3")?.text?.trim() ||
    section.querySelector(".wrap-break-word")?.text?.trim() ||
    null;
  const owner = section.querySelector("p strong")?.parentNode?.text
    ?.replace("Owner:", "")
    ?.trim() || null;
  const thumbnail = section.querySelector("img")?.getAttribute("src") || null;
  const downloads = [];

  section.querySelectorAll("a.download-btn").forEach((link) => {
    const downloadUrl = link.getAttribute("href");
    if (downloadUrl && !downloadUrl.startsWith("#")) {
      downloads.push({ label: link.text.trim(), url: downloadUrl });
    }
  });

  return {
    status: res.status,
    data: { title, owner, thumbnail, downloads }
  };
}

async function getCookie() {
  const res = await axios.get(ANALYTICS, {
    timeout: 30000,
    validateStatus: () => true,
    responseType: "text",
    transformResponse: [v => v],
    headers: {
      accept: "*/*",
      referer: `${BASE}/`,
      "user-agent": UA
    }
  });
  return parseCookie(res.headers["set-cookie"] || []);
}

async function postEndpoint(endpoint, url, cookie = "") {
  const res = await axios.post(endpoint, { url }, {
    timeout: 120000,
    validateStatus: () => true,
    responseType: "text",
    transformResponse: [v => v],
    headers: {
      accept: "*/*",
      "accept-encoding": "gzip, deflate, br",
      "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      "content-type": "application/json",
      cookie,
      origin: BASE,
      referer: `${BASE}/`,
      "sec-ch-ua": '"Chromium";v="137", "Not/A)Brand";v="24"',
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Android"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "user-agent": UA
    }
  });
  return {
    endpoint,
    status: res.status,
    data: parseData(res.data)
  };
}

async function tryDownload(url) {
  let cookie = await getCookie();
  let result = await postEndpoint(DOWNLOAD, url, cookie);
  if (isOk(result.status, result.data)) return result;

  cookie = await getCookie();
  result = await postEndpoint(DOWNLOAD, url, cookie);
  if (isOk(result.status, result.data)) return result;

  result = await postEndpoint(NYT, url, cookie);
  return result;
}

async function downr(url) {
  try {
    if (!url || !/^https?:\/\//i.test(url)) {
      return { Status: false, Code: 400, Input: url, Endpoint: null, Result: null, Error: "URL tidak valid" };
    }

    let result = await tryDownload(url);
    let ok = isOk(result.status, result.data);

    // downr.org can reject otherwise valid requests with action_forbidden.
    // Use the working retatube resolver as a transparent fallback.
    if (!ok && /action_forbidden/i.test(getError(result.data, result.status))) {
      try {
        const fallback = await retatubeFallback(url);
        if (isOk(fallback.status, fallback.data)) {
          result = {
            endpoint: RETATUBE_HTML,
            status: fallback.status,
            data: fallback.data
          };
          ok = true;
        }
      } catch {
        // Keep the original upstream error when the fallback also fails.
      }
    }

    return {
      Status: ok,
      Code: result.status,
      Input: url,
      Endpoint: result.endpoint,
      Result: ok ? result.data : null,
      Error: ok ? null : getError(result.data, result.status)
    };
  } catch (err) {
    return {
      Status: false,
      Code: err.response?.status || 500,
      Input: url || null,
      Endpoint: null,
      Result: null,
      Error: err.message
    };
  }
}

export default {
  name: "All-In-One Downloader",
  description: "Download video dari berbagai platform (TikTok, Instagram, YouTube, Facebook, Twitter, dll) — dengan retry & fallback endpoint.",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string", required: true,
      description: "URL video yang ingin diunduh (TikTok, Instagram, YouTube, Facebook, Twitter, dll)",
      default: "https://vt.tiktok.com/ZSbm6fY8P/",
      example: "https://vt.tiktok.com/ZSbm6fY8P/"
    }
  },

  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body };

      if (!url || !String(url).trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi"
        });
      }

      const result = await downr(String(url).trim());

      return res.status(result.Code || 200).json({
        status: result.Status,
        ...(result.Status
          ? { result: result.Result, endpoint: result.Endpoint }
          : { message: result.Error }
        ),
        input: url.trim()
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal mendownload"
      });
    }
  }
};
