import axios from "axios";
import FormData from "form-data";
import logger from "../../src/utils/logger.js";

// Custom fetchBuffer to bypass 403 on CDN links like Pinterest
async function fetchBuffer(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
      "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
    }
  });
  return Buffer.from(res.data);
}

export default {
  name: "Fake Dev Generator",
  description: "Generate fake developer profile card",
  category: "Maker",
  methods: ["GET"],
  params: ["url", "name", "verified"],
  paramsSchema: {
    url: {
      type: "string",
      required: false,
      description: "URL gambar avatar/profile",
      example: "https://example.com/avatar.jpg",
      default: "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg"
    },
    name: {
      type: "string",
      required: true,
      description: "Nama developer",
      example: "John Doe"
    },
    verified: {
      type: "string",
      required: false,
      description: "Teks badge verified (opsional, default: Verified)",
      example: "Verified"
    }
  },

  async run(req, res) {
    const { url, name, verified } = req.query;

    if (!name) return res.status(400).json({ status: false, message: "Parameter 'name' wajib diisi" });

    const startTime = Date.now();
    const targetUrl = url || "https://i.pinimg.com/736x/21/3a/90/213a900af021a47d7caad219318d200c.jpg";
    const verifText = verified || "Verified";

    try {
      // 1. Ambil gambar dari URL input pengguna menggunakan fetchBuffer agar lolos 403
      const imgBuffer = await fetchBuffer(targetUrl);

      // 2. Siapkan FormData untuk dikirim ke upstream
      const formData = new FormData();
      formData.append("apikey", "VmBuO");
      formData.append("name", name);
      formData.append("verified", verifText);
      formData.append("image", imgBuffer, "avatar.jpg"); // Mengirim buffer sebagai file

      // 3. Tembak upstream API
      const upstreamRes = await axios.post("https://api.theresav.biz.id/canvas/fakedev", formData, {
        headers: {
          ...formData.getHeaders()
        },
        responseType: "arraybuffer" // Terima balasan sebagai file
      });

      const buffer = Buffer.from(upstreamRes.data);
      const duration = Date.now() - startTime;

      // 4. Return gambar JPEG ke pengguna
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("X-Generated-In", `${duration}ms`);
      return res.send(buffer);

    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[FakeDev] Generation failed after ${duration}ms: ${err.message}`);

      let errorMessage = err.message;
      if (err.response && err.response.data) {
        // Coba ekstrak error dari upstream jika berupa JSON buffer
        try {
          const upstreamError = JSON.parse(err.response.data.toString());
          errorMessage = upstreamError.message || errorMessage;
        } catch (e) {
          // Abaikan jika bukan JSON
        }
      }

      return res.status(500).json({
        status: false,
        message: "Failed to generate fake dev image via upstream",
        error: errorMessage
      });
    }
  }
};
