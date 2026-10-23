export default {
  name: "Timestamp",
  description: "Get current server timestamp",
  category: "Tools",
  methods: ["GET", "POST"],

  params: [],

  paramsSchema: {},

  async run(req, res) {
    try {
      const now = new Date();
      return res.json({
        status: true,
        result: {
          iso: now.toISOString(),
          unix: Math.floor(now.getTime() / 1000),
          unix_ms: now.getTime()
        }
      });
    } catch (e) {
      return res.status(500).json({
        status: false,
        message: e.message || "Failed to get timestamp"
      });
    }
  }
};
