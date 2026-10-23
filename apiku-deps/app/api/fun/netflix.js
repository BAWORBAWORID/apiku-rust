/**
 * Netflix Token Generator
 * GET /api/fun/netflix
 */

const ENDPOINT = "https://token-netflix.vercel.app/api/generate";

function buildLinks(token) {
  return {
    pc: `https://www.netflix.com/browse?nftoken=${token}`,
    android: `https://www.netflix.com/browse?nftoken=${token}`,
    tv: `https://www.netflix.com/tv?nftoken=${token}`,
  };
}

function cleanToken(item) {
  return {
    id: item.id,
    index: item.index,
    success: item.success,
    token: item.token,
    expiry: item.expiry || null,
    type: item.type || "cookie",
    profile: item.profile || null,
    links: item.token ? buildLinks(item.token) : item.links || null,
  };
}

export default {
  name: "Netflix Token Generator",
  description: "Generate Netflix token gratis",
  category: "Fun",
  methods: ["GET", "POST"],
  params: [],
  paramsSchema: {},
  async run(req, res) {
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 1, stream: false }),
        signal: AbortSignal.timeout(15000),
      });

      const data = await response.json();

      if (!response.ok) {
        return res.json({ status: false, message: data?.message || "Gagal generate token" });
      }

      const tokens = Array.isArray(data.data) ? data.data.map(cleanToken) : [];
      const token = tokens[0] || null;

      return res.json({
        status: true,
        result: token,
      });
    } catch (e) {
      return res.json({ status: false, message: e.message });
    }
  },
};
