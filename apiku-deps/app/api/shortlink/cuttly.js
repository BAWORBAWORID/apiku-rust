import axios from 'axios';

// Pool API Key Cuttly (load-balancing & auto-fallback)
const apicuttly = [
  '4786cc6a0f19de9c67ea6a4282c494323c932',
  '2038c1a7754b408aa8f9055282638c00e668e',
  '127b09320337c7f855427601a74eddd8261ee',
  '89d73b3a07209177d0251e30d49d66bd669ac',
  'e841147455d0fdfbf50f74aefe63b6728adc0',
  '27f3aa3f45cb4460bcbac69b782ca470a4570',
  '31a8df09d5a9d8d009790df0b5642e3d76919',
  '09b4e764ff07b10eac1682e71aaf95a78f358',
  '75fe576ce040b619176af22f5a718b2f574f5',
  'e24ee36f9c1519c0a779667a5182a31fb7ccf',
  '903869065d29e23455ddca922071f4bbeb133',
  'e40a3b5f856026b0b42555a09dff20e0',
  'de3805d3b96674a142e054749a0f43f346815'
];

function isUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const CUTTLY_STATUS_MSG = {
  1: "Link sudah pernah diperpendek sebelumnya",
  2: "Link yang dimasukkan bukan URL valid",
  3: "Nama alias sudah digunakan",
  4: "API Key tidak valid",
  5: "Link mengandung karakter yang tidak diizinkan",
  6: "Domain link diblokir oleh Cutt.ly",
  7: "Berhasil"
};

export default {
  name: "Cutt.ly Shortener",
  description: "Perpendek link URL menggunakan layanan Cutt.ly",
  category: "Shortlink",
  methods: ["GET", "POST"],

  params: ["link"],

  paramsSchema: {
    link: {
      type: "string",
      required: true,
      description: "URL yang ingin diperpendek",
      example: "https://google.com"
    }
  },

  async run(req, res) {
    const { link } = { ...req.query, ...req.body };

    if (!link) {
      return res.status(400).json({
        status: false,
        message: "[!] masukan parameter link"
      });
    }

    if (!isUrl(link)) {
      return res.status(400).json({
        status: false,
        message: "[!] masukan parameter url sahaja"
      });
    }

    // Acak urutan API keys untuk load balancing & failover
    const shuffledKeys = [...apicuttly].sort(() => Math.random() - 0.5);
    let lastError = null;

    for (const apiKey of shuffledKeys) {
      try {
        const endpoint = `https://cutt.ly/api/api.php?key=${apiKey}&short=${encodeURIComponent(link.trim())}`;
        const response = await axios.get(endpoint, { timeout: 15000 });
        const hasil = response.data;

        if (!hasil || !hasil.url) continue;

        // Status 7 = baru dibuat, Status 1 = sudah ada
        if (hasil.url.status === 7 || hasil.url.status === 1) {
          return res.json({
            status: true,
            result: hasil.url.shortLink,
            data: {
              fullLink: hasil.url.fullLink,
              shortLink: hasil.url.shortLink,
              title: hasil.url.title,
              date: hasil.url.date
            }
          });
        }

        // Jika status 4 (invalid key atau kuota habis), coba key lain di pool
        if (hasil.url.status === 4) {
          lastError = CUTTLY_STATUS_MSG[4];
          continue;
        }

        // Error spesifik link (status 2, 5, 6)
        return res.status(400).json({
          status: false,
          message: CUTTLY_STATUS_MSG[hasil.url.status] || `Cutt.ly error code: ${hasil.url.status}`
        });
      } catch (err) {
        lastError = err.message;
        continue;
      }
    }

    return res.status(500).json({
      status: false,
      message: lastError || "Gagal memperpendek link melalui Cutt.ly"
    });
  }
};
