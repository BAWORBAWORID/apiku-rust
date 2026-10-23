const BASE_URL = 'https://clooud.my.id/api/cekstatus?id=';

export default {
  name: "Tiktok View Status",
  description: "Cek status TikTok View (Pending/Proses/Success)",
  category: "Fun",
  methods: ["GET", "POST"],
  params: ["id"],

  paramsSchema: {
    id: {
      type: "string",
      required: true,
      description: "ID proses Tiktok View",
      example: "10533",
    }
  },

  async run(req, res) {
    try {
      const { id } = { ...req.query, ...req.body };

      if (!id || typeof id !== "string" || id.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'id' wajib diisi",
        });
      }

      const cleanId = id.trim();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(BASE_URL + encodeURIComponent(cleanId), {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const result = await response.json();

      res.status(200).json({
        statusCode: 200,
        status: true,
        result: {
          data: result.data || result
        },
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      res.status(500).json({
        status: false,
        message: 'Gagal mengambil data dari server',
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  },
};
