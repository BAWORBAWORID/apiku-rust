import { extractError, verifyOtp } from './assets/gopay/index.js';

export default {
  name: "GoPay Verif",
  description: "Verifikasi OTP GoBiz Merchant menjadi access token dan refresh token",
  category: "Payment",
  methods: ["GET", "POST"],
  params: ["otp", "otpToken"],
  paramsSchema: {
    otp: {
      type: "string",
      required: true,
      default: "",
      description: "Kode OTP yang diterima via WhatsApp/SMS",
      example: "123456"
    },
    otpToken: {
      type: "string",
      required: true,
      default: "",
      description: "otp_token dari respons endpoint GoPay Login",
      example: ""
    },
    save: {
      type: "boolean",
      required: false,
      default: false,
      description: "Bila true, token langsung disimpan di server agar endpoint auto/history bisa dipakai"
    }
  },

  async run(req, res) {
    try {
      const { otp, otpToken, save } = { ...req.query, ...req.body };

      if (!otp || !otpToken) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'otp' dan 'otpToken' wajib diisi."
        });
      }

      const data = await verifyOtp(otp, otpToken);
      const payload = data?.data || data || {};
      const accessToken = payload.access_token || null;
      const refreshToken = payload.refresh_token || null;

      if (!accessToken) {
        return res.status(400).json({
          status: false,
          message: "Verifikasi gagal. Pastikan OTP benar dan belum kedaluwarsa.",
          error: data
        });
      }

      let saved = false;
      if (save === true || save === 'true') {
        if (refreshToken) {
          const { setTokens } = await import('./assets/gopay/tokenManager.js');
          setTokens(accessToken, refreshToken);
          saved = true;
        }
      }

      return res.status(200).json({
        status: true,
        message: saved
          ? "OTP terverifikasi dan token tersimpan di server."
          : "OTP terverifikasi. Simpan access_token & refresh_token dengan aman.",
        result: {
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: payload.token_type || null,
          expires_in: payload.expires_in || null,
          saved
        }
      });
    } catch (err) {
      return res.status(err.response?.status || 500).json({
        status: false,
        message: extractError(err, "Gagal verifikasi OTP")
      });
    }
  }
};
