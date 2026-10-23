import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createCanvas, loadImage, registerFont } from "canvas";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_DIR = path.join(__dirname, "assets", "fake-ml");
const ASSETS = {
  lobby: path.join(ASSETS_DIR, "Lobby.jpg"),
  font: path.join(ASSETS_DIR, "noto-sans.regular.ttf"),
  avatar: path.join(ASSETS_DIR, "avatar.jpg"),
};

if (fs.existsSync(ASSETS.font)) {
  try { registerFont(ASSETS.font, { family: "NotoSans" }); } catch (e) {}
}

const RANK_CONFIG = {
  epic: { size: 210, x: 388, y: 760 },
  glory: { size: 210, x: 387, y: 760 },
  gm: { size: 260, x: 358, y: 760 },
  honor: { size: 210, x: 384, y: 760 },
  imo: { size: 260, x: 358, y: 760 },
  legend: { size: 260, x: 360, y: 760 },
  mawi: { size: 210, x: 387, y: 760 },
};

const BORDER_OFFSET = {
  1: 26, 2: 36, 3: 26, 4: 26, 5: 26,
  6: 26, 7: 26, 8: 26, 9: 26,
  10: 26, 11: 22, 12: 28, 13: 26,
  14: 21, 15: 26, 16: 26,
};

const config = {
  canvas: { width: 960, height: 1706 },
  rank_name: "imo",
  border_num: 0,
  avatar: { x: 389, y: 446, size: 204, borderRadius: 12 },
  outline: { color: "#b8956f", thickness: 4 },
  rank: { x: 387, y: 760, size: 210 },
  flag: { x: 364, y: 428, size: 55 },
  username: { a: 681, b: 727, c: 400, centerX: 496, d: 609, fontSize: 36, maxChars: 15, color: "#ffffff" },
};

const RANK_ENUMS = fs.existsSync(path.join(ASSETS_DIR, "rank"))
  ? fs.readdirSync(path.join(ASSETS_DIR, "rank")).filter(f => f.endsWith(".png")).map(f => f.replace(/\.png$/, ""))
  : [];

const BORDER_ENUMS = fs.existsSync(path.join(ASSETS_DIR, "border"))
  ? fs.readdirSync(path.join(ASSETS_DIR, "border")).filter(f => f.endsWith(".png")).map(f => f.replace(/\.png$/, "")).sort((a, b) => Number(a) - Number(b))
  : [];

function calcHeight(img, size) {
  return size * (img.height / img.width);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawAvatar(ctx, img, cfg, outlineCfg) {
  const { x, y, size, borderRadius } = cfg;
  const height = calcHeight(img, size);
  const r = borderRadius || 0;

  ctx.save();

  if (outlineCfg) {
    const { color, thickness } = outlineCfg;
    roundRect(ctx, x - thickness, y - thickness, size + thickness * 2, height + thickness * 2, r + thickness);
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness * 2;
    ctx.stroke();
  }

  roundRect(ctx, x, y, size, height, r);
  ctx.clip();
  ctx.drawImage(img, x, y, size, height);
  ctx.restore();
}

function drawBorder(ctx, img, avatarCfg, borderCfg) {
  const { x, y, size } = avatarCfg;
  const { offset } = borderCfg;
  const bSize = size + offset * 2;
  ctx.drawImage(img, x - offset, y - offset, bSize, bSize);
}

function drawFlagCircle(ctx, cfg) {
  const { x, y, size } = cfg;
  const radius = size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + radius, y + radius, radius, 0, Math.PI * 2);
  ctx.clip();
  const grad = ctx.createRadialGradient(x + radius, y + radius, 0, x + radius, y + radius, radius);
  grad.addColorStop(0, "#ff4444");
  grad.addColorStop(0.5, "#ffffff");
  grad.addColorStop(1, "#ff4444");
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, size, size);
  ctx.restore();
}

function drawUsername(ctx, username, cfg) {
  const { a, b, c, d, centerX, fontSize, maxChars, color } = cfg;
  const w = d - c;
  const h = b - a;
  const name = String(username || "Player").slice(0, maxChars);
  let size = fontSize;
  ctx.textAlign = "center";
  while (size > 8) {
    ctx.font = `${size}px NotoSans`;
    if (ctx.measureText(name).width <= w) break;
    size -= 1;
  }
  ctx.fillStyle = color;
  ctx.font = `${size}px NotoSans`;
  ctx.fillText(name, centerX, a + h / 2 + size / 3);
}

export default {
  name: "Fake ML",
  description: "Generate fake Mobile Legends profile card",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["username", "rank", "border", "avatar"],
  paramsSchema: {
    username: { type: "string", required: true, description: "Username pemain", example: "Zyyvor" },
    rank: { type: "string", required: true, description: "Peringkat", enum: RANK_ENUMS, example: "imo" },
    border: { type: "string", required: true, description: "Nomor border", enum: ["0", ...BORDER_ENUMS], example: "0" },
    avatar: { type: "string", required: false, description: "URL avatar (kosongkan untuk default)", example: "" }
  },

  async run(req, res) {
    try {
      let { username, rank, border, avatar } = { ...req.query, ...req.body };

      if (!username || !String(username).trim()) {
        return res.status(400).json({ status: false, message: "Parameter 'username' wajib diisi" });
      }
      if (!rank) {
        return res.status(400).json({ status: false, message: "Parameter 'rank' wajib diisi" });
      }
      if (border === undefined || border === null || border === "") {
        return res.status(400).json({ status: false, message: "Parameter 'border' wajib diisi" });
      }

      username = String(username).trim();
      rank = String(rank).trim();
      const borderNum = Number(border);
      const useBorder = borderNum > 0;

      let avatarImg;
      if (avatar) {
        try {
          const avRes = await fetch(avatar);
          const avBuf = Buffer.from(await avRes.arrayBuffer());
          avatarImg = await loadImage(avBuf);
        } catch {
          avatarImg = await loadImage(ASSETS.avatar);
        }
      } else {
        avatarImg = await loadImage(ASSETS.avatar);
      }

      const baseImages = [
        loadImage(ASSETS.lobby),
        avatarImg,
        loadImage(path.join(ASSETS_DIR, "rank", `${rank}.png`)),
      ];

      if (useBorder) baseImages.push(loadImage(path.join(ASSETS_DIR, "border", `${borderNum}.png`)));

      const [lobbyImg, avatarImgLoaded, rankImg, borderImg] = await Promise.all(baseImages);

      const { width, height } = config.canvas;
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");

      ctx.drawImage(lobbyImg, 0, 0, width, height);
      drawAvatar(ctx, avatarImgLoaded, config.avatar, useBorder ? null : config.outline);

      if (useBorder) {
        drawBorder(ctx, borderImg, config.avatar, { offset: BORDER_OFFSET[borderNum] ?? 26 });
      }

      const rankCfg = RANK_CONFIG[rank] || { size: config.rank.size, x: config.rank.x, y: config.rank.y };
      ctx.drawImage(rankImg, rankCfg.x, rankCfg.y, rankCfg.size, calcHeight(rankImg, rankCfg.size));

      drawFlagCircle(ctx, config.flag);
      drawUsername(ctx, username, config.username);

      const buffer = canvas.toBuffer("image/png");

      res.set("Content-Type", "image/png");
      res.set("Content-Length", buffer.length);
      res.send(buffer);

    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || "Gagal generate fake ML" });
    }
  }
};
