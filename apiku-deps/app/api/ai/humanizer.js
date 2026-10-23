/**
 * PROJECT     : ZeroGPT Humanizer
 * AUTHOR      : BINTANG
 * CREATOR     : BINTANG
 * DESCRIPTION : Humanize AI text using ZeroGPT
 * BASE_URL    : https://api.zerogpt.com
 * Parameter   : teks (required, min 50 karakter)
 */

import axios from "axios";

const API_URL = "https://api.zerogpt.com/api/transform/humanize";

async function humanizeText(text) {
  const res = await axios.post(API_URL, {
    string: text,
    skipRealtime: 1,
    humanizerReadability: "High School",
    humanizerPurpose: "General Writing",
    humanizerStrength: "Balanced",
    humanizerModel: "v11"
  }, {
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/plain, */*",
      "Origin": "https://www.zerogpt.com",
      "Referer": "https://www.zerogpt.com/ai-humanizer",
      "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36"
    },
    timeout: 30000
  });

  return res.data;
}

export default {
  name: "AI Humanizer",
  description: "Humanize teks AI menggunakan ZeroGPT — ubah teks AI-generated jadi lebih natural (min 50 karakter)",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["teks"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Teks AI yang ingin di-humanize (minimal 50 karakter)",
      example: "Berdasarkan analisis yang mendalam, dapat disimpulkan bahwa implementasi teknologi artificial intelligence memberikan kontribusi signifikan terhadap peningkatan efisiensi operasional perusahaan.",
      minLength: 50,
      maxLength: 10000
    }
  },
  async run(req, res) {
    const { teks } = { ...req.query, ...req.body };

    if (!teks || typeof teks !== "string" || !teks.trim()) {
      return res.status(400).json({
        success: false,
        message: "Parameter 'teks' wajib diisi"
      });
    }

    const trimmed = teks.trim();

    if (trimmed.length < 50) {
      return res.status(400).json({
        success: false,
        message: `Teks terlalu pendek: ${trimmed.length} karakter (minimal 50)`
      });
    }

    try {
      const result = await humanizeText(trimmed);

      if (!result.success) {
        return res.status(502).json({
          success: false,
          message: result.message || "ZeroGPT humanizer request failed"
        });
      }

      res.json({
        success: true,
        input: trimmed,
        input_length: trimmed.length,
        output_length: result.data?.output?.length || 0,
        result: result.data?.output || ""
      });
    } catch (err) {
      const errMsg = err.response?.data?.message || err.message || "Humanizer request failed";
      res.status(500).json({
        success: false,
        message: errMsg
      });
    }
  }
};
