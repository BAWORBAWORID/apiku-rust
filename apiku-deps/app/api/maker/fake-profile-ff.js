import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../../src/utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.join(__dirname, "assets", "fake-profile-ff");
const FONTS_DIR = path.join(ASSETS_DIR, "fonts");
const TEMPLATE_LOCAL = path.join(ASSETS_DIR, "template.jpg");
const TEMPLATE_URL = "https://clooud.my.id/uploder/uploads/ujRKQj.jpg";

const FONT_URLS = {
  TeutonNormal: "https://raw.githubusercontent.com/ElrayyXml/src/refs/heads/main/database/TeutonNormal.otf",
  NotoSans: "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf",
  NotoColorEmoji: "https://github.com/googlefonts/noto-emoji/raw/main/fonts/NotoColorEmoji.ttf",
  NotoSansMath: "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSansMath/NotoSansMath-Regular.ttf",
  NotoSansBengali: "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSansBengali/NotoSansBengali-Regular.ttf",
  NotoSansSymbols: "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSansSymbols/NotoSansSymbols-Regular.ttf",
  NotoSansSymbols2: "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSansSymbols2/NotoSansSymbols2-Regular.ttf",
  NotoSansArabic: "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSansArabic/NotoSansArabic-Regular.ttf",
  NotoSansCJK: "https://raw.githubusercontent.com/googlefonts/noto-cjk/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf",
  NotoSansThai: "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSansThai/NotoSansThai-Regular.ttf",
  NotoSansDevanagari: "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf"
};

const FONT_STACK = "TeutonNormal, NotoSans, NotoSansMath, NotoSansBengali, NotoSansArabic, NotoSansCJK, NotoSansSymbols2, NotoSansSymbols, NotoSansThai, NotoSansDevanagari, NotoColorEmoji";

const REF_W = 941;
const REF_H = 1672;
const FONT_SIZE_REF = 68;
const MIN_FONT_REF = 40;
const UID_FONT_SIZE_REF = 48;
const UID_MIN_FONT_REF = 26;

let fontsLoaded = false;

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function fetchAndCache(url, dest) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    headers: { "User-Agent": "Mozilla/5.0" },
    timeout: 15000
  });
  await ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, Buffer.from(res.data));
  return Buffer.from(res.data);
}

async function loadFonts() {
  if (fontsLoaded) return;
  await ensureDir(FONTS_DIR);

  const entries = Object.entries(FONT_URLS);
  await Promise.all(entries.map(async ([name, url]) => {
    const ext = url.split(".").pop().split("?")[0];
    const dest = path.join(FONTS_DIR, `${name}.${ext}`);
    try {
      let buf;
      if (fs.existsSync(dest)) {
        buf = fs.readFileSync(dest);
      } else {
        buf = await fetchAndCache(url, dest);
      }
      GlobalFonts.register(buf, name);
    } catch (err) {
      logger.warn(`[FakeProfileFF] Failed to load font ${name}: ${err.message}`);
    }
  }));

  fontsLoaded = true;
}

async function loadTemplate() {
  if (fs.existsSync(TEMPLATE_LOCAL)) {
    try {
      return await loadImage(TEMPLATE_LOCAL);
    } catch {}
  }
  const buf = await fetchAndCache(TEMPLATE_URL, TEMPLATE_LOCAL);
  return await loadImage(buf);
}

function drawText({ ctx, text, x, y, fontSize, maxWidth, color, textAlign = "center" }) {
  let size = fontSize;
  ctx.textAlign = textAlign;
  ctx.textBaseline = "middle";

  while (size > 12) {
    ctx.font = `${size}px ${FONT_STACK}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }

  ctx.font = `${size}px ${FONT_STACK}`;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  return size;
}

async function generate({ nickname, uid }) {
  await loadFonts();
  const template = await loadTemplate();

  const realW = template.width;
  const realH = template.height;
  const scaleX = realW / REF_W;
  const scaleY = realH / REF_H;

  const canvas = createCanvas(realW, realH);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(template, 0, 0, realW, realH);

  const leftBoundRef = 325.5 - 68;
  const rightBoundRef = leftBoundRef + 380;
  const maxWidthRef = 380;
  const yRef = 316.1 + 5;
  const centerXRef = (leftBoundRef + rightBoundRef) / 2;

  drawText({
    ctx,
    text: nickname,
    x: centerXRef * scaleX,
    y: yRef * scaleY,
    fontSize: FONT_SIZE_REF,
    maxWidth: maxWidthRef,
    color: "#1a1a1a"
  });

  const uidText = `UID: ${uid}`;
  const uidLeftRef = 594;
  const uidWidthRef = 280;
  const uidCenterXRef = uidLeftRef + uidWidthRef / 2;
  const uidBoxYRef = 492.4 + 5;
  const uidBoxHeightRef = 57.7;
  const uidCenterYRef = uidBoxYRef + uidBoxHeightRef / 2;

  drawText({
    ctx,
    text: uidText,
    x: uidCenterXRef * scaleX,
    y: uidCenterYRef * scaleY,
    fontSize: UID_FONT_SIZE_REF,
    maxWidth: uidWidthRef,
    color: "#fafafa"
  });

  return canvas.toBuffer("image/jpeg");
}

export default {
  name: "Fake Profile FF",
  description: "Generate fake Free Fire lobby profile with nickname and UID",
  category: "Maker",
  methods: ["GET", "POST"],
  params: ["nickname", "uid"],
  paramsSchema: {
    nickname: {
      type: "string",
      required: true,
      description: "Nama nickname pemain FF",
      example: "Zyvor"
    },
    uid: {
      type: "string",
      required: true,
      description: "UID akun Free Fire",
      example: "75813269"
    }
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const data = { ...req.query, ...req.body };
      const nickname = data.nickname || data.name || data.username || "";
      const uid = data.uid || data.id || "";

      if (!nickname || !uid) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'nickname' dan 'uid' wajib diisi"
        });
      }

      const buffer = await generate({ nickname: String(nickname), uid: String(uid) });
      const duration = Date.now() - startTime;

      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("X-Generated-In", `${duration}ms`);
      return res.send(buffer);
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[FakeProfileFF] Error after ${duration}ms: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal generate fake FF profile"
      });
    }
  }
};
