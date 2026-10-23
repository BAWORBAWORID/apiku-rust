import { vtuberspace } from "./lib.js";

export default {
  name: "VTuberSpace Popular News",
  description: "Berita paling populer (terbanyak view)",
  category: "VTuberSpace",
  methods: ["GET", "POST"],
  params: ["limit"],
  paramsSchema: { limit: { type: "integer", required: false, default: 5, minimum: 1, maximum: 50, description: "Jumlah berita" } },
  async run(req, res) {
    try {
      const { limit } = { ...req.query, ...req.body };
      const data = await vtuberspace.getPopularNews(limit);
      res.json(data);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  },
};