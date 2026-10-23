import axios from "axios";
import * as cheerio from "cheerio";

const BASE_URL = "https://05c.manhwaland.land/";

function getAbsoluteUrl(pathOrUrl) {
  if (!pathOrUrl) return "";
  if (pathOrUrl.startsWith("http")) return pathOrUrl;
  if (pathOrUrl.startsWith("/")) return `${BASE_URL.replace(/\/$/, "")}${pathOrUrl}`;
  return `${BASE_URL.replace(/\/$/, "")}/${pathOrUrl}`;
}

async function fetchPage(url, params = {}) {
  const { data } = await axios.get(url, {
    params,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": BASE_URL,
    },
    timeout: 15000,
  });
  return data;
}

function parseMangaCard($, el) {
  const card = $(el);
  let href = "";
  if (card.prop("tagName").toLowerCase() === "a") {
    href = card.attr("href") || "";
  } else {
    href = card.find('a[href^="/manga/"]').first().attr("href") || "";
  }

  const title = card.find(".manga-title").text().trim() || card.find("h3").text().trim() || card.find("img").attr("alt")?.trim() || "";
  const image = card.find("img").attr("src") || "";
  const type = card.find(".manga-badge").text().trim() || card.find(".text-white\\/80").text().trim() || "";
  let rating = card.find(".text-amber-400").text().trim().replace("★", "").trim();
  if (!rating) {
    const match = card.text().match(/★\s*([\d.A-Za-z/]+)/);
    if (match) rating = match[1].trim();
  }
  let views = card.find(".text-zinc-300").text().trim();
  if (!views) {
    const match = card.text().match(/•\s*([\d.A-Za-z/]+)\s*•/);
    if (match) views = match[1].trim();
  }
  const latestChapters = [];
  card.find("div.flex.flex-col.gap-2 a, div.bg-card\\/50 a").each((i, chEl) => {
    const chHref = $(chEl).attr("href");
    const chText = $(chEl).find("span").first().text().trim() || $(chEl).text().trim();
    const chDate = $(chEl).find("span").last().text().trim() || "";
    latestChapters.push({
      title: chText,
      url: chHref ? getAbsoluteUrl(chHref) : "",
      uploadDate: chDate !== chText ? chDate : "",
    });
  });
  return { title, slug: href.replace(/^\/manga\//, ""), url: href ? getAbsoluteUrl(href) : "", image, type, rating: rating || "N/A", views: views || "N/A", latestChapters };
}

export default {
  name: "Manhwaland Search",
  description: "Cari manga/manhwa — homepage, latest, popular, genres, search, detail, chapter.",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["action"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      default: "homepage",
      description: "Action: homepage, latest, popular, genres, search, detail, chapter",
      enum: ["homepage", "latest", "popular", "genres", "search", "detail", "chapter"],
    },
    page: {
      type: "number",
      required: false,
      default: 1,
      description: "Halaman untuk hasil paginated",
    },
    genre: {
      type: "string",
      required: false,
      default: "",
      description: "Genre slug untuk action genre (contoh: action, romance)",
    },
    query: {
      type: "string",
      required: false,
      default: "",
      description: "Query pencarian untuk action search",
    },
    url: {
      type: "string",
      required: false,
      default: "",
      description: "URL atau slug untuk action detail/chapter",
    },
  },

  async run(req, res) {
    try {
      const { action, page, genre, query, url } = { ...req.query, ...req.body };

      if (!action) {
        return res.status(400).json({ status: false, message: "Parameter 'action' wajib diisi" });
      }

      const p = parseInt(page) || 1;

      let result;
      switch (action) {
        case "homepage": {
          const html = await fetchMage(BASE_URL);
          const $ = cheerio.load(html);
          const hero = [];
          $('img[loading="eager"]').each((i, el) => {
            const parent = $(el).parent();
            if (parent.prop("tagName").toLowerCase() === "a") {
              const href = parent.attr("href") || "";
              hero.push({ title: $(el).attr("alt") || "", slug: href.replace(/^\/manga\//, ""), url: getAbsoluteUrl(href), image: $(el).attr("src") || "" });
            }
          });
          const latest = [];
          $(".manga-card").each((i, el) => { latest.push(parseMangaCard($, el)); });
          result = { hero, latest: latest.slice(0, 20) };
          break;
        }
        case "latest": {
          const html = await fetchMage(`${BASE_URL}latest`, { page: p });
          const $ = cheerio.load(html);
          const manga = [];
          $(".manga-card").each((i, el) => { manga.push(parseMangaCard($, el)); });
          result = { page: p, manga };
          break;
        }
        case "popular": {
          const html = await fetchMage(`${BASE_URL}popular`, { page: p });
          const $ = cheerio.load(html);
          const manga = [];
          $(".manga-card").each((i, el) => { manga.push(parseMangaCard($, el)); });
          result = { page: p, manga };
          break;
        }
        case "genres": {
          const html = await fetchMage(BASE_URL);
          const $ = cheerio.load(html);
          const genres = [];
          $('a[href^="/genres/"]').each((i, el) => {
            const href = $(el).attr("href") || "";
            const title = $(el).text().trim();
            const slug = href.replace(/^\/genres\//, "");
            if (slug && !genres.some(g => g.slug === slug)) {
              genres.push({ title: title || slug, slug });
            }
          });
          result = genres;
          break;
        }
        case "search": {
          if (!query) return res.status(400).json({ status: false, message: "Parameter 'query' wajib untuk action search" });
          const html = await fetchMage(`${BASE_URL}search`, { q: query, page: p });
          const $ = cheerio.load(html);
          const manga = [];
          $(".manga-card, a.manga-grid").each((i, el) => { manga.push(parseMangaCard($, el)); });
          result = { query, page: p, manga };
          break;
        }
        case "detail": {
          if (!url) return res.status(400).json({ status: false, message: "Parameter 'url' wajib untuk action detail" });
          let detailUrl = url;
          if (!detailUrl.startsWith("http")) detailUrl = `${BASE_URL}manga/${detailUrl.replace(/^\/manga\//, "").replace(/^\//, "")}`;
          const html = await fetchMage(detailUrl);
          const $ = cheerio.load(html);
          const title = $("h1").text().trim();
          const image = $('img[alt^="Cover Komik"]').first().attr("src") || $("img.aspect-\\[2\\/3\\]").attr("src") || "";
          let author = "", artist = "", status = "", type = "", views = "";
          $("span").each((i, el) => {
            const txt = $(el).text().trim();
            if (txt === "Author") author = $(el).next().text().trim();
            else if (txt === "Artist") artist = $(el).next().text().trim();
            else if (txt === "Status") status = $(el).next().text().trim();
            else if (txt === "Type") type = $(el).next().text().trim();
            else if (txt === "Views") views = $(el).next().text().trim();
          });
          const synopsis = $("h3:contains('Synopsis')").next().text().trim() || "";
          const slug = detailUrl.replace(/\/$/, "").split("/").pop();
          const chapters = [];
          $("a").each((i, el) => {
            const href = $(el).attr("href") || "";
            if (href.startsWith(`/manga/${slug}/`)) {
              const chText = $(el).find("span").first().text().trim() || $(el).text().trim();
              const chDate = $(el).find("span").last().text().trim() || "";
              chapters.push({ title: chText.replace(chDate, "").trim(), slug: href.replace(`/manga/${slug}/`, ""), url: getAbsoluteUrl(href), uploadDate: chDate !== chText ? chDate.trim() : "" });
            }
          });
          result = { title, slug, url: detailUrl, image, author, artist, status, type, views, synopsis, chapters: chapters.reverse() };
          break;
        }
        case "chapter": {
          if (!url) return res.status(400).json({ status: false, message: "Parameter 'url' wajib untuk action chapter" });
          let chUrl = url;
          if (!chUrl.startsWith("http")) chUrl = `${BASE_URL}manga/${chUrl.replace(/^\/manga\//, "").replace(/^\//, "")}`;
          const html = await fetchMage(chUrl);
          const $ = cheerio.load(html);
          const title = $("title").text().trim();
          const images = [];
          $("img.page-image, img[class*='page-image']").each((i, el) => {
            const src = $(el).attr("src") || $(el).attr("data-src") || "";
            if (src) images.push(src);
          });
          if (images.length === 0) {
            $("img").each((i, el) => {
              const src = $(el).attr("src") || $(el).attr("data-src") || "";
              const cls = $(el).attr("class") || "";
              if (src && (cls.includes("page") || src.includes("/manga/"))) images.push(src);
            });
          }
          result = { title, url: chUrl, pages: images };
          break;
        }
        default:
          return res.status(400).json({ status: false, message: `Unknown action: ${action}` });
      }

      res.json({ status: true, result });
    } catch (err) {
      res.status(500).json({ status: false, message: err.message || "Request failed" });
    }
  },
};

async function fetchMage(url, params = {}) {
  const { data } = await axios.get(url, {
    params,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": BASE_URL,
    },
    timeout: 15000,
  });
  return data;
}