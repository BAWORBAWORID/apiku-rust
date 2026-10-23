import TinyURL from 'tinyurl';

/**
 * Validasi apakah input merupakan URL valid (http / https)
 */
function isUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export default {
  name: "TinyURL Shortener",
  description: "Perpendek link URL menggunakan layanan TinyURL",
  category: "Shortlink",
  methods: ["GET", "POST"],

  params: ["link"],

  paramsSchema: {
    link: {
      type: "string",
      required: true,
      description: "URL yang ingin diperpendek",
      example: "https://google.com"
    }
  },

  async run(req, res) {
    const { link } = { ...req.query, ...req.body };

    if (!link) {
      return res.status(400).json({
        status: false,
        message: "[!] masukan parameter link"
      });
    }

    if (!isUrl(link)) {
      return res.status(400).json({
        status: false,
        message: "[!] masukan parameter url sahaja"
      });
    }

    try {
      const result = await TinyURL.shorten(link);

      if (!result || result.trim().toLowerCase().startsWith('error')) {
        return res.status(400).json({
          status: false,
          message: "[!] gagal memperpendek link dari layanan TinyURL"
        });
      }

      return res.json({
        status: true,
        result: result.trim()
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err?.message || "Internal server error"
      });
    }
  }
};
