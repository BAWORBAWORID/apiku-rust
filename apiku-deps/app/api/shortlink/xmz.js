import axios from "axios";

/**
 * Validasi apakah input merupakan URL valid (http / https)
 */
function isUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Generate PIN acak 4 digit angka
 */
function generateRandomPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export default {
  name: "XMZ Shortlink",
  description: "Perpendek dan kunci link URL menggunakan layanan XMZ Unlock dengan proteksi PIN 4 digit",
  category: "Shortlink",
  methods: ["GET", "POST"],

  params: ["url", "pin", "name"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL tujuan yang ingin diperpendek dan dikunci",
      example: "https://google.com"
    },
    pin: {
      type: "string",
      required: false,
      description: "PIN 4 digit angka (opsional, jika kosong akan digenerate otomatis)",
      example: "1234"
    },
    name: {
      type: "string",
      required: false,
      description: "Nama atau judul link yang dilindungi",
      example: "File Rahasia"
    }
  },

  async run(req, res) {
    const { url, link, pin: inputPin, name: inputName } = { ...req.query, ...req.body };
    const targetUrl = url || link;

    if (!targetUrl) {
      return res.status(400).json({
        status: false,
        message: "[!] Masukkan parameter 'url' atau 'link'"
      });
    }

    if (!isUrl(targetUrl)) {
      return res.status(400).json({
        status: false,
        message: "[!] Masukkan format URL yang valid (http:// atau https://)"
      });
    }

    let pin = inputPin ? String(inputPin).trim() : generateRandomPin();
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        status: false,
        message: "[!] PIN harus berupa 4 digit angka (misal: 1234)"
      });
    }

    const title = inputName && String(inputName).trim() ? String(inputName).trim() : "Protected Link";

    try {
      const response = await axios.post("https://xmz-unlock.zone.id/api", {
        type: "generate",
        name: title,
        url: targetUrl.trim(),
        pin: pin
      }, {
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0"
        },
        timeout: 15000
      });

      const data = response.data;
      if (!data || !data.ok) {
        return res.status(400).json({
          status: false,
          message: data?.error || "Gagal membuat shortlink dari XMZ Unlock"
        });
      }

      const shortUrl = `https://xmz-unlock.zone.id/${data.token}`;

      return res.json({
        status: true,
        result: shortUrl,
        data: {
          name: title,
          original_url: targetUrl.trim(),
          short_url: shortUrl,
          pin: pin,
          token: data.token
        }
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.response?.data?.error || err.message || "Terjadi kesalahan pada server XMZ Unlock"
      });
    }
  }
};
