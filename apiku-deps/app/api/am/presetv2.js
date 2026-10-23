/**
 * AlightMotion (AM) Preset Finder v2
 * Provider: BintangAPI AMFind Engine
 * Features: Auto-scan caption, bio, and comments for Alight Motion XML & 5MB share links, with full video metadata & stream URLs
 */

import axios from "axios";
import logger from "../../src/utils/logger.js";

async function findPresetV2(url) {
  const { data } = await axios.get("https://bintangapi.my.id/api/amfind/", {
    params: { url },
    headers: {
      Accept: "*/*",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      Connection: "keep-alive",
      Origin: "https://starlabs.biz.id",
      Referer: "https://starlabs.biz.id/",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site",
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
      "sec-ch-ua": '"Chromium";v="139", "Not;A=Brand";v="99"',
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Android"',
    },
    timeout: 60000,
  });

  return data;
}

export default {
  name: "AlightMotion Preset Finder v2",
  description:
    "Cari link preset Alight Motion (5MB/XML) dari video TikTok — memindai deskripsi, bio akun, dan komentar video secara otomatis",
  category: "AlightMotion",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL video TikTok (vt.tiktok.com atau tiktok.com/@user/video/...)",
      default: "https://vt.tiktok.com/ZSbm87nak/",
      example: "https://vt.tiktok.com/ZSbm87nak/",
    },
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body };
    const inputUrl = String(params.url || params.link || "").trim();

    if (!inputUrl) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'url' wajib diisi (URL video TikTok)",
      });
    }

    if (!/tiktok\.com/i.test(inputUrl)) {
      return res.status(400).json({
        status: false,
        message: "URL tidak valid. Masukkan URL video TikTok yang benar.",
      });
    }

    logger.info(`[AM Preset v2] Mencari preset untuk URL: ${inputUrl}`);

    try {
      const upstream = await findPresetV2(inputUrl);

      if (!upstream || !upstream.success) {
        return res.status(404).json({
          status: false,
          message: upstream?.message || "Preset Alight Motion tidak ditemukan untuk video ini",
        });
      }

      const d = upstream.data || {};
      const presetItems = d.preset?.items || [];
      const isFound = presetItems.length > 0;

      return res.status(200).json({
        status: true,
        found: isFound,
        message: isFound
          ? "Preset Alight Motion berhasil ditemukan"
          : "Preset tidak ditemukan pada video ini",
        result: {
          query_url: d.query_url || inputUrl,
          found_in: d.found_in || null,
          source: d.source || null,
          presets: presetItems,
          preset_info: d.preset || null,
          total_comments_scanned: d.total_comments_scanned || 0,
          video: d.video
            ? {
                id: d.video.id,
                caption: d.video.caption,
                duration: d.video.duration,
                views: d.video.views,
                likes: d.video.likes,
                comments: d.video.comments,
                shares: d.video.shares,
                created_at: d.video.created_at,
                play_url: d.video.play_url,
                play_hd_url: d.video.play_hd_url,
                play_wm_url: d.video.play_wm_url,
                audio_url: d.video.audio_url,
                url: d.video.url,
              }
            : null,
          user: d.user || null,
          thumbnail: d.thumbnail || null,
        },
      });
    } catch (err) {
      logger.error(`[AM Preset v2] Error: ${err.message}`);
      const errorMsg =
        err.response?.data?.message ||
        err.message ||
        "Gagal memproses pencarian preset Alight Motion";
      return res.status(500).json({
        status: false,
        message: errorMsg,
      });
    }
  },
};
