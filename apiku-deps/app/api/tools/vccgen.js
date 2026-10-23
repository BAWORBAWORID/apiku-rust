const NETWORKS = {
  visa: { name: "Visa", lengths: [16, 19], cvvLength: 3 },
  mastercard: { name: "Mastercard", lengths: [16], cvvLength: 3 },
  amex: { name: "American Express", lengths: [15], cvvLength: 4 },
  discover: { name: "Discover", lengths: [16, 19], cvvLength: 3 },
  jcb: { name: "JCB", lengths: [16, 19], cvvLength: 3 },
  diners: { name: "Diners Club", lengths: [14, 16], cvvLength: 3 },
  unionpay: { name: "UnionPay", lengths: [16, 19], cvvLength: 3 },
  unknown: { name: "Unknown", lengths: [16], cvvLength: 3 }
};

const DEFAULT_BIN = "4258-8164|07|20-27";

function detectNetwork(binDigits) {
  if (!binDigits) return "unknown";
  const t = parseInt(binDigits.slice(0, 2), 10);
  const r = parseInt(binDigits.slice(0, 4), 10);
  const a = parseInt(binDigits.slice(0, 6), 10);

  if (t === 34 || t === 37) return "amex";
  if ((t >= 51 && t <= 55) || (binDigits.length >= 4 && r >= 2221 && r <= 2720)) return "mastercard";
  if (binDigits[0] === "4") return "visa";
  if (
    (binDigits.length >= 4 && r === 6011) ||
    (binDigits.length >= 6 && a >= 622126 && a <= 622925) ||
    (binDigits.length >= 3 && parseInt(binDigits.slice(0, 3), 10) >= 644 && parseInt(binDigits.slice(0, 3), 10) <= 649) ||
    t === 65
  ) return "discover";
  if (binDigits.length >= 4 && r >= 3528 && r <= 3589) return "jcb";
  if (
    (binDigits.length >= 3 && parseInt(binDigits.slice(0, 3), 10) >= 300 && parseInt(binDigits.slice(0, 3), 10) <= 305) ||
    t === 36 ||
    t === 38
  ) return "diners";
  if (t === 62) return "unionpay";
  return "unknown";
}

function generateLuhnNumber(binDigits, targetLength) {
  const digits = binDigits.split("").map(Number);
  while (digits.length < targetLength - 1) {
    digits.push(Math.floor(Math.random() * 10));
  }
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits[i];
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  digits.push(checkDigit);
  return digits.join("");
}

function isValidLuhn(cardNumber) {
  const digits = cardNumber.replace(/\D/g, "").split("").map(Number);
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits[i];
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function generateRandomExpiry() {
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0");
  const year = new Date().getFullYear() + Math.floor(Math.random() * 5) + 1;
  return { month, year: String(year) };
}

function generateRandomCvv(length = 3) {
  return Array.from({ length }, () => Math.floor(Math.random() * 10)).join("");
}

function parseInputPattern(inputStr) {
  const cleanInput = (inputStr || "").toString().trim() || DEFAULT_BIN;
  const parts = cleanInput.split("|").map(p => p.trim());
  const rawBin = parts[0] || "";
  const cleanBin = rawBin.replace(/\D/g, "").slice(0, 16);

  let customMonth = null;
  let customYear = null;
  let customCvv = null;

  if (parts.length >= 2 && parts[1]) {
    const m = parts[1].replace(/\D/g, "");
    if (m) customMonth = m.padStart(2, "0");
  }

  if (parts.length >= 3 && parts[2]) {
    let y = parts[2].replace(/\D/g, "");
    if (y.length === 2) {
      y = "20" + y;
    } else if (y.length > 4) {
      y = y.slice(-4);
    }
    if (y) customYear = y;
  }

  if (parts.length >= 4 && parts[3]) {
    const c = parts[3].replace(/\D/g, "");
    if (c) customCvv = c;
  }

  return { cleanBin, rawBin, customMonth, customYear, customCvv, rawInput: cleanInput };
}

export default {
  name: "VCC Generator",
  description: "Generate nomor Virtual Credit Card (VCC) Luhn-valid untuk testing payment gateway. Bisa langsung dipanggil tanpa parameter (menggunakan default BIN 4258-8164|07|20-27) atau dengan custom BIN/pola.",
  category: "Tools",
  methods: ["GET", "POST"],
  params: ["bin", "amount"],

  paramsSchema: {
    bin: {
      type: "string",
      required: false,
      description: "Format BIN atau pola kartu (contoh: '4258-8164|07|20-27' atau '541288|12|28'). Default: '4258-8164|07|20-27'",
      example: "4258-8164|07|20-27"
    },
    amount: {
      type: "integer",
      required: false,
      description: "Jumlah kartu yang ingin di-generate (1-100). Default: 10",
      example: 10
    }
  },

  features: {
    platform: "VCC Luhn Generator",
    region: "Global"
  },

  async run(req, res) {
    try {
      const { bin, amount } = { ...req.query, ...req.body };

      const {
        cleanBin,
        customMonth,
        customYear,
        customCvv,
        rawInput
      } = parseInputPattern(bin);

      if (cleanBin.length < 2) {
        return res.status(400).json({
          status: false,
          message: "BIN minimal harus memiliki 2 digit angka."
        });
      }

      const parsedAmount = parseInt(amount, 10);
      const totalAmount = (!isNaN(parsedAmount) && parsedAmount >= 1)
        ? Math.min(parsedAmount, 100)
        : 10;

      const networkKey = detectNetwork(cleanBin);
      const network = NETWORKS[networkKey];
      const targetLength = network.lengths[0];
      const cvvLength = network.cvvLength;

      const cards = [];
      const rawList = [];

      for (let i = 0; i < totalAmount; i++) {
        const rawNumber = generateLuhnNumber(cleanBin, targetLength);
        const exp = (customMonth && customYear)
          ? { month: customMonth, year: customYear }
          : generateRandomExpiry();
        const cvv = customCvv || generateRandomCvv(cvvLength);

        const formattedNumber = rawNumber.replace(/(.{4})/g, "$1 ").trim();
        const pipeFormat = `${rawNumber}|${exp.month}|${exp.year}|${cvv}`;

        cards.push({
          card_number: rawNumber,
          formatted: formattedNumber,
          month: exp.month,
          year: exp.year,
          cvv,
          pipe: pipeFormat,
          network: network.name,
          luhn_valid: isValidLuhn(rawNumber)
        });

        rawList.push(pipeFormat);
      }

      return res.json({
        status: true,
        result: {
          total: cards.length,
          bin_pattern: rawInput,
          network: network.name,
          card_length: targetLength,
          cvv_length: cvvLength,
          cards,
          raw_list: rawList
        },
        timestamp: Date.now()
      });

    } catch (err) {
      console.error("VCC Generator Error:", err.message);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal generate Virtual Credit Card"
      });
    }
  }
};
