import { getMe } from './assets/gopay/index.js';
import { resolveToken, fail } from './assets/gopay/helpers.js';

export default {
  name: "GoPay Me",
  description: "Ambil profil user GoBiz Merchant yang sedang login",
  category: "Payment",
  methods: ["GET", "POST"],
  params: ["token"],
  paramsSchema: {
    token: {
      type: "string",
      required: false,
      default: "",
      description: "Access token GoBiz. Bila dikosongkan, pakai token tersimpan di server"
    }
  },

  async run(req, res) {
    try {
      const { token, error, autoUsed, refreshed } = await resolveToken(req);
      if (error) return res.status(401).json({ status: false, message: error });

      const data = await getMe(token);
      return res.status(200).json({
        status: true,
        message: "Profil user berhasil diambil.",
        result: {
          user: data?.data?.user || data?.user || data?.data || data,
          token_source: autoUsed ? 'stored' : 'parameter',
          auto_refreshed: autoUsed ? !!refreshed : false
        }
      });
    } catch (err) {
      return fail(res, err, "Gagal mengambil profil user");
    }
  }
};
