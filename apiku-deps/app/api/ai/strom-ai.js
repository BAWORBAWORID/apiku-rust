/**
 * PROJECT     : Strom-AI Chat
 * CREATOR     : BAWORBAWORID
 * DESCRIPTION : Chat AI via strom-ai.my.id — support 4 mode: strom, nightgpt, deepseek, llama4
 * BASE_URL    : https://strom-ai.my.id
 */

const BASE = 'https://strom-ai.my.id';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MODES = ['strom', 'nightgpt', 'deepseek', 'llama4'];

const baseHeaders = {
  'Content-Type': 'application/json',
  'Origin': BASE,
  'Referer': BASE + '/',
  'User-Agent': UA
};

function randomId(prefix = 'user_') {
  return prefix + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

async function stromChat(prompt, mode = 'strom', sessionId = null) {
  const uid = randomId();
  const sid = sessionId || randomId('sess_');

  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({
      prompt,
      sessionId: sid,
      image: null,
      mimeType: null,
      userId: uid,
      mode
    })
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  if (!data.text || data.text === 'No response') throw new Error('Upstream tidak memberikan respons');

  return {
    text: data.text,
    session_id: data.sessionId || sid,
    mode
  };
}

export default {
  name: "Strom-AI Chat",
  description: "Chat AI via Strom-AI — 4 mode tersedia: strom (default), nightgpt, deepseek, llama4",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["text", "mode", "session_id"],
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Pesan atau pertanyaan untuk AI",
      example: "Siapa presiden Indonesia pertama?"
    },
    mode: {
      type: "string",
      required: false,
      default: "strom",
      enum: MODES,
      description: "Mode AI yang digunakan (strom, nightgpt, deepseek, llama4)"
    },
    session_id: {
      type: "string",
      required: false,
      description: "Session ID untuk melanjutkan percakapan sebelumnya"
    }
  },

  async run(req, res) {
    const { text, teks, prompt, message, mode = 'strom', session_id } = { ...req.query, ...req.body };
    const rawInput = text || teks || prompt || message;

    if (!rawInput || typeof rawInput !== 'string' || !rawInput.trim()) {
      return res.status(400).json({ status: false, message: "Parameter 'text' wajib diisi" });
    }

    if (!MODES.includes(mode)) {
      return res.status(400).json({
        status: false,
        message: `Mode tidak valid. Pilih dari: ${MODES.join(', ')}`
      });
    }

    try {
      const result = await stromChat(rawInput.trim(), mode, session_id || null);
      return res.json({
        status: true,
        result: result.text,
        session_id: result.session_id,
        mode: result.mode
      });
    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || "Gagal chat dengan Strom-AI" });
    }
  }
};
