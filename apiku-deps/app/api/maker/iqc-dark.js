import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import logger from "../../src/utils/logger.js";
import https from "https";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ASSETS_DIR = join(__dirname, "assets", "iqc-dark");
const FONTS_DIR = join(ASSETS_DIR, "fonts");

const APPLE_EMOJI_JSON = join(process.cwd(), "src", "assets", "emoji-apple.json");
const BG = join(ASSETS_DIR, "iqc-hytam.png");
const FONT = join(FONTS_DIR, "Inter-Regular.ttf");

let fontRegistered = false;
let appleEmojiMap = null;
const emojiImageCache = new Map();

// Helper to fetch image buffer from URL or local file
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const isHttp = url.startsWith("http://") || url.startsWith("https://");
    const client = isHttp ? (url.startsWith("https") ? https : http) : null;
    if (!isHttp) {
      // local file
      fs.promises
        .readFile(url)
        .then(resolve)
        .catch((err) => reject(new Error(`Failed to read file ${url}: ${err.message}`)));
      return;
    }
    const req = client.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} → ${url}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

const EMOJI_REGEX = /(\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji_Presentation}\uFE0F?|\p{Emoji}\uFE0F|[\u{1F1E0}-\u{1F1FF}]{2}|\p{Extended_Pictographic}\uFE0F?)/gu;

function emojiToUnicode(emoji) {
  return [...emoji]
    .map((c) => c.codePointAt(0).toString(16).padStart(4, "0"))
    .join("-");
}

async function loadAppleEmojiMap() {
  if (appleEmojiMap) return appleEmojiMap;
  const raw = await readFile(APPLE_EMOJI_JSON, "utf-8");
  appleEmojiMap = JSON.parse(raw);
  return appleEmojiMap;
}

async function getEmojiImage(emoji) {
  if (emojiImageCache.has(emoji)) return emojiImageCache.get(emoji);
  const map = await loadAppleEmojiMap();
  const base = emojiToUnicode(emoji);
  const variants = [
    base,
    base.replace(/-fe0f/gi, ""),
    `${base.replace(/-fe0f/gi, "")}-fe0f`,
    base.toUpperCase(),
    base.replace(/-fe0f/gi, "").toUpperCase(),
    base.replace(/-fe0f/gi, "").toUpperCase() + "-FE0F",
  ];
  let b64 = null;
  for (const v of variants) {
    if (map[v]) {
      b64 = map[v];
      break;
    }
  }
  if (!b64) return null;
  const buf = Buffer.from(b64, "base64");
  const img = await loadImage(buf);
  emojiImageCache.set(emoji, img);
  return img;
}

async function drawAppleEmoji(ctx, emoji, x, y, size) {
  const img = await getEmojiImage(emoji);
  if (!img) {
    ctx.fillText(emoji, x, y);
    return;
  }
  ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
}

function measureTextCustom(ctx, text, fontSize) {
  const parts = text.split(EMOJI_REGEX);
  let totalWidth = 0;
  for (const part of parts) {
    if (!part) continue;
    EMOJI_REGEX.lastIndex = 0;
    if (EMOJI_REGEX.test(part)) {
      totalWidth += fontSize * 1.05;
    } else {
      totalWidth += ctx.measureText(part).width;
    }
    EMOJI_REGEX.lastIndex = 0;
  }
  return totalWidth;
}

async function drawTextWithEmojis(ctx, text, x, y, fontSize) {
  const parts = text.split(EMOJI_REGEX);
  let currentX = x;
  for (const part of parts) {
    if (!part) continue;
    EMOJI_REGEX.lastIndex = 0;
    if (EMOJI_REGEX.test(part)) {
      const emojiSize = fontSize * 1.05;
      const emojiCX = currentX + emojiSize / 2;
      const emojiCY = y;
      await drawAppleEmoji(ctx, part, emojiCX, emojiCY, emojiSize);
      currentX += emojiSize;
    } else {
      ctx.fillText(part, currentX, y);
      currentX += ctx.measureText(part).width;
    }
    EMOJI_REGEX.lastIndex = 0;
  }
}

function wrapText(ctx, text, maxWidth, fontSize) {
  ctx.font = `${fontSize}px InterRegular`;
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.includes("\n")) {
      const parts = word.split("\n");
      for (let j = 0; j < parts.length; j++) {
        const test = cur + (cur ? " " : "") + parts[j];
        if (measureTextCustom(ctx, test, fontSize) > maxWidth && cur) {
          lines.push(cur);
          cur = parts[j];
        } else {
          cur = test;
        }
        if (j < parts.length - 1) {
          lines.push(cur);
          cur = "";
        }
      }
      continue;
    }
    const test = cur + (cur ? " " : "") + word;
    if (measureTextCustom(ctx, test, fontSize) > maxWidth && i > 0) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export default {
  name: "IQC Dark",
  description:
    "Generate iPhone-style chat quote with dark bubble, Apple emoji support, reaction bar, and optional image with caption",
  category: "Maker",
  methods: ["GET"],
  params: ["text", "time", "image"],
  paramsSchema: {
    text: {
      type: "string",
      required: false,
      description: "Teks chat bubble (default: Earth without art is just \"eh\" ✨)",
      example: "Halo, apa kabar? 😊",
    },
    time: {
      type: "string",
      required: false,
      description: "Timestamp chat (format: HH.MM, default: 16.34)",
      example: "12.00",
    },
    image: {
      type: "string",
      required: false,
      default: "https://raw.githubusercontent.com/ryyntwx/allimagerin/refs/heads/main/IMG-20260703-WA0651.jpg",
      description:
        "URL gambar untuk dikirim (jika diisi, chat bubble akan menampilkan gambar + caption dari parameter text)",
      example: "https://raw.githubusercontent.com/ryyntwx/allimagerin/refs/heads/main/IMG-20260703-WA0651.jpg",
    },
  },

  async run(req, res) {
    const { text, time, image } = { ...req.query, ...req.body };
    const startTime = Date.now();

    try {
      if (!fontRegistered) {
        GlobalFonts.registerFromPath(FONT, "InterRegular");
        fontRegistered = true;
      }
      await loadAppleEmojiMap();

      const txt = text || `Earth without art is just "eh" ✨`;
      const timeStr = time || "16.34";
      const imgUrl = image || "https://raw.githubusercontent.com/ryyntwx/allimagerin/refs/heads/main/IMG-20260703-WA0651.jpg";
      const caption = imgUrl ? txt : "";

      const BG_W = 941;
      const BG_H = 1671;
      const chatFontSize = 30;
      const maxWidthLimit = 530;
      const minBubbleWidth = 280;
      const lineHeight = chatFontSize + 14;
      const paddingX = 30;
      const paddingY = 20;
      const rad = 28;
      const fixedX = 35;
      const fixedBaseY = 946;
      const emojis = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

      const canvas = createCanvas(BG_W, BG_H);
      const ctx = canvas.getContext("2d");
      const bgImg = await loadImage(BG);
      ctx.drawImage(bgImg, 0, 0, BG_W, BG_H);

      // Draw permanent time
      ctx.fillStyle = "#ffffff";
      ctx.font = `27px InterRegular`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(timeStr, 463, 8);

      // Measure time string for bubble
      ctx.font = `22px InterRegular`;
      const timeWidth = ctx.measureText(timeStr).width;

      let finalY, finalBubbleHeight, bubbleW;

      if (!imgUrl) {
        // Text-only bubble
        ctx.font = `${chatFontSize}px InterRegular`;
        const chatLines = wrapText(ctx, txt, maxWidthLimit, chatFontSize);

        let longestW = 0;
        chatLines.forEach((l) => {
          const w = measureTextCustom(ctx, l.trim(), chatFontSize);
          if (w > longestW) longestW = w;
        });

        bubbleW = longestW + paddingX * 2;
        bubbleW = Math.max(bubbleW, timeWidth + 75);
        bubbleW = Math.max(bubbleW, 180);

        const spaceTimeY = 12;
        finalBubbleHeight =
          chatLines.length * lineHeight + paddingY + spaceTimeY + 22;
        finalY = fixedBaseY - finalBubbleHeight;

        // Draw bubble bg
        ctx.fillStyle = "#1c1c1e";
        ctx.beginPath();
        ctx.moveTo(fixedX + rad, finalY);
        ctx.lineTo(fixedX + bubbleW - rad, finalY);
        ctx.quadraticCurveTo(
          fixedX + bubbleW,
          finalY,
          fixedX + bubbleW,
          finalY + rad
        );
        ctx.lineTo(fixedX + bubbleW, finalY + finalBubbleHeight - rad);
        ctx.quadraticCurveTo(
          fixedX + bubbleW,
          finalY + finalBubbleHeight,
          fixedX + bubbleW - rad,
          finalY + finalBubbleHeight
        );
        ctx.lineTo(fixedX + rad, finalY + finalBubbleHeight);
        ctx.quadraticCurveTo(
          fixedX + 8,
          finalY + finalBubbleHeight,
          fixedX + 8,
          finalY + finalBubbleHeight - 8
        );
        ctx.lineTo(fixedX + 8, finalY + rad);
        ctx.quadraticCurveTo(fixedX + 8, finalY, fixedX + rad, finalY);
        ctx.closePath();
        ctx.fill();

        // Tail
        ctx.beginPath();
        ctx.moveTo(fixedX + 12, finalY + finalBubbleHeight - 20);
        ctx.quadraticCurveTo(
          fixedX - 2,
          finalY + finalBubbleHeight - 4,
          fixedX - 8,
          finalY + finalBubbleHeight
        );
        ctx.quadraticCurveTo(
          fixedX + 6,
          finalY + finalBubbleHeight,
          fixedX + 22,
          finalY + finalBubbleHeight - 2
        );
        ctx.closePath();
        ctx.fill();

        // Text
        ctx.save();
        ctx.fillStyle = "#ffffff";
        ctx.font = `${chatFontSize}px InterRegular`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        for (let i = 0; i < chatLines.length; i++) {
          const lineY =
            finalY + paddingY + i * lineHeight + chatFontSize / 2;
          await drawTextWithEmojis(
            ctx,
            chatLines[i].trim(),
            fixedX + paddingX,
            lineY,
            chatFontSize
          );
        }
        ctx.restore();

        // Timestamp in bubble
        ctx.fillStyle = "#727278";
        ctx.font = `22px InterRegular`;
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        ctx.fillText(
          timeStr,
          fixedX + bubbleW - 22,
          finalY + finalBubbleHeight - 38
        );
      } else {
        // Image + optional caption bubble
        const imgBuf = await fetchBuffer(imgUrl);
        const imgObj = await loadImage(imgBuf);

        const imgAspect = imgObj.width / imgObj.height;
        bubbleW = Math.min(Math.max(imgObj.width, minBubbleWidth), maxWidthLimit);
        bubbleW = Math.max(bubbleW, timeWidth + 75);
        let imgDrawH = Math.round(bubbleW / imgAspect);

        let captionLines = [];
        if (caption) {
          ctx.font = `${chatFontSize}px InterRegular`;
          captionLines = wrapText(ctx, caption, bubbleW - paddingX * 2, chatFontSize);
        }

        const captionH =
          captionLines.length > 0
            ? paddingY + captionLines.length * lineHeight
            : 0;
        const timeRowH = 28;
        finalBubbleHeight =
          imgDrawH + captionH + timeRowH + (captionLines.length > 0 ? 4 : 0);
        finalY = fixedBaseY - finalBubbleHeight;

        // Bubble bg
        ctx.fillStyle = "#1c1c1e";
        ctx.beginPath();
        ctx.moveTo(fixedX + rad, finalY);
        ctx.lineTo(fixedX + bubbleW - rad, finalY);
        ctx.quadraticCurveTo(
          fixedX + bubbleW,
          finalY,
          fixedX + bubbleW,
          finalY + rad
        );
        ctx.lineTo(fixedX + bubbleW, finalY + finalBubbleHeight - rad);
        ctx.quadraticCurveTo(
          fixedX + bubbleW,
          finalY + finalBubbleHeight,
          fixedX + bubbleW - rad,
          finalY + finalBubbleHeight
        );
        ctx.lineTo(fixedX + rad, finalY + finalBubbleHeight);
        ctx.quadraticCurveTo(
          fixedX + 8,
          finalY + finalBubbleHeight,
          fixedX + 8,
          finalY + finalBubbleHeight - 8
        );
        ctx.lineTo(fixedX + 8, finalY + rad);
        ctx.quadraticCurveTo(fixedX + 8, finalY, fixedX + rad, finalY);
        ctx.closePath();
        ctx.fill();

        // Tail
        ctx.beginPath();
        ctx.moveTo(fixedX + 12, finalY + finalBubbleHeight - 20);
        ctx.quadraticCurveTo(
          fixedX - 2,
          finalY + finalBubbleHeight - 4,
          fixedX - 8,
          finalY + finalBubbleHeight
        );
        ctx.quadraticCurveTo(
          fixedX + 6,
          finalY + finalBubbleHeight,
          fixedX + 22,
          finalY + finalBubbleHeight - 2
        );
        ctx.closePath();
        ctx.fill();

        // Clip & draw image
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(fixedX + rad, finalY);
        ctx.lineTo(fixedX + bubbleW - rad, finalY);
        ctx.quadraticCurveTo(
          fixedX + bubbleW,
          finalY,
          fixedX + bubbleW,
          finalY + rad
        );
        ctx.lineTo(fixedX + bubbleW, finalY + imgDrawH);
        ctx.lineTo(fixedX + 8, finalY + imgDrawH);
        ctx.lineTo(fixedX + 8, finalY + rad);
        ctx.quadraticCurveTo(fixedX + 8, finalY, fixedX + rad, finalY);
        ctx.closePath();
        ctx.clip();

        ctx.drawImage(imgObj, fixedX, finalY, bubbleW, imgDrawH);
        ctx.beginPath();
        ctx.moveTo(fixedX + 8, finalY + imgDrawH);
        ctx.lineTo(fixedX + 8, finalY + rad);
        ctx.quadraticCurveTo(fixedX + 8, finalY, fixedX + rad, finalY);
        ctx.lineTo(fixedX + bubbleW - rad, finalY);
        ctx.quadraticCurveTo(
          fixedX + bubbleW,
          finalY,
          fixedX + bubbleW,
          finalY + rad
        );
        ctx.lineTo(fixedX + bubbleW, finalY + imgDrawH);
        ctx.strokeStyle = "#1c1c1e";
        ctx.lineWidth = 18;
        ctx.stroke();
        ctx.restore();

        // Caption text
        if (captionLines.length > 0) {
          ctx.save();
          ctx.fillStyle = "#ffffff";
          ctx.font = `${chatFontSize}px InterRegular`;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          for (let i = 0; i < captionLines.length; i++) {
            const lineY =
              finalY + imgDrawH + paddingY + i * lineHeight + chatFontSize / 2;
            await drawTextWithEmojis(
              ctx,
              captionLines[i].trim(),
              fixedX + paddingX,
              lineY,
              chatFontSize
            );
          }
          ctx.restore();
        }

        // Timestamp
        ctx.fillStyle = "#727278";
        ctx.font = `22px InterRegular`;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(
          timeStr,
          fixedX + bubbleW - 22,
          finalY + finalBubbleHeight - timeRowH
        );
      }

      // Reaction bar
      const emojiSize = Math.round(54 * 1.03);
      const emCardH = emojiSize + Math.round(44 * 1.03);
      const emCardW = Math.round(530 * 1.03);
      const emCardX = fixedX + 8;
      const emCardY = finalY - emCardH - 18;

      ctx.fillStyle = "#1c1c1e";
      ctx.beginPath();
      ctx.roundRect(emCardX, emCardY, emCardW, emCardH, [emCardH / 2]);
      ctx.fill();

      const startX = emCardX + 55;
      const spacingX = 76;
      const emojiCY = emCardY + emCardH / 2 + 2;

      for (let i = 0; i < Math.min(emojis.length, 6); i++) {
        await drawAppleEmoji(
          ctx,
          emojis[i],
          startX + i * spacingX,
          emojiCY,
          emojiSize
        );
      }

      // + button
      ctx.fillStyle = "#8e8e93";
      ctx.font = `${Math.round(36 * 1.03)}px InterRegular`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        "+",
        startX + 6 * spacingX - 8,
        emCardY + emCardH / 2 - 2
      );

      // Output
      const buffer = await canvas.encode("png");
      const duration = Date.now() - startTime;

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("X-Generated-In", `${duration}ms`);
      return res.send(buffer);
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[IQC-Dark] Failed after ${duration}ms: ${err.message}`);

      return res.status(500).json({
        status: false,
        message: err.message || "Failed to generate IQC Dark image",
      });
    }
  },
};