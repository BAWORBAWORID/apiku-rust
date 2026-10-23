/**
 * PROJECT     : Strom-AI Text to Image
 * CREATOR     : BAWORBAWORID
 * DESCRIPTION : Generate gambar dari teks prompt via strom-ai.my.id
 * BASE_URL    : https://strom-ai.my.id
 */

import sharp from 'sharp';

const BASE = 'https://strom-ai.my.id';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const baseHeaders = {
  'Content-Type': 'application/json',
  'Origin': BASE,
  'Referer': BASE + '/',
  'User-Agent': UA
};

async function generateImage(prompt) {
  const res = await fetch(`${BASE}/api/text2img`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ prompt })
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  if (!data.imageUrl) throw new Error('Tidak ada imageUrl di response');

  return data.imageUrl;
}

export default {
  name: "Strom-AI Text to Image",
  description: "Generate gambar dari teks prompt menggunakan Strom-AI (output: base64 PNG)",
  category: "Image AI",
  methods: ["GET", "POST"],
  params: ["prompt"],
  paramsSchema: {
    prompt: {
      type: "string",
      required: true,
      description: "Deskripsi gambar yang ingin dibuat",
      example: "a beautiful sunset over the ocean, digital art"
    }
  },

  async run(req, res) {
    const { prompt, text, teks } = { ...req.query, ...req.body };
    const rawInput = prompt || text || teks;

    if (!rawInput || typeof rawInput !== 'string' || !rawInput.trim()) {
      return res.status(400).json({ status: false, message: "Parameter 'prompt' wajib diisi" });
    }

    try {
      const imageUrl = await generateImage(rawInput.trim());

      // Konversi base64 PNG → JPG via sharp
      if (imageUrl.startsWith('data:image/')) {
        const matches = imageUrl.match(/^data:(image\/\w+);base64,(.+)$/);
        if (matches) {
          const base64Data = matches[2];
          const inputBuffer = Buffer.from(base64Data, 'base64');
          const jpgBuffer = await sharp(inputBuffer)
            .jpeg({ quality: 90 })
            .toBuffer();
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Content-Length', jpgBuffer.length);
          return res.end(jpgBuffer);
        }
      }

      return res.json({ status: true, result: imageUrl });
    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || "Gagal generate gambar dengan Strom-AI" });
    }
  }
};
