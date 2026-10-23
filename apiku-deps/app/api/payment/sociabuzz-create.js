import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const config = {
  base_url: 'https://sociabuzz.com',
  db_path: path.join(process.cwd(), 'data', 'sociabuzz.json')
};

const methods = {
  qris: { type_payment: 'qris', source_payment: 'xendit', group: 'qris', min: 1000 },
  gopay: { type_payment: 'ewallet_id', source_payment: 'midtrans', group: 'ewallet', min: 1000 },
  ovo: { type_payment: 'ewallet_id', source_payment: 'xendit', group: 'ewallet', min: 1000, need_phone: true },
  dana: { type_payment: 'ewallet_id', source_payment: 'xendit', group: 'ewallet', min: 1000 },
  linkaja: { type_payment: 'ewallet_id', source_payment: 'xendit', group: 'ewallet', min: 1000 },
  shopeepay_idr: { type_payment: 'ewallet_id', source_payment: '2c2p', group: 'ewallet', min: 1000 },
  bca: { type_payment: 'bank_transfer', source_payment: 'midtrans', group: 'bank', min: 10000 },
  mandiri: { type_payment: 'bank_transfer', source_payment: 'xendit', group: 'bank', min: 10000 },
  bri: { type_payment: 'bank_transfer', source_payment: 'xendit', group: 'bank', min: 10000 },
  bni: { type_payment: 'bank_transfer', source_payment: 'xendit', group: 'bank', min: 10000 },
  bsi: { type_payment: 'bank_transfer', source_payment: 'xendit', group: 'bank', min: 10000 },
  cimb: { type_payment: 'bank_transfer', source_payment: 'xendit', group: 'bank', min: 10000 },
  permata: { type_payment: 'bank_transfer', source_payment: 'xendit', group: 'bank', min: 10000 },
  bjb: { type_payment: 'bank_transfer', source_payment: 'xendit', group: 'bank', min: 10000 },
  bnc: { type_payment: 'bank_transfer', source_payment: 'xendit', group: 'bank', min: 10000 },
  sahabat_sampoerna: { type_payment: 'bank_transfer', source_payment: 'xendit', group: 'bank', min: 10000 },
  indomaret: { type_payment: 'retail_outlet', source_payment: 'xendit', group: 'retail', min: 10000 },
  alfamart: { type_payment: 'retail_outlet', source_payment: 'xendit', group: 'retail', min: 10000 },
  alfamidi: { type_payment: 'retail_outlet', source_payment: 'xendit', group: 'retail', min: 10000 },
  alfaexpress: { type_payment: 'retail_outlet', source_payment: 'xendit', group: 'retail', min: 10000 },
  lawson: { type_payment: 'retail_outlet', source_payment: 'xendit', group: 'retail', min: 10000 },
  dandan: { type_payment: 'retail_outlet', source_payment: 'xendit', group: 'retail', min: 10000 }
};

const ua = 'Mozilla/5.0 (Linux; Android 13; SM-A057F) AppleWebKit/537.36';

function getJar(jarString, name) {
  const m = jarString.match(new RegExp('(^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[2] : null;
}

function setCookie(jarString, name, value) {
  const re = new RegExp('(^|;\\s*)' + name + '=[^;]*');
  if (jarString.match(re)) {
    return jarString.replace(re, '$1' + name + '=' + value);
  } else {
    return (jarString ? jarString + '; ' : '') + name + '=' + value;
  }
}

function loadDB() {
  try { return JSON.parse(fs.readFileSync(config.db_path, 'utf-8')); } catch { return []; }
}
function saveDB(db) { fs.writeFileSync(config.db_path, JSON.stringify(db, null, 2)); }
function trxId() { return 'TRX-' + Date.now() + String(Math.floor(Math.random() * 10000)).padStart(4, '0'); }
function cleanAmount(v) { return Number(String(v || '').replace(/[^\d]/g, '')); }

async function createPayment(username, amount, name, message, method, extras) {
  let jar = '';
  const api = axios.create({ timeout: 20000, headers: { 'User-Agent': ua } });
  
  api.interceptors.response.use(r => {
    if (r.headers['set-cookie']) {
      for (const s of r.headers['set-cookie']) {
        const [kv] = s.split(';');
        const [k, ...v] = kv.split('=');
        jar = setCookie(jar, k, v.join('='));
      }
    }
    return r;
  });
  api.interceptors.request.use(c => { if (jar && c.url.includes('sociabuzz')) c.headers.Cookie = jar; return c; });

  method = (method || 'qris').toLowerCase();
  extras = extras || {};
  const pm = methods[method];
  if (!pm) throw new Error('Method ' + method + ' not available');

  amount = cleanAmount(amount);
  var min = pm.min;
  if (!amount || amount < min) throw new Error('Minimum Rp ' + min + ' for ' + method);

  const donateUrl = config.base_url + '/' + username + '/donate';

  const home = await api.get(donateUrl, { headers: { 'Accept': 'text/html' }, validateStatus: () => true });
  if (home.status === 404) throw new Error('Username Sociabuzz tidak ditemukan');
  
  const $ = cheerio.load(home.data);
  const csrf = $('input[name="sb_token_csrf"]').val();
  if (!csrf) throw new Error('Failed to load donation page (CSRF not found)');

  const body = {
    sb_token_csrf: csrf, currency: 'IDR', amount: String(amount), qty: '1',
    support_duration: '30', note: message || '', fullname: name || 'Donatur',
    email: extras.email || 'donatur' + Date.now() + '@gmail.com', is_agree: '1', years18: '1',
    is_vote: '0', is_voice: '0', is_mediashare: '0', is_gif: '0', is_sound: '0',
    is_voicy: '0', vote_id: '', ms_maxtime: '', start_from: '0',
    ms_starthour: '0', ms_startminute: '0', ms_startsecond: '0', spin_check: '0',
    prev_url: donateUrl, hide_email: '0', is_tiktok: '0', tiktok_duration: '0',
    is_instagram: '0', instagram_duration: '0', wishlist_id: '', quickpay: '0'
  };

  const sub = await api.post(donateUrl + '/get-form-queue', new URLSearchParams(body).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': config.base_url, 'Referer': donateUrl, 'X-Requested-With': 'XMLHttpRequest' }
  });
  if (sub.data.success !== 'true') throw new Error(sub.data.content?.form_alert || 'Donation failed');

  const paymentUrl = sub.data.content.redirect;
  const token = paymentUrl.split('/payment/x/')[1]?.split(/[?#]/)[0];

  const pay = await api.get(paymentUrl, { headers: { 'Accept': 'text/html' } });
  let csrf2 = pay.data.match(/input.*name="sb_token_csrf".*value="([^"]+)"/)?.[1];
  jar = setCookie(jar, 'sociabuzz_sb_cookie_csrf', csrf2);

  await api.get('https://sociabuzz.com/payment/pay/setting', {
    params: {
      amount: String(amount), currency: 'IDR', base_amount: String(amount),
      base_currency: 'IDR', currency_def: 'IDR', convertion: 'IDR',
      country: 'Indonesia', feature: 'TRIBE', is_borne_fee: '1', risk: '',
      message: '', direct: '', service_fee: '1', token: token, country_account: ''
    }
  });

  const c = getJar(jar, 'csrf_cookie_name');
  if (c) { jar = setCookie(jar, 'sociabuzz_sb_cookie_csrf', c); csrf2 = c; }

  const sendBody = {
    sb_token_csrf: csrf2,
    order_id: token,
    final_currency: 'IDR',
    currency_def: 'IDR',
    payment_method: method,
    type_payment: pm.type_payment,
    source_payment: pm.source_payment,
    country: 'ID',
    country_pay: 'Indonesia'
  };

  if (extras.phone) sendBody.phone_number = extras.phone;

  const res = await api.post(config.base_url + '/payment/send/create', sendBody, {
    headers: { 'Content-Type': 'application/json', 'Origin': config.base_url, 'Referer': paymentUrl, 'X-Requested-With': 'XMLHttpRequest' }
  });

  if (!res.data?.status) throw new Error(JSON.stringify(res.data));

  const rd = res.data;
  const total = cleanAmount(rd.data?.amount || rd.data?.total || amount);
  const fee = total - amount;
  const id = trxId();
  const created = new Date().toISOString();
  const expired = rd.data?.countdown
    ? new Date(rd.data.countdown).toISOString()
    : new Date(Date.now() + 3600000).toISOString();

  const paymentInfo = {
    method: method,
    payment_method: rd.payment_method,
    type_payment: rd.type_payment,
    source_payment: rd.source_payment
  };

  if (rd.data?.qr_string) paymentInfo.qr_string = rd.data.qr_string;
  if (rd.data?.account_number) paymentInfo.account_number = rd.data.account_number;
  if (rd.data?.name) paymentInfo.bank_name = rd.data.name;
  if (rd.data?.bank) paymentInfo.bank = rd.data.bank;
  if (rd.data?.redirect_url) paymentInfo.redirect_url = rd.data.redirect_url;
  if (rd.data?.payment_link) paymentInfo.payment_link = rd.data.payment_link;
  if (rd.inv_id) {
    paymentInfo.inv_id = rd.inv_id;
    paymentInfo.pending_url = config.base_url + '/payment/pending?type=' + rd.payment_method + '&inv_id=' + rd.inv_id;
  }
  if (rd.data?.id) paymentInfo.transaction_id = rd.data.id;

  const trx = {
    id, order_id: token, payment_url: paymentUrl,
    payment_info: paymentInfo, amount, total_amount: total,
    fee, status: 'pending', created_at: created, expired_at: expired,
    paid_at: null, supporter: name || null, message: message || null,
    username: username
  };

  const db = loadDB();
  db.push(trx);
  saveDB(db);
  return trx;
}

export default {
  name: "Sociabuzz Create Payment",
  description: "Buat tagihan pembayaran Sociabuzz Unofficial",
  category: "Payment",
  methods: ["GET", "POST"],
  params: ["username", "amount", "method", "name", "message", "phone", "email"],
  paramsSchema: {
    username: { type: "string", required: true, description: "Username Sociabuzz (misal: xeoms)" },
    amount: { type: "number", required: true, description: "Nominal donasi/pembayaran" },
    method: { type: "string", required: true, description: "Metode pembayaran (misal: qris, gopay, dana, ovo)", enum: ["qris", "gopay", "ovo", "dana", "linkaja", "shopeepay_idr", "bca", "mandiri", "bri", "bni", "bsi", "cimb", "permata", "bjb", "bnc", "sahabat_sampoerna", "indomaret", "alfamart", "alfamidi", "alfaexpress", "lawson", "dandan"] },
    name: { type: "string", required: false, description: "Nama pembayar (opsional)" },
    message: { type: "string", required: false, description: "Catatan atau pesan (opsional)" },
    phone: { type: "string", required: false, description: "Nomor HP (wajib untuk OVO)" },
    email: { type: "string", required: false, description: "Email pembayar (opsional)" }
  },
  async run(req, res) {
    const { username, amount, method, name, message, phone, email } = { ...req.query, ...req.body };

    if (!username || !amount || !method) {
      return res.status(400).json({ success: false, message: "Parameter 'username', 'amount', dan 'method' wajib diisi" });
    }

    try {
      const trx = await createPayment(username, amount, name, message, method, { phone, email });
      return res.json({ success: true, result: trx });
    } catch (e) {
      return res.status(500).json({ success: false, message: typeof e === 'string' ? e : e.message });
    }
  }
};
