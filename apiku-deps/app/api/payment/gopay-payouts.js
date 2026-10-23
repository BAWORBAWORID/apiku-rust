import { getPayouts } from './assets/gopay/index.js';
import { resolveToken, fail } from './assets/gopay/helpers.js';

export default {
  name: "GoPay Payouts",
  description: "Ambil daftar payout / withdraw merchant GoBiz",
  category: "Payment",
  methods: ["GET", "POST"],
  params: ["token", "page", "per"],
  paramsSchema: {
    token: {
      type: "string",
      required: false,
      default: "",
      description: "Access token GoBiz. Bila dikosongkan, pakai token tersimpan di server"
    },
    page: {
      type: "number",
      required: false,
      default: 1,
      description: "Nomor halaman"
    },
    per: {
      type: "number",
      required: false,
      default: 50,
      description: "Jumlah item per halaman"
    }
  },

  async run(req, res) {
    try {
      const { page, per } = { ...req.query, ...req.body };

      const { token, error } = await resolveToken(req);
      if (error) return res.status(401).json({ status: false, message: error });

      const data = await getPayouts(
        token,
        parseInt(page || 1, 10),
        parseInt(per || 50, 10)
      );

      return res.status(200).json({
        status: true,
        message: "Daftar payout berhasil diambil.",
        result: {
          page: parseInt(page || 1, 10),
          per_page: parseInt(per || 50, 10),
          payouts: data?.data?.payouts || data?.payouts || data?.data?.hits || data?.data || data
        }
      });
    } catch (err) {
      return fail(res, err, "Gagal mengambil payout");
    }
  }
};
