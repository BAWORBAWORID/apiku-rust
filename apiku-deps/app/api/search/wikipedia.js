import axios from "axios";
import * as cheerio from "cheerio";

const LIMIT = 5;
// WMF robot policy requires a descriptive UA — browser UA from non-browser clients gets 403 (T400119)
const UA = "ZyyvorAPI/2.1 (https://api.zyvor.my.id; contact: @ZyyvorAPI)";

function decodeHtml(text) {
  return String(text || "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanText(text) {
  return decodeHtml(text)
    .replace(/<\/?[^>]+>/g, "")
    .replace(/\[\d+\]/g, "")
    .replace(/\[[a-z]\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanBlock(text) {
  return decodeHtml(text)
    .replace(/<\/?[^>]+>/g, "")
    .replace(/\[\d+\]/g, "")
    .replace(/\[[a-z]\]/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fixUrl(url, base) {
  if (!url) return null;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `${base}${url}`;
  return url;
}

function uniqueBy(array, key) {
  return array.filter((item, index, self) => self.findIndex(x => x[key] === item[key]) === index);
}

const LANG = "id";
const BASE = `https://${LANG}.wikipedia.org`;
const API = `${BASE}/w/api.php`;

async function searchWikipedia(query) {
  const { data } = await axios.get(API, {
    params: {
      action: "query",
      list: "search",
      srsearch: query,
      srlimit: LIMIT,
      format: "json",
      origin: "*"
    },
    headers: {
      "user-agent": UA,
      "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7"
    },
    timeout: 10000
  });

  return data?.query?.search || [];
}

async function getFullArticle(title) {
  const pagePath = `/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`;
  const pageUrl = `${BASE}${pagePath}`;

  const { data } = await axios.get(pageUrl, {
    headers: {
      "user-agent": UA,
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      "referer": "https://www.wikipedia.org/"
    },
    timeout: 15000
  });

  const $ = cheerio.load(data);

  $("script, style, noscript, sup.reference, .mw-editsection, .navbox, .metadata, .ambox, .hatnote, .toc, #toc, table.vertical-navbox").remove();

  const pageTitle = cleanText($("#firstHeading").text()) || title;
  const description = cleanText($(".tagline").first().text()) || null;

  const introParagraphs = [];

  $(".mw-parser-output > section").first().find("p").each((_, el) => {
    const text = cleanBlock($(el).text());
    if (text.length > 40) introParagraphs.push(text);
  });

  if (!introParagraphs.length) {
    $(".mw-parser-output > p").each((_, el) => {
      const text = cleanBlock($(el).text());
      if (text.length > 40) introParagraphs.push(text);
    });
  }

  const sections = [];

  $(".mw-parser-output > section").each((_, section) => {
    const heading = cleanText($(section).find("h2, h3").first().text());
    if (!heading || heading.toLowerCase() === "daftar isi") return;

    const texts = [];
    $(section).find("p, ul, ol").each((_, el) => {
      const text = cleanBlock($(el).text());
      if (text.length > 40) texts.push(text);
    });

    if (texts.length) {
      sections.push({ title: heading, text: texts.join("\n\n") });
    }
  });

  const infobox = {};
  $(".infobox tr").each((_, tr) => {
    const key = cleanText($(tr).find("th").first().text());
    const value = cleanText($(tr).find("td").first().text());
    if (key && value && key.length < 100) infobox[key] = value;
  });

  const images = [];
  $(".mw-parser-output img").each((_, img) => {
    const src = fixUrl($(img).attr("src"), BASE);
    const alt = cleanText($(img).attr("alt"));
    if (!src) return;
    if (src.includes("static/images")) return;
    if (src.includes("Semi-protection")) return;
    if (src.includes("OOjs_UI")) return;
    images.push({ alt: alt || null, url: src });
  });

  return {
    title: pageTitle,
    description,
    url: pageUrl,
    extract: introParagraphs.join("\n\n") || null,
    sections,
    infobox,
    images: uniqueBy(images, "url")
  };
}

export default {
  name: "Wikipedia",
  description: "Cari dan ambil artikel Wikipedia lengkap beserta sections, infobox, dan gambar.",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["query"],

  paramsSchema: {
    query: {
      type: "string",
      required: true,
      description: "Kata kunci pencarian artikel Wikipedia",
      example: "Rendang",
      minLength: 1,
      maxLength: 300
    }
  },

  async run(req, res) {
    let { query } = { ...req.query, ...req.body };

    if (!query || typeof query !== "string" || !query.trim()) {
      return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi" });
    }

    query = query.trim();

    try {
      const results = await searchWikipedia(query);

      if (!results.length) {
        return res.status(404).json({ status: false, message: "Artikel tidak ditemukan" });
      }

      const first = results[0];
      const article = await getFullArticle(first.title);

      return res.json({
        status: true,
        result: {
          selected: {
            title: first.title,
            pageId: first.pageid,
            snippet: cleanText(first.snippet)
          },
          article
        }
      });
    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || "Gagal mengambil artikel Wikipedia" });
    }
  }
};
