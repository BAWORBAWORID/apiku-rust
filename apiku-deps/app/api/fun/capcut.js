/**
 * CapCut Auto Create Account
 * POST /api/fun/capcut?count=1
 * GET /api/fun/capcut?count=1
 */

import crypto from 'node:crypto';
import logger from "../../src/utils/logger.js";

function encryptToTargetHex(input) {
  let hex = '';
  for (const c of String(input)) {
    hex += (c.charCodeAt(0) ^ 0x05).toString(16).padStart(2, '0');
  }
  return hex;
}

function generatePassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
  let p = 'Cc9!';
  for (let i = 0; i < 10; i++) p += chars[crypto.randomBytes(1)[0] % chars.length];
  return p;
}

function randomBirthday() {
  const start = new Date(1995, 0, 1).getTime();
  const end = new Date(2004, 11, 31).getTime();
  return new Date(start + Math.random() * (end - start)).toISOString().split('T')[0];
}

function signPayload(payload, secret) {
  const string = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', secret).update(string).digest('hex');
  return { ...payload, signature: sig };
}

async function requestOTP(email, password, proxy = null) {
  const url = 'https://www.capcut.com/api/account/register/send_code/';
  const payload = signPayload({ email, password, source: 1 }, '5b14e9c59b6e8f0e8b4a1f2d3c5e6a7b');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'X-Request-ID': crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  return res.json();
}

async function verifyOTP(email, password, code, proxy = null) {
  const url = 'https://www.capcut.com/api/account/register/verify_code/';
  const payload = signPayload({ email, password, code, source: 1 }, '5b14e9c59b6e8f0e8b4a1f2d3c5e6a7b');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'X-Request-ID': crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  return res.json();
}

async function registerAccount(email, password, code, proxy = null) {
  const url = 'https://www.capcut.com/api/account/register/';
  const payload = signPayload({ email, password, code, birthday: randomBirthday(), source: 1 }, '5b14e9c59b6e8f0e8b4a1f2d3c5e6a7b');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'X-Request-ID': crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  return res.json();
}

async function createCapCutAccount() {
  const email = `cc${crypto.randomBytes(8).toString('hex')}@uberip.com`;
  const password = generatePassword();

  // Step 1: Send OTP
  const otpRes = await requestOTP(email, password);
  if (otpRes.code !== 0) throw new Error(`OTP request failed: ${otpRes.message}`);

  // Step 2: Get OTP from mail.tm (using uberip.com temp mail)
  // For simplicity, we'll skip actual OTP retrieval in this API
  // In production, would integrate with temp mail API
  throw new Error('OTP retrieval not implemented in API endpoint. Use CLI version.');
}

export default {
  name: "CapCut Account Creator",
  description: "Create CapCut accounts (email, password, cookies)",
  category: "Fun",
  methods: ["GET", "POST"],
  params: ["count"],
  paramsSchema: {
    count: {
      type: "number",
      required: false,
      default: 1,
      description: "Jumlah akun (maks 3)",
      minimum: 1,
      maximum: 3
    }
  },
  async run(req, res) {
    const { count } = { ...req.query, ...req.body };
    const n = Math.min(parseInt(count) || 1, 3);

    const results = [];
    for (let i = 0; i < n; i++) {
      try {
        // Use CLI version logic but simplified
        // For now return info about CLI usage
        results.push({
          info: 'Use CLI: node tes.js [count]',
          note: 'CapCut account creation requires temp mail OTP handling - see CLI version'
        });
      } catch (e) {
        results.push({ error: e.message });
      }
    }

    return res.json({
      status: true,
      message: 'CapCut account creation - use CLI version (node tes.js)',
      results
    });
  }
};
