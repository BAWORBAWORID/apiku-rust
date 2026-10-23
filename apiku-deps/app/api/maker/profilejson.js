import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../../src/utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INTER_FONT = path.join(__dirname, "assets", "iqc-dark", "fonts", "Inter-Regular.ttf");
const INTER_ALT = path.join(__dirname, "assets", "qcwa", "fonts", "Inter-Regular.ttf");

let fontsLoaded = false;
function registerOfflineFonts() {
  if (fontsLoaded) return;
  try {
    if (fs.existsSync(INTER_FONT)) {
      GlobalFonts.registerFromPath(INTER_FONT, "Inter");
    } else if (fs.existsSync(INTER_ALT)) {
      GlobalFonts.registerFromPath(INTER_ALT, "Inter");
    } else {
      logger.warn("[ProfileJSON] Inter font not found offline, text rendering may use system default.");
    }
    fontsLoaded = true;
  } catch (err) {
    logger.error(`[ProfileJSON] Failed to register font: ${err.message}`);
  }
}

function drawRow(ctx, key, value, y, last = false) {
  const keyX = 210;
  const colonX = 405;
  const valueX = 445;
  ctx.fillStyle = "#E06C75";
  ctx.fillText(`"${key}"`, keyX, y);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(":", colonX, y);
  ctx.fillStyle = "#98C379";
  ctx.fillText(`"${value}"`, valueX, y);
  if (!last) {
    const w = ctx.measureText(`"${value}"`).width;
    ctx.fillText(",", valueX + w + 5, y);
  }
}

function generateProfileJSON({ name, title, email, link }) {
  registerOfflineFonts();

  const width = 1200;
  const height = 700;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#f5f2ea";
  ctx.fillRect(0, 0, width, height);

  ctx.shadowColor = "rgba(0,0,0,.25)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;

  const x = 120, y = 120, w = 960, h = 430, r = 35;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = "#202433";
  ctx.fill();
  ctx.shadowBlur = 0;

  ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(200 + i * 45, 170, 14, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  });

  ctx.font = "34px Inter";
  ctx.fillStyle = "#cfcfcf";
  ctx.textAlign = "center";
  ctx.fillText("aboutme.json", width / 2, 180);
  ctx.textAlign = "left";

  ctx.font = "bold 40px Inter";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText("{", 160, 245);

  drawRow(ctx, "name", name, 285);
  drawRow(ctx, "title", title, 345);
  drawRow(ctx, "email", email, 405);
  drawRow(ctx, "link", link, 465, true);

  ctx.fillStyle = "#FFFFFF";
  ctx.fillText("}", 165, 510);

  return canvas.toBuffer("image/png");
}

export default {
  name: "Profile JSON Card",
  description: "Generate a macOS-style code editor card showing your profile as a JSON object",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["name", "title", "email", "link"],
  paramsSchema: {
    name: {
      type: "string",
      required: true,
      description: "Nama lengkap",
      example: "Zyvor"
    },
    title: {
      type: "string",
      required: true,
      description: "Jabatan atau title",
      example: "Development"
    },
    email: {
      type: "string",
      required: true,
      description: "Alamat email",
      example: "contact@zyvor.my.id"
    },
    link: {
      type: "string",
      required: true,
      description: "URL atau link personal",
      example: "https://api.zyvor.my.id"
    }
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const data = { ...req.query, ...req.body };
      const result = generateProfileJSON({
        name: data.name || "Zyvor",
        title: data.title || "Development",
        email: data.email || "contact@zyvor.my.id",
        link: data.link || "https://api.zyvor.my.id"
      });
      const duration = Date.now() - startTime;

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", result.length);
      res.setHeader("X-Generated-In", `${duration}ms`);
      return res.send(result);
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[ProfileJSON] Error after ${duration}ms: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Failed generating Profile JSON card"
      });
    }
  }
};
