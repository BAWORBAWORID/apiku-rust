import axios from "axios";
import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const client = axios.create({
  baseURL: "https://mcpelife.com",
  headers: { "User-Agent": UA },
  timeout: 30000,
});

async function fetchPage(url) {
  try {
    const { data } = await client.get(url);
    return data;
  } catch (error) {
    throw new Error(`Gagal fetch: ${error.message}`);
  }
}

function extractInfo($) {
  const title = $("title").text().trim() || "Tidak ditemukan";
  const metaDesc = $('meta[name="description"]').attr("content") || "";
  const schema = $("script[type='application/ld+json']").first().text() || "";
  const logo = $("a.logo").attr("href") || "";
  
  const menuItems = $("nav.mainmenu a")
    .map((i, e) => $(e).attr("href"))
    .get()
    .slice(0, 10);

  const boxCount = $(".box").length;
  const firstBoxText = $(".box:first").text().trim().slice(0, 200) || "Kosong";

  return {
    title,
    meta_description: metaDesc.slice(0, 200),
    schema_json_ld: schema ? JSON.parse(schema) : null,
    logo: logo || "https://mcpelife.com/",
    menu: menuItems.filter(Boolean),
    box_count: boxCount,
    first_box_preview: firstBoxText,
  };
}

export default {
  name: "MCPelife Scraper",
  description: "Scraper info halaman MCPelife (Minecraft Bedrock resource site)",
  category: "Downloader",
  methods: ["GET", "POST"],

  params: ["url", "action"],

  paramsSchema: {
    url: {
      type: "string",
      required: false,
      description: "URL halaman spesifik di mcpelife.com (default: halaman utama)",
      example: "https://mcpelife.com/mods/some-mod",
    },
    action: {
      type: "string",
      required: false,
      enum: ["info", "menu", "schema", "boxes", "all"],
      default: "all",
      description: "Jenis data yang diambil",
      example: "info",
    },
  },

  async run(req, res) {
    try {
      const { url, action } = { ...req.query, ...req.body };
      const targetUrl = url || "https://mcpelife.com/";

      if (!targetUrl.startsWith("https://mcpelife.com/")) {
        return res.status(400).json({
          status: false,
          message: "URL harus dari domain mcpelife.com",
        });
      }

      const html = await fetchPage(targetUrl);
      if (!html) {
        return res.status(500).json({
          status: false,
          message: "Gagal mengambil halaman",
        });
      }

      const $ = cheerio.load(html);
      const data = extractInfo($);

      let result;
      switch (action) {
        case "info":
          result = { title: data.title, meta_description: data.meta_description, logo: data.logo };
          break;
        case "menu":
          result = { menu: data.menu };
          break;
        case "schema":
          result = { schema: data.schema_json_ld };
          break;
        case "boxes":
          result = { box_count: data.box_count, first_box_preview: data.first_box_preview };
          break;
        case "all":
        default:
          result = data;
          break;
      }

      return res.json({
        status: true,
        result,
        source_url: targetUrl,
      });
    } catch (e) {
      return res.status(500).json({
        status: false,
        message: e.message || "Gagal scraping mcpelife",
      });
    }
  }
};