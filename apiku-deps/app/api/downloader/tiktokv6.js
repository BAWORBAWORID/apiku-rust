import logger from "../../src/utils/logger.js";

const API = "https://ttdl.zone.id/api/tiktok";
const OEMBED = "https://www.tiktok.com/oembed";
const TIMEOUT_MS = 25000;

const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
];

function apiHeaders(i) {
  return {
    "User-Agent": UAS[i % UAS.length],
    Accept: "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://ttdl.zone.id/",
  };
}

/** Validasi format link TikTok (terima vt.tiktok.com & tt.site short link). */
async function parseTiktokUrl(input) {
  let s = String(input || "").trim();
  if (!/^(https?:\/\/)?([\w-]+\.)?(tiktok\.com|tt\.site)\//i.test(s)) {
    throw new Error(
      "Bukan link TikTok. Contoh: https://vt.tiktok.com/ZSbM4DXTu/ atau https://www.tiktok.com/@user/video/123"
    );
  }
  if (!s.startsWith("http")) s = `https://${s}`;
  if (s.includes("tt.site") || s.includes("vt.tiktok.com") || s.includes("vm.tiktok.com")) {
    try {
      const head = await fetch(s, { method: "HEAD", redirect: "follow" });
      if (head.url) s = head.url;
    } catch {}
  }
  return s;
}

/**
 * Ground truth dari oEmbed resmi TikTok (gratis, tanpa key).
 * Mengembalikan null kalau oEmbed tidak bisa dihubungi — TikTok sering
 * membalas 429 "ratelimit triggered" ke IP datacenter, dan itu BUKAN
 * tanda video mati. Validasi silang hanya jalan kalau oEmbed tersedia.
 */
async function oembedTruth(url) {
  try {
    const res = await fetch(`${OEMBED}?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent": UAS[0],
        Accept: "application/json",
        Referer: "https://www.tiktok.com/",
      },
    });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    const html = String(j?.html || "");
    return {
      id: html.match(/data-video-id="(\d+)"/)?.[1] || null,
      username: (j?.author_url?.match(/@([^/]+)/)?.[1] || "").toLowerCase() || null,
      title: j?.title || "",
    };
  } catch {
    return null;
  }
}

/**
 * Info + link download. Divalidasi silang terhadap oEmbed: kalau author/id
 * dari API tidak cocok, berarti URL mati (API balas ok:true + konten acak).
 */
async function getTiktokInfo(input) {
  const url = await parseTiktokUrl(input);
  const truth = await oembedTruth(url);

  let res = await fetch(`${API}?url=${encodeURIComponent(url)}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: apiHeaders(0),
  });

  if (!res.ok && (res.status === 403 || res.status === 429)) {
    res = await fetch(`${API}?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: apiHeaders(1),
    });
  }

  if (!res.ok) throw new Error(`Server downloader sedang sibuk (HTTP ${res.status}).`);

  const body = await res.json().catch(() => null);
  if (!body?.ok || !body?.data) throw new Error(body?.error || "Gagal mengambil data.");

  const d = body.data;
  const gotUser = String(d.author?.username || "").toLowerCase();
  const gotId = String(d.video?.id || d.photo?.id || "");

  if (
    (truth?.username && gotUser && gotUser !== truth.username) ||
    (truth?.id && gotId && gotId !== truth.id)
  ) {
    throw new Error("Video tidak ditemukan atau sudah dihapus.");
  }

  const s = d.statistics || {};

  const info = {
    id: gotId || truth?.id || null,
    type: d.type,
    verified: truth ? "oembed" : "api-only",
    author: {
      username: d.author?.username || truth?.username || null,
      nickname: d.author?.nickname || "",
      region: d.author?.region || null,
      avatar: d.author?.avatar || null,
      signature: d.author?.signature || null,
    },
    desc: d.video?.desc ?? d.photo?.desc ?? truth?.title ?? "",
    statistics: {
      play: s.play_count ?? null,
      like: s.digg_count ?? null,
      comment: s.comment_count ?? null,
      share: s.share_count ?? null,
      download: s.download_count ?? null,
    },
    video: d.video
      ? {
          duration: d.video.duration,
          size: d.video.size,
          cover: d.video.thumbnail,
          nowm: d.video.download_nowm,
          wm: d.video.download_wm,
          stream: d.video.stream,
        }
      : null,
    photos: Array.isArray(d.photo?.images)
      ? d.photo.images
          .filter((p) => p?.download)
          .map((p, i) => ({ index: i + 1, view: p.view, download: p.download }))
      : [],
    music: d.music?.download
      ? { title: d.music.title || "", author: d.music.author || "", download: d.music.download }
      : null,
  };

  // Ringkasan link siap-pakai, supaya pemanggil tidak perlu tahu bentuk
  // tiap varyen. Prioritas: video no-watermark > foto pertama > audio.
  const main = info.video?.nowm
    ? { type: "video", url: info.video.nowm, size: info.video.size }
    : info.photos.length
      ? { type: "photo", url: info.photos[0].download, size: null }
      : info.music
        ? { type: "audio", url: info.music.download, size: null }
        : null;

  info.download = main;
  info.downloads = {
    video: info.video?.nowm || null,
    audio: info.music?.download || null,
    photos: info.photos.map((p) => p.download),
  };

  // Tanpa oEmbed tidak ada yang mengonfirmasi link ini hidup. Upstream
  // balas ok:true + konten acak milik orang lain untuk URL mati, jadi
  // tandai eksplisit supaya pemanggil tidak memercayai datanya.
  if (!truth) {
    info.warning =
      "Tidak tervalidasi: oEmbed TikTok tidak bisa dihubungi (rate limit), sehingga link ini tidak dicek apakah masih hidup. Data di bawah bisa jadi konten acak milik akun lain.";
  }

  return info;
}

export default {
  name: "TikTok Downloader v6",
  description:
    "TikTok downloader dengan validasi silang oEmbed (deteksi dead link), plus dukungan video no-watermark, foto slideshow, dan audio MP3 terpisah",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "TikTok URL (vt.tiktok.com, www.tiktok.com/@user/video/123, dll)",
      default: "https://vt.tiktok.com/ZSbm6fY8P/",
      example: "https://vt.tiktok.com/ZSbm6fY8P/",
    },
  },

  async run(req, res) {
    const { url } = { ...req.query, ...req.body };

    try {
      if (!url || typeof url !== "string" || !url.trim()) {
        return res.status(400).json({ status: false, error: "Parameter 'url' wajib diisi" });
      }

      let info;
      try {
        info = await getTiktokInfo(url);
      } catch (e) {
        if (/Bukan link TikTok/.test(e.message)) {
          return res.status(400).json({ status: false, error: e.message });
        }
        throw e;
      }

      return res.json({ status: true, result: info });
    } catch (err) {
      logger.error(`[TikTok v6] Error: ${err.message}`);
      return res.status(500).json({ status: false, error: err.message });
    }
  },
};
