import { getMerchant } from './assets/gopay/index.js';
import { resolveToken, resolveMerchantId, noMerchantId, fail } from './assets/gopay/helpers.js';

export default {
  name: "GoPay Merchant",
  description: "Ambil detail merchant GoBiz milik access token (nama, MCC, status, lokasi)",
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
      const { token, error } = await resolveToken(req);
      if (error) return res.status(401).json({ status: false, message: error });

      const merchantId = await resolveMerchantId(token);
      if (!merchantId) return noMerchantId(res);

      const data = await getMerchant(token, merchantId);
      return res.status(200).json({
        status: true,
        message: "Detail merchant berhasil diambil.",
        result: {
          merchant_id: merchantId,
          merchant: data?.data?.merchant || data?.merchant || data?.data || data
        }
      });
    } catch (err) {
      return fail(res, err, "Gagal mengambil detail merchant");
    }
  }
};