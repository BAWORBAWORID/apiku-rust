const API = "https://trw.lat/api/bypass";
const API_KEY = "TRW_FREE-GAY-15a92945-9b04-4c75-8337-f2a6007281e9";

function parseResult(result) {
  if (typeof result !== "string") return result;

  const tupleMatch = result.match(/^\(['"](.+?)['"]\s*,\s*(True|False)\)$/);
  if (tupleMatch) return tupleMatch[1];

  const quoteMatch = result.match(/^["'](.+?)["']$/);
  if (quoteMatch) return quoteMatch[1];

  return result;
}

async function bypassUrl(url) {
  const apiUrl = new URL(API);
  apiUrl.searchParams.set("apikey", API_KEY);
  apiUrl.searchParams.set("url", url);

  const res = await fetch(apiUrl.toString(), {
    method: "GET",
    headers: {
      "accept": "*/*",
      "origin": "https://bypassunlock.com",
      "referer": "https://bypassunlock.com/",
      "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36",
      "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Android"',
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
      "accept-language": "id-ID,id;q=0.9"
    }
  });

  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(text || res.statusText || `HTTP ${res.status}`);
  }

  if (!res.ok || !data.success || !data.result) {
    const upstreamError = data.message || data.error || (typeof data.result === 'string' && data.result) || `Bypass failed: HTTP ${res.status}`;
    throw new Error(upstreamError);
  }

  return parseResult(data.result);
}

async function resolveRedirects(url, maxHops = 10) {
  let current = url;
  for (let i = 0; i < maxHops; i++) {
    const res = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (loc) {
        current = new URL(loc, current).href;
        continue;
      }
    }
    const text = await res.text();
    const metaRefresh = text.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/i);
    if (metaRefresh) {
      current = new URL(metaRefresh[1].trim(), current).href;
      continue;
    }
    const jsLoc = text.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i);
    if (jsLoc) {
      current = new URL(jsLoc[1].trim(), current).href;
      continue;
    }
    break;
  }
  return current;
}

export default {
  name: "Bypass Link v2",
  description: "Bypass shortlink — support Linkvertise, Lootlinks, Sub2unlock, Pastebin, Bit.ly, Tinyurl, dan 40+ layanan lainnya.",
  category: "Bypass",
  methods: ["GET", "POST"],
  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL shortlink/adlink yang ingin di-bypass",
      example: "https://linkvertise.com/519136/resource-pack-hd?o=sharing",
      default: "https://linkvertise.com/519136/resource-pack-hd?o=sharing"
    }
  },

  async run(req, res) {
    const { url } = { ...req.query, ...req.body };

    if (!url || typeof url !== "string" || !url.trim()) {
      return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" });
    }

    try { new URL(url); } catch {
      return res.status(400).json({ status: false, message: "Format URL tidak valid" });
    }

    const start = Date.now();

    try {
      const result = await bypassUrl(url.trim());
      return res.json({
        status: true,
        result: {
          originalUrl: url.trim(),
          bypassedUrl: result,
          responseTime: `${Date.now() - start}ms`
        }
      });
    } catch (err) {
      try {
        const fallback = await resolveRedirects(url.trim());
        if (fallback && fallback !== url.trim()) {
          return res.json({
            status: true,
            result: {
              originalUrl: url.trim(),
              bypassedUrl: fallback,
              responseTime: `${Date.now() - start}ms`
            }
          });
        }
      } catch (_) {}

      return res.status(500).json({
        status: false,
        message: err.message || "Gagal bypass URL",
        result: { responseTime: `${Date.now() - start}ms` }
      });
    }
  }
};
