import { vtuberspace } from "./lib.js";

export default {
  name: "VTuberSpace YouTube Avatar",
  description: "Resolve avatar YouTube channel VTuber",
  category: "VTuberSpace",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: { url: { type: "string", required: true, description: "URL channel YouTube (contoh: https://youtube.com/@channel)" } },
  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body };
      if (!url) return res.status(400).json({ success: false, error: "Parameter 'url' wajib diisi" });
      const data = await vtuberspace.resolveYoutubeAvatar(url);
      res.json(data);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  },
};