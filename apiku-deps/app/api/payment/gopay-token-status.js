import { status } from './assets/gopay/tokenManager.js';

export default {
  name: "GoPay Token Status",
  description: "Cek apakah token GoBiz tersimpan di server, tanpa menampilkan nilai token",
  category: "Payment",
  methods: ["GET"],
  params: [],
  paramsSchema: {},

  async run(req, res) {
    try {
      const s = status();
      return res.status(200).json({
        status: true,
        message: s.hasTokens
          ? "Token tersimpan dan siap dipakai."
          : "Belum ada token tersimpan. Jalankan GoPay Verif (save=true) atau GoPay Token Save.",
        result: s
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: `Gagal membaca status token: ${err.message}`
      });
    }
  }
};
