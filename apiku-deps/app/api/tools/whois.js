import axios from "axios";

export default {
  name: "WHOIS Lookup",
  description: "Cek informasi domain WHOIS / RDAP resmi (.id, .com, .net, dll)",
  category: "Tools",
  methods: ["GET", "POST"],
  params: ["domain"],
  paramsSchema: {
    domain: {
      type: "string",
      required: true,
      description: "Nama domain yang ingin dicek",
      example: "zyvor.my.id"
    }
  },

  async run(req, res) {
    const startTime = Date.now();
    const { domain: rawDomain, q } = { ...req.query, ...req.body };
    const domain = (rawDomain || q || "").trim().toLowerCase();

    if (!domain) {
      return res.status(400).json({
        status: false,
        time: `${Date.now() - startTime}ms`,
        error: "Parameter 'domain' wajib diisi (contoh: zyvor.my.id)."
      });
    }

    const cleanDomain = domain
      .replace(/^https?:\/\//i, "")
      .split("/")[0];

    const rdapUrl = cleanDomain.endsWith(".id")
      ? `https://rdap.pandi.id/rdap/domain/${cleanDomain}`
      : `https://rdap.org/domain/${cleanDomain}`;

    try {
      const response = await axios.get(rdapUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "application/rdap+json, application/json"
        },
        timeout: 15000
      });

      return res.json({
        status: true,
        time: `${Date.now() - startTime}ms`,
        result: response.data,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      return res.status(502).json({
        status: false,
        time: `${Date.now() - startTime}ms`,
        error: `Koneksi ke RDAP server gagal: ${err.message}`
      });
    }
  }
};
