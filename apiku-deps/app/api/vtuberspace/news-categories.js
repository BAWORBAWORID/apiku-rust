import { vtuberspace } from "./lib.js";

export default {
  name: "VTuberSpace News Categories",
  description: "Daftar kategori berita beserta jumlah postingan",
  category: "VTuberSpace",
  methods: ["GET"],
  params: [],
  paramsSchema: {},
  async run(req, res) {
    try {
      const data = await vtuberspace.getNewsCategories();
      res.json(data);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  },
};