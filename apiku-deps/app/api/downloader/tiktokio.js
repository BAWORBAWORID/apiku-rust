import * as cheerio from "cheerio";

class TikTokIO {
  constructor() {
    this.baseUrl = "https://tiktokio.com";
  }

  async download({ url, link, target, ...rest }) {
    let targetUrl = String(url || link || target || "").trim();
    if (!targetUrl) {
      throw {
        status: 400,
        message: "Parameter 'url', 'link', atau 'target' wajib diisi.",
      };
    }
    if (!targetUrl.includes("tiktok.com") && !targetUrl.includes("tt.site") && !targetUrl.includes("douyin.com")) {
      throw {
        status: 400,
        message: "URL yang dimasukkan bukan URL TikTok yang valid.",
      };
    }

    if (targetUrl.includes("tt.site") || targetUrl.includes("vt.tiktok.com") || targetUrl.includes("vm.tiktok.com")) {
      try {
        const head = await fetch(targetUrl, { method: "HEAD", redirect: "follow" });
        if (head.url) targetUrl = head.url;
      } catch {}
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/tk/html`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
          Referer: `${this.baseUrl}/id/`,
        },
        body: JSON.stringify({
          prefix: "tiktokio.com",
          vid: targetUrl,
        }),
      });

      if (!response.ok) {
        throw new Error(`Gagal menghubungi TikTokIO: HTTP ${response.status}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      const thumbnail = $("img", ".video-info").attr("src") || null;
      const title = $("h3", ".video-info").text().trim() || "";

      const medias = $("a.download-btn")
        .map((_, el) => {
          const $el = $(el);
          const linkUrl = $el.attr("href") || "";
          const text = $el.text().trim();
          const cls = $el.attr("class") || "";
          let type = "video";
          let quality = "Normal";
          if (cls.includes("download-btn-purple")) {
            type = "audio";
          } else if (cls.includes("download-btn-green")) {
            quality = "HD";
          } else if (cls.includes("download-btn-gray")) {
            quality = "Watermark";
          }
          return { quality, type, text, url: linkUrl };
        })
        .get()
        .filter((v) => v.url && v.url.startsWith("http"));

      if (medias.length === 0) {
        throw new Error("Gagal mengambil media. Pastikan URL video publik.");
      }

      return {
        url: targetUrl,
        title,
        thumbnail,
        total_media: medias.length,
        medias,
      };
    } catch (err) {
      throw {
        status: err.status || 500,
        message: err.message || "Terjadi kesalahan saat memproses media dari TikTokIO.",
      };
    }
  }
}

const tiktokio = new TikTokIO();

export default {
  name: "TikTokIO Downloader",
  description: "Download video TikTok — video HD/Normal/Watermark + audio MP3",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL video TikTok (vt.tiktok.com, tiktok.com, dll)",
      default: "https://vt.tiktok.com/ZSbm6fY8P/",
      example: "https://vt.tiktok.com/ZSbm6fY8P/",
    },
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body };
    const targetUrl = params.url || params.link || params.target;
    const availableActions = { tiktokio_actions: ["download"] };

    if (!targetUrl) {
      return res.status(400).json({
        status: false,
        error: "Parameter 'url' atau 'action' wajib diisi.",
        available_actions: availableActions,
      });
    }

    try {
      const response = await tiktokio.download({ url: targetUrl, ...params });
      return res.json({ status: true, result: response });
    } catch (error) {
      return res.status(error.status || 500).json({
        status: false,
        error: error.message || "Terjadi kesalahan internal pada server.",
      });
    }
  },
};
