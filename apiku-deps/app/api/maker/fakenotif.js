import { createCanvas, loadImage, registerFont } from "canvas";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../../src/utils/logger.js";

// ==================== ASSET PATHS (offline-first, per-endpoint) ====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.join(__dirname, "assets", "fakenotif");

// ==================== FONT REGISTRATION (offline-first, per-endpoint only) ====================
const fontCandidates = [
  { path: path.join(ASSETS_DIR, "Poppins-SemiBold.ttf"), family: "Poppins SemiBold" },
  { path: path.join(ASSETS_DIR, "Poppins-Regular.ttf"), family: "Poppins" },
  { path: path.join(ASSETS_DIR, "HelveticaNeueMed.ttf"), family: "HelveticaNeueMed" }
];

let fontLoaded = false;
let fontRegular = "sans-serif";
let fontSemiBold = "sans-serif";

for (const font of fontCandidates) {
  if (!fs.existsSync(font.path)) continue;
  try {
    registerFont(font.path, { family: font.family });
    if (font.family === "Poppins") fontRegular = "Poppins";
    if (font.family === "Poppins SemiBold") fontSemiBold = `"Poppins SemiBold"`;
    if (font.family === "HelveticaNeueMed") {
      if (fontRegular === "sans-serif") fontRegular = "HelveticaNeueMed";
      if (fontSemiBold === "sans-serif") fontSemiBold = "HelveticaNeueMed";
    }
    fontLoaded = true;
  } catch (err) {
    logger.error(`[FakeNotif] Failed to register font ${font.path}: ${err.message}`);
  }
}

// Helpers
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    const metrics = ctx.measureText(testLine);

    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line, x, y);
      line = words[n] + " ";
      y += lineHeight;
    } else {
      line = testLine;
    }
  }

  ctx.fillText(line, x, y);
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);

  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);

  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(
    x + width,
    y + height,
    x + width - radius,
    y + height
  );

  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(
    x,
    y + height,
    x,
    y + height - radius
  );

  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);

  ctx.closePath();
}

export default {
  name: "Fake Whatsapp Notification Generator",
  description: "Generate a fake Whatsapp notification meme with custom name and message",
  category: "Maker",
  methods: ["GET"],
  params: ["name", "message"],
  paramsSchema: {
    name: {
      type: "string",
      required: true,
      description: "Nama pengirim notifikasi",
      example: "temen asu"
    },
    message: {
      type: "string",
      required: true,
      description: "Isi pesan notifikasi",
      example: "login woi -1 jungler ini"
    }
  },

  async run(req, res) {
    const { name, message } = { ...req.query, ...req.body };

    if (!name || !String(name).trim()) {
      return res.status(400).json({ status: false, message: "Parameter 'name' wajib diisi" });
    }
    if (!message || !String(message).trim()) {
      return res.status(400).json({ status: false, message: "Parameter 'message' wajib diisi" });
    }

    const startTime = Date.now();

    try {
      const width = 900;
      const height = 260;

      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");

      // Background
      ctx.fillStyle = "#ece5dd";
      ctx.fillRect(0, 0, width, height);

      // Shadow
      ctx.shadowColor = "rgba(0,0,0,0.15)";
      ctx.shadowBlur = 15;
      ctx.shadowOffsetY = 4;

      // Card
      ctx.fillStyle = "#ffffff";
      roundRect(ctx, 20, 20, width - 40, 180, 20);
      ctx.fill();

      // Reset shadow
      ctx.shadowColor = "transparent";

      // Header
      ctx.fillStyle = "#075E54";
      roundRect(ctx, 20, 20, width - 40, 60, 20);
      ctx.fill();

      // Perbaiki sudut bawah header
      ctx.fillRect(20, 50, width - 40, 30);

      // Avatar sejajar
      ctx.beginPath();
      ctx.arc(55, 50, 16, 0, Math.PI * 2);
      ctx.fillStyle = "#25D366";
      ctx.fill();

      const nameX = 40;
      const nameY = 105;

      const messageX = 40;
      const messageY = 135;

      const nameSize = 22;
      const messageSize = 18;

      ctx.fillStyle = "#111111";
      ctx.font = `600 ${nameSize}px ${fontSemiBold}`;
      ctx.textBaseline = "top";
      ctx.fillText(name, nameX, nameY);

      ctx.fillStyle = "#555555";
      ctx.font = `${messageSize}px ${fontRegular}`;

      wrapText(
        ctx,
        message,
        messageX,
        messageY,
        width - 80,
        28
      );

      // Output as JPEG
      const buffer = canvas.toBuffer("image/jpeg", { quality: 0.95 });
      const duration = Date.now() - startTime;
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("X-Generated-In", `${duration}ms`);
      res.setHeader("X-FakeNotif-Name", encodeURIComponent(name));
      res.setHeader("X-FakeNotif-Message", encodeURIComponent(message));
      return res.send(buffer);

    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[FakeNotif] Generation failed after ${duration}ms: ${err.message}`);

      let status = 500;
      return res.status(status).json({
        status: false,
        message: err.message || "Failed to generate notification image"
      });
    }
  }
};
