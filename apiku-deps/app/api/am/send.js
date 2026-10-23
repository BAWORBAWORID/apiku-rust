import amService from "../../src/utils/amService.js";

export default {
  name: "AlightMotion Send",
  description: "Kirim email verifikasi Alight Motion Premium",
  category: "AlightMotion",
  methods: ["GET", "POST"],
  params: ["email"],
  paramsSchema: {
    email: {
      type: "string",
      required: true,
      description: "Email tujuan untuk magic link verifikasi",
      example: "user@email.com"
    }
  },
  async run(req, res) {
    const { email } = { ...req.query, ...req.body };

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'email' wajib diisi dan harus valid"
      });
    }

    try {
      const result = await amService.sendMagicLink(email.trim());
      if (!result.success) {
        return res.status(502).json({ 
          status: false, 
          message: result.error || "Gagal mengirim magic link" 
        });
      }
      return res.json({
        status: true,
        message: result.message || "Link berhasil dikirim.",
        result: {
          email: email.trim()
        }
      });
    } catch (err) {
      return res.status(500).json({ 
        status: false, 
        message: err.message 
      });
    }
  }
};
