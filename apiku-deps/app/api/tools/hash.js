import crypto from 'crypto';

const ALGOS = ['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512',
  'sha3-256', 'sha3-512', 'ripemd160', 'blake2b512'];

export default {
  name: "Hash Generator",
  description: "Generate text hash (MD5, SHA1, SHA256, SHA512, etc)",
  category: "Tools",
  methods: ["GET", "POST"],

  params: ["text", "algo"],

  paramsSchema: {
    text: {
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 10000,
      description: "Text to hash",
      example: "halo"
    },
    algo: {
      type: "string",
      required: true,
      enum: ["md5", "sha1", "sha224", "sha256", "sha384", "sha512", "sha3-256", "sha3-512", "ripemd160", "blake2b512"],
      description: "Hash algorithm (pilih salah satu)",
      example: "sha256"
    }
  },

  async run(req, res) {
    try {
      const { text, algo: rawAlgo } = { ...req.query, ...req.body };

      if (!text) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'text' wajib diisi"
        });
      }

      const arg = String(rawAlgo || '').toLowerCase().trim();

      if (!arg) {
        return res.json({
          status: true,
          result: {
            message: "Pilih salah satu algo berikut",
            supported: ALGOS
          }
        });
      }

      const list = [...new Set(arg.split(',').map(s => s.trim()).filter(Boolean))];

      const invalid = list.filter(a => !ALGOS.includes(a));
      if (invalid.length > 0) {
        return res.status(400).json({
          status: false,
          message: `Algoritma tidak didukung: ${invalid.join(', ')}`,
          supported: ALGOS
        });
      }

      const hashes = {};
      for (const a of list) {
        hashes[a] = crypto.createHash(a).update(String(text)).digest('hex');
      }

      return res.json({
        status: true,
        result: list.length === 1 ? { algo: list[0], hash: hashes[list[0]] } : { text: String(text), hashes }
      });
    } catch (e) {
      return res.status(500).json({
        status: false,
        message: e.message || "Hash generation failed"
      });
    }
  }
};
