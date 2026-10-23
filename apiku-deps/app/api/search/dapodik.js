import https from 'https';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

class DapodikScraper {
  constructor(baseUrl = 'https://dapo.kemendikdasmen.go.id') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = null;
    this.apiUrl = this.baseUrl;
  }

  fetchConfig() {
    return new Promise((resolve, reject) => {
      const url = `${this.baseUrl}/env.js`;
      const options = { headers: { 'User-Agent': USER_AGENT } };
      https.get(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const urlMatch = data.match(/VITE_STRAPI_URL\s*:\s*"(.*?)"/);
            const tokenMatch = data.match(/VITE_API_TOKEN\s*:\s*"(.*?)"/);
            if (urlMatch) this.apiUrl = urlMatch[1].replace(/\/$/, '');
            if (tokenMatch) this.token = tokenMatch[1];
            if (!this.token) return reject(new Error('Gagal mengurai VITE_API_TOKEN dari env.js'));
            resolve(true);
          } catch (err) { reject(err); }
        });
      }).on('error', (err) => { reject(err); });
    });
  }

  async getHeaders() {
    if (!this.token) await this.fetchConfig();
    return {
      'Authorization': `Bearer ${this.token}`,
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json'
    };
  }

  fetchJson(url) {
    return new Promise(async (resolve, reject) => {
      let headers;
      try {
        headers = await this.getHeaders();
      } catch (err) { return reject(err); }
      https.get(url, { headers }, (res) => {
        if (res.statusCode === 400) {
          return reject(new Error('Pencarian gagal: Request tidak valid. Kata kunci pencarian minimal 4 karakter.'));
        }
        if (res.statusCode === 429) {
          return reject(new Error('Terlalu banyak permintaan (Rate limit). Coba beberapa saat lagi.'));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Server merespon dengan status HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }).on('error', (err) => { reject(err); });
    });
  }

  async searchSchools(query) {
    const cleanQuery = String(query).trim();
    if (cleanQuery.length < 4) throw new Error('Kata kunci pencarian minimal harus 4 karakter.');
    const url = `${this.apiUrl}/api/detail-sekolah/search?q=${encodeURIComponent(cleanQuery)}`;
    const result = await this.fetchJson(url);
    if (result && result.data) return result.data;
    if (Array.isArray(result)) return result;
    return [];
  }

  async getSchoolDetail(npsn) {
    const cleanNpsn = String(npsn).trim();
    if (!/^\d+$/.test(cleanNpsn)) throw new Error('NPSN harus berupa angka.');
    const url = `${this.apiUrl}/api/detail-sekolah?npsn=${encodeURIComponent(cleanNpsn)}`;
    return await this.fetchJson(url);
  }
}

export default {
  name: "Dapodik Sekolah",
  description: "Pencarian data sekolah (Kementerian Pendidikan) — cari sekolah berdasarkan nama/kata kunci atau lihat detail lengkap per NPSN",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["action", "query", "npsn"],
  paramsSchema: {
    action: { type: "string", required: true, description: "Jenis aksi: search (cari sekolah) atau detail (detail per NPSN)", example: "search", enum: ["search", "detail"] },
    query: { type: "string", required: false, description: "Kata kunci pencarian sekolah (minimal 4 karakter, wajib untuk action=search)", example: "smpn 1", minLength: 4 },
    npsn: { type: "string", required: false, description: "Nomor Pokok Sekolah Nasional (wajib untuk action=detail)", example: "20601893" }
  },
  run(req, res) {
    const { action = "search", query, npsn } = { ...req.query, ...req.body };
    const scraper = new DapodikScraper();

    if (action === "detail") {
      if (!npsn) {
        return res.status(400).json({ error: "Parameter 'npsn' wajib diisi untuk action=detail" });
      }
      return scraper.getSchoolDetail(npsn)
        .then((data) => res.json({ status: true, result: data.data || data }))
        .catch((err) => res.status(500).json({ error: err.message }));
    }

    if (!query) {
      return res.status(400).json({ error: "Parameter 'query' wajib diisi untuk action=search" });
    }
    return scraper.searchSchools(query)
      .then((data) => res.json({ status: true, result: data }))
      .catch((err) => res.status(400).json({ error: err.message }));
  }
};
