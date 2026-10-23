import { getJournals, mapQrisEntries } from './assets/gopay/index.js';
import { getTokens, ensureFreshToken, hasTokens } from './assets/gopay/tokenManager.js';
import { resolveMerchantId, noMerchantId, fail } from './assets/gopay/helpers.js';

export default {
  name: "GoPay History Auto",
  description: "Riwayat transaksi QRIS memakai token tersimpan di server dengan auto-refresh bila kedaluwarsa",
  category: "Payment",
  methods: ["GET", "POST"],
  params: ["days"],
  paramsSchema: {
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

      if (!hasTokens()) {
        return res.status(401).json({
          status: false,
          message: "Belum ada token tersimpan di server. Jalankan GoPay Verif dengan save=true atau GoPay Token Save terlebih dahulu."
        });
      }

      // Validasi + refresh token bila perlu (retry otomatis di ensureFreshToken).
      const fresh = await ensureFreshToken();
      const { accessToken } = getTokens();

      if (!accessToken || !fresh.ok) {
        return res.status(401).json({
          status: false,
          message: "Token tersimpan tidak dapat diperbarui. Jalankan login ulang.",
          reason: fresh?.reason || 'token_tidak_tersedia'
        });
      }

      const merchantId = await resolveMerchantId(accessToken);
      if (!merchantId) return noMerchantId(res);

      const span = parseInt(days || 7, 10);
      const journal = await getJournals(accessToken, merchantId, null, span);
      const entries = mapQrisEntries(journal);

      return res.status(200).json({
        status: true,
        message: `Berhasil mengambil ${entries.length} transaksi QRIS dalam ${span} hari terakhir.`,
        result: {
          merchant_id: merchantId,
          total: entries.length,
          days: span,
          auto_refreshed: !!fresh.refreshed,
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