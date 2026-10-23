import logger from "../../src/utils/logger.js";

const BASE_URL = "https://www.goal.com";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
};

const ACTIONS = ["latest", "transfers", "search", "article"];

function cleanText(text) {
  if (!text) return "";
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function deduplicateNews(newsArray) {
  const seen = new Set();
  const result = [];
  for (const item of newsArray) {
    const key = item.url || item.title;
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

function absolutize(url) {
  if (!url) return null;
  return url.startsWith("/") ? `${BASE_URL}${url}` : url;
}

async function fetchNextData(path = "/id") {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;

  const res = await fetch(url, {
    headers: DEFAULT_HEADERS,
    signal: AbortSignal.timeout(30000),
  });

  if (res.status !== 200) {
    throw new Error(`Gagal terhubung ke Goal.com (HTTP ${res.status})`);
  }

  const html = await res.text();
  const nextDataMatch = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );

  if (!nextDataMatch) {
    throw new Error("Gagal mengekstrak data internal Goal.com");
  }

  return JSON.parse(nextDataMatch[1]);
}

function collectCards(content) {
  const groups = [];
  const push = (cards) => {
    if (Array.isArray(cards) && cards.length) groups.push(cards);
  };

  push(content?.newsArchive?.news?.cards);
  push(content?.news?.cards);
  push(content?.cards);
  (Array.isArray(content?.elements) ? content.elements : []).forEach((elem) => {
    push(elem?.content?.cards);
  });

  if (groups.length) return groups;

  const deep = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.title && (node.url || node.teaser)) {
      deep.push(node);
      return;
    }
    Object.values(node).forEach(walk);
  };
  walk(content);

  return deep.length ? [deep] : [];
}

function mapCard(c, lang) {
  const img = c.image?.url || c.squareImage?.url || null;
  const tag = c.tags?.primaryTag?.name || null;

  return {
    title: cleanText(c.title),
    url: absolutize(c.url),
    teaser: cleanText(c.teaser),
    tag: tag ? cleanText(tag) : null,
    publishTime: c.publishTime || null,
    commentCount: c.commentCount ?? null,
    image: img ? img.replace(/&amp;/g, "&") : null,
    lang,
  };
}

async function getHome(lang = "id") {
  const json = await fetchNextData(`/${lang}`);
  const content = json.props?.pageProps?.content || {};

  const mostRead = [];
  if (Array.isArray(content.mostRead?.cards)) {
    content.mostRead.cards.forEach((c) => {
      if (c.headline && c.link?.slug && c.link?.id) {
        mostRead.push({
          title: cleanText(c.headline),
          url: `${BASE_URL}/${lang}/berita/${c.link.slug}/${c.link.id}`,
          views: c.viewsCount || 0,
        });
      }
    });
  }

  const newsFeed = [];
  for (const cards of collectCards(content)) {
    for (const c of cards) {
      if (c?.title) newsFeed.push(mapCard(c, lang));
    }
  }

  return {
    status: true,
    language: lang,
    mostRead: deduplicateNews(mostRead),
    totalNews: deduplicateNews(newsFeed).length,
    newsFeed: deduplicateNews(newsFeed),
  };
}

async function getTransfers(lang = "id") {
  const json = await fetchNextData(
    `/${lang}/kategori/transfers/1/k94w8e1yy9ch14mllpf4srnks`,
  );
  const content = json.props?.pageProps?.content || {};

  const transfers = [];
  for (const cards of collectCards(content)) {
    for (const c of cards) {
      if (c?.title) transfers.push(mapCard(c, lang));
    }
  }

  const unique = deduplicateNews(transfers);
  return { status: true, lang, total: unique.length, transfers: unique };
}

function scoreMatch(item, q) {
  const title = (item.title || "").toLowerCase();
  const teaser = (item.teaser || "").toLowerCase();
  const tag = (item.tag || "").toLowerCase();

  if (title.includes(q)) {
    return title === q || title.startsWith(q) || title.includes(` ${q} `) ? 30 : 20;
  }
  if (tag.includes(q)) return 5;
  if (teaser.includes(q)) return 1;
  return 0;
}

async function searchNews(query, lang = "id") {
  if (!query || !String(query).trim()) {
    throw new Error("Kata kunci pencarian tidak boleh kosong!");
  }

  const q = String(query).toLowerCase().trim();
  const sections = [];

  const home = await getHome(lang);
  if (Array.isArray(home.newsFeed)) sections.push(...home.newsFeed);
  if (Array.isArray(home.mostRead)) sections.push(...home.mostRead);

  try {
    const transfers = await getTransfers(lang);
    if (Array.isArray(transfers.transfers)) sections.push(...transfers.transfers);
  } catch (error) {
    logger.warn(`[Goal] arsip transfer gagal dimuat: ${error.message}`);
  }

  const seen = new Set();
  const scored = [];

  for (const item of sections) {
    const key = item.url || item.title;
    if (!key || seen.has(key)) continue;
    const score = scoreMatch(item, q);
    if (score <= 0) continue;
    seen.add(key);
    scored.push({ ...item, score });
  }

  scored.sort((a, b) => b.score - a.score);

  return {
    status: true,
    query,
    scope: "goal.com news archive (homepage + transfers + most read)",
    note: "Goal.com tidak menyediakan endpoint search publik; hasil di-rank dari arsip berita.",
    totalResults: scored.length,
    results: scored,
  };
}

async function getArticle(articleUrl) {
  if (!articleUrl || !articleUrl.includes("goal.com")) {
    throw new Error("URL artikel Goal.com tidak valid!");
  }

  const res = await fetch(articleUrl, {
    headers: DEFAULT_HEADERS,
    signal: AbortSignal.timeout(30000),
  });

  if (res.status !== 200) {
    throw new Error(`Gagal membuka artikel (HTTP ${res.status})`);
  }

  const html = await res.text();

  let title = "";
  let author = "";
  let publishDate = "";
  let heroImage = "";
  let description = "";

  const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/s);
  if (titleMatch) title = titleMatch[1].replace(/<[^>]+>/g, "").trim();

  for (const match of html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs,
  )) {
    try {
      const ld = JSON.parse(match[1]);
      if (ld["@type"] !== "NewsArticle" && ld["@type"] !== "Article") continue;
      title = title || ld.headline;
      publishDate = ld.datePublished || "";
      heroImage = ld.image || "";
      description = ld.description || "";
      if (Array.isArray(ld.author) && ld.author[0]) author = ld.author[0].name || "";
      else if (ld.author && ld.author.name) author = ld.author.name;
    } catch {
      /* abaikan JSON-LD yang tidak valid */
    }
  }

  if (!heroImage) {
    heroImage = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)?.[1] || "";
  }
  if (!description) {
    description = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/)?.[1] || "";
  }

  const paragraphs = [];
  const bodyHtml =
    (html.match(/<article[^>]*>(.*?)<\/article>/s) || html.match(/<main[^>]*>(.*?)<\/main>/s) || [html])[1] || html;

  for (const m of bodyHtml.matchAll(/<p[^>]*>(.*?)<\/p>/gs)) {
    const pText = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (
      pText.length > 30 &&
      !pText.includes("verifikasi usia") &&
      !pText.includes("iklan perjudian") &&
      !pText.includes("Tambahkan GOAL")
    ) {
      paragraphs.push(cleanText(pText));
    }
  }

  return {
    status: true,
    title: cleanText(title),
    url: articleUrl,
    author: cleanText(author) || "Goal.com",
    publishDate,
    heroImage: heroImage ? heroImage.replace(/&amp;/g, "&") : null,
    description: cleanText(description),
    totalParagraphs: paragraphs.length,
    content: paragraphs,
  };
}

export default {
  name: "Goal.com",
  description: "Scrape beritaArbaca sepak bola dari Goal.com (latest, transfers, search, article)",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["action", "query", "url", "lang"],

  paramsSchema: {
    action: {
      type: "string",
      required: false,
      default: "latest",
      enum: ACTIONS,
      description: "Aksi: latest (berita terbaru), transfers, search, article",
      example: "latest",
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci untuk action=search",
      example: "Barcelona",
    },
    url: {
      type: "string",
      required: false,
      description: "URL artikel untuk action=article",
      example:
        "https://www.goal.com/id/berita/contoh-artikel/blta689069dfe2a7976",
    },
    lang: {
      type: "string",
      required: false,
      default: "id",
      description: "Kode bahasa: id atau en",
      example: "id",
    },
  },

  async run(req, res) {
    try {
      const { action, query, url, lang } = { ...req.query, ...req.body };
      const act = String(action || "latest").trim().toLowerCase();
      const language = String(lang || "id").trim() || "id";

      if (!ACTIONS.includes(act)) {
        return res.status(400).json({
          status: false,
          message: `Action tidak valid. Pilihan: ${ACTIONS.join(", ")}`,
        });
      }

      if (act === "search") {
        if (!query || !String(query).trim()) {
          return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi untuk action=search" });
        }
        const result = await searchNews(String(query).trim(), language);
        return res.json({ status: true, action: act, result });
      }

      if (act === "article") {
        if (!url || !String(url).trim()) {
          return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi untuk action=article" });
        }
        const result = await getArticle(String(url).trim());
        return res.json({ status: true, action: act, result });
      }

      const result = act === "transfers" ? await getTransfers(language) : await getHome(language);
      return res.json({ status: true, action: act, result });
    } catch (error) {
      logger.error(`[Goal] Error: ${error.message}`);
      return res.status(500).json({
        status: false,
        message: error.message || "Gagal mengambil data Goal.com",
      });
    }
  },
};
