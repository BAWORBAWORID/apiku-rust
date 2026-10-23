import { getJournals, mapQrisEntries } from './assets/gopay/index.js';
import { resolveToken, resolveMerchantId, noMerchantId, fail } from './assets/gopay/helpers.js';

export default {
  name: "GoPay Journal",
  description: "Journal transaksi QRIS merchant dari access token, sudah difilter ke tipe qris",
  category: "Payment",
  methods: ["GET", "POST"],
  params: ["token", "days", "startTime"],
  paramsSchema: {
    token: {
      type: "string",
      required: false,
      default: "",
      description: "Access token GoBiz. Bila dikosongkan, pakai token tersimpan di server"
    },
    days: {
      type: "number",
      required: false,
      default: 7,
      description: "Rentang hari ke belakang untuk pencarian journal"
    },
    startTime: {
      type: "string",
      required: false,
      default: "",
      description: "Waktu mulai ISO8601. Bila diisi, mengabaikan parameter days"
    }
  },

  async run(req, res) {
    try {
      const { days, startTime } = { ...req.query, ...req.body };

      const { token, error } = await resolveToken(req);
      if (error) return res.status(401).json({ status: false, message: error });

      const merchantId = await resolveMerchantId(token);
      if (!merchantId) return noMerchantId(res);

      const journal = await getJournals(
        token,
        merchantId,
        startTime || null,
        parseInt(days || 7, 10)
      );

      const entries = mapQrisEntries(journal);
      return res.status(200).json({
        status: true,
        message: `Berhasil mengambil ${entries.length} transaksi QRIS.`,
        result: {
          merchant_id: merchantId,
          total: entries.length,
          days: startTime ? null : parseInt(days || 7, 10),
          journals: entries
        }
      });
    } catch (err) {
      return fail(res, err, "Gagal mengambil journal");
    }
  }
};