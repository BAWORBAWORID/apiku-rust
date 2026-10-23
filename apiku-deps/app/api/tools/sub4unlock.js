import fetch from "node-fetch";

export default {
  name: "Sub4Unlock Generator",
  description: "Generate link Sub4Unlock dengan social media requirements",
  category: "Tools",
  methods: ["POST"],
  params: ["destinationUrl", "youtubeSub1", "youtubeSub2", "youtubeLikeSub", "youtubeSubBell", "youtubeLikeComment", "igLike", "igFollow", "fbFollow", "twFollow", "tgJoin", "tgJoin2", "discordJoin"],
  paramsSchema: {
    destinationUrl: { type: "string", required: true, description: "URL tujuan setelah unlock" },
    youtubeSub1: { type: "string", required: false, description: "YouTube subscribe link 1" },
    youtubeSub2: { type: "string", required: false, description: "YouTube subscribe link 2" },
    youtubeLikeSub: { type: "string", required: false, description: "YouTube like & subscribe" },
    youtubeSubBell: { type: "string", required: false, description: "YouTube subscribe + bell" },
    youtubeLikeComment: { type: "string", required: false, description: "YouTube like & comment" },
    igLike: { type: "string", required: false, description: "Instagram like" },
    igFollow: { type: "string", required: false, description: "Instagram follow" },
    fbFollow: { type: "string", required: false, description: "Facebook follow" },
    twFollow: { type: "string", required: false, description: "Twitter follow" },
    tgJoin: { type: "string", required: false, description: "Telegram join 1" },
    tgJoin2: { type: "string", required: false, description: "Telegram join 2" },
    discordJoin: { type: "string", required: false, description: "Discord join" },
  },
  async run(req, res) {
    const body = { ...req.query, ...req.body };
    const { destinationUrl, youtubeSub1, youtubeSub2, youtubeLikeSub, youtubeSubBell, youtubeLikeComment, igLike, igFollow, fbFollow, twFollow, tgJoin, tgJoin2, discordJoin } = body;

    if (!destinationUrl) return res.status(400).json({ status: false, message: "Parameter 'destinationUrl' wajib diisi" });

    try {
      const formData = new URLSearchParams();
      formData.append("link-1", youtubeSub1 || "");
      formData.append("link-2", youtubeSub2 || "");
      formData.append("link-3", youtubeLikeSub || "");
      formData.append("link-4", youtubeSubBell || "");
      formData.append("link-5", youtubeLikeComment || "");
      formData.append("link-6", igLike || "");
      formData.append("link-7", igFollow || "");
      formData.append("link-8", fbFollow || "");
      formData.append("link-9", twFollow || "");
      formData.append("link-10", tgJoin || "");
      formData.append("link-11", tgJoin2 || "");
      formData.append("link-12", discordJoin || "");
      formData.append("file-link", destinationUrl);
      formData.append("cf_auto_token", "");
      formData.append("cf_visible_token", "");

      const response = await fetch("https://sub4unlock.io/gendo_ajax.php", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
          "Origin": "https://sub4unlock.io",
          "Referer": "https://sub4unlock.io/",
        },
        body: formData.toString(),
      });

      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

      const generatedLink = await response.text();
      res.json({ status: true, result: generatedLink });
    } catch (e) {
      res.status(500).json({ status: false, message: e.message });
    }
  },
};