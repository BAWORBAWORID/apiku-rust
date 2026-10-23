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
  name: "TinyURL with Custom Alias",
  description: "Perpendek link URL menggunakan layanan TinyURL dengan custom alias",
  category: "Shortlink",
  methods: ["GET", "POST"],

  params: ["link", "alias"],

  paramsSchema: {
    link: {
      type: "string",
      required: true,
      description: "URL yang ingin diperpendek",
      example: "https://google.com"
    },
    alias: {
      type: "string",
      required: true,
      description: "Custom alias untuk tautan pendek (maks 30 karakter)",
      example: "mycustomalias123"
    }
  },

  async run(req, res) {
    const { link, alias } = { ...req.query, ...req.body };

    if (!link) {
      return res.status(400).json({
        status: false,
        message: "[!] masukan parameter link"
      });
    }

    if (!alias) {
      return res.status(400).json({
        status: false,
        message: "[!] masukan parameter alias"
      });
    }

    if (!isUrl(link)) {
      return res.status(400).json({
        status: false,
        message: "[!] masukan parameter url sahaja"
      });
    }

    const cleanAlias = String(alias).trim().slice(0, 30);

    try {
      const data = {
        url: link.trim(),
        alias: cleanAlias
      };

      const result = await TinyURL.shortenWithAlias(data);

      if (!result || result.trim().toLowerCase().startsWith('error')) {
        return res.status(400).json({
          status: false,
          message: `[!] Alias '${cleanAlias}' sudah digunakan atau tidak valid di layanan TinyURL`
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
