import { createHash, randomBytes } from 'node:crypto';

const BASE_URL = 'https://viu.interflazz.my.id/?action=account';
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Origin: 'https://viu.interflazz.my.id',
  Referer: 'https://viu.interflazz.my.id/',
};

function generateDeviceId(seed = null) {
  return seed ? createHash('md5').update(String(seed)).digest('hex') : randomBytes(16).toString('hex');
}

export async function getViuAccount(deviceId) {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: DEFAULT_HEADERS,
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Gagal mengambil akun');
  return {
    success: data.success,
    message: data.message,
    is_new: data.is_new,
    device_id: data.device_id,
    account: { email: data.account?.email ?? null, password: data.account?.password ?? null },
    fetched_at: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  const deviceId = req.query?.device_id || req.body?.device_id || generateDeviceId();
  try {
    const result = await getViuAccount(deviceId);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, device_id: deviceId });
  }
}
