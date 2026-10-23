/**
 * MAGMA API — Endpoint Katalog Gunung Api
 * Sumber data: magma.esdm.go.id
 * Metode: GET /
 */

import axios from "axios"
import * as cheerio from "cheerio"

const BASE_URL = "https://magma.esdm.go.id"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

export default {
  name: "MAGMA Katalog Gunung Api",
  description: "Daftar 69 gunung api di Indonesia",
  category: "Tools",
  methods: ["GET", "POST"],
  params: [],
  paramsSchema: {},
  async run(req, res) {
    try {
      const { data: html } = await axios.get(BASE_URL, {
        headers: { "User-Agent": UA, "Accept": "text/html" }
      })
      const $ = cheerio.load(html)
      
      let m = html.match(/var\s+markersGunungApi\s*=\s*(\[[\s\S]*?\])\s*[,;]/)
      if (!m) m = html.match(/var\s+markersGunungApi\s*=\s*(\[[\s\S]*?\])/)
      if (!m) {
        return res.json({ status: false, message: "Tidak bisa ekstrak katalog dari halaman", timestamp: Date.now() })
      }
      
      let raw
      try { raw = JSON.parse(m[1]) } catch { raw = null }
      if (!raw) {
        return res.json({ status: false, message: "Gagal parse JSON katalog", timestamp: Date.now() })
      }
      
      const catalog = raw
        .filter((it) => it && it.ga_code)
        .map((it) => ({
          code: String(it.ga_code),
          name: it.ga_nama_gapi || '',
          lat: it.ga_lat_gapi ? Number(it.ga_lat_gapi) : null,
          lon: it.ga_lon_gapi ? Number(it.ga_lon_gapi) : null,
          elevation: it.ga_elev_gapi ? Number(it.ga_elev_gapi) : null,
          province: it.ga_prov_gapi ?? null,
          kabupaten: it.ga_kab_gapi ?? null,
          status: Number(it.ga_status),
          hasVona: Boolean(it.has_vona),
        }))
      
      for (const v of catalog) if (v.name) _nameToCode[v.name] = v.code // simple in-memory cache
      
      res.json({
        status: true,
        timestamp: Date.now(),
        data: {
          source: BASE_URL,
          total: catalog.length,
          catalog
        }
      })
    } catch (err) {
      console.error("[MAGMA Katalog Error]", err.message)
      res.status(500).json({
        status: false,
        message: err.message || "Gagal mengambil katalog gunung",
        timestamp: Date.now()
      })
    }
  }
}

// Simple in-memory cache for name->code mapping (shared across requests)
const _nameToCode = {}

;(function populateNameToCode() {
  try {
    const { data: html } = axios.get(BASE_URL, { headers: { "User-Agent": UA } })
    const $ = cheerio.load(html)
    let m = html.match(/var\s+markersGunungApi\s*=\s*(\[[\s\S]*?\])\s*[,;]/)
    if (!m) m = html.match(/var\s+markersGunungApi\s*=\s*(\[[\s\S]*?\])/)
    if (m) {
      raw = JSON.parse(m[1])
      for (const it of raw.filter((it) => it && it.ga_code)) {
        _nameToCode[it.ga_nama_gapi || ''] = it.ga_code
      }
    }
  } catch (_) {}
})()