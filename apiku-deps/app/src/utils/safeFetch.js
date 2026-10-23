import dns from 'dns';
import { URL } from 'url';

const BLOCKED_HOSTNAMES = [
  'localhost', 'localhost.localdomain', 'local', 'ip6-localhost', 'ip6-local',
  'broadcasthost', '0.0.0.0', 'metadata.google.internal',
  'instance-metadata', '[fd00::]',
];

const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.)/;
const PRIVATE_IP6_RE = /^(::1$|::$|fc|fd|fe80|ff)/i;

function isPrivateIP(ip) {
  if (!ip) return false;
  if (PRIVATE_IP_RE.test(ip)) return true;
  if (ip.startsWith('169.254.')) return true;
  if (PRIVATE_IP6_RE.test(ip)) return true;
  return false;
}

function validateUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('Invalid URL format');
  }

  const protocol = parsed.protocol.toLowerCase();
  if (!['http:', 'https:'].includes(protocol)) {
    throw new Error(`Blocked protocol: ${protocol} (only http/https allowed)`);
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    throw new Error(`Blocked hostname: ${hostname}`);
  }

  if (isPrivateIP(hostname)) {
    throw new Error(`Blocked private/reserved IP: ${hostname}`);
  }

  return parsed;
}

async function resolveDNS(hostname) {
  const v4 = await new Promise((resolve) => {
    dns.resolve4(hostname, (err, addrs) => err ? resolve([]) : resolve(addrs));
  });
  const v6 = await new Promise((resolve) => {
    dns.resolve6(hostname, (err, addrs) => err ? resolve([]) : resolve(addrs));
  });
  return [...v4, ...v6];
}

async function validateResolvedIPs(hostname) {
  const addresses = await resolveDNS(hostname);
  for (const ip of addresses) {
    if (isPrivateIP(ip)) {
      throw new Error(`SSRF blocked: ${hostname} resolves to private IP ${ip}`);
    }
  }
}

export async function safeFetch(urlStr, opts = {}) {
  const parsed = validateUrl(urlStr);
  await validateResolvedIPs(parsed.hostname);

  const timeout = opts.timeout || 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const { signal: _, ...fetchOpts } = opts;
    const res = await fetch(urlStr, {
      ...fetchOpts,
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...opts.headers,
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function safeFetchBuffer(urlStr, opts = {}) {
  const res = await safeFetch(urlStr, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function safeFetchJSON(urlStr, opts = {}) {
  const res = await safeFetch(urlStr, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export { validateUrl as validateSSRFUrl, isPrivateIP };
