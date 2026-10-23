/**
 * Endpoint Downloader Multi-Platform (All-in-One v3)
 */

async function resolveUrl(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
    return res.url || url;
  } catch {
    return url;
  }
}

function detectPlatform(url) {
  const lower = url.toLowerCase();
  if (lower.includes('tiktok.com') || lower.includes('douyin.com')) return 'tiktok';
  if (lower.includes('instagram.com')) return 'instagram';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('facebook.com') || lower.includes('fb.watch') || lower.includes('fb.com')) return 'facebook';
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'twitter';
  if (lower.includes('threads.net')) return 'threads';
  if (lower.includes('pinterest.com') || lower.includes('pin.it')) return 'pinterest';
  if (lower.includes('spotify.com')) return 'spotify';
  if (lower.includes('soundcloud.com')) return 'soundcloud';
  if (lower.includes('capcut.com')) return 'capcut';
  if (lower.includes('snackvideo.com')) return 'snackvideo';
  if (lower.includes('linkedin.com')) return 'linkedin';
  return 'tiktok';
}

export default {
  name: "All-In-One Downloader v3",
  description: "Unduh media video, audio, dan foto dari berbagai platform populer seperti TikTok, Instagram, YouTube, Facebook, Twitter, Threads, Pinterest, dan lainnya",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "Tautan URL media yang ingin diunduh",
      example: "https://www.tiktok.com/@tiktok/video/7106594312292453675"
    },
    platform: {
      type: "string",
      required: false,
      description: "Platform media (opsional, auto-detect jika tidak diisi): tiktok, instagram, youtube, facebook, twitter, threads, pinterest, spotify, soundcloud, capcut, snackvideo, linkedin",
      example: "tiktok"
    }
  },
  async run(req, res) {
    const { url, platform } = { ...req.query, ...req.body };

    if (!url) {
      return res.status(400).json({
        status: false,
        error: "Parameter 'url' wajib diisi."
      });
    }

    try {
      const targetUrl = await resolveUrl(url);
      const selectedPlatform = platform || detectPlatform(targetUrl);
      const targetApi = `https://www.downloadin.web.id/api/download-proxy?platform=${encodeURIComponent(selectedPlatform)}&url=${encodeURIComponent(targetUrl)}`;

      const response = await fetch(targetApi, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Referer": "https://www.downloadin.web.id/",
          "Origin": "https://www.downloadin.web.id",
          "Accept": "application/json, text/plain, */*"
        }
      });

      if (!response.ok) {
        return res.status(response.status).json({
          status: false,
          error: `Gagal mengambil data media (HTTP ${response.status})`
        });
      }

      const result = await response.json();

      return res.json({
        status: true,
        platform: selectedPlatform,
        result
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        error: err.message || "Terjadi kesalahan pada server saat memproses unduhan."
      });
    }
  }
};
