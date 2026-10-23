import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { refreshToken, pickTokens } from './sdk.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, '../../../../data/gopay-tokens.json');
const REFRESH_INTERVAL = 15 * 60 * 1000;

let cache = null;
let timer = null;
let refreshing = null;

function load() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
    cache = {
      accessToken: raw.accessToken || null,
      refreshToken: raw.refreshToken || null,
      lastRefresh: raw.lastRefresh || null
    };
  } catch {
    cache = { accessToken: null, refreshToken: null, lastRefresh: null };
  }
  if (process.env.GOBIZ_ACCESS_TOKEN && !cache.accessToken) {
    cache.accessToken = process.env.GOBIZ_ACCESS_TOKEN;
  }
  if (process.env.GOBIZ_REFRESH_TOKEN && !cache.refreshToken) {
    cache.refreshToken = process.env.GOBIZ_REFRESH_TOKEN;
  }
  return cache;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
    fs.chmodSync(STORE_PATH, 0o600);
    return true;
  } catch {
    return false;
  }
}

export function getTokens() {
  const s = load();
  return { accessToken: s.accessToken, refreshToken: s.refreshToken };
}

export function hasTokens() {
  const s = load();
  return !!(s.accessToken && s.refreshToken);
}

export function status() {
  const s = load();
  return {
    hasTokens: !!(s.accessToken && s.refreshToken),
    hasAccessToken: !!s.accessToken,
    hasRefreshToken: !!s.refreshToken,
    lastRefresh: s.lastRefresh
  };
}

export function setTokens(accessToken, refreshToken) {
  cache = load();
  cache.accessToken = accessToken || null;
  cache.refreshToken = refreshToken || null;
  cache.lastRefresh = new Date().toISOString();
  persist();
  startAutoRefresh();
  return status();
}

export function updateAccessToken(accessToken, newRefreshToken) {
  cache = load();
  cache.accessToken = accessToken || cache.accessToken;
  if (newRefreshToken && newRefreshToken !== cache.refreshToken) {
    cache.refreshToken = newRefreshToken;
  }
  cache.lastRefresh = new Date().toISOString();
  persist();
}

export function clearTokens() {
  cache = { accessToken: null, refreshToken: null, lastRefresh: null };
  persist();
  stopAutoRefresh();
  return status();
}

async function runRefresh() {
  const s = load();
  if (!s.refreshToken) return { ok: false, reason: 'no_refresh_token' };
  try {
    const result = await refreshToken(s.refreshToken);
    const { accessToken, refreshToken: rotated } = pickTokens(result);
    if (!accessToken) return { ok: false, reason: 'no_access_token_in_response' };
    updateAccessToken(accessToken, rotated);
    return { ok: true, accessToken };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

export async function ensureFreshToken() {
  const s = load();
  if (!s.accessToken) return { ok: false, reason: 'no_token' };

  try {
    const { getMe } = await import('./sdk.js');
    await getMe(s.accessToken);
    return { ok: true, refreshed: false };
  } catch (err) {
    if (err?.response?.status !== 401) return { ok: false, reason: err.message };
    const res = await runRefresh();
    return res.ok
      ? { ok: true, refreshed: true }
      : { ok: false, reason: res.reason };
  }
}

export function startAutoRefresh() {
  if (timer) clearInterval(timer);
  if (!hasTokens()) return false;
  timer = setInterval(() => {
    if (refreshing) return;
    refreshing = runRefresh().finally(() => { refreshing = null; });
  }, REFRESH_INTERVAL);
  if (timer.unref) timer.unref();
  return true;
}

export function stopAutoRefresh() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function autoRefreshActive() {
  return !!timer;
}

function invalidate() {
  cache = null;
}

try {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(
      STORE_PATH,
      JSON.stringify({ accessToken: null, refreshToken: null, lastRefresh: null }, null, 2),
      'utf-8'
    );
  }
  fs.chmodSync(STORE_PATH, 0o600);
  fs.watch(STORE_PATH, () => invalidate());
} catch {
  /* store belum bisa dibuat, setTokens akan mencoba lagi nanti */
}
