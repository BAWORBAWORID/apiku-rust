import {
  getPartnerToken,
  createQrisTransaction,
  partnerConfig
} from './assets/gopay/index.js';
import { registerQris } from './assets/gopay/qrisRegistry.js';
import { fail, partnerConfigError } from './assets/gopay/helpers.js';

export default {
  name: "GoPay QRIS Official Create",
  description: "Buat transaksi QRIS lewat Official GoBiz Direct Integration API (butuh kredensial developer)",
  category: "Payment",
  methods: ["POST"],
  params: ["grossAmount", "orderId", "outletId", "currency"],
  paramsSchema: {
    grossAmount: {
      type: "number",
      required: true,
      default: "",
      description: "Nominal total transaksi dalam Rupiah",
      example: 25000
    },
    orderId: {
      type: "string",
      required: true,
      default: "",
      description: "Order ID unik milik Anda",
      example: "INV-20260101-001"
    },
    outletId: {
      type: "string",
      required: false,
      default: "",
      description: "Outlet ID. Bila kosong, pakai env GOBIZ_OUTLET_ID"
    },
    currency: {
      type: "string",
      required: false,
      default: "IDR",
      description: "Mata uang transaksi"
    }
  },

  async run(req, res) {
    try {
      const { grossAmount, orderId, outletId, currency } = { ...req.query, ...req.body };

      if (!grossAmount || !orderId) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'grossAmount' dan 'orderId' wajib diisi."
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
      const data = await createQrisTransaction(outlet, {
        orderId: String(orderId),
        grossAmount: parseInt(grossAmount, 10),
        currency: currency || 'IDR'
      }, partnerToken);

      const tx = data?.data || data || {};
      const txId = tx.transaction_id || tx.id || null;

      if (txId) {
        try {
          registerQris({
            amount: parseInt(grossAmount, 10),
            created_at: new Date().toISOString(),
            image_url: null
          });
        } catch {
          /* registry opsional */
        }
      }

      return res.status(200).json({
        status: true,
        message: "Transaksi QRIS official berhasil dibuat.",
        result: tx
      });
    } catch (err) {
      return fail(res, err, "Gagal membuat transaksi QRIS official");
    }
  }
};
