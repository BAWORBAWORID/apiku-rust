import crypto from "crypto";

async function askHilda(message) {
  try {
    const xsrfToken = crypto.randomBytes(32).toString('hex').toUpperCase();
    const fingerprint = crypto.randomBytes(16).toString('hex');
    const referenceId = `${crypto.randomUUID()}:${Date.now()}`;

    const headers = {
      'Host': 'customers.api.halodoc.com',
      'Connection': 'keep-alive',
      'sec-ch-ua-platform': '"Android"',
      'X-XSRF-TOKEN': xsrfToken,
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Infinix X6837 Build/BP2A.250605.031.A2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'Origin': 'https://www.halodoc.com',
      'Referer': 'https://www.halodoc.com/',
      'Cookie': `XSRF-TOKEN=${xsrfToken};`
    };

    const sessionRes = await fetch('https://customers.api.halodoc.com/magneto-api/v1/concierge/guest/sessions', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        usecase_type: 'h4c_concierge',
        fingerprint: fingerprint
      })
    });

    if (!sessionRes.ok) {
      throw new Error(`${sessionRes.status} ${sessionRes.statusText}`);
    }

    const sessionData = await sessionRes.json();
    const sessionId = sessionData.session_id;

    const chatRes = await fetch('https://customers.api.halodoc.com/magneto-api/v1/concierge/guest/conversation', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        session_id: sessionId,
        message: message,
        type: 'text',
        reference_id: referenceId,
        usecase_type: 'h4c_concierge'
      })
    });

    if (!chatRes.ok) {
      throw new Error(`${chatRes.status} ${chatRes.statusText}`);
    }

    const chatData = await chatRes.json();
    return chatData;

  } catch (error) {
    console.error(error.message);
    throw error;
  }
}

export default {
  name: "Halodoc AI",
  description: "AI Konsultasi Kesehatan (Hilda)",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["teks"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Pertanyaan seputar kesehatan atau obat-obatan",
      example: "saran obat flu batuk yang manjur dan murah?",
      minLength: 1,
      maxLength: 2000
    }
  },

  async run(req, res) {
    try {
      const { teks } = { ...req.query, ...req.body };

      if (!teks || typeof teks !== "string" || teks.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'teks' wajib diisi dengan pertanyaan seputar kesehatan"
        });
      }

      const result = await askHilda(teks.trim());

      res.json({
        status: true,
        model: "Halodoc Hilda",
        input: teks.trim(),
        result: result
      });
    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "Halodoc AI request failed"
      });
    }
  }
};
