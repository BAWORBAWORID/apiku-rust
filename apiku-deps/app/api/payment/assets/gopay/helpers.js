import { extractError, isAuthError, getMe } from './sdk.js';
import { getTokens, hasTokens, ensureFreshToken } from './tokenManager.js';

export function params(req) {
  return { ...req.query, ...req.body };
}

export function bad(res, message) {
  return res.status(400).json({ status: false, message });
}

/**
 * Balas error upstream apa adanya (pesan asli GoBiz), lalu tambahkan `hint`
 * bila ini murni masalah token — tanpa menutupi pesan upstream.
 */
export function fail(res, err, fallback = 'Permintaan gagal') {
  const status = err?.response?.status || 500;
  const body = { status: false, message: extractError(err, fallback) };
  if (isAuthError(err)) {
    body.hint = 'Access token tidak valid atau kedaluwarsa. Gunakan endpoint GoPay Refresh, atau login ulang bila refresh token juga sudah habis.';
  }
  return res.status(status).json(body);
}

/**
 * Token dari parameter, atau token tersimpan bila mode=auto.
 * Return { token, error } — error = pesan siap tampil bila token tidak tersedia.
 */
export async function resolveToken(req, { allowStored = true } = {}) {
  const p = params(req);
  const explicit = p.token || p.accessToken;

  if (explicit) return { token: String(explicit), error: null };

  if (allowStored && hasTokens()) {
    const fresh = await ensureFreshToken();
    const { accessToken } = getTokens();
    if (!accessToken) {
      return { token: null, error: 'Token tersimpan sudah tidak berlaku. Jalankan login ulang.' };
    }
    return {
      token: accessToken,
      error: null,
      autoUsed: true,
      refreshed: fresh?.refreshed || false
    };
  }

  return {
    token: null,
    error: allowStored
      ? 'Token belum tersedia. Kirim parameter \'token\', atau simpan dulu lewat endpoint gopay-token-save.'
      : 'Parameter \'token\' wajib diisi.'
  };
}

/**
 * Merchant ID selalu diturunkan dari access token, jadi pemanggil tidak
 * perlu mengirim merchantId sama sekali.
 */
export async function resolveMerchantId(token) {
  const fromEnv = process.env.GOBIZ_MERCHANT_ID;
  if (fromEnv) return fromEnv;
  const me = await getMe(token);
  return me?.data?.user?.merchant_id || me?.user?.merchant_id || null;
}

export function noMerchantId(res) {
  return res.status(400).json({
    status: false,
    message: "Merchant ID tidak bisa diturunkan dari access token. Pastikan token belonging ke merchant yang sudah onboard."
  });
}

export function partnerConfigError(cfg) {
  if (!cfg.clientId || !cfg.clientSecret) {
    return 'Official GoBiz API belum dikonfigurasi. Set env GOBIZ_CLIENT_ID dan GOBIZ_CLIENT_SECRET (kredensial Direct Integration dari portal developer GoBiz).';
  }
  return null;
}
