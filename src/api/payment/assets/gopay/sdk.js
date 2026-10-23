import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';

const CONFIG = {
  baseUrl: 'https://api.gobiz.co.id',
  oauthUrl: 'https://accounts.go-jek.com',
  clientId: 'go-biz-web-new',
  appId: 'go-biz-web-dashboard',
  appVersion: 'platform-v3.101.0-8918927d'
};

const UA_LIST = [
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-A057F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36'
];

let uniqueId = uuidv4();
let cachedPartnerToken = null;
let cachedPartnerTokenExpiresAt = 0;

export function headers(token = null) {
  const h = {
    'Accept': 'application/json, text/plain, */*',
    'Authentication-Type': 'go-id',
    'X-PhoneMake': 'Android 10',
    'X-PhoneModel': 'K',
    'x-DeviceOS': 'Web',
    'X-Platform': 'Web',
    'X-User-Type': 'merchant',
    'x-appId': CONFIG.appId,
    'x-uniqueid': uniqueId,
    'X-AppVersion': CONFIG.appVersion,
    'Gojek-Country-Code': 'ID',
    'Gojek-Timezone': 'Asia/Jakarta',
    'Content-Type': 'application/json',
    'User-Agent': UA_LIST[Math.floor(Math.random() * UA_LIST.length)]
  };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export function convertCRC16(str) {
  let crc = 0xFFFF;
  for (let c = 0; c < str.length; c++) {
    crc ^= str.charCodeAt(c) << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
    }
  }
  return ("000" + (crc & 0xFFFF).toString(16).toUpperCase()).slice(-4);
}

export function buildDynamicQrisPayload(staticQr, amount) {
  const base = String(staticQr).trim().slice(0, -4);
  const step1 = base.replace("010211", "010212");
  const parts = step1.split("5802ID");
  if (parts.length < 2) throw new Error("QRIS statis tidak valid: tag '5802ID' tidak ditemukan.");
  const amountStr = String(amount);
  const uang = "54" + ("0" + amountStr.length).slice(-2) + amountStr + "5802ID";
  return parts[0] + uang + parts[1] + convertCRC16(parts[0] + uang + parts[1]);
}

export async function createDynamicQRIS(amount, staticQr) {
  const qr_string = buildDynamicQrisPayload(staticQr, amount);
  const qr_buffer = await QRCode.toBuffer(qr_string);
  return { qr_buffer, qr_string, amount: Number(amount), created_at: new Date().toISOString() };
}

export async function requestOtp(phoneNumber) {
  const { data } = await axios.post(`${CONFIG.baseUrl}/goid/login/request`, {
    client_id: CONFIG.clientId,
    phone_number: String(phoneNumber),
    country_code: '62'
  }, { headers: headers(), timeout: 20000 });
  return data;
}

export async function verifyOtp(otp, otpToken) {
  const { data } = await axios.post(`${CONFIG.baseUrl}/goid/token`, {
    client_id: CONFIG.clientId,
    data: { otp: String(otp), otp_token: otpToken },
    grant_type: 'otp'
  }, { headers: headers(), timeout: 20000 });
  return data;
}

export async function refreshToken(refreshTokenValue) {
  const { data } = await axios.post(`${CONFIG.baseUrl}/goid/token`, {
    client_id: CONFIG.clientId,
    data: { refresh_token: refreshTokenValue },
    grant_type: 'refresh_token'
  }, { headers: headers(), timeout: 20000 });
  return data;
}

export function pickTokens(result) {
  const src = result?.data || result || {};
  return {
    accessToken: src.access_token || null,
    refreshToken: src.refresh_token || null
  };
}

export async function getMe(accessToken) {
  const { data } = await axios.get(`${CONFIG.baseUrl}/v1/users/me`, {
    headers: headers(accessToken), timeout: 20000
  });
  return data;
}

export async function getMerchant(accessToken, merchantId) {
  const { data } = await axios.get(`${CONFIG.baseUrl}/v1/merchants/${merchantId}`, {
    headers: headers(accessToken), timeout: 20000
  });
  return data;
}

export async function getPayouts(accessToken, page = 1, per = 50) {
  const { data } = await axios.get(`${CONFIG.baseUrl}/v1/merchants/payouts`, {
    headers: headers(accessToken),
    params: { page, per },
    timeout: 20000
  });
  return data;
}

export async function getJournals(accessToken, merchantId, startTime = null, days = 7) {
  const dateTo = new Date().toISOString();
  const dateFrom = startTime || new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await axios.post(`${CONFIG.baseUrl}/journals/search`, {
    from: 0,
    size: 50,
    sort: { time: { order: 'desc' } },
    included_categories: { incoming: ['transaction_share', 'action'] },
    query: [{
      clauses: [
        { field: 'metadata.transaction.status', op: 'in', value: ['settlement', 'capture'] },
        { field: 'metadata.transaction.transaction_time', op: 'gte', value: dateFrom },
        { field: 'metadata.transaction.transaction_time', op: 'lte', value: dateTo },
        { field: 'metadata.transaction.merchant_id', op: 'equal', value: merchantId }
      ],
      op: 'and'
    }]
  }, {
    headers: { ...headers(accessToken), 'accept': 'application/vnd.journal.v1+json' },
    timeout: 25000
  });
  return data;
}

export function mapQrisEntries(journalResult) {
  return (journalResult?.hits || [])
    .filter((item) => item?.metadata?.transaction?.payment_type === 'qris')
    .map((item) => {
      const aspi = item.metadata?.provider_metadata?.aspi;
      return {
        id: item.id,
        reference_id: item.reference_id,
        status: item.status,
        time: item.time,
        amount: aspi?.data?.amount || 0,
        issuer: aspi?.issuer || null,
        acquirer: aspi?.acquirer || null,
        merchant_name: aspi?.data?.merchant_name || null,
        merchant_id: aspi?.data?.merchant_id || null,
        merchant_city: aspi?.data?.merchant_city || null,
        terminal_label: aspi?.data?.additional_data?.terminal_label || null
      };
    });
}

export async function getPartnerToken(clientId, clientSecret) {
  if (cachedPartnerToken && cachedPartnerTokenExpiresAt > Date.now() + 60000) {
    return cachedPartnerToken;
  }
  const payload = new URLSearchParams();
  payload.append('grant_type', 'client_credentials');
  payload.append('scope', 'payment:transaction:read payment:transaction:write');

  const { data } = await axios.post(`${CONFIG.oauthUrl}/oauth2/token`, payload.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    auth: { username: clientId, password: clientSecret },
    timeout: 20000
  });

  cachedPartnerToken = data.access_token;
  cachedPartnerTokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedPartnerToken;
}

export async function createQrisTransaction(outletId, opts, partnerToken) {
  const payload = {
    payment_type: 'qris',
    transaction_details: {
      order_id: opts.orderId,
      gross_amount: opts.grossAmount,
      currency: opts.currency || 'IDR'
    }
  };
  if (opts.itemDetails?.length) payload.item_details = opts.itemDetails;
  if (opts.customerDetails) payload.customer_details = opts.customerDetails;

  const { data } = await axios.post(
    `${CONFIG.baseUrl}/integrations/payment/outlets/${outletId}/v2/transactions`,
    payload,
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${partnerToken}`,
        'Idempotency-Key': uuidv4().replace(/-/g, '').slice(0, 32)
      },
      timeout: 25000
    }
  );
  return data;
}

export async function getQrisTransaction(outletId, transactionId, partnerToken) {
  const { data } = await axios.get(
    `${CONFIG.baseUrl}/integrations/payment/outlets/${outletId}/v1/transactions/${transactionId}`,
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${partnerToken}`
      },
      timeout: 20000
    }
  );
  return data;
}

export function partnerConfig() {
  return {
    clientId: process.env.GOBIZ_CLIENT_ID || null,
    clientSecret: process.env.GOBIZ_CLIENT_SECRET || null,
    outletId: process.env.GOBIZ_OUTLET_ID || null
  };
}

/**
 * Selalu balas pesan asli upstream apa adanya. Jangan samakan 401 jadi
 * "token tidak valid" — di endpoint login, 401 berarti "nomor tidak terdaftar".
 */
export function extractError(err, fallback = 'Permintaan gagal') {
  const body = err?.response?.data;
  const first = body?.errors?.[0];
  const message = first?.message || first?.message_title || body?.message || err?.message;
  return message || fallback;
}

export function isAuthError(err) {
  const status = err?.response?.status;
  return status === 401 || status === 403;
}

export function resetCache() {
  uniqueId = uuidv4();
  cachedPartnerToken = null;
  cachedPartnerTokenExpiresAt = 0;
}

export { CONFIG };
