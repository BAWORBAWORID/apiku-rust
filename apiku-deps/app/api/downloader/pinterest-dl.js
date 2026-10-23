export default {
  name: "Pinterest Downloader",
  description: "Download video dari Pinterest via URL. Scraper HTML langsung, extract semua resolusi MP4.",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL Pinterest (pin.it/... atau pinterest.com/pin/...)",
      default: "https://id.pinterest.com/pin/617837642704161325/",
      example: "https://id.pinterest.com/pin/617837642704161325/"
    }
  },

  async run(req, res) {
    const url = req.query?.url || req.body?.url;

    if (!url) {
      return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi." });
    }

    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
        }
      });

      const html = await response.text();
      const mp4Links = html.match(/https:\/\/[^\"]+\.mp4/g);

      if (!mp4Links || mp4Links.length === 0) {
        return res.status(404).json({ status: false, message: "Tidak ditemukan video MP4 di URL tersebut." });
      }

      const uniqueLinks = [...new Set(mp4Links)];
      const bestLink = uniqueLinks.find(link => link.includes("720p")) || uniqueLinks[uniqueLinks.length - 1];

      const resolutions = uniqueLinks.map(link => {
        if (link.includes("/720p/")) return { quality: "720p (HD)", url: link };
        if (link.includes("_t1.mp4")) return { quality: "HEVC t1 (Very Low)", url: link };
        if (link.includes("_t2.mp4")) return { quality: "HEVC t2 (Low)", url: link };
        if (link.includes("_t3.mp4")) return { quality: "HEVC t3 (Medium)", url: link };
        if (link.includes("_t4.mp4")) return { quality: "HEVC t4 (High)", url: link };
        if (link.includes("_t5.mp4")) return { quality: "HEVC t5 (Highest)", url: link };
        return { quality: "Unknown", url: link };
      });

      return res.json({
        status: true,
        result: {
          url,
          download_url: bestLink,
          total_resolutions: resolutions.length,
          resolutions
        }
      });
    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || "Gagal mengambil data." });
    }
  }
};
