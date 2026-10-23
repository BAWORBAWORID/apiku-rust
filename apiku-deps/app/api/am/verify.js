import amService from "../../src/utils/amService.js";

export default {
  name: "AlightMotion Verify",
  description: "Verifikasi link email + aktivasi Alight Motion Premium",
  category: "AlightMotion",
  methods: ["GET", "POST"],
  params: ["email", "link"],
  paramsSchema: {
    email: {
      type: "string",
      required: true,
      description: "Email yang sama dengan saat kirim magic link",
      example: "user@email.com"
    },
    link: {
      type: "string",
      required: true,
      description: "Link verifikasi full URL dari email (alight-creative.firebaseapp.com/__/auth/links?link=...)",
      example: "https://alight-creative.firebaseapp.com/__/auth/links?link=..."
    }
  },
  async run(req, res) {
    const { email, link } = { ...req.query, ...req.body };

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ success: false, error: "Parameter 'email' wajib diisi dan harus valid" });
    }
    if (!link || typeof link !== "string" || link.length < 10) {
      return res.status(400).json({ success: false, error: "Parameter 'link' wajib diisi (full URL verifikasi)" });
    }

    try {
      const verifyResult = await amService.verifyAndFetchProfile(email.trim(), link.trim());
      if (!verifyResult.success) {
        return res.status(400).json({ success: false, error: verifyResult.error || "Verifikasi gagal" });
      }

      const premiumResult = await amService.applyPremium(verifyResult.idToken);
      if (!premiumResult.success) {
        return res.status(502).json({
          success: false,
          step: "verify_ok",
          error: premiumResult.error || "Aktivasi premium gagal"
        });
      }

      return res.json({
        success: true,
        email: email.trim(),
        user: verifyResult.user,
        premium: premiumResult.data,
        code_order: premiumResult.codeorder
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
};
