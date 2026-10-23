import { vtuberspace } from "./lib.js";

export default {
  name: "VTuberSpace Agencies",
  description: "Daftar agensi VTuber",
  category: "VTuberSpace",
  methods: ["GET", "POST"],
  params: ["page", "pageSize"],
  paramsSchema: {
    page: { type: "integer", required: false, default: 1, minimum: 1, description: "Nomor halaman" },
    pageSize: { type: "integer", required: false, default: 100, minimum: 1, maximum: 200, description: "Item per halaman" },
  },
  async run(req, res) {
    try {
      const { page, pageSize } = { ...req.query, ...req.body };
      const data = await vtuberspace.getAgencies({ page, pageSize });
      res.json(data);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  },
};