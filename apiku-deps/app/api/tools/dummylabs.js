/**
 * DummyLabs CC Generator API
 * Source & Engine: https://dummylabs.live/cc-gen
 * Category: Tools
 * Methods: GET, POST
 */

export const NETWORKS = {
  visa: {
    name: "Visa",
    color: "text-blue-400",
    lengths: [16, 19],
    cvvLength: 3,
    match: (bin) => /^4/.test(bin)
  },
  mastercard: {
    name: "Mastercard",
    color: "text-red-400",
    lengths: [16],
    cvvLength: 3,
    match: (bin) => {
      const b2 = parseInt(bin.slice(0, 2), 10);
      const b4 = parseInt(bin.slice(0, 4), 10);
      return (b2 >= 51 && b2 <= 55) || (bin.length >= 4 && b4 >= 2221 && b4 <= 2720);
    }
  },
  amex: {
    name: "American Express",
    color: "text-green-400",
    lengths: [15],
    cvvLength: 4,
    match: (bin) => /^(34|37)/.test(bin)
  },
  discover: {
    name: "Discover",
    color: "text-orange-400",
    lengths: [16, 19],
    cvvLength: 3,
    match: (bin) => {
      const b6 = parseInt(bin.slice(0, 6), 10);
      const b3 = parseInt(bin.slice(0, 3), 10);
      const b2 = parseInt(bin.slice(0, 2), 10);
      return (
        bin.startsWith("6011") ||
        (bin.length >= 6 && b6 >= 622126 && b6 <= 622925) ||
        (bin.length >= 3 && b3 >= 644 && b3 <= 649) ||
        b2 === 65
      );
    }
  },
  jcb: {
    name: "JCB",
    color: "text-purple-400",
    lengths: [16, 19],
    cvvLength: 3,
    match: (bin) => {
      const b4 = parseInt(bin.slice(0, 4), 10);
      return bin.length >= 4 && b4 >= 3528 && b4 <= 3589;
    }
  },
  diners: {
    name: "Diners Club",
    color: "text-cyan-400",
    lengths: [14, 16],
    cvvLength: 3,
    match: (bin) => {
      const b3 = parseInt(bin.slice(0, 3), 10);
      const b2 = parseInt(bin.slice(0, 2), 10);
      return (bin.length >= 3 && b3 >= 300 && b3 <= 305) || b2 === 36 || b2 === 38;
    }
  },
  unionpay: {
    name: "UnionPay",
    color: "text-teal-400",
    lengths: [16, 19],
    cvvLength: 3,
    match: (bin) => /^(62|81)/.test(bin)
  },
  unknown: {
    name: "Unknown",
    color: "text-muted-foreground",
    lengths: [16],
    cvvLength: 3,
    match: () => false
  }
};

export function detectNetwork(binStr) {
  if (!binStr) return NETWORKS.unknown;
  const str = String(binStr).replace(/\D/g, "");
  for (const [key, net] of Object.entries(NETWORKS)) {
    if (key !== "unknown" && net.match(str)) {
      return { key, ...net };
    }
  }
  return { key: "unknown", ...NETWORKS.unknown };
}

export function calculateLuhnCheckDigit(partial) {
  const digits = String(partial).replace(/\D/g, "").split("").map(Number);
  let sum = 0;
  let double = true;

  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }

  return ((10 - (sum % 10)) % 10).toString();
}

export function isValidLuhn(cardNumber) {
  const digits = String(cardNumber).replace(/\D/g, "").split("").map(Number);
  if (digits.length < 12) return false;

  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function generateLuhnPan(binDigits, targetLength) {
  const digits = String(binDigits).replace(/\D/g, "").split("").map(Number);
  while (digits.length < targetLength - 1) {
    digits.push(Math.floor(Math.random() * 10));
  }

  const checkDigit = calculateLuhnCheckDigit(digits.join(""));
  digits.push(parseInt(checkDigit, 10));
  return digits.join("");
}

export function generateRandomExpiry() {
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0");
  const fullYear = new Date().getFullYear() + Math.floor(Math.random() * 5) + 1;
  const shortYear = String(fullYear).slice(-2);

  return {
    month,
    year: String(fullYear),
    shortYear,
    formatted: `${month}/${shortYear}`
  };
}

export function generateRandomCvv(length = 3) {
  return Array.from({ length }, () => Math.floor(Math.random() * 10)).join("");
}

export default {
  name: "DummyLabs CC Generator",
  description: "Generate nomor Virtual Credit Card (VCC) Luhn-valid menggunakan engine DummyLabs (dummylabs.live/cc-gen). Mendukung custom Expiry (MM/YY) dan custom CVV.",
  category: "Tools",
  methods: ["GET", "POST"],
  params: ["bin", "amount", "expiry", "cvv"],

  paramsSchema: {
    bin: {
      type: "string",
      required: false,
      description: "Format BIN atau nomor prefix kartu (2-16 digit angka). Default: '42588164'",
      example: "42588164"
    },
    amount: {
      type: "integer",
      required: false,
      description: "Jumlah kartu yang ingin di-generate (1-100). Default: 10",
      example: 10
    },
    expiry: {
      type: "string",
      required: false,
      description: "Tanggal kadaluarsa kustom (format 'MM/YY', contoh: '07/28') atau 'random'. Default: 'random'",
      example: "random"
    },
    cvv: {
      type: "string",
      required: false,
      description: "Kode CVV/CVC kustom (contoh: '789') atau 'random'. Default: 'random'",
      example: "random"
    }
  },

  async run(req, res) {
    try {
      const { bin, amount, expiry, cvv } = { ...req.query, ...req.body };

      const rawBin = (bin || "").toString().trim() || "42588164";
      const cleanBin = rawBin.replace(/\D/g, "").slice(0, 16);

      if (cleanBin.length < 2) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'bin' minimal harus memiliki 2 digit angka."
        });
      }

      const parsedAmount = parseInt(amount, 10);
      const totalAmount = (!isNaN(parsedAmount) && parsedAmount >= 1)
        ? Math.min(parsedAmount, 100)
        : 10;

      const network = detectNetwork(cleanBin);
      const targetLength = network.lengths[0];
      const cvvLength = network.cvvLength;

      const customExpiry = expiry && expiry !== "random" ? String(expiry).trim() : null;
      const customCvv = cvv && cvv !== "random" ? String(cvv).trim() : null;

      const cards = [];
      const displayList = [];
      const pipeList = [];

      for (let i = 0; i < totalAmount; i++) {
        const rawNumber = generateLuhnPan(cleanBin, targetLength);
        const formattedNumber = rawNumber.replace(/(.{4})/g, "$1 ").trim();

        let exp;
        if (customExpiry) {
          const parts = customExpiry.replace(/[^\d/]/g, "").split("/");
          const m = (parts[0] || "01").padStart(2, "0");
          let y = parts[1] || "28";
          if (y.length === 2) y = "20" + y;
          exp = { month: m, year: y, formatted: `${m}/${y.slice(-2)}` };
        } else {
          exp = generateRandomExpiry();
        }

        const cardCvv = customCvv || generateRandomCvv(cvvLength);
        const display = `${formattedNumber} | ${exp.formatted} | ${cardCvv}`;
        const pipe = `${rawNumber}|${exp.month}|${exp.year}|${cardCvv}`;

        cards.push({
          card_number: rawNumber,
          formatted: formattedNumber,
          month: exp.month,
          year: exp.year,
          expiry: exp.formatted,
          cvv: cardCvv,
          network: network.name,
          display,
          pipe,
          luhn_valid: isValidLuhn(rawNumber)
        });

        displayList.push(display);
        pipeList.push(pipe);
      }

      return res.json({
        status: true,
        bin: cleanBin,
        network: network.name,
        total: cards.length,
        cards,
        pipe: pipeList,
        display: displayList,
        timestamp: new Date().toISOString()
      });

    } catch (err) {
      console.error("DummyLabs CC Generator Error:", err.message);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal generate kartu dari DummyLabs"
      });
    }
  }
};
