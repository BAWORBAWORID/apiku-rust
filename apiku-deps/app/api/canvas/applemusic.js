/**
 * Apple Music Card Generator
 *
 * @route {GET|POST} /api/canvas/applemusic
 * @param {string} title - Judul lagu
 * @param {string} artist - Nama artis/penyanyi
 * @param {string} cover - URL foto sampul album
 * @param {string} current - Waktu saat ini (contoh: 2:40)
 * @param {string} total - Total durasi lagu (contoh: 04:11)
 * @param {number} progress - Persentase progress bar (0 - 100)
 * @param {string} color1 - Warna gradien kiri atas (hex/rgba)
 * @param {string} color2 - Warna gradien kanan bawah (hex/rgba)
 * @param {string} color3 - Warna gradien kanan atas (hex/rgba)
 */

import { createCanvas, loadImage, CanvasRenderingContext2D } from "canvas";
import axios from "axios";

// Polyfill roundRect untuk CanvasRenderingContext2D jika belum tersedia
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, radii) {
    const r = typeof radii === "number" ? radii : radii || 0;
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
  };
}

function drawIcon(ctx, type, x, y) {
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();

  if (type === "pause") {
    const w = 8,
      h = 34,
      gap = 12;
    ctx.roundRect(x - gap / 2 - w, y - h / 2, w, h, 3);
    ctx.roundRect(x + gap / 2, y - h / 2, w, h, 3);
  } else if (type === "next") {
    const size = 22,
      gap = 18;
    ctx.moveTo(x - gap, y - size / 2);
    ctx.lineTo(x, y);
    ctx.lineTo(x - gap, y + size / 2);
    ctx.moveTo(x, y - size / 2);
    ctx.lineTo(x + gap, y);
    ctx.lineTo(x, y + size / 2);
    ctx.roundRect(x + gap + 2, y - size / 2, 4, size, 2);
  } else if (type === "prev") {
    const size = 22,
      gap = 18;
    ctx.roundRect(x - gap - 6, y - size / 2, 4, size, 2);
    ctx.moveTo(x - gap, y);
    ctx.lineTo(x, y - size / 2);
    ctx.lineTo(x, y + size / 2);
    ctx.moveTo(x, y);
    ctx.lineTo(x + gap, y - size / 2);
    ctx.lineTo(x + gap, y + size / 2);
  }

  ctx.fill();
  ctx.closePath();
}

export default {
  name: "Apple Music Card Generator",
  description:
    "Membuat kartu visual pemutar lagu bergaya Apple Music modern dengan efek kaca (glassmorphism) dan mesh gradient",
  category: "Canvas",
  methods: ["GET", "POST"],
  params: [
    "title",
    "artist",
    "cover",
    "current",
    "total",
    "progress",
    "color1",
    "color2",
    "color3",
  ],
  paramsSchema: {
    title: {
      type: "string",
      required: false,
      description: "Judul lagu",
      example: "Always Alone",
    },
    artist: {
      type: "string",
      required: false,
      description: "Nama penyanyi/artis",
      example: "#Shn",
    },
    cover: {
      type: "string",
      required: false,
      description: "URL gambar sampul album (cover image)",
      example: "https://files.soonex.biz.id/cc0e64906c2c.png",
    },
    current: {
      type: "string",
      required: false,
      description: "Waktu putar saat ini",
      example: "2:40",
    },
    total: {
      type: "string",
      required: false,
      description: "Total durasi lagu",
      example: "04:11",
    },
    progress: {
      type: "number",
      required: false,
      description: "Persentase progress bar (0 - 100)",
      example: 53,
    },
    color1: {
      type: "string",
      required: false,
      description: "Warna gradien kiri atas",
      example: "#7b2cbf",
    },
    color2: {
      type: "string",
      required: false,
      description: "Warna gradien tengah/kanan",
      example: "#ff2a5f",
    },
    color3: {
      type: "string",
      required: false,
      description: "Warna gradien atas kanan",
      example: "#ff7e40",
    },
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const data = { ...req.query, ...req.body };

      const title = String(data.title || "Always Alone");
      const artist = String(data.artist || "#Shn");
      const coverUrl = String(
        data.cover || "https://files.soonex.biz.id/cc0e64906c2c.png"
      );
      const appleIconUrl =
        "https://img.icons8.com/ios-glyphs/60/ffffff/mac-os.png";
      const currentTime = String(data.current || "2:40");
      const totalTime = String(data.total || "04:11");
      const progressPercent = Math.min(
        100,
        Math.max(0, Number(data.progress ?? 53))
      );
      const color1 = String(data.color1 || "#7b2cbf");
      const color2 = String(data.color2 || "#ff2a5f");
      const color3 = String(data.color3 || "#ff7e40");

      const width = 1200;
      const height = 700;
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");

      // 1. Background dasar & Mesh Gradient
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, width, height);

      const grad1 = ctx.createRadialGradient(200, 350, 100, 300, 350, 900);
      grad1.addColorStop(0, color1);
      grad1.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad1;
      ctx.fillRect(0, 0, width, height);

      const grad2 = ctx.createRadialGradient(1000, 600, 50, 900, 500, 800);
      grad2.addColorStop(0, color2);
      grad2.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad2;
      ctx.fillRect(0, 0, width, height);

      const grad3 = ctx.createRadialGradient(1100, 100, 0, 900, 200, 700);
      grad3.addColorStop(0, color3);
      grad3.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad3;
      ctx.fillRect(0, 0, width, height);

      // 2. Kartu kaca (Glass Card)
      const cardW = 1000;
      const cardH = 460;
      const cardX = (width - cardW) / 2;
      const cardY = (height - cardH) / 2;
      const cardRadius = 36;

      ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
      ctx.shadowBlur = 50;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 20;

      ctx.beginPath();
      ctx.roundRect(cardX, cardY, cardW, cardH, cardRadius);
      ctx.fillStyle = "rgba(28, 28, 30, 0.65)";
      ctx.fill();

      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.stroke();

      // 3. Download Cover & Logo Apple Music
      let coverImg = null;
      let appleImg = null;

      try {
        const [coverRes, appleRes] = await Promise.all([
          axios
            .get(coverUrl, {
              responseType: "arraybuffer",
              headers: { "User-Agent": "Mozilla/5.0" },
              timeout: 10000,
            })
            .catch(() => null),
          axios
            .get(appleIconUrl, {
              responseType: "arraybuffer",
              headers: { "User-Agent": "Mozilla/5.0" },
              timeout: 8000,
            })
            .catch(() => null),
        ]);

        if (coverRes && coverRes.data) {
          coverImg = await loadImage(Buffer.from(coverRes.data)).catch(
            () => null
          );
        }
        if (appleRes && appleRes.data) {
          appleImg = await loadImage(Buffer.from(appleRes.data)).catch(
            () => null
          );
        }
      } catch (e) {}

      // 4. Album Cover di Kiri
      const albumSize = 360;
      const albumX = cardX + 50;
      const albumY = cardY + 50;
      const albumRadius = 24;

      ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
      ctx.shadowBlur = 25;
      ctx.shadowOffsetY = 12;

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(albumX, albumY, albumSize, albumSize, albumRadius);
      ctx.fillStyle = "#333";
      ctx.fill();

      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.clip();

      if (coverImg) {
        ctx.drawImage(coverImg, albumX, albumY, albumSize, albumSize);
      } else {
        ctx.fillStyle = "#444";
        ctx.fillRect(albumX, albumY, albumSize, albumSize);
        ctx.fillStyle = "#fff";
        ctx.font = "50px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("🎵", albumX + albumSize / 2, albumY + albumSize / 2);
      }
      ctx.restore();

      // 5. Keterangan Artis, Judul, & Logo Apple
      const detailX = albumX + albumSize + 60;
      const detailW = cardW - (detailX - cardX) - 50;

      ctx.textAlign = "left";
      ctx.textBaseline = "top";

      const logoY = albumY + 5;

      if (appleImg) {
        ctx.drawImage(appleImg, detailX, logoY - 2, 20, 20);
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.font = '18px "Helvetica Neue", Helvetica, Arial, sans-serif';
        ctx.fillText("Music", detailX + 26, logoY);
      } else {
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.font = "18px Arial";
        ctx.fillText("Apple Music", detailX, logoY);
      }

      const textY = logoY + 40;
      ctx.fillStyle = "#ffffff";
      ctx.font = 'bold 42px "Helvetica Neue", Helvetica, Arial, sans-serif';
      ctx.fillText(title.substring(0, 30), detailX, textY);

      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      ctx.font = '26px "Helvetica Neue", Helvetica, Arial, sans-serif';
      ctx.fillText(artist.substring(0, 40), detailX, textY + 55);

      // 6. Player Control Icons
      const controlY = textY + 160;
      const controlCenterX = detailX + detailW / 2;

      drawIcon(ctx, "prev", controlCenterX - 85, controlY);
      drawIcon(ctx, "pause", controlCenterX, controlY);
      drawIcon(ctx, "next", controlCenterX + 85, controlY);

      // 7. Progress Bar
      const barY = albumY + albumSize - 25;
      const barH = 6;

      ctx.beginPath();
      ctx.roundRect(detailX, barY, detailW, barH, barH / 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
      ctx.fill();

      const fillW = (progressPercent / 100) * detailW;
      ctx.beginPath();
      ctx.roundRect(detailX, barY, fillW, barH, barH / 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(detailX + fillW, barY + barH / 2, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();

      // 8. Waktu Lagu (Current & Total Time)
      const timeY = barY + 18;
      ctx.font = '14px "Helvetica Neue", Helvetica, Arial, sans-serif';
      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      ctx.textAlign = "left";
      ctx.fillText(currentTime, detailX, timeY);
      ctx.textAlign = "right";
      ctx.fillText(
        totalTime.startsWith("-") ? totalTime : "-" + totalTime,
        detailX + detailW,
        timeY
      );

      // Send Response Buffer PNG
      const buffer = canvas.toBuffer("image/png");
      const duration = Date.now() - startTime;

      res.setHeader("Content-Type", "image/png");
      res.setHeader(
        "Content-Disposition",
        'inline; filename="apple-music.png"'
      );
      res.setHeader("X-Generated-In", `${duration}ms`);

      return res.send(buffer);
    } catch (err) {
      if (res.headersSent) return res.end();
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal membuat gambar Apple Music Card",
      });
    }
  },
};
