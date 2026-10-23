/**
 * YouTube Downloader v4 — via scriptmind.co media resolver
 * Feature: resolve YouTube video → tunnel streams (video+audio) → auto merge ffmpeg → MP4
 * Upstream: scriptmind.co/api/media/resolve/preview
 */
import axios from "axios";
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const RESOLVE_URL = "https://scriptmind.co/api/media/resolve/preview";

async function resolvePreview(url) {
  const response = await axios.post(
    RESOLVE_URL,
    {
      url,
      platform: "youtube",
      pageType: "video",
      guestId: crypto.randomUUID(),
    },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 60000,
    }
  );
  return response.data;
}

function parseResolvedMedia(data) {
  try {
    if (!data) return null;
    if (typeof data === "string") return JSON.parse(data);
    if (typeof data === "object") return data;
  } catch {
    return null;
  }
  return null;
}

async function downloadToFile(url, dest) {
  const response = await axios.get(url, { responseType: "stream", timeout: 300000 });
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(dest);
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
    response.data.on("error", reject);
  });
}

function buildMeta(data, resolved) {
  return {
    title: data.title || null,
    duration: data.duration || null,
    canonicalUrl: data.canonicalUrl || null,
    platform: data.platform || "youtube",
    mediaApiToken: data.mediaApiToken || null,
    resolvedStatus: resolved?.status || null,
    resolveType: resolved?.type || null,
    outputType: resolved?.output?.type || null,
    filename: resolved?.output?.filename || null,
    tunnels: resolved?.tunnel || [],
  };
}

export default {
  name: "YouTube Downloader v4",
  description:
    "Download video YouTube — auto merge video+audio (ffmpeg) jadi MP4. Param json=1 untuk metadata saja.",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url", "json"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL YouTube (youtu.be / youtube.com/watch)",
      example: "https://youtu.be/ObuP-wH0ghA",
      minLength: 10,
    },
    json: {
      type: "string",
      required: false,
      description: "Jika '1', return metadata + tunnel URLs tanpa merge (cepat)",
      enum: ["0", "1"],
      default: "0",
    },
  },
  async run(req, res) {
    const { url, json } = { ...req.query, ...req.body };
    if (!url) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'url' wajib diisi",
      });
    }

    let data;
    try {
      data = await resolvePreview(url);
    } catch (err) {
      const msg =
        err.response?.data?.message || err.response?.data || err.message;
      return res.json({ status: false, message: `Gagal resolve video: ${msg}` });
    }

    if (!data?.success || !data?.result) {
      return res.json({
        status: false,
        message: data?.message || "Gagal resolve video dari scriptmind.co",
      });
    }

    const resolved = parseResolvedMedia(data.result.resolvedMediaJson);
    const meta = buildMeta(data.result, resolved);

    if (json === "1") {
      return res.json({ status: true, result: meta });
    }

    const tunnels = Array.isArray(resolved?.tunnel) ? resolved.tunnel.filter(Boolean) : [];
    if (tunnels.length === 0) {
      return res.json({
        status: false,
        message: "Tidak ada tunnel stream yang tersedia untuk video ini",
        meta,
      });
    }

    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "yt4-"));
    try {
      // Single tunnel (already merged / audio only) → langsung kirim
      if (tunnels.length === 1) {
        const singlePath = path.join(tmpDir, "single.mp4");
        await downloadToFile(tunnels[0], singlePath);
        const buf = fs.readFileSync(singlePath);
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Disposition", `inline; filename="youtube.mp4"`);
        return res.send(buf);
      }

      // Dua tunnel (video + audio) → merge via ffmpeg
      const videoPath = path.join(tmpDir, "video.mp4");
      const audioPath = path.join(tmpDir, "audio.m4a");
      const outputPath = path.join(tmpDir, "output.mp4");

      await Promise.all([
        downloadToFile(tunnels[0], videoPath),
        downloadToFile(tunnels[1], audioPath),
      ]);

      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-i", videoPath,
          "-i", audioPath,
          "-map", "0:v:0",
          "-map", "1:a:0",
          "-c", "copy",
          "-movflags", "+faststart",
          outputPath,
        ],
        { maxBuffer: 1024 * 1024 * 50 }
      );

      const videoBuffer = fs.readFileSync(outputPath);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", `inline; filename="youtube.mp4"`);
      return res.send(videoBuffer);
    } catch (err) {
      return res.json({
        status: false,
        message: `Gagal memproses video: ${err.message}`,
        meta,
      });
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  },
};
