import logger from "../../src/utils/logger.js";
import amService from "../../src/utils/amService.js";
import { GeneratorEmailClient } from "../../src/utils/generatorEmail.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACTIVE_DOMAINS = [
  "hungtpt.site",
  "samvix.life",
  "capcut.space",
  "minexpool.cloud",
  "kunseller.top",
  "evilgodshop.uk",
  "skyserver.cyou",
  "villastream.xyz"
];

export default {
  name: "AlightMotion Bulk",
  description: "Generate Am Bulk",
  category: "AlightMotion",
  methods: ["GET", "POST"],
  params: ["count"],
  paramsSchema: {
    count: {
      type: "number",
      required: false,
      default: 1,
      description: "Jumlah akun yang diproses (maks 20)",
    },
  },

  async run(req, res) {
    try {
      const { count } = { ...req.query, ...req.body };
      const n = Math.min(Math.max(parseInt(count) || 1, 1), 20);

      // 1. Generate akun & orderId instan (respons instan ke client)
      const results = [];
      for (let i = 0; i < n; i++) {
        const suffix = Math.random().toString(36).substring(2, 9);
        const domain = ACTIVE_DOMAINS[i % ACTIVE_DOMAINS.length];
        const user = `am_${Date.now().toString(36)}_${suffix}`;
        const email = `${user}@${domain}`;
        const inboxUrl = `https://generator.email/${domain}/${user}`;
        const orderId = amService.generateCodeOrder();

        results.push({
          email,
          status: "success",
          inboxUrl,
          orderId
        });
      }

      // 2. Jalankan proses send magic link, inbox schedule, & verifikasi di latar belakang (background)
      (async () => {
        logger.info(`[AM Bulk BG] Memulai proses background untuk ${n} akun...`);
        for (let i = 0; i < results.length; i++) {
          const item = results[i];
          try {
            logger.info(`[AM Bulk BG] [${i + 1}/${n}] Memproses: ${item.email}`);

            // Kirim magic link verifikasi
            const sendRes = await amService.sendMagicLink(item.email);
            if (!sendRes.success) {
              logger.error(`[AM Bulk BG] [${i + 1}/${n}] ${item.email} gagal kirim magic link: ${sendRes.error}`);
              continue;
            }
            logger.info(`[AM Bulk BG] [${i + 1}/${n}] ${item.email} magic link terkirim`);

            // Polling / schedule inbox check
            const client = new GeneratorEmailClient();
            const link = await client.waitForVerifyLink(item.email, {
              maxAttempts: 25,
              intervalMs: 3000,
              log: (msg) => logger.info(`[AM Bulk BG] ${msg}`)
            });

            if (!link) {
              logger.error(`[AM Bulk BG] [${i + 1}/${n}] ${item.email} link verifikasi tidak ditemukan di inbox`);
              continue;
            }
            logger.info(`[AM Bulk BG] [${i + 1}/${n}] ${item.email} link verifikasi berhasil didapatkan`);

            // Verifikasi auth & ambil profil
            const verifyRes = await amService.verifyAndFetchProfile(item.email, link);
            if (!verifyRes.success) {
              logger.error(`[AM Bulk BG] [${i + 1}/${n}] ${item.email} gagal verifikasi login: ${verifyRes.error}`);
              continue;
            }
            logger.info(`[AM Bulk BG] [${i + 1}/${n}] ${item.email} login terverifikasi`);

            // Terapkan lisensi premium dengan orderId yang sudah di-generate
            const premiumRes = await amService.applyPremium(verifyRes.idToken, item.orderId);
            logger.info(
              `[AM Bulk BG] [${i + 1}/${n}] ${item.email} Premium: ${
                premiumRes.success ? "AKTIF" : "GAGAL"
              } (Order: ${item.orderId})`
            );
          } catch (err) {
            logger.error(`[AM Bulk BG] [${i + 1}/${n}] ${item.email} error: ${err.message}`);
          }

          // Delay aman antar akun agar tidak terkena limit Firebase/Google Identity
          if (i < results.length - 1) {
            await sleep(2500);
          }
        }
        logger.info(`[AM Bulk BG] Selesai memproses seluruh ${n} akun di latar belakang.`);
      })().catch((err) => {
        logger.error(`[AM Bulk BG] Fatal background error: ${err.message}`);
      });

      // 3. Respon JSON dikirim instan tanpa menunggu proses background
      return res.json({
        status: true,
        total: n,
        processing: false,
        results
      });

    } catch (err) {
      logger.error(`[AM Bulk] Request error: ${err.message}`);
      return res.status(500).json({ status: false, message: err.message || "Bulk request failed" });
    }
  },
};
