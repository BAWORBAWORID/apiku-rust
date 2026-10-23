import axios from 'axios';

// Pool API Key Bitly (18 key aktif dengan auto-failover & load balancing)
const apibitly = [
  'c71b6658a1d271ddaf2a5077de3dcb9d67f68025',
  'cddbceccdc2f1c9d11e4cdd0d2b1d1078e447c43',
  '7915c671fbd90eca96310e5c9442d761225a1080',
  'e5dee46eb2d69fc9f4b0057266226a52a3555356',
  'f09ab8db9cf778b37a1cf8bc406eee5063816dec',
  '964080579f959c0cc3226b4b2053cd6520bb60ad',
  'a4f429289bf8bf6291be4b1661df57dde5066525',
  '3d48e2601f25800f375ba388c30266aad54544ae',
  '4854cb9fbad67724a2ef9c27a9d1a4e9ded62faa',
  'd375cf1fafb3dc17e711870524ef4589995c4f69',
  '43f58e789d57247b2cf285d7d24ab755ba383a28',
  '971f6c6c2efe6cb5d278b4164acef11c5f21b637',
  'ae128b3094c96bf5fd1a349e7ac03113e21d82c9',
  'e65f2948f584ffd4c568bf248705eee2714abdd2',
  '08425cf957368db9136484145aa6771e1171e232',
  'dc4bec42a64749b0f23f1a8f525a69184227e301',
  '0f9eb729a7a08ff5e73fe1860c6dc587cc523035',
  '037c5017712c8f5f154ebbe6f91db1f82793c375'
];

function isUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export default {
  name: "Bitly Shortener",
  description: "Perpendek link URL menggunakan layanan Bitly",
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

    // Acak pool API keys untuk load balancing
    const shuffledKeys = [...apibitly].sort(() => Math.random() - 0.5);
    let lastError = null;

    for (const apiKey of shuffledKeys) {
      try {
        const response = await axios.post(
          'https://api-ssl.bitly.com/v4/shorten',
          { long_url: link.trim() },
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: 15000
          }
        );

        const data = response.data;
        if (data && data.link) {
          return res.json({
            status: true,
            result: data.link,
            data: {
              id: data.id,
              link: data.link,
              long_url: data.long_url,
              created_at: data.created_at
            }
          });
        }
      } catch (err) {
        const status = err.response?.status;
        const errorMsg = err.response?.data?.message || err.message;
        lastError = errorMsg;

        // Jika key suspended (403), unauthorized (401), atau rate-limit (429), otomatis coba key lain
        if (status === 403 || status === 429 || status === 401) {
          continue;
        }

        // Error spesifik link (misal invalid domain)
        return res.status(400).json({
          status: false,
          message: errorMsg
        });
      }
    }

    return res.status(500).json({
      status: false,
      message: lastError || "Gagal memperpendek link melalui Bitly"
    });
  }
};
