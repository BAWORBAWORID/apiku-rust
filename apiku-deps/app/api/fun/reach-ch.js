/**
 * Reach CH — WhatsApp Channel Reaction Automation
 * Provider: ReactionWA (react.v1.zfile.web.id)
 * Fitur   : Mengirim reaksi emoji ke postingan channel WhatsApp via Star-Cloud VIP Queue solver & auto IP rotation
 * Mode    : Fast Response / Background Processing
 */

import axios from 'axios';
import logger from '../../src/utils/logger.js';

const BASE_URL = 'https://react.v1.zfile.web.id';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

/**
 * Generate random IP untuk rotasi coin (tiap IP baru dapat coin penuh di ReactionWA)
 */
function randomIp() {
  const r = () => Math.floor(Math.random() * 254) + 1;
  return `${r()}.${r()}.${r()}.${r()}`;
}

/**
 * Parse input emoji (bisa string tunggal, dipisah koma, atau multiple grapheme)
 */
function parseEmojis(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  const str = String(raw).trim();
  if (!str) return [];
  if (str.includes(',')) {
    return str.split(',').map(s => s.trim()).filter(Boolean);
  }
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const segs = [...segmenter.segment(str)].map(s => s.segment).filter(s => s.trim());
  return segs.length ? segs : [str];
}

/**
 * Kirim reaksi emoji ke WhatsApp Channel melalui endpoint react.v1.zfile.web.id
 */
async function sendReaction(channelUrl, emojis) {
  const ip = randomIp();
  const payload = {
    url: channelUrl,
    emojis: emojis,
    visitorIp: ip
  };

  const { status, data } = await axios.post(`${BASE_URL}/api/react`, payload, {
    timeout: 60_000,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip,
      'User-Agent': UA,
      Referer: `${BASE_URL}/`,
      Origin: BASE_URL
    },
    validateStatus: () => true
  });

  return { status, data, sessionIp: ip };
}

export default {
  name: "Reach CH",
  description: "Kirim reaksi emoji otomatis ke postingan WhatsApp Channel (Fast Response / Background Process)",
  category: "Fun",
  methods: ["GET", "POST"],
  params: ["url", "emoji"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      default: "",
      description: "Link postingan WhatsApp Channel (contoh: https://whatsapp.com/channel/xxx/123)",
      example: ""
    },
    emoji: {
      type: "string",
      required: true,
      default: "",
      description: "Emoji reaksi (contoh: ⚡, 🥵, 👍, atau dipisah koma jika multi emoji)",
      example: ""
    }
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      const channelUrl = String(params.url || params.link || params.channelLink || '').trim();
      const rawEmoji = String(params.emoji || params.emojis || '').trim();
      const emojis = parseEmojis(rawEmoji);
      const shouldWait = params.wait === 'true' || params.wait === true || params.sync === 'true';

      if (!channelUrl) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi dengan tautan postingan channel WhatsApp."
        });
      }

      // Proteksi Saluran Terlindungi
      const extractedChannelId = (channelUrl.match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i) || [])[1];
      if (extractedChannelId === '0029Vb8vO7o2f3EEsjefzm0w') {
        logger.warn(`[REACH-CH] Akses ditolak: Saluran ${extractedChannelId} dilindungi.`);
        return res.status(403).json({
          status: false,
          protected: true,
          channel_id: extractedChannelId,
          message: "Saluran ini dilindungi (Protected Channel). Reaksi emoji dan reach dinonaktifkan untuk saluran ini."
        });
      }

      if (!rawEmoji || !emojis.length) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'emoji' wajib diisi."
        });
      }

      if (!/^https?:\/\/(www\.)?whatsapp\.com\/channel\/[^\/]+\/\d+/i.test(channelUrl)) {
        return res.status(400).json({
          status: false,
          message: "Format URL tidak valid. Contoh yang benar: https://whatsapp.com/channel/0029Vb8EfuN35fM5AX25AT1W/1360"
        });
      }

      logger.info(`[REACH-CH] Dispatching reaksi [${emojis.join(', ')}] ke ${channelUrl} (wait=${shouldWait})`);

      // Mode Synchronous (opsional jika user menambahkan &wait=true)
      if (shouldWait) {
        const { status, data } = await sendReaction(channelUrl, emojis);
        if (!data || !data.success) {
          return res.status(status >= 400 ? status : 400).json({
            status: false,
            message: data?.message || "Gagal mengirim reaksi ke channel",
            error: data
          });
        }
        return res.status(200).json({
          status: true,
          message: data.message || "Reaction berhasil masuk antrean VIP!",
          result: {
            channelUrl,
            emojis,
            task: data.data?.data?.task || null,
            solverUsed: data.data?.solverUsed || null,
            vip: data.data?.data?.vip || null,
            raw: data
          }
        });
      }

      // Mode Asynchronous / Fast Response (Default):
      // Proses dikirimkan di latar belakang (background), client langsung menerima response 200 instan!
      sendReaction(channelUrl, emojis)
        .then(({ status, data, sessionIp }) => {
          if (data && data.success) {
            logger.info(`[REACH-CH] Background task SUKSES [${emojis.join(', ')}] -> ${channelUrl} (IP: ${sessionIp})`);
          } else {
            logger.warn(`[REACH-CH] Background task GAGAL: ${data?.message || JSON.stringify(data)}`);
          }
        })
        .catch((err) => {
          logger.error(`[REACH-CH] Background task ERROR: ${err.message}`);
        });

      return res.status(200).json({
        status: true,
        message: "Reaction berhasil diterima dan sedang diproses di latar belakang!",
        result: {
          channelUrl,
          emojis,
          status: "processing",
          mode: "background"
        }
      });

    } catch (err) {
      logger.error(`[REACH-CH] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Terjadi kesalahan internal saat memproses reaksi"
      });
    }
  }
};
