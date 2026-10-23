import crypto from "crypto";
import axios from "axios";

const ALGOS = {
  "SHA-1": "sha1",
  "SHA-256": "sha256",
  "SHA-384": "sha384",
  "SHA-512": "sha512",
};

function hashHex(algorithm, data) {
  const nodeAlg = ALGOS[String(algorithm || "SHA-256").toUpperCase()];
  if (!nodeAlg) {
    throw new Error("Unsupported algorithm: " + algorithm);
  }
  return crypto.createHash(nodeAlg).update(String(data), "utf8").digest("hex");
}

async function fetchChallenge(challengeurl) {
  const res = await axios.get(challengeurl, { timeout: 15000 });
  const data = res.data;
  if (!data || !data.challenge || !data.salt) {
    throw new Error("Invalid challenge response (missing challenge/salt)");
  }
  return data;
}

async function solveAltcha({ challengeurl, challenge, max, start, timeout = 60 } = {}) {
  const startTime = Date.now();
  let ch = challenge || null;

  if (!ch && challengeurl) {
    ch = await fetchChallenge(challengeurl);
  }
  if (!ch || !ch.challenge || !ch.salt) {
    throw new Error("challenge object or challengeurl is required");
  }

  const algorithm = ch.algorithm || "SHA-256";
  const maxNumber = Math.min(max || ch.maxnumber || 1e6, ch.maxnumber || 1e6);
  const startNumber = Math.max(start || 0, 0);
  const timeoutMs = Math.min(Math.max((timeout || 60) * 1000, 5000), 300000);

  let number = null;
  for (let n = startNumber; n <= maxNumber; n++) {
    if ((n & 4095) === 0 && Date.now() - startTime > timeoutMs) {
      throw new Error("Timeout solving Altcha challenge");
    }
    if (hashHex(algorithm, ch.salt + n) === ch.challenge) {
      number = n;
      break;
    }
  }

  if (number === null) {
    throw new Error("No solution found within maxnumber");
  }

  const payload = {
    algorithm,
    challenge: ch.challenge,
    number,
    salt: ch.salt,
    signature: ch.signature || null,
  };

  return {
    success: true,
    data: {
      payload: Buffer.from(JSON.stringify(payload)).toString("base64"),
      number,
      algorithm,
      salt: ch.salt,
      signature: ch.signature || null,
    },
    duration: Date.now() - startTime,
  };
}

export default {
  name: "Altcha Solver",
  description: "Solve Altcha proof-of-work captcha challenges",
  category: "Solve",
  methods: ["POST"],

  params: ["challengeurl", "challenge", "max", "start", "timeout"],

  paramsSchema: {
    challengeurl: {
      type: "string",
      required: false,
      description: "URL to fetch Altcha challenge from",
      example: "https://example.com/altcha-challenge",
    },
    challenge: {
      type: "object",
      required: false,
      description: "Challenge object (alternative to challengeurl)",
      example: { challenge: "abc123", salt: "salt123", algorithm: "SHA-256", maxnumber: 1000000 },
    },
    max: {
      type: "number",
      required: false,
      description: "Maximum number to try (overrides challenge.maxnumber)",
      example: 1000000,
    },
    start: {
      type: "number",
      required: false,
      default: 0,
      description: "Starting number for brute force",
      example: 0,
    },
    timeout: {
      type: "number",
      required: false,
      default: 60,
      description: "Timeout in seconds",
      example: 60,
    },
  },

  async run(req, res) {
    try {
      const { challengeurl, challenge, max, start, timeout } = { ...req.query, ...req.body };

      const result = await solveAltcha({ challengeurl, challenge, max, start, timeout });

      return res.json({
        status: true,
        result: {
          payload: result.data.payload,
          number: result.data.number,
          algorithm: result.data.algorithm,
          salt: result.data.salt,
          signature: result.data.signature,
          duration: result.duration,
        },
      });
    } catch (e) {
      return res.status(500).json({
        status: false,
        message: e.message || "Gagal solve Altcha",
      });
    }
  }
};