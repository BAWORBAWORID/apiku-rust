import axios from "axios";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function extractState(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("Tidak dapat menemukan __NEXT_DATA__ di halaman");
  const state = JSON.parse(m[1]);
  const trackInfo = state?.props?.pageProps?.data?.trackInfo?.data;
  if (!trackInfo) throw new Error("Track info tidak ditemukan");
  return trackInfo;
}

async function musixmatchScrape(url) {
  const { data: html } = await axios.get(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    timeout: 30000,
  });

  const trackInfo = extractState(html);
  const lyrics = trackInfo.lyrics?.body || null;
  const track = trackInfo.track || {};

  return {
    title: track.name || null,
    artist: track.artistName || null,
    album: track.albumName || null,
    language: trackInfo.lyrics?.languageDescription || null,
    image: track.coverImageHD || track.coverImage || null,
    lyrics,
    url,
  };
}

export default {
  name: "Musixmatch Lyrics",
  description: "Scrape lirik lagu & metadata dari Musixmatch",
  category: "Search",
  methods: ["GET", "POST"],

  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL lirik Musixmatch (contoh: https://www.musixmatch.com/lyrics/Artist/Title)",
      example: "https://www.musixmatch.com/lyrics/Justin-Bieber-feat-Nicki-Minaj/Beauty-and-a-Beat",
    },
  },

  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body };

      if (!url || !url.trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
        });
      }

      if (!url.includes("musixmatch.com/lyrics/")) {
        return res.status(400).json({
          status: false,
          message: "URL harus dari domain musixmatch.com/lyrics/",
        });
      }

      const result = await musixmatchScrape(url.trim());

      return res.json({
        status: true,
        result,
      });
    } catch (e) {
      return res.status(500).json({
        status: false,
        message: e.message || "Gagal scrape Musixmatch",
      });
    }
  }
};