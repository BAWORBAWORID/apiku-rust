const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

class SimpleCookieJar {
  constructor() {
    this.cookies = new Map();
  }

  setFromHeaders(headers) {
    if (!headers) return;
    let setCookies = [];
    if (typeof headers.getSetCookie === 'function') {
      setCookies = headers.getSetCookie();
    } else if (headers.get('set-cookie')) {
      setCookies = [headers.get('set-cookie')];
    }

    for (const str of setCookies) {
      if (!str) continue;
      const parts = str.split(';');
      const nameValue = parts[0].trim();
      const eqIdx = nameValue.indexOf('=');
      if (eqIdx !== -1) {
        const name = nameValue.slice(0, eqIdx).trim();
        const value = nameValue.slice(eqIdx + 1).trim();
        if (name) this.cookies.set(name, value);
      }
    }
  }

  getCookieHeader() {
    const pairs = [];
    for (const [name, value] of this.cookies.entries()) {
      pairs.push(`${name}=${value}`);
    }
    return pairs.join('; ');
  }

  get(name) {
    return this.cookies.get(name);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithJar(url, options = {}, jar) {
  let currentUrl = url;
  let method = options.method || 'GET';
  let body = options.body;
  let headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    ...(options.headers || {})
  };

  const maxRedirects = 10;
  let redirectCount = 0;

  while (true) {
    const cookieHeader = jar ? jar.getCookieHeader() : '';
    if (cookieHeader) headers['Cookie'] = cookieHeader;

    const response = await fetch(currentUrl, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000)
    });

    if (jar) jar.setFromHeaders(response.headers);

    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      if (!loc || redirectCount >= maxRedirects) return response;
      redirectCount++;
      headers['Referer'] = currentUrl;
      currentUrl = new URL(loc, currentUrl).href;
      method = 'GET';
      body = undefined;
      delete headers['Content-Type'];
      delete headers['Content-Length'];
      continue;
    }

    Object.defineProperty(response, 'url', { value: currentUrl, writable: false });
    return response;
  }
}

function generateSessionToken(rawXsrfCookie) {
  const unquotedXsrf = decodeURIComponent(rawXsrfCookie);
  const dummyFp = createHash('sha256')
    .update("webgl:ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)||audio:12.345678901234||canvas:abcdef123||fonts:20/25||system:8CPU,8GB,Win32,0,1,0||env:Asia/Jakarta,1920,1080,24,en-US||network:4g,10,50")
    .digest('hex');

  const o = '#' + Buffer.from(dummyFp).toString('base64');
  return unquotedXsrf.slice(0, 128 - o.length) + o;
}

async function bypassSafelink(targetUrl, initialHtml = null, jar = null) {
  if (!jar) jar = new SimpleCookieJar();

  let html = initialHtml;
  let currentShortlinkUrl = targetUrl;

  if (!html) {
    const r1 = await fetchWithJar(targetUrl, {}, jar);
    html = await r1.text();
    currentShortlinkUrl = r1.url;
  }

  const formMatch = html.match(/<form[^>]+action=["']([^"']+)["'][^>]*>([\s\S]*?)<\/form>/i);
  const rayMatch = html.match(/name=["']ray_id["']\s+value=["']([^"']+)["']/i);
  const aliasMatch = html.match(/name=["']alias["']\s+value=["']([^"']+)["']/i);

  if (!formMatch || !rayMatch || !aliasMatch) return null;

  const actionUrl = formMatch[1];
  const rayId = rayMatch[1];
  const alias = aliasMatch[1];

  const parsedAction = new URL(actionUrl, currentShortlinkUrl);
  const blogOrigin = `${parsedAction.protocol}//${parsedAction.host}`;
  const redirectUrl = `${blogOrigin}/redirect.php?ray_id=${encodeURIComponent(rayId)}&alias=${encodeURIComponent(alias)}`;

  const r2 = await fetchWithJar(redirectUrl, { headers: { 'Referer': currentShortlinkUrl } }, jar);
  const step1PageUrl = r2.url;

  const xsrf1 = jar.get('XSRF-TOKEN');
  if (!xsrf1) throw new Error("Missing XSRF-TOKEN on gateway.");

  const tokenPayload1 = generateSessionToken(xsrf1);
  const sessionHeaders = {
    'Origin': blogOrigin,
    'Referer': step1PageUrl,
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest'
  };

  const sessionRes1 = await fetchWithJar(`${blogOrigin}/api/session`, {
    method: 'POST',
    headers: sessionHeaders,
    body: JSON.stringify({ _token: tokenPayload1 })
  }, jar);

  const sessionData1 = await sessionRes1.json().catch(() => ({}));
  let step = sessionData1.step || 1;
  let step2PageUrl = step1PageUrl;

  if (step === 1) {
    await sleep(800);
    const verifyRes = await fetchWithJar(`${blogOrigin}/api/verify`, {
      method: 'POST',
      headers: sessionHeaders,
      body: JSON.stringify({ _a: 0, captcha: null, passcode: null })
    }, jar);

    const verifyData = await verifyRes.json().catch(() => ({}));
    let target = verifyData.target || '/redirect.php';
    if (target.startsWith('/')) target = `${blogOrigin}${target}`;

    const r3 = await fetchWithJar(target, { headers: { 'Referer': step1PageUrl } }, jar);
    step2PageUrl = r3.url;

    const xsrf2 = jar.get('XSRF-TOKEN') || xsrf1;
    sessionHeaders['Referer'] = step2PageUrl;
    await fetchWithJar(`${blogOrigin}/api/session`, {
      method: 'POST',
      headers: sessionHeaders,
      body: JSON.stringify({ _token: generateSessionToken(xsrf2) })
    }, jar);
  }

  await sleep(1500);
  const key = 500;
  const size = `${(1920 + key) * 2}.${(1080 + key) * 2}`;

  sessionHeaders['Referer'] = step2PageUrl;
  const goRes = await fetchWithJar(`${blogOrigin}/api/go`, {
    method: 'POST',
    headers: sessionHeaders,
    body: JSON.stringify({ key, size })
  }, jar);

  const goText = await goRes.text();
  let goData = {};
  try { goData = JSON.parse(goText); }
  catch { throw new Error(`Invalid /api/go response.`); }

  let readyUrl = goData.url;
  if (!readyUrl) throw new Error("Failed to get ready URL.");
  if (!/^https?:\/\//i.test(readyUrl)) {
    readyUrl = new URL(readyUrl, blogOrigin).href;
  }

  const rReady = await fetchWithJar(readyUrl, { headers: { 'Referer': step2PageUrl } }, jar);
  const htmlReady = await rReady.text();
  const destMatch = htmlReady.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i);

  if (destMatch) {
    return destMatch[1].replace(/\\\//g, '/').replace(/\\u0026/g, '&');
  }

  return readyUrl;
}

async function resolveChain(initialUrl) {
  let currentUrl = initialUrl.trim();
  if (!/^https?:\/\//i.test(currentUrl)) currentUrl = 'https://' + currentUrl;

  const visited = new Set();
  const maxHops = 15;

  for (let hop = 1; hop <= maxHops; hop++) {
    if (visited.has(currentUrl)) break;
    visited.add(currentUrl);

    const jar = new SimpleCookieJar();
    let res;
    try {
      res = await fetchWithJar(currentUrl, { redirect: 'manual' }, jar);
    } catch (err) {
      return { success: false, error: `Fetch failed: ${err.message}`, url: currentUrl };
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (loc) {
        currentUrl = new URL(loc, currentUrl).href;
        continue;
      }
    }

    // fetchWithJar follows redirects internally — adopt its final URL
    if (res.url && res.url !== currentUrl && res.status >= 200 && res.status < 300) {
      currentUrl = res.url;
    }

    const html = await res.text();

    if (html.includes('name="ray_id"') || html.includes("name='ray_id'") || html.includes('redirect.php')) {
      try {
        const destination = await bypassSafelink(currentUrl, html, jar);
        if (destination && destination !== currentUrl) {
          currentUrl = destination;
          continue;
        }
      } catch (err) {
        return { success: false, error: err.message, url: currentUrl };
      }
    }

    const metaRefresh = html.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/i);
    if (metaRefresh) {
      currentUrl = new URL(metaRefresh[1].trim(), currentUrl).href;
      continue;
    }

    break;
  }

  return { success: true, url: currentUrl };
}

import { createHash } from "crypto";

export default {
  name: "Bypass Safelink Universal",
  description: "Bypass semua gateway safelink (sfl.gl, adlinksumo, myshortlink, dll) secara universal — auto-deteksi host gateway dari form, cookie jar, dan resolve rantai redirect sampai 15 hop",
  category: "Bypass",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: { type: "string", required: true, description: "URL safelink yang ingin di-bypass", example: "https://sfl.gl/mQdE", default: "https://sfl.gl/mQdE" }
  },
  async run(req, res) {
    const { url } = { ...req.query, ...req.body };
    if (!url) {
      return res.status(400).json({ error: "Parameter 'url' wajib diisi." });
    }
    const result = await resolveChain(String(url));
    if (!result.success) {
      return res.status(502).json({ status: false, error: result.error, url: result.url });
    }
    return res.json({ status: true, result: result.url, destination: result.url });
  }
};