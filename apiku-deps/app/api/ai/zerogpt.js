/**
 * PROJECT     : ZeroGPT AI (Chat & Detector)
 * CREATOR     : BAWORBAWORID
 * DESCRIPTION : Chat dengan ZeroGPT AI Assistant dan fitur deteksi AI
 * BASE_URL    : https://api.zerogpt.com
 */

const BASE_URL = 'https://api.zerogpt.com';
const WS_URL = 'wss://api.zerogpt.com/api/transform/ws';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function cleanText(text) {
  return String(text ?? '')
    .replace(/\u200b/g, ' ')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// ==================== WEBSOCKET & CHAT ====================
function openSocket(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    let ws;
    try {
      ws = new WebSocket(WS_URL, {
        headers: {
          Origin: 'https://www.zerogpt.com',
          'User-Agent': USER_AGENT
        }
      });
    } catch (e) {
      return reject(e);
    }

    const ctx = {
      ws,
      clientId: '',
      buffer: [],
      done: false,
      closed: false
    };

    let doneResolve = null;
    ctx.donePromise = new Promise((res) => {
      doneResolve = res;
    });

    ctx._resolveDone = () => {
      if (!ctx.done) {
        ctx.done = true;
        doneResolve();
      }
    };

    timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch (_) {}
        reject(new Error('WebSocket connection timeout'));
      }
    }, timeoutMs);

    ws.onerror = (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        try { ws.close(); } catch (_) {}
        reject(new Error(err?.message || 'WebSocket connect error'));
      }
    };

    ws.onmessage = (event) => {
      const frame = String(event.data);
      if (frame.startsWith('setClientId,')) {
        ctx.clientId = frame.split(',', 2)[1];
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(ctx);
        }
      } else if (frame === 'done') {
        ctx._resolveDone();
      } else if (frame === '') {
        return;
      } else {
        ctx.buffer.push(frame);
      }
    };

    ws.onclose = () => {
      ctx.closed = true;
      ctx._resolveDone();
    };
  });
}

async function readStream(ctx, timeoutMs = 30000) {
  if (ctx.done) return ctx.buffer.join('');
  const timer = setTimeout(() => ctx._resolveDone(), timeoutMs);
  try {
    await ctx.donePromise;
  } finally {
    clearTimeout(timer);
  }
  return ctx.buffer.join('');
}

async function chatWithZeroGPT(prompt, conversationId = 0) {
  const started = Date.now();
  let socket = null;
  let clientId = '';

  try {
    socket = await openSocket(10000);
    clientId = socket.clientId;
  } catch (err) {
    // WebSocket fallback
  }

  try {
    const res = await fetch(`${BASE_URL}/api/transform/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://www.zerogpt.com',
        'Referer': 'https://www.zerogpt.com/',
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*'
      },
      body: JSON.stringify({
        string: prompt,
        wsId: clientId,
        conversation_id: Number(conversationId) || 0,
        chatVersion: 1
      })
    });

    const body = await res.json();
    if (!res.ok || body?.success === false) {
      throw new Error(body?.message || `Chat API error (HTTP ${res.status})`);
    }

    const data = body?.data || {};
    let reply = String(data.message || '').trim();

    if (socket) {
      try {
        const streamedTokens = await readStream(socket, 30000);
        if (streamedTokens && streamedTokens.trim()) {
          reply = streamedTokens.trim();
        }
      } catch (_) {}
    }

    if (!reply || reply.includes('no channel exists')) {
      throw new Error('ZeroGPT tidak memberikan balasan yang valid.');
    }

    return {
      response: reply,
      conversation_id: data.conversation_id || conversationId || 0,
      duration_ms: Date.now() - started
    };
  } finally {
    if (socket?.ws) {
      try { socket.ws.close(); } catch (_) {}
    }
  }
}

// ==================== DETECTOR ====================
async function detectAI(text, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE_URL}/api/detect/detectText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://www.zerogpt.com',
        'Referer': 'https://www.zerogpt.com/',
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*'
      },
      body: JSON.stringify({ input_text: text }),
      signal: controller.signal
    });

    const json = await res.json();
    if (!res.ok || json?.success === false) {
      throw new Error(json?.message || `ZeroGPT API error (HTTP ${res.status})`);
    }

    const d = json?.data || {};
    const fake = Number(d.fakePercentage ?? 0);
    const verdict = fake >= 70 ? 'ai' : fake <= 30 ? 'human' : 'uncertain';

    return {
      verdict,
      fake_percentage: fake,
      is_human: Number(d.isHuman ?? 0),
      ai_words: Number(d.aiWords ?? 0),
      text_words: Number(d.textWords ?? 0),
      ai_characters: d.aiCharacters ?? null,
      feedback: d.feedback || '',
      additional_feedback: d.additional_feedback || '',
      detected_language: d.detected_language || 'en',
      sentences: d.sentences || [],
      highlights: d.h || [],
      highlight_indexes: d.hi || [],
      special_indexes: d.specialIndexes || [],
      special_sentences: d.specialSentences || []
    };
  } finally {
    clearTimeout(timer);
  }
}

export default {
  name: "ZeroGPT AI",
  description: "Chat interaktif dengan ZeroGPT AI Assistant (mendukung mode chat dan deteksi AI)",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["text", "action", "conversation_id"],
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Pesan untuk chat atau teks untuk dideteksi",
      example: "Siapa presiden Indonesia pertama?"
    },
    action: {
      type: "string",
      required: false,
      default: "chat",
      enum: ["chat", "detect"],
      description: "Aksi yang ingin dijalankan: 'chat' (default) atau 'detect'"
    },
    conversation_id: {
      type: "number",
      required: false,
      default: 0,
      description: "ID percakapan untuk melanjutkan chat sebelumnya (khusus mode chat)"
    }
  },

  async run(req, res) {
    const { text, teks, prompt, message, action, mode, conversation_id } = { ...req.query, ...req.body };
    const rawInput = text || teks || prompt || message;

    if (!rawInput || typeof rawInput !== 'string' || !rawInput.trim()) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'text' wajib diisi"
      });
    }

    const cleaned = cleanText(rawInput);
    const selectedAction = String(action || mode || 'chat').toLowerCase();

    // Mode Detect
    if (selectedAction === 'detect') {
      if (cleaned.length < 10) {
        return res.status(400).json({
          status: false,
          message: `Teks terlalu pendek untuk deteksi: ${cleaned.length} karakter (minimal 10 karakter)`
        });
      }

      try {
        const result = await detectAI(cleaned);
        return res.json({
          status: true,
          action: "detect",
          result
        });
      } catch (err) {
        return res.status(500).json({
          status: false,
          message: err.message || "Gagal mendeteksi teks dengan ZeroGPT"
        });
      }
    }

    // Default: Mode Chat
    try {
      const result = await chatWithZeroGPT(cleaned, conversation_id);
      return res.json({
        status: true,
        action: "chat",
        result: result.response,
        conversation_id: result.conversation_id,
        duration_ms: result.duration_ms
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal berkomunikasi dengan ZeroGPT Chat"
      });
    }
  }
};
