import { vtuberspace } from "./lib.js";

export default {
  name: "VTuberSpace News Search",
  description: "Cari berita berdasarkan kata kunci",
  category: "VTuberSpace",
  methods: ["GET", "POST"],
  params: ["q", "limit"],
  paramsSchema: {
    q: { type: "string", required: true, description: "Kata kunci pencarian" },
    limit: { type: "integer", required: false, default: 10, minimum: 1, maximum: 50, description: "Jumlah hasil" },
  },
  async run(req, res) {
    try {
      const { q, limit } = { ...req.query, ...req.body };
      if (!q) return res.status(400).json({ success: false, error: "Parameter 'q' wajib diisi" });
      const data = await vtuberspace.searchNews(q, limit);
      res.json(data);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  },
};