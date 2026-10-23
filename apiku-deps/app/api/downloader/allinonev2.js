/**
 * All-In-One Downloader v2 — via retatube.com
 * Base: https://retatube.com
 * Sumber Scraper: ShanMolvyr
 *
 * Download dari berbagai platform: TikTok, Instagram, YouTube, Facebook, Twitter dll
 *
 * GET  /api/downloader/allinonev2?url=https://vt.tiktok.com/xxx
 * POST /api/downloader/allinonev2
 */

import axios from "axios";
import { parse } from "node-html-parser";

const BASE_URL = "https://retatube.com";
const PREFIX = "retatube.com";
const HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36",
  Referer: "https://retatube.com/",
  Origin: "https://retatube.com",
};

async function fetchInfo(url, { exclude = "", format = "" } = {}) {
  const res = await axios.post(
    `${BASE_URL}/api/v1/aio/html`,
    { vid: url, prefix: PREFIX, ex: exclude, format },
    { headers: HEADERS, timeout: 60000 }
  );
  return parseHtml(res.data);
}

function parseHtml(html) {
  const root = parse(html);
  const section = root.querySelector(".download-section");
  if (!section) throw new Error("No download results found");

  const title =
    section.querySelector("h3")?.text?.trim() ||
    section.querySelector(".wrap-break-word")?.text?.trim() ||
    null;

  const owner =
    section.querySelector("p strong")?.parentNode?.text
      ?.replace("Owner:", "")
      ?.trim() || null;

  const thumbnail = section.querySelector("img")?.getAttribute("src") || null;

  const links = [];
  section.querySelectorAll("a.download-btn").forEach((a) => {
    const href = a.getAttribute("href");
    const label = a.text.trim();
    if (href && !href.startsWith("#")) links.push({ label, url: href });
  });

  return {
    title,
    owner,
    thumbnail,
    downloads: links,
  };
}

async function fetchFormats(url, format, { exclude = "" } = {}) {
  const res = await axios.post(
    `${BASE_URL}/api/v1/aio/search`,
    { vid: url, prefix: PREFIX, ex: exclude, format },
    { headers: HEADERS, timeout: 60000 }
  );
  // Check if search endpoint returned JSON error
  if (typeof res.data === 'object' && res.data.code === -1) {
    // Fallback to html endpoint
    const htmlRes = await axios.post(
      `${BASE_URL}/api/v1/aio/html`,
      { vid: url, prefix: PREFIX, ex: exclude, format },
      { headers: HEADERS, timeout: 60000 }
    );
    return parseHtml(htmlRes.data);
  }
  // Parse HTML response
  return parseHtml(res.data);
}

async function checkProgress(loaderId, videoUrl) {
  const res = await axios.get(`${BASE_URL}/api/v1/loader/progress`, {
    params: { id: loaderId, prefix: PREFIX, v: Date.now(), s: videoUrl },
    headers: HEADERS,
    timeout: 30000,
  });
  return { loaderId, ...res.data };
}

async function retatube(url, format = "") {
  try {
    if (!url || !/^https?:\/\//i.test(url)) {
      return { Status: false, error: "URL tidak valid" };
    }

    const result = format
      ? await fetchFormats(url, format)
      : await fetchInfo(url);

    return { Status: true, ...result };
  } catch (err) {
    return {
      Status: false,
      error: err.message || "Gagal mengambil data",
    };
  }
}

export default {
  name: "All-In-One Downloader v2",
  description: "Download video dari berbagai platform (TikTok, Instagram, YouTube, Facebook, Twitter, dll) — dengan dukungan format selection & progress tracking.",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url", "format"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL video yang ingin diunduh (TikTok, Instagram, YouTube, Facebook, dll)",
      default: "https://vt.tiktok.com/ZSbm6fY8P/",
      example: "https://vt.tiktok.com/ZSbm6fY8P/",
    },
    format: {
      type: "string",
      required: false,
      description: "Format yang diinginkan (opsional — jika tidak diisi akan auto-detect)",
      example: "mp4",
    },
  },

  async run(req, res) {
    try {
      const { url, format } = { ...req.query, ...req.body };

      if (!url || !String(url).trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
        });
      }

      const result = await retatube(String(url).trim(), String(format || "").trim());

      return res.status(result.Status ? 200 : 500).json({
        status: result.Status,
        input: url.trim(),
        ...(result.Status
          ? {
              title: result.title,
              owner: result.owner,
              thumbnail: result.thumbnail,
              downloads: result.downloads,
              ...(result.data ? { formats: result.data } : {}),
            }
          : { message: result.error }),
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal mendownload",
      });
    }
  },
};

// CLI mode
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const url = args[0];
  const format = args[1] || "";

  if (!url) {
    console.error("Usage: node retatube.js <url> [format]");
    process.exit(1);
  }

  const run = async () => {
    try {
      const result = format ? await fetchFormats(url, format) : await fetchInfo(url);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error(JSON.stringify({ error: err.message }));
      process.exit(1);
    }
  };
  run();
}
