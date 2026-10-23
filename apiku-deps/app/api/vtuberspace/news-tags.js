import { vtuberspace } from "./lib.js";

export default {
  name: "VTuberSpace News Tags",
  description: "Daftar tag berita",
  category: "VTuberSpace",
  methods: ["GET"],
  params: [],
  paramsSchema: {},
  async run(req, res) {
    try {
      const data = await vtuberspace.getNewsTags();
      res.json(data);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  },
};