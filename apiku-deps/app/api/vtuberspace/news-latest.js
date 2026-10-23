import { vtuberspace } from "./lib.js";

export default {
  name: "VTuberSpace Latest News",
  description: "Berita terbaru",
  category: "VTuberSpace",
  methods: ["GET", "POST"],
  params: ["limit"],
  paramsSchema: { limit: { type: "integer", required: false, default: 10, minimum: 1, maximum: 100, description: "Jumlah berita" } },
  async run(req, res) {
    try {
      const { limit } = { ...req.query, ...req.body };
      const data = await vtuberspace.getLatestNews(limit);
      res.json(data);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  },
};