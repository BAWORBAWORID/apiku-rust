import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createCanvas, loadImage, registerFont } from "canvas";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_DIR = path.join(__dirname, "assets", "fake-ff");
const FONT_PATH = path.join(ASSETS_DIR, "fonts", "TeutonNormal.otf");
const LOBBY_DIR = path.join(ASSETS_DIR, "lobby");
const LOBBY_COUNT = 30;

if (fs.existsSync(FONT_PATH)) {
  try { registerFont(FONT_PATH, { family: "TeutonNormal" }); } catch (e) {}
}

const config = {
  canvas: { width: 1920, height: 3416 },
  username: {
    a: 2650,
    b: 2790,
    c: 727,
    d: 1319,
    centerX: 1009,
    fontSize: 85,
    maxChars: 20,
  }
};

function drawGradientUsername(ctx, username, cfg) {
  const { a, b, c, d, fontSize, maxChars } = cfg;
  const name = String(username || "Player").slice(0, maxChars);
  const boxW = d - c;
  const boxH = b - a;
  const cx = cfg.centerX ?? (c + boxW / 2);

  let size = fontSize;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  while (size > 12) {
    ctx.font = `${size}px TeutonNormal`;
    if (ctx.measureText(name).width <= boxW) break;
    size -= 1;
  }

  ctx.font = `${size}px TeutonNormal`;
  const centerY = a + boxH / 2;
  const textW = ctx.measureText(name).width;
  const gradX1 = cx - textW / 2;
  const gradX2 = cx + textW / 2;

  const grad = ctx.createLinearGradient(gradX1, centerY, gradX2, centerY);
  grad.addColorStop(0.00, "#FFFDE7");
  grad.addColorStop(0.35, "#FFE57F");
  grad.addColorStop(0.70, "#FFB300");
  grad.addColorStop(1.00, "#FF8F00");

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = grad;
  ctx.fillText(name, cx, centerY);
  ctx.restore();
}

const LOBBY_ENUMS = fs.existsSync(LOBBY_DIR)
  ? fs.readdirSync(LOBBY_DIR).filter(f => /\.jpg$/i.test(f)).map(f => f.replace(/\.jpg$/i, "")).sort((a,b) => Number(a)-Number(b))
  : [];

export default {
  name: "Fake FF",
  description: "Generate fake Free Fire profile card",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["username", "lobby"],
  paramsSchema: {
    username: { type: "string", required: true, description: "Username pemain", example: "Zyyvor" },
    lobby: { type: "string", required: true, description: "Nomor lobby", enum: LOBBY_ENUMS, example: LOBBY_ENUMS[0] || "1" }
  },

  async run(req, res) {
    try {
      let { username, lobby } = { ...req.query, ...req.body };

      if (!username || !String(username).trim()) {
        return res.status(400).json({ status: false, message: "Parameter 'username' wajib diisi" });
      }
      if (!lobby) {
        return res.status(400).json({ status: false, message: "Parameter 'lobby' wajib diisi" });
      }

      username = String(username).trim();
      const lobbyNum = Math.max(1, Math.min(30, Number(lobby)));

      const lobbyPath = path.join(LOBBY_DIR, `${lobbyNum}.jpg`);
      if (!fs.existsSync(lobbyPath)) {
        return res.status(500).json({ status: false, message: `Lobby ${lobbyNum} tidak ditemukan` });
      }

      const lobbyImg = await loadImage(lobbyPath);
      const { width, height } = config.canvas;
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");

      ctx.drawImage(lobbyImg, 0, 0, width, height);
      drawGradientUsername(ctx, username, config.username);

      const buffer = canvas.toBuffer("image/jpeg");

      res.set("Content-Type", "image/jpeg");
      res.set("Content-Length", buffer.length);
      res.send(buffer);

    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || "Gagal generate fake FF" });
    }
  }
};
