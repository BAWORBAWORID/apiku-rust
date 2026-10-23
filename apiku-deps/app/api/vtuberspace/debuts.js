import { vtuberspace } from "./lib.js";

export default {
  name: "VTuberSpace Debut Roster",
  description: "Daftar VTuber yang debut di bulan/tahun tertentu",
  category: "VTuberSpace",
  methods: ["GET", "POST"],
  params: ["year", "month", "page", "pageSize", "gender", "agencyType"],
  paramsSchema: {
    year: { type: "integer", required: true, minimum: 2020, maximum: 2030, description: "Tahun debut (contoh: 2024)" },
    month: { type: "integer", required: true, minimum: 1, maximum: 12, description: "Bulan debut (1-12)" },
    page: { type: "integer", required: false, default: 1, minimum: 1, description: "Nomor halaman" },
    pageSize: { type: "integer", required: false, default: 100, minimum: 1, maximum: 200, description: "Item per halaman" },
    gender: { type: "string", required: false, enum: ["Male", "Female"], description: "Filter gender" },
    agencyType: { type: "string", required: false, description: "Filter tipe agensi" },
  },
  async run(req, res) {
    try {
      const { year, month, page, pageSize, gender, agencyType } = { ...req.query, ...req.body };
      if (!year || !month) return res.status(400).json({ success: false, error: "Parameter 'year' dan 'month' wajib diisi" });
      const data = await vtuberspace.getDebuts(year, month, { page, pageSize, gender, agencyType });
      res.json(data);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  },
};