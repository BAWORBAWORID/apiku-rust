import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createCanvas, loadImage } from "canvas";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKGROUND = path.join(__dirname, "assets", "afinitas-ml", "background.png");

const CANVAS_W = 941;
const CANVAS_H = 1672;

const PP_BOX = { x: 337.5, y: 694, w: 264, h: 270.1 };

const DEFAULT_AVATAR = "https://i.pinimg.com/736x/da/9f/76/da9f7672bc9e54a99c634a72bb9479b5.jpg";

export default {
  name: "Fake Afinitas ML",
  description: "Generate fake Mobile Legends affinity/bond card with profile picture",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["ppurl"],
  paramsSchema: {
    ppurl: {
      type: "string",
      required: true,
      example: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg"
    }
  },

  async run(req, res) {
    try {
      let { ppurl } = { ...req.query, ...req.body };

      if (!ppurl || !String(ppurl).trim()) {
        return res.status(400).json({ status: false, message: "Parameter 'ppurl' wajib diisi" });
      }

      ppurl = String(ppurl).trim();

      const [bgBuffer, ppBuffer] = await Promise.all([
        fs.promises.readFile(BACKGROUND),
        fetch(ppurl, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36" } }).then(r => {
          if (!r.ok) throw new Error("Gagal mengunduh foto profil (HTTP " + r.status + ")");
          return r.arrayBuffer();
        }).then(b => Buffer.from(b))
      ]);

      const [bg, pp] = await Promise.all([loadImage(bgBuffer), loadImage(ppBuffer)]);

      const canvas = createCanvas(CANVAS_W, CANVAS_H);
      const ctx = canvas.getContext("2d");

      ctx.drawImage(pp, PP_BOX.x, PP_BOX.y, PP_BOX.w, PP_BOX.h);
      ctx.drawImage(bg, 0, 0, CANVAS_W, CANVAS_H);

      const buffer = canvas.toBuffer("image/png");

      res.set("Content-Type", "image/png");
      res.set("Content-Length", buffer.length);
      res.send(buffer);
    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || "Gagal generate fake afinitas ML" });
    }
  }
};
