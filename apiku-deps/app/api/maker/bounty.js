import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, "assets/bounty");
const BG_PATH = path.join(ASSETS, "bg.jpg");
const FONT_PATH = path.join(__dirname, "assets/fakeboard/fonts/Poppins-Bold.ttf");

if (existsSync(FONT_PATH)) {
  GlobalFonts.registerFromPath(FONT_PATH, "Poppins");
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function generate(imageUrl, text) {
  const bg = await loadImage(BG_PATH);
  const poster = await loadImage(imageUrl);

  const canvas = createCanvas(bg.width, bg.height);
  const ctx = canvas.getContext("2d");

  ctx.drawImage(bg, 0, 0);

  const imgX = 35;
  const imgY = 125;
  const imgW = 340;
  const imgH = 260;
  ctx.drawImage(poster, imgX, imgY, imgW, imgH);

  const textX = canvas.width / 2;
  const textY = 470;
  const maxWidth = 400;
  const minFont = 28;
  let fontSize = 38;

  do {
    ctx.font = `${fontSize}px Poppins`;
    const lines = wrapText(ctx, text.toUpperCase(), maxWidth);
    if (lines.length <= 2 && lines.every((l) => ctx.measureText(l).width <= maxWidth)) {
      break;
    }
    fontSize -= 2;
  } while (fontSize > minFont);

  ctx.font = `${fontSize}px Poppins`;
  const lines = wrapText(ctx, text.toUpperCase(), maxWidth);

  ctx.fillStyle = "#2b1b11";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lineHeight = fontSize + 8;
  let startY = textY - ((lines.length - 1) * lineHeight) / 2;

  for (const line of lines) {
    ctx.fillText(line, textX, startY);
    startY += lineHeight;
  }

  return canvas.encode("png");
}

export default {
  name: "Fake Bounty",
  description: "Buat poster bounty palsu dengan foto dan teks custom",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["image", "text"],

  paramsSchema: {
    image: {
      type: "string",
      required: true,
      description: "URL gambar yang akan ditempel di poster",
      example: "https://example.com/photo.jpg",
    },
    text: {
      type: "string",
      required: true,
      description: "Teks bounty (maks 2 baris)",
      example: "Heisenberg",
    },
  },

  async run(req, res) {
    const { image, text } = { ...req.query, ...req.body };

    if (!image || !text) {
      return res.status(400).json({ status: false, message: "Parameter 'image' dan 'text' wajib diisi" });
    }

    try {
      const buffer = await generate(image, text.trim());
      res.setHeader("Content-Type", "image/png");
      res.send(buffer);
    } catch (err) {
      res.status(500).json({ status: false, message: err.message || "Gagal generate bounty" });
    }
  },
};
