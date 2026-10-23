import axios from "axios";

/**
 * Ekstrak token dari URL atau string mentah
 */
function extractToken(input) {
  if (!input) return null;
  const str = String(input).trim();
  if (str.includes("xmz-unlock.zone.id/")) {
    const parts = str.split("xmz-unlock.zone.id/");
    const tokenPart = parts[1].split(/[?#]/)[0];
    return tokenPart.replace(/^\/+|\/+$/g, "");
  }
  return str;
}

export default {
  name: "XMZ Bypass",
  description: "Buka dan bypass proteksi link XMZ Unlock menggunakan token dan PIN",
  category: "Bypass",
  methods: ["GET", "POST"],

  params: ["url", "pin"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL XMZ Unlock (contoh: https://xmz-unlock.zone.id/<token>) atau token link",
      example: "https://xmz-unlock.zone.id/eyJ0IjoidXJsIiwibiI6IlRlc3QifQ.EUAMpCydvFm5g5YxfcdmTncqUekew9Fizo94lDk9HCY5OGWF7Q0iGTurixTJ1OfFGosY3jFGL"
    },
    pin: {
      type: "string",
      required: false,
      description: "PIN 4 digit untuk membuka link (opsional, jika tidak diisi akan menampilkan info link)",
      example: "1234"
    }
  },

  async run(req, res) {
    const { url, link, token: inputToken, pin: inputPin } = { ...req.query, ...req.body };
    const rawInput = url || link || inputToken;

    if (!rawInput) {
      return res.status(400).json({
        status: false,
        message: "[!] Masukkan parameter 'url' atau 'token'"
      });
    }

    const token = extractToken(rawInput);
    if (!token) {
      return res.status(400).json({
        status: false,
        message: "[!] Token XMZ Unlock tidak valid"
      });
    }

    const pin = inputPin ? String(inputPin).trim() : null;

    try {
      // Jika ada PIN, buka URL tujuan
      if (pin) {
        if (!/^\d{4}$/.test(pin)) {
          return res.status(400).json({
            status: false,
            message: "[!] PIN harus berupa 4 digit angka"
          });
        }

        const unlockResp = await axios.post("https://xmz-unlock.zone.id/api", {
          type: "unlock",
          token: token,
          pin: pin
        }, {
          headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
          timeout: 15000,
          validateStatus: () => true
        });

        if (unlockResp.status === 200 && unlockResp.data?.ok) {
          return res.json({
            status: true,
            result: unlockResp.data.url,
            data: {
              name: unlockResp.data.name || "Protected Link",
              unlocked_url: unlockResp.data.url,
              pin: pin,
              token: token
            }
          });
        }

        return res.status(unlockResp.status || 400).json({
          status: false,
          message: unlockResp.data?.error || "PIN salah atau gagal membuka link"
        });
      }

      // Jika PIN tidak disediakan, cek info metadata link
      const metaResp = await axios.post("https://xmz-unlock.zone.id/api", {
        type: "meta",
        token: token
      }, {
        headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
        timeout: 15000,
        validateStatus: () => true
      });

      if (metaResp.status === 200 && metaResp.data?.ok) {
        return res.json({
          status: true,
          message: "Link terdeteksi terkunci. Masukkan parameter 'pin' untuk membuka URL tujuan.",
          data: {
            name: metaResp.data.name || "Protected Link",
            locked: true,
            token: token
          }
        });
      }

      return res.status(metaResp.status || 400).json({
        status: false,
        message: metaResp.data?.error || "Link atau token XMZ Unlock tidak ditemukan / tidak valid"
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Terjadi kesalahan saat memproses link XMZ Unlock"
      });
    }
  }
};
