import axios from "axios";
import * as cheerio from "cheerio";


const BASE_URL = "https://otakudesu.blog";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Referer: BASE_URL,
};

const client = axios.create({
  headers: HEADERS,
  maxRedirects: 5,
  validateStatus: (status) => status >= 200 && status < 400,
});

// Format Standar JSON Response
const formatResponse = (success, dataOrMessage) => {
  const result = {
    creator: "Lann",
    status: success,
  };
  if (success) {
    result.data = dataOrMessage;
  } else {
    result.message = dataOrMessage;
  }
  return result;
};

// ==========================================
// 1. SCRAPER ENGINE CORE
// ==========================================

// 1. Home (Ongoing & Completed Summary)
async function getHome() {
  try {
    const { data } = await client.get(BASE_URL);
    const $ = cheerio.load(data);

    const ongoing = [];
    $(".venz")
      .first()
      .find("ul li")
      .each((_, el) => {
        const item = $(el);
        const title = item.find("h2").text().trim();
        const url = item.find("a").first().attr("href");
        const thumb = item.find("img").attr("src");
        const episode = item.find(".epz").text().trim();
        const day = item.find(".epztipe").text().trim();
        const date = item.find(".newseps").text().trim();
        const endpoint = url ? url.replace(`${BASE_URL}/anime/`, "").replace(/\/$/, "") : "";

        if (title && url) {
          ongoing.push({ title, endpoint, url, thumb, episode, day, date });
        }
      });

    const completed = [];
    $(".venz")
      .last()
      .find("ul li")
      .each((_, el) => {
        const item = $(el);
        const title = item.find("h2").text().trim();
        const url = item.find("a").first().attr("href");
        const thumb = item.find("img").attr("src");
        const episode = item.find(".epz").text().trim();
        const score = item.find(".epztipe").text().trim();
        const date = item.find(".newseps").text().trim();
        const endpoint = url ? url.replace(`${BASE_URL}/anime/`, "").replace(/\/$/, "") : "";

        if (title && url) {
          completed.push({ title, endpoint, url, thumb, episode, score, date });
        }
      });

    return formatResponse(true, { ongoing, completed });
  } catch (err) {
    return formatResponse(false, err.message);
  }
}

// 2. Ongoing Anime (Paginated)
async function getOngoingAnime(page = 1) {
  try {
    const url = page > 1 ? `${BASE_URL}/ongoing-anime/page/${page}/` : `${BASE_URL}/ongoing-anime/`;
    const { data } = await client.get(url);
    const $ = cheerio.load(data);
    const anime = [];

    $(".venz ul li").each((_, el) => {
      const item = $(el);
      const title = item.find("h2").text().trim();
      const url = item.find("a").first().attr("href");
      const thumb = item.find("img").attr("src");
      const episode = item.find(".epz").text().trim();
      const day = item.find(".epztipe").text().trim();
      const date = item.find(".newseps").text().trim();
      const endpoint = url ? url.replace(`${BASE_URL}/anime/`, "").replace(/\/$/, "") : "";

      if (title && url) {
        anime.push({ title, endpoint, url, thumb, episode, day, date });
      }
    });

    return formatResponse(true, { page: Number(page), anime });
  } catch (err) {
    return formatResponse(false, err.message);
  }
}

// 3. Completed Anime (Paginated)
async function getCompleteAnime(page = 1) {
  try {
    const url = page > 1 ? `${BASE_URL}/complete-anime/page/${page}/` : `${BASE_URL}/complete-anime/`;
    const { data } = await client.get(url);
    const $ = cheerio.load(data);
    const anime = [];

    $(".venz ul li").each((_, el) => {
      const item = $(el);
      const title = item.find("h2").text().trim();
      const url = item.find("a").first().attr("href");
      const thumb = item.find("img").attr("src");
      const episode = item.find(".epz").text().trim();
      const score = item.find(".epztipe").text().trim();
      const date = item.find(".newseps").text().trim();
      const endpoint = url ? url.replace(`${BASE_URL}/anime/`, "").replace(/\/$/, "") : "";

      if (title && url) {
        anime.push({ title, endpoint, url, thumb, episode, score, date });
      }
    });

    return formatResponse(true, { page: Number(page), anime });
  } catch (err) {
    return formatResponse(false, err.message);
  }
}

// 4. All Anime List Directory (A-Z)
async function getAnimeList() {
  try {
    const { data } = await client.get(`${BASE_URL}/anime-list/`);
    const $ = cheerio.load(data);
    const animeList = [];

    $("#absl .barispu").each((_, group) => {
      $(group)
        .find(".hpage a")
        .each((_, el) => {
          const title = $(el).text().trim();
          const url = $(el).attr("href");
          const endpoint = url ? url.replace(`${BASE_URL}/anime/`, "").replace(/\/$/, "") : "";
          if (title && url) {
            animeList.push({ title, endpoint, url });
          }
        });
    });

    return formatResponse(true, animeList);
  } catch (err) {
    return formatResponse(false, err.message);
  }
}

// 5. Search Anime
async function searchAnime(query) {
  try {
    const { data } = await client.get(`${BASE_URL}/?s=${encodeURIComponent(query)}&post_type=anime`);
    const $ = cheerio.load(data);
    const results = [];

    $(".chivsrc li").each((_, el) => {
      const item = $(el);
      const title = item.find("h2 a").text().trim();
      const url = item.find("h2 a").attr("href");
      const thumb = item.find("img").attr("src");
      const endpoint = url ? url.replace(`${BASE_URL}/anime/`, "").replace(/\/$/, "") : "";

      const genres = [];
      item.find(".set a").each((_, g) => genres.push($(g).text().trim()));

      const status = item.find(".set:contains('Status')").text().replace("Status :", "").trim();
      const rating = item.find(".set:contains('Rating')").text().replace("Rating :", "").trim();

      if (title && url) {
        results.push({ title, endpoint, url, thumb, genres, status, rating });
      }
    });

    return formatResponse(true, results);
  } catch (err) {
    return formatResponse(false, err.message);
  }
}

// 6. Anime Detail & Episode List
async function getAnimeDetail(endpoint) {
  try {
    const cleanEndpoint = endpoint.trim().replace(/^\/|\/$/g, "");
    const fullUrl = cleanEndpoint.startsWith("http")
      ? cleanEndpoint
      : `${BASE_URL}/anime/${cleanEndpoint}/`;

    const res = await client.get(fullUrl);
    const finalUrl = res.request?.res?.responseUrl || fullUrl;
    const $ = cheerio.load(res.data);

    const isAnimePage = finalUrl.includes("/anime/");
    if (!isAnimePage) {
      return formatResponse(
        false,
        `URL/Endpoint bukan halaman anime (dialihkan ke: ${finalUrl})`
      );
    }

    const info = {};
    $(".infozingle p").each((_, el) => {
      const text = $(el).text().trim();
      if (text.includes(":")) {
        const [k, ...v] = text.split(":");
        info[k.trim()] = v.join(":").trim();
      }
    });

    const episodes = [];
    $(".episodelist").each((_, epDiv) => {
      $(epDiv)
        .find("ul li")
        .each((_, el) => {
          const a = $(el).find("a");
          const date = $(el).find(".zeebr").text().trim();
          const epUrl = a.attr("href");
          const epTitle = a.text().trim();
          if (epUrl && epTitle && epUrl.includes("/episode/")) {
            const epEndpoint = epUrl.replace(`${BASE_URL}/episode/`, "").replace(/\/$/, "");
            episodes.push({
              title: epTitle,
              endpoint: epEndpoint,
              url: epUrl,
              date,
            });
          }
        });
    });

    let batchLink = null;
    $("a").each((_, a) => {
      const href = $(a).attr("href");
      if (href && href.includes("/batch/")) {
        batchLink = {
          title: $(a).text().trim(),
          url: href,
          endpoint: href.replace(`${BASE_URL}/batch/`, "").replace(/\/$/, ""),
        };
      }
    });

    return formatResponse(true, {
      title: info["Judul"] || $(".jdlwrap h1").text().trim() || $("h1.entry-title").text().trim(),
      japanese: info["Japanese"] || null,
      score: info["Skor"] || null,
      producer: info["Produser"] || null,
      type: info["Tipe"] || null,
      status: info["Status"] || null,
      total_episodes: info["Total Episode"] || null,
      duration: info["Durasi"] || null,
      release_date: info["Tanggal Rilis"] || null,
      studio: info["Studio"] || null,
      genres: info["Genre"] ? info["Genre"].split(",").map((g) => g.trim()) : [],
      synopsis: $(".sinopc").text().trim(),
      thumb: $(".attachment-post-thumbnail").attr("src"),
      batch: batchLink,
      episodes,
    });
  } catch (err) {
    return formatResponse(false, err.message);
  }
}

// 7. Episode Detail (Default Stream, Decrypted Mirrors, Downloads, Navigation)
async function getEpisodeDetail(endpoint, episodeNumber = null) {
  try {
    let cleanEndpoint = endpoint.trim().replace(/^\/|\/$/g, "");
    let targetUrl = cleanEndpoint.startsWith("http")
      ? cleanEndpoint
      : `${BASE_URL}/episode/${cleanEndpoint}/`;

    let res = await client.get(targetUrl);
    let finalUrl = res.request?.res?.responseUrl || targetUrl;
    let $ = cheerio.load(res.data);

    // AUTO-RESOLVE: Jika input adalah slug anime (misal 'borot-sub-indo' / 'yowayowa-sensei-sub-indo')
    if (finalUrl.includes("/anime/")) {
      const episodes = [];
      $(".episodelist").each((_, epDiv) => {
        $(epDiv)
          .find("ul li a")
          .each((_, a) => {
            const epHref = $(a).attr("href");
            if (epHref && epHref.includes("/episode/")) {
              episodes.push({
                title: $(a).text().trim(),
                endpoint: epHref.replace(`${BASE_URL}/episode/`, "").replace(/\/$/, ""),
                url: epHref,
              });
            }
          });
      });

      if (episodes.length === 0) {
        return formatResponse(false, `Anime '${cleanEndpoint}' tidak memiliki episode.`);
      }

      let selectedEp = episodes[0];
      if (episodeNumber) {
        const found = episodes.find((ep) =>
          new RegExp(`\\b(eps|episode)\\s*${episodeNumber}\\b`, "i").test(ep.title)
        );
        if (found) selectedEp = found;
      }

      const resolvedRes = await client.get(selectedEp.url);
      finalUrl = resolvedRes.request?.res?.responseUrl || selectedEp.url;
      $ = cheerio.load(resolvedRes.data);
    }

    const pageTitle = $(".posttl").text().trim() || $("h1").text().trim();
    if (!pageTitle) {
      return formatResponse(false, `Episode '${endpoint}' tidak ditemukan atau halaman tidak valid.`);
    }

    // Navigasi Episode
    let previous_episode = null;
    let next_episode = null;
    let anime_info = null;

    $(".flir a, .nvs a").each((_, a) => {
      const text = $(a).text().trim().toLowerCase();
      const href = $(a).attr("href") || "";
      if (text.includes("prev") || text.includes("sebelum")) {
        previous_episode = {
          title: $(a).text().trim(),
          endpoint: href.replace(`${BASE_URL}/episode/`, "").replace(/\/$/, ""),
          url: href,
        };
      } else if (text.includes("next") || text.includes("lanjut")) {
        next_episode = {
          title: $(a).text().trim(),
          endpoint: href.replace(`${BASE_URL}/episode/`, "").replace(/\/$/, ""),
          url: href,
        };
      } else if (text.includes("all") || text.includes("semua") || href.includes("/anime/")) {
        anime_info = {
          title: $(a).text().trim(),
          endpoint: href.replace(`${BASE_URL}/anime/`, "").replace(/\/$/, ""),
          url: href,
        };
      }
    });

    // Ekstraksi Action & Nonce dinamis untuk Mirror Decryption
    let nonceAction = "aa1208d27f29ca340c92c66d1926f13f";
    let streamAction = "2a3505c93b0035d3f455df82bf976b84";

    const scripts = $("script").toArray();
    for (const s of scripts) {
      const scriptText = $(s).html() || "";
      if (scriptText.includes("__x__nonce")) {
        const matchStreamAction = scriptText.match(/nonce:[^,]+,\s*action:\s*["']([a-f0-9]{32})["']/);
        const matchNonceAction = scriptText.match(/data:\s*\{\s*action:\s*["']([a-f0-9]{32})["']\s*\}/);
        if (matchNonceAction) nonceAction = matchNonceAction[1];
        if (matchStreamAction) streamAction = matchStreamAction[1];
        break;
      }
    }

    const ajaxHeaders = {
      ...HEADERS,
      Referer: finalUrl,
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    };

    let nonce = null;
    try {
      const nonceRes = await client.post(
        `${BASE_URL}/wp-admin/admin-ajax.php`,
        new URLSearchParams({ action: nonceAction }).toString(),
        { headers: ajaxHeaders }
      );
      nonce = nonceRes.data?.data;
    } catch (err) {}

    const mirrors = {};
    const mirrorPromises = [];

    $(".mirrorstream ul").each((_, ul) => {
      const className = $(ul).attr("class") || "";
      const quality = className.replace(/^m/, "").trim();
      if (!quality) return;
      mirrors[quality] = [];

      $(ul)
        .find("li a")
        .each((_, a) => {
          const serverName = $(a).text().trim();
          const contentRaw = $(a).attr("data-content");

          if (contentRaw && nonce) {
            const p = (async () => {
              try {
                const decoded = JSON.parse(Buffer.from(contentRaw, "base64").toString("utf-8"));
                const streamRes = await client.post(
                  `${BASE_URL}/wp-admin/admin-ajax.php`,
                  new URLSearchParams({
                    ...decoded,
                    nonce,
                    action: streamAction,
                  }).toString(),
                  { headers: ajaxHeaders }
                );

                const rawHtml = Buffer.from(streamRes.data?.data || "", "base64").toString("utf-8");
                const match = rawHtml.match(/src=["']([^"']+)["']/);
                return {
                  quality,
                  server: serverName,
                  iframe: match ? match[1] : null,
                };
              } catch (e) {
                return { quality, server: serverName, iframe: null };
              }
            })();
            mirrorPromises.push(p);
          } else {
            mirrors[quality].push({ server: serverName, iframe: null });
          }
        });
    });

    if (mirrorPromises.length > 0) {
      const resolvedMirrors = await Promise.all(mirrorPromises);
      for (const m of resolvedMirrors) {
        mirrors[m.quality].push({ server: m.server, iframe: m.iframe });
      }
    }

    const downloads = {};
    $(".download ul li").each((_, li) => {
      const strong = $(li).find("strong").text().trim();
      const size = $(li).find("i").text().trim();
      const links = [];

      $(li)
        .find("a")
        .each((_, a) => {
          links.push({
            server: $(a).text().trim(),
            url: $(a).attr("href"),
          });
        });

      if (strong) {
        downloads[strong] = { size, links };
      }
    });

    return formatResponse(true, {
      title: pageTitle,
      default_iframe: $(".responsive-embed-stream iframe").attr("src") || null,
      previous_episode,
      next_episode,
      anime_info,
      mirrors,
      downloads,
    });
  } catch (err) {
    return formatResponse(false, err.message);
  }
}

// 8. Batch Download Links
async function getBatchDetail(endpoint) {
  try {
    const cleanEndpoint = endpoint.trim().replace(/^\/|\/$/g, "");
    const url = cleanEndpoint.startsWith("http")
      ? cleanEndpoint
      : `${BASE_URL}/batch/${cleanEndpoint}/`;

    const res = await client.get(url);
    const $ = cheerio.load(res.data);
    const title = $("h1").text().trim() || $(".batchlink h4").text().trim();

    const downloads = {};
    $(".batchlink ul li").each((_, li) => {
      const format = $(li).find("strong").text().trim();
      const links = [];
      $(li).find("a").each((_, a) => {
        links.push({
          server: $(a).text().trim(),
          url: $(a).attr("href"),
        });
      });
      if (format) {
        downloads[format] = { links };
      }
    });

    return formatResponse(true, {
      title,
      downloads,
    });
  } catch (err) {
    return formatResponse(false, err.message);
  }
}

// 9. Genre List
async function getGenreList() {
  try {
    const { data } = await client.get(`${BASE_URL}/genre-list/`);
    const $ = cheerio.load(data);
    const genres = [];

    $(".genres li a").each((_, a) => {
      const name = $(a).text().trim();
      const url = $(a).attr("href");
      const endpoint = url ? url.replace(`${BASE_URL}/genres/`, "").replace(/\/$/, "") : "";
      if (name && url) {
        genres.push({ name, endpoint, url });
      }
    });

    return formatResponse(true, genres);
  } catch (err) {
    return formatResponse(false, err.message);
  }
}

// 10. Anime By Genre
async function getAnimeByGenre(genre, page = 1) {
  try {
    const cleanGenre = genre.trim().replace(/^\/genres\/|\/$/g, "");
    const url = page > 1 ? `${BASE_URL}/genres/${cleanGenre}/page/${page}/` : `${BASE_URL}/genres/${cleanGenre}/`;
    const { data } = await client.get(url);
    const $ = cheerio.load(data);
    const anime = [];

    $(".col-anime").each((_, el) => {
      const title = $(el).find(".col-anime-title a").text().trim();
      const url = $(el).find(".col-anime-title a").attr("href");
      const studio = $(el).find(".col-anime-studio").text().trim();
      const episodes = $(el).find(".col-anime-eps").text().trim();
      const score = $(el).find(".col-anime-rating").text().trim();
      const thumb = $(el).find("img").attr("src");
      const endpoint = url ? url.replace(`${BASE_URL}/anime/`, "").replace(/\/$/, "") : "";
      if (title && url) {
        anime.push({ title, endpoint, url, thumb, studio, episodes, score });
      }
    });

    return formatResponse(true, { genre: cleanGenre, page: Number(page), anime });
  } catch (err) {
    return formatResponse(false, err.message);
  }
}

// 11. Schedule / Jadwal Rilis
async function getSchedule() {
  try {
    const { data } = await client.get(`${BASE_URL}/jadwal-rilis/`);
    const $ = cheerio.load(data);
    const schedule = [];

    $(".kglist321").each((_, el) => {
      const day = $(el).find("h2").text().trim();
      const anime = [];
      $(el)
        .find("ul li a")
        .each((_, a) => {
          const title = $(a).text().trim();
          const url = $(a).attr("href");
          const endpoint = url ? url.replace(`${BASE_URL}/anime/`, "").replace(/\/$/, "") : "";
          if (title && url) {
            anime.push({ title, endpoint, url });
          }
        });
      if (day) {
        schedule.push({ day, anime });
      }
    });

    return formatResponse(true, schedule);
  } catch (err) {
    return formatResponse(false, err.message);
  }
}

export default {
  name: "OtakuDesu",
  description: "Scraper anime (home, ongoing, complete, search, detail anime, detail episode dengan stream & download, batch, schedule, genres)",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["action", "query", "page"],

  paramsSchema: {
    action: {
      type: "string",
      required: true,
      enum: ["home", "ongoing", "complete", "search", "anime_list", "anime_detail", "episode_detail", "batch_detail", "schedule", "genres", "by_genre"],
      description: "Aksi yang dijalankan",
      default: "home"
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian (search) atau endpoint slug anime/episode/batch/genre",
      example: "borot-sub-indo"
    },
    page: {
      type: "number",
      required: false,
      default: 1,
      description: "Halaman (untuk ongoing/complete/by_genre)"
    }
  },

  async run(req, res) {
    const { action = "home", query = "", page = 1 } = { ...req.query, ...req.body }
    const p = parseInt(page, 10) || 1

    try {
      switch (action) {
        case "home": {
          const r = await getHome()
          return res.json({ status: true, result: r.data })
        }
        case "ongoing": {
          const r = await getOngoingAnime(p)
          return res.json({ status: true, result: r.data })
        }
        case "complete": {
          const r = await getCompleteAnime(p)
          return res.json({ status: true, result: r.data })
        }
        case "search": {
          if (!query || !query.trim()) return res.status(400).json({ status: false, message: "Parameter 'query' wajib untuk action=search", code: "MISSING_QUERY" })
          const r = await searchAnime(query.trim())
          if (!r.status) return res.status(500).json({ status: false, message: r.message })
          return res.json({ status: true, result: { query: query.trim(), count: r.data.length, list: r.data } })
        }
        case "anime_list": {
          const r = await getAnimeList()
          return res.json({ status: true, result: { count: r.data.length, list: r.data } })
        }
        case "anime_detail": {
          if (!query) return res.status(400).json({ status: false, message: "Parameter 'query' (endpoint slug anime) wajib untuk action=anime_detail", code: "MISSING_QUERY" })
          const r = await getAnimeDetail(query)
          if (!r.status) return res.status(404).json({ status: false, message: r.message, code: "NOT_FOUND" })
          return res.json({ status: true, result: r.data })
        }
        case "episode_detail": {
          if (!query) return res.status(400).json({ status: false, message: "Parameter 'query' (endpoint slug episode) wajib untuk action=episode_detail", code: "MISSING_QUERY" })
          const r = await getEpisodeDetail(query)
          if (!r.status) return res.status(404).json({ status: false, message: r.message, code: "NOT_FOUND" })
          return res.json({ status: true, result: r.data })
        }
        case "batch_detail": {
          if (!query) return res.status(400).json({ status: false, message: "Parameter 'query' (endpoint slug batch) wajib untuk action=batch_detail", code: "MISSING_QUERY" })
          const r = await getBatchDetail(query)
          if (!r.status) return res.status(404).json({ status: false, message: r.message, code: "NOT_FOUND" })
          return res.json({ status: true, result: r.data })
        }
        case "schedule": {
          const r = await getSchedule()
          return res.json({ status: true, result: { count: r.data.length, schedule: r.data } })
        }
        case "genres": {
          const r = await getGenreList()
          return res.json({ status: true, result: { count: r.data.length, list: r.data } })
        }
        case "by_genre": {
          if (!query) return res.status(400).json({ status: false, message: "Parameter 'query' (genre) wajib untuk action=by_genre", code: "MISSING_QUERY" })
          const r = await getAnimeByGenre(query, p)
          return res.json({ status: true, result: r.data })
        }
        default:
          return res.status(400).json({ status: false, message: `Action tidak dikenali: '${action}'`, code: "INVALID_ACTION" })
      }
    } catch (err) {
      return res.status(500).json({ status: false, message: err.message, code: "OTAKUDESU_ERROR" })
    }
  }
}
