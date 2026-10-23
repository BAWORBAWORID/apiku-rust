import { vtuberspace } from "./lib.js";

export default {
  name: "VTuberSpace Home",
  description: "Beranda VTuberSpace — statistik, berita unggulan, populer, terbaru, kategori, tag",
  category: "VTuberSpace",
  methods: ["GET"],
  params: [],
  paramsSchema: {},
  async run(req, res) {
    try {
      const data = await vtuberspace.getHome();
      res.json(data);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  },
};