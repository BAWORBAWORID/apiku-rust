import { getJournals, mapQrisEntries } from './assets/gopay/index.js';
import { getQris, removeQris } from './assets/gopay/qrisRegistry.js';
import { resolveToken, resolveMerchantId, noMerchantId, fail } from './assets/gopay/helpers.js';

export default {
  name: "GoPay QRIS Status",
  description: "Cek status pembayaran QRIS dinamis. Cocokkan nominal & waktu transaksi, lalu bersihkan registry bila sudah lunas",
  category: "Payment",
  methods: ["GET", "POST"],
  params: ["created_at", "amount", "token"],
  paramsSchema: {
    created_at: {
      type: "string",
      required: false,
      default: "",
      description: "registry_key dari GoPay QRIS. Bila diisi, hanya transaksi pada waktu itu yang dicocokkan"
    },
    amount: {
      type: "number",
      required: false,
      default: "",
      description: "Nominal QRIS dalam Rupiah untuk pencocokan"
    },
    token: {
      type: "string",
      required: false,
      default: "",
      description: "Access token GoBiz. Bila dikosongkan, pakai token tersimpan di server"
    }
  },

  async run(req, res) {
    try {
      const { created_at: createdAt, amount } = { ...req.query, ...req.body };

      const { token, error } = await resolveToken(req);
      if (error) return res.status(401).json({ status: false, message: error });

      const merchantId = await resolveMerchantId(token);
      if (!merchantId) return noMerchantId(res);

      const journal = await getJournals(token, merchantId, null, 30);
      let entries = mapQrisEntries(journal);

      if (createdAt) {
        entries = entries.filter((e) => String(e.time || '').startsWith(String(createdAt).slice(0, 13)));
      }

      // Amount dari upstream dalam sen; parameter user dalam Rupiah.
      let match = null;
      if (amount) {
        const target = parseInt(amount, 10) * 100;
        match = entries.find((e) => Number(e.amount) === target) || null;
      } else {
        match = entries[0] || null;
      }

      if (match) {
        const registryEntry = createdAt ? getQris(createdAt) : null;
        if (createdAt && registryEntry) removeQris(createdAt);

        return res.status(200).json({
          status: true,
          message: "Pembayaran QRIS ditemukan.",
          result: {
            paid: true,
            transaction_id: match.id,
            reference_id: match.reference_id,
            transaction_status: match.status,
            amount: Number(match.amount) / 100,
            transaction_time: match.time,
            merchant_name: match.merchant_name,
            merchant_city: match.merchant_city,
            issuer: match.issuer,
            acquirer: match.acquirer,
            terminal_label: match.terminal_label,
            image_url: registryEntry?.image_url || null
          }
        });
      }

      // Belum lunas: bersihkan registry agar tidak menumpuk.
      if (createdAt) {
        const stale = getQris(createdAt);
        if (stale?.image_url) {
          try {
            const { deleteFromCloudStorage, extractS3KeyFromUrl } =
              await import('./assets/gopay/cloudStorage.js');
            const key = extractS3KeyFromUrl(stale.image_url);
            if (key) await deleteFromCloudStorage(key);
          } catch {
            /* cleanup opsional */
          }
        }
        removeQris(createdAt);
      }

      return res.status(200).json({
        status: true,
        message: createdAt
          ? "Pembayaran belum ditemukan (belum lunas atau kedaluwarsa)."
          : "Belum ada transaksi QRIS pada periode ini.",
        result: {
          paid: false,
          created_at: createdAt || null,
          amount: amount ? parseInt(amount, 10) : null,
          checked_count: entries.length,
          merchant_id: merchantId
        }
      });
    } catch (err) {
      return fail(res, err, "Gagal mengecek status QRIS");
    }
  }
};
