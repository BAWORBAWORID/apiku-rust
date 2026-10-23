import { vtuberspace } from "./lib.js";

export default {
  name: "VTuberSpace News List",
  description: "Daftar berita dengan filter kategori, tag, pencarian, urutan",
  category: "VTuberSpace",
  methods: ["GET", "POST"],
  params: ["page", "pageSize", "sort", "category", "tag", "search", "featuredOnly"],
  paramsSchema: {
    page: { type: "integer", required: false, default: 1, minimum: 1, description: "Nomor halaman" },
    pageSize: { type: "integer", required: false, default: 10, minimum: 1, maximum: 100, description: "Item per halaman" },
    sort: { type: "string", required: false, default: "latest", enum: ["latest", "popular", "oldest"], description: "Urutan" },
    category: { type: "string", required: false, default: "all", description: "Filter kategori (slug atau nama)" },
    tag: { type: "string", required: false, description: "Filter tag (slug atau nama)" },
    search: { type: "string", required: false, description: "Kata kunci pencarian di judul/ekstrak/tag" },
    featuredOnly: { type: "boolean", required: false, default: false, description: "Hanya berita unggulan" },
  },
  async run(req, res) {
    try {
      const { page, pageSize, sort, category, tag, search, featuredOnly } = { ...req.query, ...req.body };
      const data = await vtuberspace.getNews({ page, pageSize, sort, category, tag, search, featuredOnly });
      res.json(data);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  },
};