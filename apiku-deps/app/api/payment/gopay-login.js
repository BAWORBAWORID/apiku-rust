import { extractError, requestOtp } from './assets/gopay/index.js';

export default {
  name: "GoPay Login",
  description: "Minta kode OTP login GoBiz Merchant. OTP dikirim via WhatsApp/SMS ke nomor terdaftar",
  category: "Payment",
  methods: ["GET", "POST"],
  params: ["phone"],
  paramsSchema: {
    phone: {
      type: "string",
      required: true,
      default: "",
      description: "Nomor HP merchant. Boleh diawali 62 atau tidak (contoh: 6281234567890 / 81234567890)",
      example: "6281234567890"
    }
  },

  async run(req, res) {
    try {
      const { phone } = { ...req.query, ...req.body };

      if (!phone) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'phone' wajib diisi."
        });
      }

      let digits = String(phone).replace(/^\+/, '').replace(/[\s-]/g, '');
      if (digits.startsWith('62')) digits = digits.slice(2);

      if (!/^\d{8,15}$/.test(digits)) {
        return res.status(400).json({
          status: false,
          message: "Format nomor tidak valid. Contoh: 6281234567890 atau 81234567890."
        });
      }

      const data = await requestOtp(digits);
      const otpToken = data?.data?.otp_token || data?.otp_token || null;

      if (!otpToken) {
        return res.status(400).json({
          status: false,
          message: "OTP tidak terkirim. Periksa kembali nomor HP merchant.",
          error: data
        });
      }

      return res.status(200).json({
        status: true,
        message: "Kode OTP berhasil dikirim. Simpan otp_token untuk verifikasi.",
        result: {
          otp_token: otpToken,
          message: data?.data?.message || "Kode OTP berhasil dikirim"
        }
      });
    } catch (err) {
      return res.status(err.response?.status || 500).json({
        status: false,
        message: extractError(err, "Gagal requesting OTP")
      });
    }
  }
};
