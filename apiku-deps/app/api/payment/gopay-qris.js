import { createDynamicQRIS } from './assets/gopay/index.js';
import { registerQris } from './assets/gopay/qrisRegistry.js';
import { fail } from './assets/gopay/helpers.js';

export default {
  name: "GoPay QRIS",
  description: "Buat QRIS dinamis dari QRIS statis merchant (nominal ikut tertanam) dan daftarkan ke registry",
  category: "Payment",
  methods: ["GET", "POST"],
  params: ["amount", "qr", "cdn"],
  paramsSchema: {
    amount: {
      type: "number",
      required: true,
      default: "",
      description: "Nominal transaksi dalam Rupiah",
      example: 25000
    },
    qr: {
      type: "string",
      required: true,
      default: "",
      description: "Isi QRIS statis merchant (string EMVCo, bukan gambar)",
      example: ""
    },
    cdn: {
      type: "boolean",
      required: false,
      default: false,
      description: "Bila true, QRIS PNG diunggah ke cloud storage dan URLnya dikembalikan"
    }
  },

  async run(req, res) {
    try {
      const { amount, qr, cdn } = { ...req.query, ...req.body };

      if (!amount || !qr) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'amount' dan 'qr' wajib diisi."
        });
      }

      const nominal = parseInt(amount, 10);
      if (Number.isNaN(nominal) || nominal <= 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'amount' harus angka positif."
        });
      }

      const result = await createDynamicQRIS(nominal, qr);

      // Opsional: unggah ke cloud storage bila param 'cdn' diisi.
      let imageUrl = null;
      if (cdn) {
        try {
          const { uploadToCloudStorage } = await import('../../src/utils/cloudStorage.js');
          imageUrl = await uploadToCloudStorage(result.qr_buffer, 'qris.png');
        } catch {
          imageUrl = null;
        }
      }

      // Daftarkan ke registry supaya bisa dilacak lewat GoPay Qris Status.
      let registryKey = null;
      try {
        const entry = registerQris({
          amount: result.amount,
          created_at: result.created_at,
          image_url: imageUrl
        });
        registryKey = entry?.created_at || null;
      } catch {
        /* registry opsional, jangan gagalkan pembuatan QR */
      }

      const base64 = result.qr_buffer.toString('base64');
      return res.status(200).json({
        status: true,
        message: "QRIS dinamis berhasil dibuat.",
        result: {
          amount: result.amount,
          qr_string: result.qr_string,
          image: `data:image/png;base64,${base64}`,
          created_at: result.created_at,
          registry_key: registryKey,
          image_url: imageUrl
        }
      });
    } catch (err) {
      return fail(res, err, "Gagal membuat QRIS dinamis");
    }
  }
};
