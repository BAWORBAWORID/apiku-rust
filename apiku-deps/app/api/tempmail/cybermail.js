/**
 * CyberMail Temporary Email API
 * Provider: CyberMail (cybermail.us)
 * API Base: https://api.cybermail.us
 * Category: Email
 * Fitur   : Generate disposable email, cek inbox, auto-extract OTP, baca pesan, list domain, hapus pesan
 */

import logger from '../../src/utils/logger.js';

const API_BASE = 'https://api.cybermail.us';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const WORDLIST = [
  'cyber', 'retro', 'neon', 'pixel', 'hack', 'code', 'tech', 'digital',
  'matrix', 'quantum', 'synth', 'wave', 'glow', 'volt', 'echo', 'nova',
  'flux', 'byte', 'data', 'core', 'alpha', 'beta', 'gamma', 'delta',
  'omega', 'prime', 'nexus', 'vertex', 'axis', 'grid'
];

const FALLBACK_DOMAINS = [
  'cybermail.us',
  'cybermail.biz.id',
  'cybermail.my.id',
  'cyber-mail.site',
  'cybermail.web.id'
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Ekstraksi OTP / Verification Code otomatis
function extractOtp(subject = '', body = '') {
  const text = `${subject}\n${body}`;
  const lower = text.toLowerCase();
  const codeRegex = /\b\d{4,8}\b/g;
  const triggers = [
    'kode', 'code', 'otp', 'verifikasi', 'verification', 'verify',
    'pin', 'passcode', 'one-time', 'sekali pakai', 'token', 'authentication', 'autentikasi'
  ];
  const negativeTriggers = [
    'invoice', 'pesanan', 'order', 'total', 'tagihan', 'faktur', 'resi', 'nomor', 'no.', 'rp', 'harga', 'jumlah'
  ];

  let otp = null;
  for (const match of text.matchAll(codeRegex)) {
    const idx = match.index || 0;
    const end = idx + match[0].length;
    const before = lower.slice(Math.max(0, idx - 80), idx);
    const after = lower.slice(end, Math.min(lower.length, end + 40));
    const near = `${before} ${after}`;

    if (idx > 0 && text[idx - 1] === '#') continue;
    if (negativeTriggers.some(neg => near.includes(neg))) continue;

    if (triggers.some(trig => near.includes(trig))) {
      if (!otp || match[0].length === 6) {
        otp = match[0];
      }
    }
  }
  return otp;
}

// 1. Fetch domain terverifikasi
async function getDomains() {
  try {
    const res = await fetch(`${API_BASE}/api/domains`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        const verified = json.data.filter((d) => d.verified).map((d) => d.name);
        if (verified.length > 0) return verified;
      }
    }
  } catch {}
  return FALLBACK_DOMAINS;
}

// 2. Generate email temporary
async function generateEmail(customUser = '', customDomain = '') {
  const domains = await getDomains();

  let domain = (customDomain || '').trim().toLowerCase();
  if (!domain || !domains.includes(domain)) {
    domain = domains[Math.floor(Math.random() * domains.length)];
  }

  let username = (customUser || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!username) {
    const word = WORDLIST[Math.floor(Math.random() * WORDLIST.length)];
    const num = Math.floor(Math.random() * 999) + 1;
    username = `${word}${num}`;
  }

  const email = `${username}@${domain}`;
  return {
    email,
    username,
    domain,
    available_domains: domains,
    created_at: new Date().toISOString(),
  };
}

// 3. Fetch inbox
async function fetchInbox(email) {
  const res = await fetch(`${API_BASE}/api/inbox/${encodeURIComponent(email)}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    throw new Error(`Gagal mengambil inbox: HTTP ${res.status}`);
  }

  const json = await res.json();
  const rawEmails = json.data?.emails || [];

  return rawEmails.map((e) => ({
    id: e.id,
    from: e.from,
    subject: e.subject,
    otp: extractOtp(e.subject, e.body),
    received_at: e.received_at,
    expires_in: e.expires_in,
    is_read: e.is_read,
    body: e.body || '',
    html: e.html || '',
  }));
}

// 4. Polling wait for inbox
async function waitForInbox(email, maxWaitSeconds = 30) {
  const maxWait = Math.min(Math.max(parseInt(maxWaitSeconds, 10) || 30, 5), 60);
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait * 1000) {
    const emails = await fetchInbox(email);
    if (emails.length > 0) {
      return emails;
    }
    await sleep(3000);
  }

  return [];
}

// 5. Fetch single message
async function fetchMessage(email, id) {
  const res = await fetch(`${API_BASE}/api/inbox/${encodeURIComponent(email)}/${id}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.message || `Pesan ID "${id}" tidak ditemukan`);
  }
  const e = json.data || {};
  return {
    id: e.id,
    from: e.from,
    subject: e.subject,
    otp: extractOtp(e.subject, e.body),
    received_at: e.received_at,
    body: e.body || '',
    html: e.html || '',
  };
}

// 6. Delete message or inbox
async function deleteMail(email, id = null) {
  const url = id
    ? `${API_BASE}/api/inbox/${encodeURIComponent(email)}/${id}`
    : `${API_BASE}/api/inbox/${encodeURIComponent(email)}`;

  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });

  const json = await res.json().catch(() => ({}));
  return {
    success: res.ok,
    target: id ? `message_${id}` : 'entire_inbox',
    message: json.message || (res.ok ? 'Berhasil dihapus' : 'Gagal menghapus'),
  };
}

const ACTIONS = ['create', 'inbox', 'message', 'domains', 'delete'];

export default {
  name: 'CyberMail',
  description: 'Generate email temporary gratis dan cek isi kotak masuk/OTP otomatis via CyberMail (cybermail.us)',
  category: 'Email',
  methods: ['GET', 'POST'],
  params: ['action', 'email', 'username', 'domain', 'id', 'wait'],
  paramsSchema: {
    action: {
      type: 'string',
      required: false,
      default: 'create',
      enum: ACTIONS,
      description: `Aksi yang dijalankan (${ACTIONS.join(', ')})`,
      example: 'create',
    },
    email: {
      type: 'string',
      required: false,
      description: 'Alamat email lengkap (wajib untuk action=inbox, message, delete)',
      example: 'cyber882@cybermail.us',
    },
    username: {
      type: 'string',
      required: false,
      description: 'Custom username pilihan (opsional untuk action=create)',
      example: 'myuser',
    },
    domain: {
      type: 'string',
      required: false,
      description: 'Domain pilihan (opsional untuk action=create)',
      example: 'cybermail.us',
    },
    id: {
      type: 'string',
      required: false,
      description: 'ID pesan yang ingin dibaca atau dihapus (action=message, delete)',
      example: '123',
    },
    wait: {
      type: 'number',
      required: false,
      default: 0,
      description: 'Tunggu email masuk sampai maksimal N detik (maks 60 detik) untuk action=inbox',
      example: 15,
    },
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      const action = String(params.action || 'create').trim().toLowerCase();

      logger.info(`[CYBERMAIL] Request action=${action}`);

      // 1. Create
      if (action === 'create' || action === 'generate' || action === 'new') {
        const data = await generateEmail(params.username, params.domain);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 2. Inbox
      if (action === 'inbox' || action === 'check' || action === 'messages') {
        const targetEmail = String(params.email || params.query || '').trim().toLowerCase();
        if (!targetEmail || !targetEmail.includes('@')) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'email' valid wajib diisi untuk action=inbox",
          });
        }

        const waitSeconds = parseInt(params.wait, 10) || 0;
        const emails = waitSeconds > 0
          ? await waitForInbox(targetEmail, waitSeconds)
          : await fetchInbox(targetEmail);

        return res.status(200).json({
          status: true,
          email: targetEmail,
          count: emails.length,
          result: emails,
        });
      }

      // 3. Message Detail
      if (action === 'message' || action === 'detail' || action === 'read') {
        const targetEmail = String(params.email || '').trim().toLowerCase();
        const msgId = String(params.id || params.messageId || '').trim();
        if (!targetEmail || !msgId) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'email' dan 'id' pesan wajib diisi untuk action=message",
          });
        }
        const data = await fetchMessage(targetEmail, msgId);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 4. Domains
      if (action === 'domains') {
        const domains = await getDomains();
        return res.status(200).json({
          status: true,
          total: domains.length,
          result: domains,
        });
      }

      // 5. Delete
      if (action === 'delete' || action === 'del') {
        const targetEmail = String(params.email || '').trim().toLowerCase();
        if (!targetEmail) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'email' wajib diisi untuk action=delete",
          });
        }
        const msgId = params.id ? String(params.id).trim() : null;
        const data = await deleteMail(targetEmail, msgId);
        return res.status(200).json({
          status: data.success,
          result: data,
        });
      }

      return res.status(400).json({
        status: false,
        message: `Action '${action}' tidak valid. Pilihan: ${ACTIONS.join(', ')}`,
      });
    } catch (err) {
      logger.error(`[CYBERMAIL] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || 'Gagal memproses permintaan CyberMail',
      });
    }
  },
};
