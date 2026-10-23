import { vtuberspace } from "./lib.js";

export default {
  name: "VTuberSpace VTuber Search",
  description: "Cari VTuber berdasarkan nama",
  category: "VTuberSpace",
  methods: ["GET", "POST"],
  params: ["q", "limit"],
  paramsSchema: {
    q: { type: "string", required: true, description: "Nama VTuber (contoh: 'Kureiji Ollie')" },
    limit: { type: "integer", required: false, default: 10, minimum: 1, maximum: 50, description: "Jumlah hasil" },
  },
  async run(req, res) {
    try {
      const { q, limit } = { ...req.query, ...req.body };
      if (!q) return res.status(400).json({ success: false, error: "Parameter 'q' wajib diisi" });
      const data = await vtuberspace.searchVtuber(q, limit);
      res.json(data);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  },
};