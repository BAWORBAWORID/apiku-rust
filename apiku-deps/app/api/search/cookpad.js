import axios from "axios";
import * as cheerio from "cheerio";

const client = axios.create({
  baseURL: "https://cookpad.com",
  timeout: 15000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "id-ID,id;q=0.9,en;q=0.8"
  }
});

async function search(query, page = 1) {
  const { data } = await client.get(`/id/cari/${encodeURIComponent(query)}`, {
    params: page > 1 ? { page } : undefined
  });
  const $ = cheerio.load(data);
  const results = [];

  $("#search-recipes-list > li[id^=\"recipe_\"]").each((_, el) => {
    const $el = $(el);
    const id = ($el.attr("id") || "").replace("recipe_", "");
    if (!id) return;

    const title = $el.find("a.block-link__main").first().text().trim().replace(/\s+/g, " ");
    if (!title) return;

    const author = $el.find("img[alt][title]").last().attr("alt")
      || $el.find("span.break-all span").last().text().trim()
      || null;

    const duration = $el.find(".mise-icon-time").parent().find(".mise-icon-text").first().text().trim() || null;
    const servings = $el.find(".mise-icon-user").parent().find(".mise-icon-text").first().text().trim() || null;

    const ingredientsPreview = [];
    const ingText = $el.find("[data-ingredients-redesign-target=\"ingredients\"] .line-clamp-2").text() || "";
    ingText.split("•").forEach(t => {
      const clean = t.trim();
      if (clean && clean.length > 1) ingredientsPreview.push(clean);
    });

    const image = $el.find("img[src*=\"cpcdn.com/recipes\"]").attr("src") || null;

    results.push({
      id,
      title,
      author,
      duration,
      servings,
      ingredientsPreview: ingredientsPreview.slice(0, 8),
      image,
      url: `https://cookpad.com/id/resep/${id}`
    });
  });

  return results;
}

async function detail(idOrUrl) {
  const id = String(idOrUrl).match(/(\d+)/)?.[1] || idOrUrl;
  const { data } = await client.get(`/id/resep/${id}`);
  const $ = cheerio.load(data);
  let recipe = null;
  $("script[type=\"application/ld+json\"]").each((_, el) => {
    try {
      const json = JSON.parse($(el).html());
      if (json["@type"] === "Recipe") recipe = json;
    } catch {}
  });
  if (!recipe) throw new Error("Recipe not found");
  return {
    id,
    title: recipe.name,
    description: recipe.description || "",
    image: Array.isArray(recipe.image) ? recipe.image[0] : recipe.image,
    author: recipe.author?.name || "",
    authorUrl: recipe.author?.url || "",
    yield: recipe.recipeYield || "",
    cuisine: recipe.recipeCuisine || "",
    datePublished: recipe.datePublished || "",
    ingredients: (recipe.recipeIngredient || []).map(i => i.trim()).filter(Boolean),
    steps: (recipe.recipeInstructions || []).map(s => {
      let images = [];
      if (Array.isArray(s.image)) images = s.image;
      else if (s.image) images = [s.image];
      return {
        text: s.text || s,
        images
      };
    }),
    url: `https://cookpad.com/id/resep/${id}`
  };
}

export default {
  name: "Cookpad",
  description: "Cari resep masakan Indonesia serta lihat detail lengkapnya (bahan, langkah, gambar).",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["action", "query", "id"],

  paramsSchema: {
    action: {
      type: "string",
      required: false,
      description: "Jenis operasi: 'search' untuk cari resep, 'detail' untuk lihat detail resep",
      example: "search",
      enum: ["search", "detail"],
      default: "search"
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian resep (wajib jika action=search)",
      example: "nasi goreng",
      minLength: 1,
      maxLength: 200
    },
    id: {
      type: "string",
      required: false,
      description: "ID atau URL resep Cookpad (wajib jika action=detail)",
      example: "26390975",
      minLength: 1,
      maxLength: 300
    },
    page: {
      type: "number",
      required: false,
      description: "Nomor halaman hasil pencarian (default 1)",
      example: 1,
      default: 1
    }
  },

  async run(req, res) {
    let { action, query, id, page } = { ...req.query, ...req.body };
    action = action || "search";
    page = parseInt(page) > 1 ? parseInt(page) : 1;

    try {
      if (action === "detail") {
        if (!id || typeof id !== "string" || !id.trim()) {
          return res.status(400).json({ status: false, message: "Parameter 'id' wajib diisi untuk action=detail" });
        }
        const recipe = await detail(id.trim());
        return res.json({ status: true, result: recipe });
      }

      if (action === "search") {
        if (!query || typeof query !== "string" || !query.trim()) {
          return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi untuk action=search" });
        }
        const results = await search(query.trim(), page);
        if (!results.length) {
          return res.status(404).json({ status: false, message: "Resep tidak ditemukan" });
        }
        return res.json({
          status: true,
          result: {
            query: query.trim(),
            page,
            total: results.length,
            recipes: results
          }
        });
      }

      return res.status(400).json({ status: false, message: "action harus 'search' atau 'detail'" });
    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || "Gagal mengakses Cookpad" });
    }
  }
};
