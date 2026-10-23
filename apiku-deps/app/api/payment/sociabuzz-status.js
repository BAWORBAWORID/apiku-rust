import axios from 'axios';
import fs from 'fs';
import path from 'path';

const config = {
  base_url: 'https://sociabuzz.com',
  db_path: path.join(process.cwd(), 'data', 'sociabuzz.json')
};

const api = axios.create({ timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-A057F) AppleWebKit/537.36' } });

function loadDB() {
  try { return JSON.parse(fs.readFileSync(config.db_path, 'utf-8')); } catch { return []; }
}
function saveDB(db) { fs.writeFileSync(config.db_path, JSON.stringify(db, null, 2)); }

async function statusPayment(invId) {
  const pendingUrl = config.base_url + '/payment/pending?inv_id=' + invId;
  const res = await api.get(pendingUrl, {
    headers: { 'Accept': 'text/html' },
    timeout: 15000,
    validateStatus: () => true
  });

  const title = (res.data.match(/<title>([^<]+)/) || ['', ''])[1] || '';
  let status = 'unknown';

  if (title.toLowerCase().includes('pending')) status = 'pending';
  else if (title.toLowerCase().includes('success')) status = 'success';
  else if (title.toLowerCase().includes('expired')) status = 'expired';
  else if (title.toLowerCase().includes('not found')) status = 'not_found';
  else if (title.toLowerCase().includes('fail')) status = 'failed';

  return { status, inv_id: invId };
}

export default {
  name: "Sociabuzz Status Payment",
  description: "Cek status pembayaran Sociabuzz Unofficial",
  category: "Payment",
  methods: ["GET", "POST"],
  params: ["transaction_id"],
  paramsSchema: {
    transaction_id: { type: "string", required: true, description: "ID Transaksi (transaction_id) dari response create" }
  },
  async run(req, res) {
    const { transaction_id } = { ...req.query, ...req.body };

    if (!transaction_id) {
      return res.status(400).json({ success: false, message: "Parameter 'transaction_id' wajib diisi" });
    }

    try {
      const db = loadDB();
      // Cari inv_id berdasarkan transaction_id yang di-passing
      const trx = db.find(t => 
        (t.id === transaction_id) || 
        (t.payment_info && t.payment_info.transaction_id === transaction_id) ||
        (t.payment_info && t.payment_info.inv_id === transaction_id)
      );

      let invIdToCheck = transaction_id;
      if (trx && trx.payment_info && trx.payment_info.inv_id) {
        invIdToCheck = trx.payment_info.inv_id;
      }

      const statusInfo = await statusPayment(invIdToCheck);
      
      if (trx) {
         trx.status = statusInfo.status;
         if (statusInfo.status === 'success' && !trx.paid_at) {
             trx.paid_at = new Date().toISOString();
         }
         saveDB(db);
      }

      return res.json({ success: true, result: statusInfo });
    } catch (e) {
      return res.status(500).json({ success: false, message: typeof e === 'string' ? e : e.message });
    }
  }
};
