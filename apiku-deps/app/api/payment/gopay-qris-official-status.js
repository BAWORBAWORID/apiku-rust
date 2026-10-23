import {
  getPartnerToken,
  getQrisTransaction,
  partnerConfig
} from './assets/gopay/index.js';
import { fail, partnerConfigError } from './assets/gopay/helpers.js';

export default {
  name: "GoPay QRIS Official Status",
  description: "Cek status transaksi QRIS official lewat Direct Integration API",
  category: "Payment",
  methods: ["GET", "POST"],
  params: ["transactionId", "outletId"],
  paramsSchema: {
    transactionId: {
      type: "string",
      required: true,
      default: "",
      description: "transaction_id dari GoPay QRIS Official Create"
    },
    outletId: {
      type: "string",
      required: false,
      default: "",
      description: "Outlet ID. Bila kosong, pakai env GOBIZ_OUTLET_ID"
    }
  },

  async run(req, res) {
    try {
      const { transactionId, outletId } = { ...req.query, ...req.body };

      if (!transactionId) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'transactionId' wajib diisi."
        });
      }

      const cfg = partnerConfig();
      const configErr = partnerConfigError(cfg);
      if (configErr) {
        return res.status(503).json({ status: false, message: configErr });
      }

      const outlet = outletId || cfg.outletId;
      if (!outlet) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'outletId' wajib diisi atau set env GOBIZ_OUTLET_ID."
        });
      }

      const partnerToken = await getPartnerToken(cfg.clientId, cfg.clientSecret);
      const data = await getQrisTransaction(outlet, String(transactionId), partnerToken);
      const tx = data?.data || data || {};

      return res.status(200).json({
        status: true,
        message: "Status transaksi QRIS official berhasil diambil.",
        result: {
          transaction_id: tx.transaction_id || transactionId,
          transaction_status: tx.transaction_status || tx.status || null,
          order_id: tx.order_id || null,
          gross_amount: tx.gross_amount || null,
          currency: tx.currency || null,
          qr_string: tx.qr_string || null,
          expires_at: tx.expires_at || null
        }
      });
    } catch (err) {
      return fail(res, err, "Gagal mengambil status transaksi QRIS official");
    }
  }
};
