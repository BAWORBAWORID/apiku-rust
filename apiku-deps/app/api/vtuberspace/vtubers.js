import { vtuberspace } from "./lib.js";

export default {
  name: "VTuberSpace VTubers List",
  description: "Daftar VTuber dengan filter gender dan tipe agensi",
  category: "VTuberSpace",
  methods: ["GET", "POST"],
  params: ["page", "pageSize", "gender", "agencyType"],
  paramsSchema: {
    page: { type: "integer", required: false, default: 1, minimum: 1, description: "Nomor halaman" },
    pageSize: { type: "integer", required: false, default: 20, minimum: 1, maximum: 100, description: "Item per halaman" },
    gender: { type: "string", required: false, enum: ["Male", "Female"], description: "Filter gender" },
    agencyType: { type: "string", required: false, description: "Filter tipe agensi (indie/affiliated)" },
  },
  async run(req, res) {
    try {
      const { page, pageSize, gender, agencyType } = { ...req.query, ...req.body };
      const data = await vtuberspace.getVtubers({ page, pageSize, gender, agencyType });
      res.json(data);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  },
};