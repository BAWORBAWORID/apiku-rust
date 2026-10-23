import { createCanvas, loadImage, registerFont } from "canvas";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../../src/utils/logger.js";
import https from "https";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.join(__dirname, "assets", "faketweet");
const FONTS_DIR = ASSETS_DIR; // Menggunakan font mandiri di folder faketweet

const TEMPLATE_PATH = path.join(ASSETS_DIR, "template.jpg");

const fontCandidates = [
  { path: path.join(FONTS_DIR, "Poppins-SemiBold.ttf"), family: "Poppins SemiBold" },
  { path: path.join(FONTS_DIR, "Poppins-Regular.ttf"), family: "Poppins" }
];

let fontsLoaded = false;
try {
  for (const font of fontCandidates) {
    if (fs.existsSync(font.path)) {
      registerFont(font.path, { family: font.family });
    }
  }
  fontsLoaded = true;
} catch (err) {
  logger.error(`[FakeTweet] Failed to register fonts: ${err.message}`);
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} → ${url}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function loadImageSmart(src) {
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return loadImage(await fetchBuffer(src));
  }
  return loadImage(src);
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let line = "";

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;

    if (ctx.measureText(testLine).width > maxWidth) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }

  if (line) lines.push(line);
  return lines;
}

function fitTweetFont(ctx, text, maxWidth, maxLines) {
  let size = 28;
  while (size >= 16) {
    ctx.font = `${size}px "Poppins"`;
    const lines = wrapText(ctx, text, maxWidth);

    if (lines.length <= maxLines) {
      return {
        size,
        lines
      };
    }
    size--;
  }

  ctx.font = `16px "Poppins"`;
  return {
    size: 16,
    lines: wrapText(ctx, text, maxWidth)
  };
}

export default {
  name: "Fake Tweet Generator",
  description: "Generate a Fake Twitter/X Tweet Image",
  category: "Maker",
  methods: ["GET"],
  params: ["name", "username", "text", "avatar"],
  paramsSchema: {
    name: {
      type: "string",
      required: true,
      description: "Nama display user",
      example: "Saul Goodman"
    },
    username: {
      type: "string",
      required: true,
      description: "Username (tanpa @ atau dengan @)",
      example: "goodman"
    },
    text: {
      type: "string",
      required: true,
      description: "Isi tweet",
      example: "Breaking Bad was good, but remember..."
    },
    avatar: {
      type: "string",
      required: false,
      description: "URL Avatar image (opsional)",
      default: "https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/6b71d84a580f385bd7ee36402df5341ead4770a0/Image/artworks-gWLRE6HyPH3DgVMG-ZFFxtg-t500x500.jpg"
    }
  },

  async run(req, res) {
    const { name, username, text, avatar } = { ...req.query, ...req.body };

    if (!name) return res.status(400).json({ status: false, message: "Parameter 'name' wajib diisi" });
    if (!username) return res.status(400).json({ status: false, message: "Parameter 'username' wajib diisi" });
    if (!text) return res.status(400).json({ status: false, message: "Parameter 'text' wajib diisi" });

    const NAME = String(name);
    const USERNAME = String(username);
    const TWEET = String(text);
    const AVATAR_SRC = avatar || "https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/6b71d84a580f385bd7ee36402df5341ead4770a0/Image/artworks-gWLRE6HyPH3DgVMG-ZFFxtg-t500x500.jpg";

    const config = {
      ppbg: { x: 24, y: 136, size: 107 },
      name: { x: 140, y: 180 },
      username: { x: 140, y: 205 },
      tweet: { x: 40, y: 290, width: 560 }
    };

    const startTime = Date.now();

    try {
      if (!fs.existsSync(TEMPLATE_PATH)) {
        throw new Error("Template missing. Place template.jpg in api/maker/assets/faketweet/.");
      }

      const templateBuffer = await fs.promises.readFile(TEMPLATE_PATH);
      const bg = await loadImage(templateBuffer);
      const pp = await loadImageSmart(AVATAR_SRC);
      
      const canvas = createCanvas(bg.width, bg.height);
      const ctx = canvas.getContext("2d");
      
      ctx.drawImage(bg, 0, 0);
      ctx.save();
      ctx.beginPath();
      ctx.arc(
        config.ppbg.x + config.ppbg.size / 2,
        config.ppbg.y + config.ppbg.size / 2,
        config.ppbg.size / 2,
        0,
        Math.PI * 2
      );
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(pp, config.ppbg.x, config.ppbg.y, config.ppbg.size, config.ppbg.size);
      ctx.restore();

      let nameSize = 26;
      ctx.font = `${nameSize}px "Poppins SemiBold"`;
      while (ctx.measureText(NAME).width > 380 && nameSize > 18) {
        nameSize--;
        ctx.font = `${nameSize}px "Poppins SemiBold"`;
      }

      ctx.fillStyle = "#000";
      ctx.fillText(NAME, config.name.x, config.name.y);

      ctx.font = '18px "Poppins"';
      ctx.fillStyle = "#657786";
      ctx.fillText(
        USERNAME.startsWith("@") ? USERNAME : `@${USERNAME}`,
        config.username.x,
        config.username.y
      );

      const tweetFit = fitTweetFont(ctx, TWEET, config.tweet.width, 8);

      ctx.font = `${tweetFit.size}px "Poppins"`;
      ctx.fillStyle = "#14171A";
      const lineHeight = tweetFit.size + 8;
      let y = config.tweet.y;

      for (const line of tweetFit.lines) {
        ctx.fillText(line, config.tweet.x, y);
        y += lineHeight;
      }

      const buffer = canvas.toBuffer("image/jpeg", { quality: 0.95 });
      const duration = Date.now() - startTime;
      
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("X-Generated-In", `${duration}ms`);
      return res.send(buffer);

    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[FakeTweet] Generation failed after ${duration}ms: ${err.message}`);

      return res.status(500).json({
        status: false,
        message: err.message || "Failed to generate fake tweet image"
      });
    }
  }
};
