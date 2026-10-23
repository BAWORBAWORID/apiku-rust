import axios from "axios";

const SITE = "https://backend.lambdatest.com";
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36";

export default {
  name: "Credit Card Generator",
  description: "Generate credit card numbers via Lambdatest API",
  category: "Tools",
  methods: ["GET", "POST"],
  params: ["type", "amount"],
  paramsSchema: {
    type: {
      type: "string",
      required: true,
      description: "Card type",
      enum: ["Visa", "American Express", "MasterCard", "JCB"],
      example: "Visa"
    },
    amount: {
      type: "integer",
      required: true,
      description: "Number of cards to generate (1-100)",
      minimum: 1,
      maximum: 100,
      example: 10
    }
  },

  async run(req, res) {
    const { type, amount } = { ...req.query, ...req.body };

    if (!type || !amount) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'type' and 'amount' wajib diisi"
      });
    }

    const rawType = (type || "").toString().trim();
    const typeMap = {
      visa: "Visa",
      "american express": "American Express",
      amex: "American Express",
      mastercard: "MasterCard",
      master: "MasterCard",
      jcb: "JCB"
    };
    const normalizedType = typeMap[rawType.toLowerCase()] || rawType;

    const allowedTypes = ["Visa", "American Express", "MasterCard", "JCB"];
    if (!allowedTypes.includes(normalizedType)) {
      return res.status(400).json({
        status: false,
        message: `Invalid type '${rawType}'. Yang tersedia: ${allowedTypes.join(", ")}`
      });
    }

    const parsedAmount = parseInt(amount, 10);
    if (isNaN(parsedAmount) || parsedAmount < 1 || parsedAmount > 100) {
      return res.status(400).json({
        status: false,
        message: "Invalid amount. Kudu angka antara 1 hingga 100."
      });
    }

    try {
      const config = {
        method: "GET",
        url: `${SITE}/api/dev-tools/credit-card-generator?type=${encodeURIComponent(
          normalizedType
        )}&no-of-cards=${parsedAmount}`,
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "sec-ch-ua-platform": '"Android"',
          "sec-ch-ua": '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
          "content-type": "application/json",
          dnt: "1",
          "sec-ch-ua-mobile": "?1",
          origin: "https://www.lambdatest.com",
          "sec-fetch-site": "same-site",
          "sec-fetch-mode": "cors",
          "sec-fetch-dest": "empty",
          referer:
            "https://www.lambdatest.com/free-online-tools/credit-card-number-generator",
          "accept-language": "id,en-US;q=0.9,en;q=0.8,ja;q=0.7",
          priority: "u=1, i"
        }
      };

      const api = await axios.request(config);
      return res.json({
        status: true,
        result: api.data
      });
    } catch (e) {
      console.log(e);
      return res.status(500).json({
        status: false,
        message: "Gagal generate credit card"
      });
    }
  }
};