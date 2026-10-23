const BASE_URL = "https://vtuberspace.id";
const API_BASE_URL = `${BASE_URL}/api/v1`;

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  Referer: `${BASE_URL}/`,
};

function toAbsoluteUrl(path) {
  if (!path || typeof path !== "string") return null;
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("//")) return `https:${path}`;
  if (path.startsWith("/")) return `${BASE_URL}${path}`;
  return `${BASE_URL}/${path}`;
}

function cleanVtuber(item) {
  if (!item || typeof item !== "object") return null;
  return {
    id: item.id,
    name: item.name,
    original_name: item.original_name || null,
    slug: item.slug,
    bio: item.bio || null,
    avatar: toAbsoluteUrl(item.avatar),
    banner: toAbsoluteUrl(item.banner),
    oshi_color: item.oshi_color || null,
    oshi_mark: item.oshi_mark || null,
    tgl_debut: item.tgl_debut || null,
    date_debut: item.date_debut || null,
    gender: item.female ? "Female" : item.male ? "Male" : null,
    artist: item.artist || null,
    rigging: item.rigging || null,
    link_perkenalan: item.link_perkenalan || null,
    link_youtube: item.link_youtube || null,
    social_links: item.social_links || {},
    email: item.email || null,
    agency: item.agency
      ? {
          id: item.agency.id,
          name: item.agency.name,
          slug: item.agency.slug,
          description: item.agency.description || null,
          logo: toAbsoluteUrl(item.agency.logo),
          banner: toAbsoluteUrl(item.agency.banner),
          is_indie: Boolean(item.agency.is_indie),
        }
      : null,
    images: Array.isArray(item.images)
      ? item.images.map((img) => ({
          id: img.id,
          title: img.title || null,
          url: toAbsoluteUrl(img.url),
        }))
      : [],
  };
}

function cleanNews(item) {
  if (!item || typeof item !== "object") return null;
  return {
    id: item.id,
    title: item.title,
    slug: item.slug,
    excerpt: item.excerpt || null,
    content: item.content || null,
    thumbnail: toAbsoluteUrl(item.thumbnail),
    status: item.status || null,
    published_at: item.published_at || null,
    created_at: item.created_at || null,
    updated_at: item.updated_at || null,
    is_featured: Boolean(item.is_featured),
    view_count: item.view_count || 0,
    like_count: item.like_count || 0,
    reading_time: item.reading_time || null,
    author: item.author
      ? {
          id: item.author.id,
          name: item.author.display_name,
          slug: item.author.slug,
          avatar: toAbsoluteUrl(item.author.avatar),
        }
      : null,
    categories: Array.isArray(item.categories)
      ? item.categories.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          description: c.description || null,
        }))
      : [],
    tags: Array.isArray(item.tags)
      ? item.tags.map((t) => ({ id: t.id, name: t.name, slug: t.slug }))
      : [],
    related_vtubers: Array.isArray(item.related_vtubers)
      ? item.related_vtubers.map(cleanVtuber)
      : [],
    images: Array.isArray(item.images)
      ? item.images.map((img) => ({
          id: img.id,
          name: img.name,
          url: toAbsoluteUrl(img.url),
        }))
      : [],
  };
}

async function getHome() {
  const [vtubersRes, postsRes, catsRes, tagsRes] = await Promise.all([
    fetch(`${API_BASE_URL}/vtubers?page=1&page_size=1`, { headers: DEFAULT_HEADERS }),
    fetch(`${API_BASE_URL}/posts?page=1&page_size=100`, { headers: DEFAULT_HEADERS }),
    fetch(`${API_BASE_URL}/categories`, { headers: DEFAULT_HEADERS }),
    fetch(`${API_BASE_URL}/tags`, { headers: DEFAULT_HEADERS }),
  ]);

  const [vtubersJson, postsJson, catsJson, tagsJson] = await Promise.all([
    vtubersRes.json(),
    postsRes.json(),
    catsRes.json(),
    tagsRes.json(),
  ]);

  const rawPosts = postsJson?.data || [];
  const cleaned = rawPosts.map(cleanNews);

  const featured = cleaned.filter((p) => p.is_featured).slice(0, 5);
  const popular = [...cleaned].sort((a, b) => (b.view_count || 0) - (a.view_count || 0)).slice(0, 5);
  const latest = [...cleaned].slice(0, 10);

  const rawCats = catsJson?.data || [];
  const categoriesWithCount = rawCats.map((cat) => {
    const count = cleaned.filter((p) => p.categories.some((c) => c.slug === cat.slug)).length;
    return { ...cat, post_count: count };
  });

  return {
    success: true,
    stats: vtubersJson?.stats || { total: 0, male: 0, female: 0, indie: 0, affiliated: 0 },
    featured_news: featured,
    popular_news: popular,
    latest_news: latest,
    categories: categoriesWithCount,
    tags: tagsJson?.data || [],
  };
}

async function getNews(options = {}) {
  const page = options.page || 1;
  const pageSize = options.pageSize || 10;
  const sort = options.sort || "latest";

  const res = await fetch(`${API_BASE_URL}/posts?page=1&page_size=100`, {
    headers: DEFAULT_HEADERS,
  });

  if (!res.ok) throw new Error(`Failed to fetch news list (${res.status})`);

  const json = await res.json();
  let list = (json.data || []).map(cleanNews);

  if (options.category && options.category !== "all" && options.category !== "semua") {
    const targetCat = options.category.toLowerCase().trim();
    list = list.filter((p) =>
      p.categories.some((c) => c.slug.toLowerCase() === targetCat || c.name.toLowerCase() === targetCat)
    );
  }

  if (options.tag) {
    const targetTag = options.tag.toLowerCase().trim();
    list = list.filter((p) => p.tags.some((t) => t.slug.toLowerCase() === targetTag || t.name.toLowerCase() === targetTag));
  }

  if (options.featuredOnly) {
    list = list.filter((p) => p.is_featured);
  }

  if (options.search) {
    const q = options.search.toLowerCase().trim();
    list = list.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.excerpt && p.excerpt.toLowerCase().includes(q)) ||
        p.tags.some((t) => t.name.toLowerCase().includes(q))
    );
  }

  if (sort === "popular") {
    list.sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
  } else if (sort === "oldest") {
    list.sort((a, b) => new Date(a.published_at || 0).getTime() - new Date(b.published_at || 0).getTime());
  } else {
    list.sort((a, b) => new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime());
  }

  const total = list.length;
  const totalPages = Math.ceil(total / pageSize) || 1;
  const startIndex = (page - 1) * pageSize;
  const paginatedData = list.slice(startIndex, startIndex + pageSize);

  return {
    success: true,
    filter: {
      category: options.category || "all",
      tag: options.tag || null,
      sort,
      search: options.search || null,
    },
    meta: {
      page: Number(page),
      page_size: Number(pageSize),
      total,
      total_page: totalPages,
    },
    data: paginatedData,
  };
}

async function getPopularNews(limit = 5) {
  return await getNews({ sort: "popular", pageSize: limit });
}

async function getLatestNews(limit = 10) {
  return await getNews({ sort: "latest", pageSize: limit });
}

async function searchNews(query, limit = 10) {
  if (!query || typeof query !== "string") throw new Error("Search query is required");
  return await getNews({ search: query, pageSize: limit });
}

async function getNewsDetail(idOrSlug) {
  if (!idOrSlug) throw new Error("News ID or slug is required");

  if (/^\d+$/.test(String(idOrSlug).trim())) {
    const res = await fetch(`${API_BASE_URL}/posts/${idOrSlug}`, { headers: DEFAULT_HEADERS });
    if (!res.ok) throw new Error(`News article with ID ${idOrSlug} not found (${res.status})`);
    const json = await res.json();
    return { success: true, data: cleanNews(json.data) };
  }

  const targetSlug = String(idOrSlug).trim().toLowerCase();
  const listRes = await fetch(`${API_BASE_URL}/posts?page=1&page_size=100`, { headers: DEFAULT_HEADERS });

  if (listRes.ok) {
    const listJson = await listRes.json();
    const found = (listJson.data || []).find((p) => p.slug === targetSlug);
    if (found) {
      const detailRes = await fetch(`${API_BASE_URL}/posts/${found.id}`, { headers: DEFAULT_HEADERS });
      if (detailRes.ok) {
        const detailJson = await detailRes.json();
        return { success: true, data: cleanNews(detailJson.data) };
      }
      return { success: true, data: cleanNews(found) };
    }
  }

  const htmlRes = await fetch(`${BASE_URL}/blog/${encodeURIComponent(targetSlug)}`, { headers: DEFAULT_HEADERS });
  if (!htmlRes.ok) throw new Error(`News article with slug '${targetSlug}' not found`);

  const html = await htmlRes.text();
  const ldMatch = html.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gis);
  if (ldMatch) {
    for (const tag of ldMatch) {
      const content = tag.replace(/<\/?script[^>]*>/gi, "");
      if (content.includes('"@type":"BlogPosting"')) {
        try {
          const ld = JSON.parse(content);
          return {
            success: true,
            data: {
              id: null,
              title: ld.headline,
              slug: targetSlug,
              excerpt: ld.description || null,
              content: null,
              thumbnail: toAbsoluteUrl(ld.image),
              status: "published",
              published_at: ld.datePublished || null,
              created_at: ld.datePublished || null,
              updated_at: ld.dateModified || null,
              is_featured: false,
              view_count: 0,
              like_count: 0,
              reading_time: null,
              author: ld.author ? { id: null, name: ld.author.name, slug: null, avatar: null } : null,
              categories: ld.articleSection
                ? [{ id: null, name: ld.articleSection, slug: ld.articleSection.toLowerCase(), description: null }]
                : [],
              tags: ld.keywords
                ? ld.keywords.split(",").map((t, idx) => ({ id: idx, name: t.trim(), slug: t.trim().toLowerCase() }))
                : [],
              related_vtubers: [],
              images: [],
            },
          };
        } catch {}
      }
    }
  }

  throw new Error(`Unable to resolve news article details for '${targetSlug}'`);
}

async function getNewsCategories() {
  const [catsRes, postsRes] = await Promise.all([
    fetch(`${API_BASE_URL}/categories`, { headers: DEFAULT_HEADERS }),
    fetch(`${API_BASE_URL}/posts?page=1&page_size=100`, { headers: DEFAULT_HEADERS }),
  ]);

  if (!catsRes.ok) throw new Error(`Failed to fetch categories (${catsRes.status})`);

  const catsJson = await catsRes.json();
  const postsJson = await postsRes.json();
  const allPosts = postsJson?.data || [];

  const rawCats = catsJson?.data || [];
  const categories = rawCats.map((cat) => {
    const count = allPosts.filter((p) => (p.categories || []).some((c) => c.slug === cat.slug)).length;
    return { id: cat.id, name: cat.name, slug: cat.slug, description: cat.description || null, post_count: count };
  });

  return { success: true, total_categories: categories.length, data: categories };
}

async function getNewsTags() {
  const res = await fetch(`${API_BASE_URL}/tags`, { headers: DEFAULT_HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch tags (${res.status})`);
  const json = await res.json();
  return { success: true, data: json.data || [] };
}

async function getVtubers(options = {}) {
  const page = options.page || 1;
  const pageSize = options.pageSize || 20;

  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });

  if (options.gender) params.set("gender", options.gender);
  if (options.agencyType) params.set("agency_type", options.agencyType);

  const res = await fetch(`${API_BASE_URL}/vtubers?${params.toString()}`, { headers: DEFAULT_HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch VTubers list (${res.status})`);

  const json = await res.json();
  const rawList = Array.isArray(json.data) ? json.data : [];

  return {
    success: true,
    data: rawList.map(cleanVtuber),
    meta: json.meta || { page, page_size: pageSize, total: rawList.length, total_page: 1 },
    stats: json.stats || null,
  };
}

async function searchVtuber(query, limit = 10) {
  if (!query || typeof query !== "string") throw new Error("Search query is required");

  const normalizedQuery = query.trim().replace(/-/g, " ");
  const params = new URLSearchParams({ q: normalizedQuery, limit: String(limit) });

  const res = await fetch(`${API_BASE_URL}/vtubers/search?${params.toString()}`, { headers: DEFAULT_HEADERS });
  if (!res.ok) throw new Error(`Failed to search VTuber (${res.status})`);

  const json = await res.json();
  const rawList = Array.isArray(json.data) ? json.data : [];

  return { success: true, query, total: rawList.length, data: rawList.map(cleanVtuber) };
}

async function getVtuberDetail(idOrSlug) {
  if (!idOrSlug) throw new Error("VTuber ID or slug is required");

  if (/^\d+$/.test(String(idOrSlug).trim())) {
    const res = await fetch(`${API_BASE_URL}/vtubers/${idOrSlug}`, { headers: DEFAULT_HEADERS });
    if (!res.ok) throw new Error(`VTuber with ID ${idOrSlug} not found (${res.status})`);
    const json = await res.json();
    return { success: true, data: cleanVtuber(json.data) };
  }

  const targetSlug = String(idOrSlug).trim().toLowerCase();
  const searchRes = await searchVtuber(targetSlug, 10);
  const found = searchRes.data.find(
    (v) => v.slug === targetSlug || v.name.toLowerCase() === targetSlug.replace(/-/g, " ")
  );

  if (found) {
    const detailRes = await fetch(`${API_BASE_URL}/vtubers/${found.id}`, { headers: DEFAULT_HEADERS });
    if (detailRes.ok) {
      const json = await detailRes.json();
      return { success: true, data: cleanVtuber(json.data) };
    }
    return { success: true, data: found };
  }

  const htmlRes = await fetch(`${BASE_URL}/vtuber/${encodeURIComponent(targetSlug)}`, { headers: DEFAULT_HEADERS });
  if (!htmlRes.ok) throw new Error(`VTuber with slug '${targetSlug}' not found`);

  const html = await htmlRes.text();
  const ldMatch = html.match(/<script\b[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gis);
  if (ldMatch) {
    for (const tag of ldMatch) {
      const content = tag.replace(/<\/?script[^>]*>/gi, "");
      if (content.includes('"@type":"Person"') || content.includes("jobTitle")) {
        try {
          const ld = JSON.parse(content);
          return {
            success: true,
            data: {
              id: null,
              name: ld.name,
              original_name: null,
              slug: targetSlug,
              bio: ld.description || null,
              avatar: toAbsoluteUrl(ld.image),
              banner: null,
              oshi_color: null,
              oshi_mark: null,
              tgl_debut: null,
              date_debut: null,
              gender: null,
              artist: null,
              rigging: null,
              link_perkenalan: null,
              link_youtube: null,
              social_links: {},
              email: null,
              agency: ld.memberOf
                ? {
                    id: null,
                    name: ld.memberOf.name,
                    slug: null,
                    description: null,
                    logo: null,
                    banner: null,
                    is_indie: false,
                  }
                : null,
              images: [],
            },
          };
        } catch {}
      }
    }
  }

  throw new Error(`Unable to resolve VTuber details for '${targetSlug}'`);
}

async function getDebuts(year, month, options = {}) {
  if (!year || !month) throw new Error("Year and month are required (e.g., year=2024, month=1)");

  const y = String(year);
  const m = String(month).padStart(2, "0");
  const dateStr = `${y}-${m}-01`;

  const page = options.page || 1;
  const pageSize = options.pageSize || 100;

  const params = new URLSearchParams({ date_debut: dateStr, page: String(page), page_size: String(pageSize) });

  if (options.gender) params.set("gender", options.gender);
  if (options.agencyType) params.set("agency_type", options.agencyType);

  const res = await fetch(`${API_BASE_URL}/vtubers?${params.toString()}`, { headers: DEFAULT_HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch debut roster (${res.status})`);

  const json = await res.json();
  const rawList = Array.isArray(json.data) ? json.data : [];
  const cleanedList = rawList.map(cleanVtuber);

  cleanedList.sort((a, b) => {
    const timeA = a.date_debut ? new Date(a.date_debut).getTime() : 0;
    const timeB = b.date_debut ? new Date(b.date_debut).getTime() : 0;
    return timeA - timeB;
  });

  return {
    success: true,
    year: Number(year),
    month: Number(month),
    date_query: dateStr,
    total: json.meta?.total || cleanedList.length,
    stats: json.stats || null,
    meta: json.meta || null,
    data: cleanedList,
  };
}

async function getAgencies(options = {}) {
  const page = options.page || 1;
  const pageSize = options.pageSize || 100;

  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });

  const res = await fetch(`${API_BASE_URL}/agencies?${params.toString()}`, { headers: DEFAULT_HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch agencies list (${res.status})`);

  const json = await res.json();
  const rawList = Array.isArray(json.data) ? json.data : [];

  const cleaned = rawList.map((a) => ({
    id: a.id,
    name: a.name,
    slug: a.slug,
    description: a.description || null,
    logo: toAbsoluteUrl(a.logo),
    banner: toAbsoluteUrl(a.banner),
    is_indie: Boolean(a.is_indie),
  }));

  return { success: true, data: cleaned, meta: json.meta || { page, page_size: pageSize, total: cleaned.length, total_page: 1 } };
}

async function resolveYoutubeAvatar(channelUrl) {
  if (!channelUrl || typeof channelUrl !== "string") throw new Error("YouTube channel URL is required");

  const params = new URLSearchParams({ url: channelUrl });
  const res = await fetch(`${BASE_URL}/api/youtube-avatar?${params.toString()}`, { headers: DEFAULT_HEADERS });
  if (!res.ok) throw new Error(`Failed to resolve YouTube avatar (${res.status})`);

  const json = await res.json();
  return { success: true, channel_url: channelUrl, avatar: json.avatar || null };
}

export const vtuberspace = {
  getHome,
  getNews,
  getPopularNews,
  getLatestNews,
  searchNews,
  getNewsDetail,
  getNewsCategories,
  getNewsTags,
  getVtubers,
  searchVtuber,
  getVtuberDetail,
  getDebuts,
  getAgencies,
  resolveYoutubeAvatar,
};

export default vtuberspace;