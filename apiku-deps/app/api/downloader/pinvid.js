import { CookieJar } from "tough-cookie";
import { download } from "node-hls-downloader";
import fs from "fs";
import { execSync } from "child_process";
import path from "path";
import os from "os";

// --- DOWNLOAD FUNCTION ---
async function downloadPinterestVideo(masterUrl) {
  const timestamp = Date.now();
  const tmpDir = os.tmpdir();
  const videoTemp = path.join(tmpDir, `${timestamp}_v.mp4`);
  const audioTemp = path.join(tmpDir, `${timestamp}_a.mp4`);
  const outputFile = path.join(tmpDir, `${timestamp}_final.mp4`);

  const baseUrl = masterUrl.substring(0, masterUrl.lastIndexOf("/") + 1);
  const res = await fetch(masterUrl);
  const text = await res.text();
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  let videoStreamUrl = null;
  let audioStreamUrl = null;
  let lastBandwidth = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
      const bw = parseInt(lines[i].match(/BANDWIDTH=(\d+)/)?.[1] || "0");
      if (bw > lastBandwidth) {
        lastBandwidth = bw;
        const u = lines[i + 1];
        videoStreamUrl = u?.startsWith("http") ? u : baseUrl + u;
      }
    }
    if (lines[i].startsWith("#EXT-X-MEDIA") && lines[i].includes("TYPE=AUDIO")) {
      const m = lines[i].match(/URI="([^"]+)"/);
      if (m) audioStreamUrl = m[1].startsWith("http") ? m[1] : baseUrl + m[1];
    }
  }

  if (!videoStreamUrl) {
    await download({ concurrency: 10, outputFile, streamUrl: masterUrl, mergeUsingFFmpeg: false });
  } else {
    await download({ concurrency: 10, outputFile: videoTemp, streamUrl: videoStreamUrl, mergeUsingFFmpeg: false });

    if (audioStreamUrl) {
      await download({ concurrency: 10, outputFile: audioTemp, streamUrl: audioStreamUrl, mergeUsingFFmpeg: false });
      execSync(`ffmpeg -i "${videoTemp}" -i "${audioTemp}" -c copy "${outputFile}" -y`, { stdio: "ignore" });
      if (fs.existsSync(videoTemp)) fs.unlinkSync(videoTemp);
      if (fs.existsSync(audioTemp)) fs.unlinkSync(audioTemp);
    } else {
      fs.renameSync(videoTemp, outputFile);
    }
  }

  return outputFile;
}

const DEFAULT_URL = "https://v1.pinimg.com/videos/iht/hls/92/58/86/925886235961044085bc5c48ca2875e2.m3u8";

export default {
  name: "Pinterest Video Downloader",
  description: "Download video Pinterest dari URL .m3u8 (hasil search /api/search/pinvid-search) menjadi MP4 via ffmpeg.",
  category: "Downloader",
  badge: "NEW",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      default: DEFAULT_URL,
      description: "URL video .m3u8 dari Pinterest (dapatkan dari /api/search/pinvid-search).",
    },
  },

  async run(req, res) {
    try {
      const url = req.query?.url || req.body?.url || DEFAULT_URL;

      if (!url) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' (.m3u8) wajib diisi.",
        });
      }

      if (!url.includes(".m3u8")) {
        return res.status(400).json({
          status: false,
          message: "URL yang dimasukkan harus berformat .m3u8 (dapatkan dari hasil search /api/search/pinvid-search).",
        });
      }

      const filePath = await downloadPinterestVideo(url);

      return res.download(filePath, "Pinterest_Video.mp4", (err) => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });

    } catch (err) {
      console.error("[Pintrest Vid Error]", err.message);
      res.status(500).json({
        status: false,
        message: err.message || "Terjadi kesalahan internal.",
      });
    }
  },
};
