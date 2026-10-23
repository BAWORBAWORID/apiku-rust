import { vtuberspace } from "./lib.js";

export default {
  name: "VTuberSpace VTuber Detail",
  description: "Detail VTuber lengkap (by ID atau slug)",
  category: "VTuberSpace",
  methods: ["GET", "POST"],
  params: ["id"],
  paramsSchema: { id: { type: "string", required: true, description: "ID numerik atau slug VTuber" } },
  async run(req, res) {
    try {
      const { id } = { ...req.query, ...req.body };
      if (!id) return res.status(400).json({ success: false, error: "Parameter 'id' wajib diisi" });
      const data = await vtuberspace.getVtuberDetail(id);
      res.json(data);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  },
};