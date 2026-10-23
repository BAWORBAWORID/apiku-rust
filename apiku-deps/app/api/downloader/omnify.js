/**
 * Omnify AIO Downloader — aio.omnifylabs.sbs
 * Feature: all-in-one resolver — TikTok, Instagram, YouTube, CapCut, Pinterest, Spotify,
 *          Apple Music, SoundCloud, GDrive, TeraBox, Mega, Pixiv, profile stalker
 * Upstream: api-aio.omnifylabs.sbs/api/v1/media/resolve (no auth)
 */
import axios from "axios";

const RESOLVE_URL = "https://api-aio.omnifylabs.sbs/api/v1/media/resolve";

async function resolveMedia(url) {
  const { data } = await axios.post(
    RESOLVE_URL,
    { url },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 90000,
    }
  );
  return data;
}

export default {
  name: "Omnify AIO",
  description:
    "All-in-one downloader (TikTok, Instagram, YouTube, CapCut, Pinterest, Spotify, GDrive, TeraBox, Mega, dll) — auto-detect platform",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL media (TikTok/IG/YouTube/CapCut/Spotify/dll)",
      default: "https://vt.tiktok.com/ZSbm6fY8P/",
      example: "https://vt.tiktok.com/ZSbm6fY8P/",
      minLength: 8,
    },
  },
  async run(req, res) {
    const { url } = { ...req.query, ...req.body };
    if (!url) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'url' wajib diisi",
      });
    }

    try {
      const data = await resolveMedia(url);
      if (data?.status !== "success") {
        return res.json({
          status: false,
          message:
            data?.data?.message || data?.message || "Gagal resolve media",
          platform: data?.platform || null,
        });
      }
      res.json({ status: true, result: data });
    } catch (err) {
      const msg =
        err.response?.data?.message ||
        err.response?.data ||
        err.message ||
        "Gagal menghubungi Omnify resolver";
      res.json({
        status: false,
        message: typeof msg === "string" ? msg : "Gagal menghubungi Omnify resolver",
      });
    }
  },
};
