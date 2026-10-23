import mql from "@microlink/mql";

const THEMES = [
  "dracula-pro", "monokai", "nord", "solarized-dark", "solarized-light",
  "one-dark", "material", "panda-syntax", "night-owl", "cobalt2"
];

const FONTS = [
  "Fira Code", "JetBrains Mono", "Hack", "Source Code Pro",
  "Inconsolata", "Droid Sans Mono", "Anonymous Pro"
];

function buildCarbonUrl(code, { theme, font, language, fontSize, background, lineNumbers }) {
  const t  = THEMES.includes(theme) ? theme : "dracula-pro";
  const fm = FONTS.includes(font) ? font : "Fira Code";

  const params = new URLSearchParams({
    bg: background || "rgba(226,233,239,1)",
    t,
    wt: "none",
    l: language || "auto",
    ds: "false",
    dsyoff: "20px",
    dsblur: "68px",
    wc: "true",
    wa: "true",
    pv: "56px",
    ph: "56px",
    ln: lineNumbers !== false ? "true" : "false",
    fl: "1",
    fm,
    fs: fontSize || "14px",
    lh: "152%",
    si: "false",
    es: "2x",
    wm: "false"
  });

  params.append("code", code);
  return `https://carbon.now.sh/?${params.toString()}`;
}

async function generateCarbon(code, opts) {
  const targetUrl = buildCarbonUrl(code, opts);

  const res = await mql(targetUrl, {
    screenshot: { element: ".export-container", optimizeForSpeed: true },
    viewport: { width: 1024, height: 768 },
    waitFor: 3000,
    meta: false
  });

  const imageUrl = res.data?.screenshot?.url;
  if (!imageUrl) throw new Error(res.data?.error?.message || "Carbon screenshot failed");
  return imageUrl;
}

export default {
  name: "Carbon Code",
  description: "Buat screenshot cantik dari kode program.",
  category: "Canvas",
  methods: ["GET", "POST"],
  params: ["code", "code_b64", "theme", "font", "language", "fontSize", "background", "lineNumbers"],

  paramsSchema: {
    code: {
      type: "string",
      required: true,
      description: "Kode program. Untuk kirim via POST JSON, escape kutip dengan \\\". Alternatif: kirim body sebagai text/plain, atau pakai code_b64.",
      example: 'console.log("Hello World");',
      default: 'console.log("Hello World");',
      minLength: 1,
      maxLength: 5000
    },
    code_b64: {
      type: "string",
      required: false,
      description: "Kode dalam base64 (hindari masalah escaping)",
      example: "Y29uc29sZS5sb2coIkhlbGxvIFdvcmxkIik7"
    },
    theme: {
      type: "string",
      required: false,
      default: "dracula-pro",
      description: "Tema warna editor",
      example: "dracula-pro",
      enum: THEMES
    },
    font: {
      type: "string",
      required: false,
      default: "Fira Code",
      description: "Font yang digunakan",
      example: "Fira Code",
      enum: FONTS
    },
    language: {
      type: "string",
      required: false,
      default: "auto",
      description: "Bahasa pemrograman (auto-detect jika kosong)",
      example: "javascript"
    },
    fontSize: {
      type: "string",
      required: false,
      default: "14px",
      description: "Ukuran font (contoh: 14px, 16px)",
      example: "14px"
    },
    background: {
      type: "string",
      required: false,
      default: "rgba(226,233,239,1)",
      description: "Warna background (rgba atau hex)",
      example: "rgba(226,233,239,1)"
    },
    lineNumbers: {
      type: "boolean",
      required: false,
      default: true,
      description: "Tampilkan nomor baris (true/false)",
      example: true
    }
  },

  async run(req, res) {
    const p = { ...req.query, ...req.body };

    let code = p.code;

    if (p.code_b64) {
      code = Buffer.from(p.code_b64, "base64").toString("utf8");
    }

    if (!code && req.headers["content-type"]?.includes("text/plain")) {
      code = await new Promise((resolve) => {
        let raw = "";
        req.on("data", (chunk) => { raw += chunk; });
        req.on("end", () => resolve(raw));
      });
    }

    if (!code || typeof code !== "string" || !code.trim()) {
      return res.status(400).json({ status: false, message: "Parameter 'code' atau 'code_b64' wajib diisi" });
    }

    const opts = {
      theme:       p.theme       || "dracula-pro",
      font:        p.font        || "Fira Code",
      language:    p.language    || "auto",
      fontSize:    p.fontSize    || "14px",
      background:  p.background  || "rgba(226,233,239,1)",
      lineNumbers: p.lineNumbers !== "false" && p.lineNumbers !== false
    };

    try {
      const imageUrl = await generateCarbon(code.trim(), opts);

      // Download image dan return sebagai buffer
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error(`Gagal download hasil: HTTP ${imgRes.status}`);

      const buf  = Buffer.from(await imgRes.arrayBuffer());
      const mime = imgRes.headers.get("content-type") || "image/png";

      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Length", buf.length);
      res.setHeader("X-Source", "carbon.now.sh");
      return res.send(buf);

    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || "Gagal generate carbon code" });
    }
  }
};
