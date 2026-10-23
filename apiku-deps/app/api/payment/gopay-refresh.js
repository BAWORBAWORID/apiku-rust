import { extractError, refreshToken, getTokens } from './assets/gopay/index.js';

export default {
  name: "GoPay Refresh",
  description: "Perbarui access token GoBiz Merchant memakai refresh token (token disimpen bila ada)",
  category: "Payment",
  methods: ["GET", "POST"],
  params: ["refreshToken", "save"],
  paramsSchema: {
    refreshToken: {
      type: "string",
      required: false,
      default: "",
      description: "refresh_token dari GoPay Verif. Bila dikosongkan, pakai refresh token tersimpan di server"
    },
    save: {
      type: "boolean",
      required: false,
      default: true,
      description: "Simpan token baru ke server (default true). Refresh token GoBiz berotasi tiap refresh, jadi ini disarankan"
    }
  },

  async run(req, res) {
    try {
      const { refreshToken: rt, save } = { ...req.query, ...req.body };
      const stored = getTokens();
      const useToken = rt || stored.refreshToken;

      if (!useToken) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'refreshToken' wajib diisi. Belum ada refresh token tersimpan di server."
        });
      }

      const data = await refreshToken(useToken);
      const payload = data?.data || data || {};
      const accessToken = payload.access_token || null;
      const rotated = payload.refresh_token || null;

      if (!accessToken) {
        return res.status(400).json({
          status: false,
          message: "Refresh gagal. Refresh token mungkin kedaluwarsa, lakukan login ulang.",
          error: data
        });
      }

      const shouldSave = save !== false && save !== 'false';
      let saved = false;
      if (shouldSave) {
        const { setTokens } = await import('./assets/gopay/tokenManager.js');
        setTokens(accessToken, rotated || useToken);
        saved = true;
      }

      return res.status(200).json({
        status: true,
        message: saved
          ? "Access token diperbarui dan disimpan. Auto-refresh aktif."
          : "Access token berhasil diperbarui.",
        result: {
          access_token: accessToken,
          refresh_token: rotated || useToken,
          refresh_token_rotated: !!rotated && rotated !== useToken,
          token_type: payload.token_type || null,
          expires_in: payload.expires_in || null,
          saved
        }
      });
    } catch (err) {
      return res.status(err.response?.status || 401).json({
        status: false,
        message: extractError(err, "Gagal refresh access token")
      });
    }
  }
};
