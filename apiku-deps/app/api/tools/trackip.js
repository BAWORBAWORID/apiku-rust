/**
 * Track IP — All-in-one domain/IP intelligence
 * Gabungan: DNS lookup + IP/geo trace + subdomain finder
 *
 * GET  /api/tools/trackip?domain=wifi.id
 * POST /api/tools/trackip -d {"domain": "wifi.id"}
 */

import { Resolver } from "dns/promises"
import axios from "axios"
import logger from "../../src/utils/logger.js"

const AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
const MAX_IP_TRACE = 8

/* ================================
   DNS LOOKUP (native resolver)
================================ */
async function lookupDNS(domain) {
  const resolver = new Resolver()
  resolver.setServers(["8.8.8.8", "8.8.4.4"])

  const records = {}
  try { records.A = await resolver.resolve4(domain) } catch { records.A = [] }
  try { records.AAAA = await resolver.resolve6(domain) } catch { records.AAAA = [] }
  try {
    records.MX = (await resolver.resolveMx(domain)).map(r => ({ exchange: r.exchange, priority: r.priority }))
  } catch { records.MX = [] }
  try { records.TXT = await resolver.resolveTxt(domain) } catch { records.TXT = [] }
  try { records.NS = await resolver.resolveNs(domain) } catch { records.NS = [] }
  try { records.CNAME = await resolver.resolveCname(domain) } catch { records.CNAME = [] }
  try { records.SOA = await resolver.resolveSoa(domain) } catch { records.SOA = null }
  try { records.SRV = await resolver.resolveSrv(domain) } catch { records.SRV = [] }

  return records
}

/* ================================
   IP TRACE via ipapi.co
================================ */
async function traceIp(ip) {
  try {
    const { data } = await axios.get(`https://ipapi.co/${ip}/json/`, { timeout: 10000 })
    if (data.error) return null
    return {
      ip: data.ip,
      city: data.city,
      region: data.region,
      country: data.country_name,
      country_code: data.country_code,
      latitude: data.latitude,
      longitude: data.longitude,
      timezone: data.timezone,
      isp: data.org,
      asn: data.asn,
      currency: data.currency,
    }
  } catch {
    return null
  }
}

/* ================================
   SUBDOMAIN FINDER (multi-source)
================================ */
async function fetchJson(url) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 12000)
    const res = await fetch(url, { headers: { "User-Agent": AGENT }, signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

async function fetchText(url) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 12000)
    const res = await fetch(url, { headers: { "User-Agent": AGENT }, signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    return await res.text()
  } catch { return null }
}

function parseDomain(sub, domain) {
  if (!sub || typeof sub !== "string") return null
  sub = sub.trim().toLowerCase()
  if (sub.startsWith("*.") || sub === domain) return null
  if (sub.endsWith("." + domain)) return sub
  if (sub.endsWith(domain)) return sub
  return null
}

const SOURCES = [
  {
    name: "hackertarget",
    async fetch(domain) {
      const text = await fetchText(`https://api.hackertarget.com/hostsearch/?q=${domain}`)
      if (!text) return []
      const set = new Set()
      for (const line of text.split("\n")) {
        const p = parseDomain(line.split(",")[0]?.trim().toLowerCase(), domain)
        if (p) set.add(p)
      }
      return [...set]
    },
  },
  {
    name: "alienvault",
    async fetch(domain) {
      const data = await fetchJson(`https://otx.alienvault.com/api/v1/indicators/domain/${domain}/passive_dns`)
      if (!data?.passive_dns) return []
      const set = new Set()
      for (const entry of data.passive_dns) {
        const p = parseDomain(entry.hostname, domain)
        if (p) set.add(p)
      }
      return [...set]
    },
  },
  {
    name: "rapiddns",
    async fetch(domain) {
      const html = await fetchText(`https://rapiddns.io/subdomain/${domain}?full=1`)
      if (!html) return []
      const set = new Set()
      const regex = new RegExp(`([a-zA-Z0-9._-]+\\.${domain.replace(".", "\\.")})`, "gi")
      let m
      while ((m = regex.exec(html)) !== null) {
        const p = parseDomain(m[1], domain)
        if (p) set.add(p)
      }
      return [...set]
    },
  },
  {
    name: "urlscan",
    async fetch(domain) {
      const data = await fetchJson(`https://urlscan.io/api/v1/search/?q=domain:${domain}&size=100`)
      if (!data?.results) return []
      const set = new Set()
      for (const r of data.results) {
        const p = parseDomain(r.page?.domain, domain)
        if (p) set.add(p)
      }
      return [...set]
    },
  },
  {
    name: "certspotter",
    async fetch(domain) {
      const data = await fetchJson(`https://certspotter.com/api/v1/certs?domain=${domain}`)
      if (!Array.isArray(data)) return []
      const set = new Set()
      for (const cert of data) {
        for (const n of cert.dns_names || []) {
          const p = parseDomain(n, domain)
          if (p) set.add(p)
        }
      }
      return [...set]
    },
  },
]

async function findSubdomains(domain) {
  const sourceResults = await Promise.all(
    SOURCES.map(async (s) => {
      const subs = await s.fetch(domain)
      return { source: s.name, count: subs.length, subdomains: subs }
    })
  )

  const all = new Set()
  const sourceDetail = {}
  for (const sr of sourceResults) {
    sourceDetail[sr.source] = sr.count
    for (const sub of sr.subdomains) all.add(sub)
  }

  // DNS resolve IP untuk subdomain
  const resolver = new Resolver()
  resolver.setServers(["8.8.8.8"])
  const subsWithIps = {}
  const chunkSize = 25
  const arr = [...all]
  for (let i = 0; i < arr.length; i += chunkSize) {
    const chunk = arr.slice(i, i + chunkSize)
    await Promise.all(
      chunk.map(async (sub) => {
        try {
          const ips = await resolver.resolve4(sub)
          if (ips.length) subsWithIps[sub] = ips
        } catch {}
      })
    )
  }

  const sorted = [...arr].sort()
  const detail = sorted.map((sub) => ({
    subdomain: sub,
    ips: subsWithIps[sub] || [],
  }))

  return { count: detail.length, sources: sourceDetail, subdomains: detail }
}

/* ================================
   SCANWEB unggulan: cek HTTP status + title
================================ */
async function checkWeb(subdomain) {
  for (const proto of ["https", "http"]) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 6000)
      const res = await fetch(`${proto}://${subdomain}`, {
        headers: { "User-Agent": AGENT },
        signal: ctrl.signal,
        redirect: "follow",
      })
      clearTimeout(t)
      const body = await res.text()
      const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim()?.slice(0, 100) || ""
      return { status: res.status, title }
    } catch {}
  }
  return { status: 0, title: "" }
}

export default {
  name: "Track IP",
  description: "Intel domain lengkap dalam satu panggilan — DNS records, IP/geo trace, subdomain discovery + resolusi IP. Semua digabung menjadi satu response.",
  category: "Tools",
  methods: ["GET", "POST"],
  params: ["domain"],
  paramsSchema: {
    domain: {
      type: "string",
      required: true,
      description: "Domain target",
      example: "wifi.id",
    },
  },

  async run(req, res) {
    const start = Date.now()
    const { domain } = { ...req.query, ...req.body }
    if (!domain) {
      return res.status(400).json({ status: false, message: "Parameter 'domain' wajib diisi", example: { GET: "/api/tools/trackip?domain=wifi.id" } })
    }

    const cleanDomain = String(domain).trim()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .split(":")[0]

    try {
      const [dnsRecords, subdomainData] = await Promise.all([
        lookupDNS(cleanDomain),
        findSubdomains(cleanDomain),
      ])

      // IP utama (A record) + trace
      const mainIps = dnsRecords.A[0] ? [...dnsRecords.A] : []
      const traces = []
      const traceTargets = [...new Set(mainIps)].slice(0, MAX_IP_TRACE)
      for (const ip of traceTargets) {
        const info = await traceIp(ip)
        if (info) traces.push(info)
      }

      // HTTP scan untuk subdomain valid dengan IP publik
      let liveWebsites = []
      const scanCandidates = subdomainData.subdomains.filter((s) => s.ips.length > 0).slice(0, 20)
      const httpResults = await Promise.all(scanCandidates.map((s) => checkWeb(s.subdomain)))
      liveWebsites = scanCandidates
        .map((s, i) => ({ subdomain: s.subdomain, ...httpResults[i] }))
        .filter((s) => s.status > 0 && s.status < 500)

      return res.json({
        status: true,
        result: {
          domain: cleanDomain,
          duration: `${Date.now() - start}ms`,
          dns: {
            records: dnsRecords,
            summary: {
              total_records: Object.values(dnsRecords).flat().length,
              has_ipv4: dnsRecords.A.length > 0,
              has_ipv6: dnsRecords.AAAA.length > 0,
              has_mail: dnsRecords.MX.length > 0,
              has_nameservers: dnsRecords.NS.length > 0,
            },
          },
          ip_traces: traces.map((t) => ({
            ip: t.ip,
            location: `${t.city || "?"}, ${t.region || "?"}, ${t.country || "?"}`,
            coordinates: t.latitude && t.longitude ? [t.latitude, t.longitude] : null,
            timezone: t.timezone,
            isp: t.isp,
            asn: t.asn,
            currency: t.currency,
          })),
          subdomains: subdomainData,
          live_websites: liveWebsites,
        },
      })
    } catch (e) {
      logger.error(`[DOMAIN-INFO] Error: ${e.message}`)
      return res.status(500).json({ status: false, message: e.message })
    }
  },
}