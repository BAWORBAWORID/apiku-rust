import { getJournals, mapQrisEntries } from './assets/gopay/index.js';
import { resolveToken, resolveMerchantId, noMerchantId, fail } from './assets/gopay/helpers.js';

export default {
  name: "GoPay History",
  description: "Riwayat transaksi QRIS dari access token yang dikirim langsung",
  category: "Payment",
  methods: ["GET", "POST"],
  params: ["token", "days"],
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
      description: "Rentang hari ke belakang"
    }
  },

  async run(req, res) {
    try {
      const { days } = { ...req.query, ...req.body };

      const { token, error } = await resolveToken(req);
      if (error) return res.status(401).json({ status: false, message: error });

      const merchantId = await resolveMerchantId(token);
      if (!merchantId) return noMerchantId(res);

      const span = parseInt(days || 7, 10);
      const journal = await getJournals(token, merchantId, null, span);
      const entries = mapQrisEntries(journal);

      return res.status(200).json({
        status: true,
        message: `Berhasil mengambil ${entries.length} transaksi QRIS dalam ${span} hari terakhir.`,
        result: {
          merchant_id: merchantId,
          total: entries.length,
          days: span,
          from: new Date(Date.now() - span * 86400000).toISOString(),
          to: new Date().toISOString(),
          journals: entries
        }
      });
    } catch (err) {
      return fail(res, err, "Gagal mengambil riwayat transaksi");
    }
  }
};