/**
 * Samehadaku Scraper API
 * Provider: Samehadaku (https://samehadaku.li)
 * Fitur   : Scrape catalog anime, episode terbaru, pencarian, detail anime & daftar episode,
 *           streaming player embed, download multi-server, list genre & filter genre, list season & filter season
 */

import logger from "../../src/utils/logger.js";

const BASE = "https://samehadaku.li";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

let jar = "";

function mergeCookies(headers) {
  if (!headers) return;
  const arr = Array.isArray(headers) ? headers : [headers];
  for (const c of arr) {
    const kv = c.split(";")[0].trim();
    if (!kv || !kv.includes("=")) continue;
    const name = kv.split("=")[0];
    const parts = jar ? jar.split("; ").filter(Boolean) : [];
    const next = parts.filter((p) => !p.startsWith(name + "="));
    next.push(kv);
    jar = next.join("; ");
  }
}

async function fetchText(url, opts = {}) {
  const maxRetries = 2;
  let last;
  for (let a = 0; a <= maxRetries; a++) {
    try {
      return await _once(url, opts);
    } catch (e) {
      last = e;
      const m = (e && e.message) || String(e);
      const t =
        m.includes("timeout") ||
        m.includes("Timeout") ||
        m.includes("fetch failed") ||
        e.code === "UND_ERR_CONNECT_TIMEOUT";
      if (t && a < maxRetries) {
        await new Promise((r) => setTimeout(r, 1200 * (a + 1)));
        continue;
      }
      throw e;
    }
  }
  throw last;
}

async function _once(url, opts = {}) {
  let cur = url;
  let method = opts.method || "GET";
  let body = opts.body;
  let extra = opts.headers || {};
  for (let hop = 0; hop < 8; hop++) {
    const headers = {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
      Referer: BASE + "/",
      ...extra,
    };
    if (jar) headers["Cookie"] = jar;
    const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(15000) : undefined;
    const res = await fetch(cur, { method, headers, body, redirect: "manual", signal });
    let sc;
    if (typeof res.headers.getSetCookie === "function") sc = res.headers.getSetCookie();
    else {
      const v = res.headers.get("set-cookie");
      sc = v ? [v] : [];
    }
    mergeCookies(sc);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      try {
        await res.text();
      } catch {}
      if (!loc) return { text: "", status: res.status, headers: res.headers, res };
      cur = new URL(loc, cur).href.split("#")[0] || new URL(loc, cur).href;
      if (res.status === 303 || method !== "GET") {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    const text = await res.text();
    return { text, status: res.status, headers: res.headers, res };
  }
  throw new Error("Too many redirects");
}

function absUrl(href) {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return BASE + href;
  if (href.startsWith("//")) return "https:" + href;
  return BASE + "/" + href;
}

function decodeEntities(s) {
  return (s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&apos;/g, "'")
    .replace(/&#8203;/g, "")
    .replace(/&#8211;/g, "-")
    .replace(/&#8212;/g, "-")
    .replace(/&#039;/g, "'");
}

function stripTags(s) {
  return (s || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSlug(s) {
  if (!s) return "";
  s = s.trim();
  if (s.startsWith("http")) {
    try {
      s = new URL(s).pathname;
    } catch {}
  }
  s = s.replace(/^\//, "").replace(/\/$/, "");
  return s;
}

function slugToUrl(slug) {
  slug = normalizeSlug(slug);
  if (!slug) return BASE + "/";
  if (slug.startsWith("http")) return slug;
  return BASE + "/" + slug + "/";
}

function extractImg(block) {
  let m = block.match(/data-src="([^"]+)"/);
  if (m) return m[1];
  m = block.match(/src="([^"]+)"/);
  if (m) {
    const v = m[1];
    if (v.startsWith("data:image")) {
      const m2 = block.match(/data-src="([^"]+)"/);
      if (m2) return m2[1];
    }
    return v;
  }
  return "";
}

function buildPagedUrl(base, page) {
  const p = parseInt(page, 10);
  if (!p || p <= 1) return base.endsWith("/") ? base : base + "/";
  const b = base.endsWith("/") ? base : base + "/";
  return b + "page/" + p + "/";
}

function parseLatest(html, url) {
  const items = [];
  const re = /<article class="bs"[\s\S]*?<\/article>/g;
  let m;
  while ((m = re.exec(html))) {
    const b = m[0];
    const href =
      (b.match(/<a[^>]*href="([^"]+)"[^>]*itemprop="url"/) ||
        b.match(/<a[^>]*href="([^"]+)"[^>]*class="tip"/) ||
        b.match(/<a[^>]*href="([^"]+)"/) ||
        [])[1] || "";
    const title =
      (b.match(/<h2[^>]*itemprop="headline"[^>]*>([\s\S]*?)<\/h2>/) ||
        b.match(/title="([^"]+)"/) ||
        [])[1] || "";
    const epx = (b.match(/<span class="epx">([\s\S]*?)<\/span>/) || [])[1] || "";
    const typez = (b.match(/<div class="typez[^"]*">([\s\S]*?)<\/div>/) || [])[1] || "";
    const sb = (b.match(/<span class="sb[^"]*">([\s\S]*?)<\/span>/) || [])[1] || "";
    const imgBlock = (b.match(/<img[^>]*>/) || [])[0] || "";
    const img = extractImg(imgBlock);
    const h2alt = (b.match(/<div class="tt">[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1] || "";
    const t = decodeEntities(stripTags(title || h2alt));
    if (!href) continue;
    if (!t && !href.includes("samehadaku.li")) continue;
    items.push({
      title: t,
      href,
      url: absUrl(href),
      episode: decodeEntities(stripTags(epx)),
      type: decodeEntities(stripTags(typez)),
      sub: decodeEntities(stripTags(sb)),
      poster: absUrl(img),
    });
  }
  const next =
    (html.match(/<a[^>]*href="([^"]+)"[^>]*class="r"[^>]*>Next/) ||
      html.match(/<a[^>]*href="([^"]+page\/2\/)"[^>]*>/) ||
      [])[1] || "";
  return {
    source: url,
    type: "latest",
    count: items.length,
    items: items.slice(0, 80),
    next: next ? absUrl(next) : "",
  };
}

function parseAnime(html, url) {
  const title =
    (html.match(/<h1 class="entry-title"[^>]*>([\s\S]*?)<\/h1>/) ||
      html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) ||
      [])[1] ||
    (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] ||
    "";
  const cleanTitle = decodeEntities(stripTags(title));
  const alter = (html.match(/<span class="alter">([\s\S]*?)<\/span>/) || [])[1] || "";
  const posterBlock = (html.match(/<div class="thumb"[^>]*>[\s\S]*?<\/div>/) || [])[0] || "";
  const posterImg = extractImg(posterBlock);
  const poster = posterImg
    ? absUrl(posterImg)
    : (html.match(/<meta property="og:image"[^>]*content="([^"]+)"/) || [])[1] || "";
  const rating =
    (html.match(/<div class="rating">[\s\S]*?<strong>Rating ([^<]+)<\/strong>/) ||
      html.match(/<meta itemprop="ratingValue"[^>]*content="([^"]+)"/) ||
      [])[1] || "";
  const ratingCount =
    (html.match(/<meta itemprop="ratingCount"[^>]*content="([^"]+)"/) || [])[1] || "";
  const bookmark = (html.match(/<div class="bmc">([^<]+)<\/div>/) || [])[1] || "";
  const mindesc = (html.match(/<div class="mindesc">([\s\S]*?)<\/div>/) || [])[1] || "";
  const synopsis =
    (html.match(/<div class="entry-content"[^>]*itemprop="description"[^>]*>([\s\S]*?)<\/div>/) ||
      html.match(/<div class="desc[^"]*">([\s\S]*?)<\/div>/) ||
      [])[1] || "";
  const info = {};
  const speBlock =
    (html.match(/<div class="spe">([\s\S]*?)<\/div>\s*<div class="genxed">/) ||
      html.match(/<div class="spe">([\s\S]*?)<\/div>/) ||
      [])[1] || "";
  const reInfo = /<span><b>([^:]+):<\/b>\s*([\s\S]*?)<\/span>/g;
  let mm;
  while ((mm = reInfo.exec(speBlock))) {
    const key = mm[1].trim().toLowerCase().replace(/\s+/g, "_");
    const val = mm[2];
    const links = [];
    const reA = /<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
    let aa;
    while ((aa = reA.exec(val)))
      links.push({ name: decodeEntities(stripTags(aa[2])), href: aa[1], url: absUrl(aa[1]) });
    const text = decodeEntities(stripTags(val));
    if (links.length > 0) info[key] = { text, links };
    else info[key] = text;
  }
  const genres = [];
  const genxed = (html.match(/<div class="genxed">([\s\S]*?)<\/div>/) || [])[1] || "";
  const reG = /<a[^>]*href="([^"]+)"[^>]*rel="tag"[^>]*>([^<]+)<\/a>/g;
  while ((mm = reG.exec(genxed)))
    genres.push({ name: decodeEntities(stripTags(mm[2])), href: mm[1], url: absUrl(mm[1]) });
  const tags = [];
  const tagBlock = (html.match(/<div class="bottom tags">([\s\S]*?)<\/div>/) || [])[1] || "";
  const reT = /<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
  while ((mm = reT.exec(tagBlock)))
    tags.push({ name: decodeEntities(stripTags(mm[2])), href: mm[1], url: absUrl(mm[1]) });
  const chars = [];
  const cvRe =
    /<div class="cvitem">[\s\S]*?<span class="charname">([\s\S]*?)<\/span>[\s\S]*?<span class="charrole">([\s\S]*?)<\/span>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<span class="charrole">([\s\S]*?)<\/span>/g;
  while ((mm = cvRe.exec(html))) {
    chars.push({
      character: decodeEntities(stripTags(mm[1])),
      role: decodeEntities(stripTags(mm[2])),
      actor_href: mm[3],
      actor_url: absUrl(mm[3]),
      actor: decodeEntities(stripTags(mm[4])),
      actor_role: decodeEntities(stripTags(mm[5])),
    });
  }
  if (chars.length === 0) {
    const reC =
      /<div class="cvsubitem cvchar">[\s\S]*?<span class="charname">([^<]+)<\/span>[\s\S]*?<span class="charrole">([^<]+)<\/span>/g;
    while ((mm = reC.exec(html)))
      chars.push({
        character: decodeEntities(stripTags(mm[1])),
        role: decodeEntities(stripTags(mm[2])),
      });
  }
  const episodes = [];
  const listBlock =
    (html.match(/<div class="eplister">([\s\S]*?)<\/ul>/) ||
      html.match(/<ul>[\s\S]*?<li data-index="1">[\s\S]*?<\/ul>/) ||
      [])[0] || "";
  const src = listBlock || html;
  const reE =
    /<li[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?<div class="epl-num">([^<]+)<\/div>[\s\S]*?<div class="epl-title">([^<]+)<\/div>[\s\S]*?<div class="epl-sub">[\s\S]*?<span[^>]*>([^<]+)<\/span>[\s\S]*?<div class="epl-date">([^<]+)<\/div>/g;
  while ((mm = reE.exec(src))) {
    episodes.push({
      href: mm[1],
      url: absUrl(mm[1]),
      episode: decodeEntities(stripTags(mm[2])),
      title: decodeEntities(stripTags(mm[3])),
      sub: decodeEntities(stripTags(mm[4])),
      date: decodeEntities(stripTags(mm[5])),
    });
  }
  if (episodes.length === 0) {
    const reE2 = /<a[^>]*href="([^"]*episode[^"]*)"[^>]*>[\s\S]*?<div class="epl-num">([^<]+)<\/div>/g;
    while ((mm = reE2.exec(html)))
      episodes.push({
        href: mm[1],
        url: absUrl(mm[1]),
        episode: decodeEntities(stripTags(mm[2])),
      });
  }
  const banner =
    (html.match(/<div class="inepcx">[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>/) || [])[1] || "";
  const screenshotFallback =
    (html.match(/<meta property="og:image"[^>]*content="([^"]+)"/) || [])[1] || "";
  return {
    source: url,
    type: "anime",
    title: cleanTitle,
    alternative: decodeEntities(stripTags(alter)),
    poster: absUrl(poster),
    rating: decodeEntities(stripTags(rating)),
    rating_count: decodeEntities(stripTags(ratingCount)),
    followers: decodeEntities(stripTags(bookmark)),
    description: decodeEntities(stripTags(mindesc)),
    synopsis: decodeEntities(stripTags(synopsis)),
    info,
    genres,
    tags,
    characters: chars,
    episodes,
    episodes_count: episodes.length,
    latest_url: banner ? absUrl(banner) : "",
    screenshot: screenshotFallback ? absUrl(screenshotFallback) : "",
  };
}

function parseEpisode(html, url) {
  const title =
    (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] ||
    (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] ||
    "";
  const cleanTitle = decodeEntities(stripTags(title));
  const canonical = (html.match(/<link rel="canonical"[^>]*href="([^"]+)"/) || [])[1] || url;
  const thumb = (html.match(/<meta property="og:image"[^>]*content="([^"]+)"/) || [])[1] || "";

  let iframe = "";
  const iframeM =
    html.match(/<IFRAME[^>]*SRC="([^"]+)"[^>]*>/i) ||
    html.match(/<iframe[^>]*src="([^"]+)"[^>]*>/i) ||
    html.match(/data-litespeed-src="([^"]+)"/i);
  if (iframeM) iframe = iframeM[1];
  if (!iframe) {
    const m2 = html.match(/<div class="player-embed"[^>]*>[\s\S]*?SRC="([^"]+)"/i);
    if (m2) iframe = m2[1];
  }
  iframe = iframe ? decodeEntities(iframe).trim() : "";

  // Multi-server extraction
  const streams = [];
  const serverBtns = html.match(/<button[^>]*class="[^"]*aspd-server[^"]*"[^>]*>[\s\S]*?<\/button>/gi) || [];
  for (const b of serverBtns) {
    const sName = (b.match(/data-label="([^"]+)"/) || [])[1] || stripTags(b).trim();
    const sUrl = (b.match(/data-url="([^"]+)"/) || [])[1] || "";
    let sEmbed = (b.match(/data-embed="([^"]+)"/) || [])[1] || "";
    if (sEmbed) {
      try {
        const decoded = Buffer.from(sEmbed, "base64").toString("utf8");
        const sm = decoded.match(/src="([^"]+)"/i);
        if (sm) sEmbed = sm[1];
      } catch {}
    }
    const finalStreamUrl = sUrl || sEmbed;
    if (finalStreamUrl) {
      streams.push({
        server: decodeEntities(sName),
        url_stream: finalStreamUrl,
        embed_url: finalStreamUrl,
      });
    }
  }

  if (streams.length === 0 && iframe) {
    streams.push({ server: "Default", url_stream: iframe, embed_url: iframe });
  }

  const download = [];
  const tera =
    (html.match(/<a[^>]*href="(https:\/\/terabox\.com[^"]+)"[^>]*>/i) ||
      html.match(/<a[^>]*href="(https:\/\/www\.terabox[^"]+)"[^>]*>/i) ||
      [])[1] || "";
  if (tera) download.push({ label: "Terabox", href: tera, url: tera });

  const dlRe =
    /<a[^>]*href="([^"]+)"[^>]*>\s*<div class="icol"><i[^>]*><\/i>\s*<span>Download<\/span><\/div>\s*<\/a>/g;
  let mm;
  while ((mm = dlRe.exec(html))) download.push({ label: "Download", href: mm[1], url: absUrl(mm[1]) });

  // Download boxes (multi-resolution / single link)
  const dlBlocks = html.match(/<div class="soraddlx[^"]*"[\s\S]*?<\/div>\s*<\/div>/g) || [];
  for (const dlb of dlBlocks) {
    const resTitle = decodeEntities(stripTags((dlb.match(/<div class="sorattlx">([\s\S]*?)<\/div>/) || [])[1] || ""));
    const linkRe = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let lm;
    const links = [];
    while ((lm = linkRe.exec(dlb))) {
      links.push({
        host: decodeEntities(stripTags(lm[2])),
        url: lm[1],
      });
    }
    if (links.length > 0) {
      download.push({
        resolution: resTitle || "Direct Download",
        links,
      });
    }
  }

  const nav = {};
  const allM = html.match(/<div class="nvs nvsc"><a[^>]*href="([^"]+)"[^>]*>[\s\S]*?All Episodes/);
  if (allM && allM[1]) nav.all_episodes = absUrl(allM[1]);
  const nextM =
    html.match(/<a[^>]*aria-label="next"[^>]*href="([^"]+)"/) ||
    html.match(/<a[^>]*href="([^"]+)"[^>]*rel="next"/);
  if (nextM && nextM[1]) nav.next = absUrl(nextM[1]);
  const prevM = html.match(/<a[^>]*href="([^"]+)"[^>]*>\s*<span class="tex">\s*Prev/);
  if (prevM && prevM[1]) nav.prev = absUrl(prevM[1]);

  const animeInfo = {};
  const infoBlock = (html.match(/<h2[^>]*itemprop="partOfSeries"[^>]*>([\s\S]*?)<\/h2>/) || [])[1] || "";
  if (infoBlock) animeInfo.title = decodeEntities(stripTags(infoBlock));
  const ratingA =
    (html.match(/<div class="rating">[\s\S]*?<strong>Rating ([^<]+)<\/strong>/) || [])[1] || "";
  if (ratingA) animeInfo.rating = decodeEntities(stripTags(ratingA));
  const animeLink =
    (html.match(/<div class="nvs nvsc"><a[^>]*href="([^"]+)"[^>]*>[\s\S]*?All Episodes/) ||
      html.match(/<a[^>]*href="(https:\/\/samehadaku\.li\/anime\/[^"]+)"[^>]*>[\s\S]*?All Episodes/) ||
      [])[1] || "";
  if (animeLink) animeInfo.anime_url = absUrl(animeLink);

  const related = [];
  const relBlock =
    (html.match(/<div class="bixbox">[\s\S]*?<h3>Related Episodes<\/h3>[\s\S]*?<div class="listupd">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/) ||
      [])[1] || "";
  if (relBlock) {
    const reR = /<a[^>]*href="([^"]+)"[^>]*title="([^"]+)"[^>]*>/g;
    while ((mm = reR.exec(relBlock)))
      related.push({ title: decodeEntities(stripTags(mm[2])), href: mm[1], url: absUrl(mm[1]) });
  }

  const desc = (html.match(/<div class="bixbox infx">[\s\S]*?<p>([\s\S]*?)<\/p>/) || [])[1] || "";
  const streamUrl = (streams[0] && streams[0].url_stream) || iframe;

  return {
    source: canonical,
    type: "episode",
    title: cleanTitle,
    thumbnail: thumb ? absUrl(thumb) : "",
    stream_url: streamUrl,
    embed_url: streamUrl,
    video_embed: iframe,
    current_stream: streamUrl,
    streams,
    download,
    navigation: nav,
    anime: animeInfo,
    description: decodeEntities(stripTags(desc)),
    related,
  };
}

function parseSearch(html, url) {
  const items = [];
  const re = /<article class="bs"[\s\S]*?<\/article>/g;
  let m;
  while ((m = re.exec(html))) {
    const b = m[0];
    const href =
      (b.match(/<a[^>]*href="([^"]+)"[^>]*itemprop="url"/) ||
        b.match(/<a[^>]*href="([^"]+)"[^>]*class="tip"/) ||
        b.match(/<a[^>]*href="([^"]+)"/) ||
        [])[1] || "";
    const h2 =
      (b.match(/<h2[^>]*itemprop="headline"[^>]*>([\s\S]*?)<\/h2>/) ||
        b.match(/<div class="tt">[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/) ||
        b.match(/title="([^"]+)"/) ||
        [])[1] || "";
    const epx = (b.match(/<span class="epx">([^<]+)<\/span>/) || [])[1] || "";
    const typez = (b.match(/<div class="typez[^"]*">([^<]+)<\/div>/) || [])[1] || "";
    const sb = (b.match(/<span class="sb[^"]*">([^<]+)<\/span>/) || [])[1] || "";
    const imgBlock = (b.match(/<img[^>]*>/) || [])[0] || "";
    const img = extractImg(imgBlock);
    const title = decodeEntities(stripTags(h2));
    if (!href || !title) continue;
    items.push({
      title,
      href,
      url: absUrl(href),
      episode: decodeEntities(stripTags(epx)),
      type: decodeEntities(stripTags(typez)),
      sub: decodeEntities(stripTags(sb)),
      poster: absUrl(img),
    });
  }
  const q =
    (html.match(/<title>You searched for ([^<]+) - Samehadaku<\/title>/) ||
      html.match(/<meta property="og:title"[^>]*content="You searched for ([^"]+) -/) ||
      [])[1] || "";
  const canonical = (html.match(/<meta property="og:url"[^>]*content="([^"]+)"/) || [])[1] || url;
  return {
    source: canonical,
    type: "search",
    query: decodeEntities(stripTags(q)),
    count: items.length,
    items,
  };
}

// Scraper Methods
async function scrapeHome(page = 1) {
  const p = parseInt(page, 10) || 1;
  const url = buildPagedUrl(BASE + "/", p);
  const { text, status } = await fetchText(url);
  if (status === 403 || text.includes("403 Forbidden")) {
    throw new Error("Layanan Samehadaku sedang dibatasi WAF, silakan coba lagi beberapa saat.");
  }
  const data = parseLatest(text, url);
  data.type = "home";
  data.page = p;
  return data;
}

async function scrapeLatest(page = 1) {
  const p = parseInt(page, 10) || 1;
  const url = buildPagedUrl(BASE + "/", p);
  const { text, status } = await fetchText(url);
  if (status === 403 || text.includes("403 Forbidden")) {
    throw new Error("Layanan Samehadaku sedang dibatasi WAF, silakan coba lagi beberapa saat.");
  }
  const data = parseLatest(text, url);
  data.page = p;
  return data;
}

async function searchAnime(query) {
  const q = (query || "").trim();
  if (!q) throw new Error("Parameter 'query' wajib diisi untuk pencarian anime");
  const url = BASE + "/?s=" + encodeURIComponent(q);
  const { text, status } = await fetchText(url);
  if (status === 403 || text.includes("403 Forbidden")) {
    throw new Error("Layanan Samehadaku sedang dibatasi WAF, silakan coba lagi beberapa saat.");
  }
  return parseSearch(text, url);
}

async function scrapeAnime(rawUrl) {
  let url = (rawUrl || "").trim();
  if (!url.startsWith("http")) {
    url = slugToUrl(url.includes("/anime/") ? url : "anime/" + normalizeSlug(url));
  }
  const { text, status } = await fetchText(url);
  if (status === 403 || text.includes("403 Forbidden")) {
    throw new Error("Gagal mengambil detail anime (WAF 403), silakan coba lagi nanti.");
  }
  return parseAnime(text, url);
}

async function scrapeEpisode(rawUrl) {
  let url = (rawUrl || "").trim();
  if (!url.startsWith("http")) {
    url = normalizeSlug(url);
    if (!url.includes("episode")) url = url + "-episode-1-subtitle-indonesia";
    url = BASE + "/" + url + (url.endsWith("/") ? "" : "/");
  }
  const { text, status } = await fetchText(url);
  if (status === 403 || text.includes("403 Forbidden")) {
    throw new Error("Gagal mengambil episode anime (WAF 403), silakan coba lagi nanti.");
  }
  return parseEpisode(text, url);
}

async function listGenres() {
  const url = BASE + "/anime/";
  const { text, status } = await fetchText(url);
  if (status === 403 || text.includes("403 Forbidden")) {
    throw new Error("Gagal mengambil daftar genre (WAF 403)");
  }
  const items = [];
  const re = /<input[^>]*id="genre-([^"]+)"[^>]*value="([^"]+)"[^>]*>\s*<label[^>]*>([^<]+)<\/label>/g;
  let m;
  const seen = {};
  while ((m = re.exec(text))) {
    const slug = m[2].trim();
    const label = decodeEntities(stripTags(m[3]));
    if (seen[slug]) continue;
    seen[slug] = true;
    items.push({ name: label, slug, href: "/genres/" + slug + "/", url: BASE + "/genres/" + slug + "/" });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { source: url, type: "listgenre", count: items.length, items };
}

async function filterGenre(name, page = 1) {
  const slug = (name || "").trim().toLowerCase().replace(/\s+/g, "-");
  if (!slug) throw new Error("Parameter 'genre' wajib diisi");
  const base = BASE + "/genres/" + slug + "/";
  const p = parseInt(page, 10) || 1;
  const url = buildPagedUrl(base, p);
  const { text, status } = await fetchText(url);
  if (status === 403 || text.includes("403 Forbidden")) {
    throw new Error("Gagal mengambil anime by genre (WAF 403)");
  }
  const data = parseLatest(text, url);
  data.type = "genre";
  data.genre = slug;
  data.page = p;
  return data;
}

async function listSeasons() {
  const url = BASE + "/anime/";
  const { text, status } = await fetchText(url);
  if (status === 403 || text.includes("403 Forbidden")) {
    throw new Error("Gagal mengambil daftar season (WAF 403)");
  }
  const items = [];
  const re = /<input[^>]*id="season-([^"]+)"[^>]*value="([^"]+)"[^>]*>\s*<label[^>]*>([^<]+)<\/label>/g;
  let m;
  const seen = {};
  while ((m = re.exec(text))) {
    const slug = m[2].trim();
    const label = decodeEntities(stripTags(m[3]));
    if (seen[slug]) continue;
    seen[slug] = true;
    items.push({ name: label, slug, href: "/season/" + slug + "/", url: BASE + "/season/" + slug + "/" });
  }
  return { source: url, type: "listseason", count: items.length, items };
}

async function filterSeason(name, page = 1) {
  const slug = (name || "").trim().toLowerCase().replace(/\s+/g, "-");
  if (!slug) throw new Error("Parameter 'season' wajib diisi");
  const base = BASE + "/season/" + slug + "/";
  const p = parseInt(page, 10) || 1;
  const url = buildPagedUrl(base, p);
  const { text, status } = await fetchText(url);
  if (status === 403 || text.includes("403 Forbidden")) {
    throw new Error("Gagal mengambil anime by season (WAF 403)");
  }
  const data = parseLatest(text, url);
  data.type = "season";
  data.season = slug;
  data.page = p;
  return data;
}

export default {
  name: "Samehadaku",
  description:
    "Scraper Samehadaku — streaming & catalog anime subtitle Indonesia: home, search, detail anime, episode player embed & download multi-server, genre & season filter",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action", "query", "url", "page", "genre", "season"],
  paramsSchema: {
    action: {
      type: "string",
      required: false,
      default: "home",
      description: "Aksi: home, latest, search, detail, episode, stream, listgenre, genre, listseason, season",
      enum: ["home", "latest", "search", "detail", "episode", "stream", "listgenre", "genre", "listseason", "season"],
      example: "latest",
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian (action=search) atau slug/url anime (action=detail, episode)",
      example: "One Piece",
    },
    url: {
      type: "string",
      required: false,
      description: "URL anime atau episode Samehadaku (action=detail, episode, stream)",
      example: "https://samehadaku.li/anime/one-piece/",
    },
    page: {
      type: "number",
      required: false,
      default: 1,
      description: "Nomor halaman untuk pagination (action=home, latest, genre, season)",
      example: 1,
    },
    genre: {
      type: "string",
      required: false,
      description: "Slug genre (action=genre), contoh: action, comedy, romance",
      example: "action",
    },
    season: {
      type: "string",
      required: false,
      description: "Slug season (action=season), contoh: fall-2025, winter-2026",
      example: "fall-2025",
    },
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      let action = String(params.action || "").trim().toLowerCase();
      const q = String(params.query || params.q || params.url || "").trim();
      const page = parseInt(params.page || params.p || 1, 10) || 1;
      const genre = String(params.genre || "").trim();
      const season = String(params.season || "").trim();

      // Auto-detect action if not explicitly given
      if (!action) {
        if (genre) action = "genre";
        else if (season) action = "season";
        else if (params.url && (params.url.includes("-episode-") || params.url.includes("/episode/"))) action = "episode";
        else if (params.url && params.url.includes("/anime/")) action = "detail";
        else if (params.query || params.q) action = "search";
        else action = "home";
      }

      logger.info(`[SAMEHADAKU] Request action=${action} q=${q || "-"} page=${page}`);

      // 1. Home
      if (action === "home") {
        const data = await scrapeHome(page);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 2. Latest
      if (action === "latest" || action === "terbaru") {
        const data = await scrapeLatest(page);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 3. Search
      if (action === "search" || action === "cari") {
        if (!q) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'query' wajib diisi untuk action=search",
          });
        }
        const data = await searchAnime(q);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 4. Detail Anime
      if (action === "detail" || action === "anime") {
        if (!q) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'query' atau 'url' wajib diisi untuk action=detail",
          });
        }
        const data = await scrapeAnime(q);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 5. Episode Detail & Stream/Download
      if (action === "episode" || action === "ep" || action === "stream" || action === "play") {
        if (!q) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'url' atau 'query' episode wajib diisi untuk action=episode/stream",
          });
        }
        const data = await scrapeEpisode(q);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 6. List Genre
      if (action === "listgenre" || action === "genres") {
        const data = await listGenres();
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 7. Filter Genre
      if (action === "genre") {
        const gName = genre || q;
        if (!gName) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'genre' wajib diisi untuk action=genre",
          });
        }
        const data = await filterGenre(gName, page);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 8. List Season
      if (action === "listseason" || action === "seasons") {
        const data = await listSeasons();
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 9. Filter Season
      if (action === "season") {
        const sName = season || q;
        if (!sName) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'season' wajib diisi untuk action=season",
          });
        }
        const data = await filterSeason(sName, page);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      return res.status(400).json({
        status: false,
        message: `Action '${action}' tidak valid. Pilihan: home, latest, search, detail, episode, stream, listgenre, genre, listseason, season`,
      });
    } catch (err) {
      logger.error(`[SAMEHADAKU] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses data Samehadaku",
      });
    }
  },
};
