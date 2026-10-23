import crypto from 'crypto';

export default {
  name: "UUID Generator",
  description: "UUID v4 generator",
  category: "Tools",
  methods: ["GET", "POST"],

  params: [],

  paramsSchema: {},

  async run(req, res) {
    try {
      const id = crypto.randomUUID();

      return res.json({
        status: true,
        result: {
          uuid: id,
          version: 4
        }
      });
    } catch (e) {
      return res.status(500).json({
        status: false,
        message: e.message || "UUID generation failed"
      });
    }
  }
};
