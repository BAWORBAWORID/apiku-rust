import { createCanvas, loadImage } from "canvas";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../../src/utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATE_PATH = path.join(__dirname, "assets", "fake-nokia", "template.jpg");

function wrapLine(ctx, text, maxWidth) {
  const words = text.split(" ");
  const wrapped = [];
  let current = "";
  for (const word of words) {
    const test = current ? current + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      wrapped.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) wrapped.push(current);
  return wrapped.length ? wrapped : [text];
}

export default {
  name: "Fake Nokia Message",
  description: "Generate a Fake Nokia (Old Phone) Message Screenshot with custom text",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["text"],
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Isi pesan yang tampil di layar Nokia",
      example: "jatuh cinta boleh alasan jangan just friend",
      minLength: 1,
      maxLength: 500
    }
  },

  async run(req, res) {
    const { text } = { ...req.query, ...req.body };

    if (!text) {
      return res.status(400).json({ status: false, message: "Parameter 'text' wajib diisi" });
    }

    const PESAN = String(text).trim();
    const startTime = Date.now();

    try {
      if (!fs.existsSync(TEMPLATE_PATH)) {
        throw new Error("Template missing. Place template.jpg in api/maker/assets/fake-nokia/.");
      }

      const templateBuffer = await fs.promises.readFile(TEMPLATE_PATH);
      const bg = await loadImage(templateBuffer);
      const W = bg.width;
      const H = bg.height;

      const canvas = createCanvas(W, H);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bg, 0, 0, W, H);

      const BOX_X = W * 0.083;
      const BOX_Y = H * 0.340;
      const BOX_W = W * 0.850;
      const BOX_H = H * 0.250;

      const FIXED_FONT = Math.floor(H * 0.045);
      const MIN_FONT = 14;

      let fontSize = FIXED_FONT;
      let wrappedLines = [];

      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#111111";

      while (fontSize >= MIN_FONT) {
        ctx.font = `bold ${fontSize}px Arial`;
        wrappedLines = wrapLine(ctx, PESAN, BOX_W);
        const lineH = fontSize * 1.30;
        const totalH = wrappedLines.length * lineH;
        if (totalH <= BOX_H) break;
        fontSize -= 2;
      }

      const lineHeight = fontSize * 1.30;
      const startY = BOX_Y + (BOX_H - (wrappedLines.length * lineHeight)) / 2;

      ctx.save();
      ctx.beginPath();
      ctx.rect(BOX_X, BOX_Y, BOX_W, BOX_H);
      ctx.clip();

      ctx.font = `bold ${fontSize}px Arial`;
      wrappedLines.forEach((line, i) => {
        const y = startY + (i * lineHeight);
        if (y > BOX_Y + BOX_H - lineHeight) return;
        ctx.fillText(line, BOX_X, y);
      });
      ctx.restore();

      const buffer = canvas.toBuffer("image/jpeg", { quality: 0.95 });
      const duration = Date.now() - startTime;

      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("X-Generated-In", `${duration}ms`);
      return res.send(buffer);

    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[FakeNokia] Generation failed after ${duration}ms: ${err.message}`);
      return res.status(500).json({ status: false, message: `Gagal generate gambar: ${err.message}` });
    }
  }
};
