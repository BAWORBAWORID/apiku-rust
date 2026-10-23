import { setTokens } from './assets/gopay/tokenManager.js';

export default {
  name: "GoPay Token Save",
  description: "Simpan access token dan refresh token GoBiz ke server agar endpoint auto bisa dipakai",
  category: "Payment",
  methods: ["POST"],
  params: ["accessToken", "refreshToken"],
  paramsSchema: {
    accessToken: {
      type: "string",
      required: true,
      default: "",
      description: "access_token dari GoPay Verif"
    },
    refreshToken: {
      type: "string",
      required: true,
      default: "",
      description: "refresh_token dari GoPay Verif"
    }
  },

  async run(req, res) {
    try {
      const { accessToken, refreshToken } = { ...req.query, ...req.body };

      if (!accessToken || !refreshToken) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'accessToken' dan 'refreshToken' wajib diisi."
        });
      }

      const status = setTokens(accessToken, refreshToken);

      return res.status(200).json({
        status: true,
        message: "Token berhasil disimpan. Auto-refresh aktif setiap 15 menit.",
        result: status
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: `Gagal menyimpan token: ${err.message}`
      });
    }
  }
};
