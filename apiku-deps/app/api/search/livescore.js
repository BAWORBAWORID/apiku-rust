import axios from 'axios'
import logger from '../../src/utils/logger.js'

const HEADER = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
}

function urlEdisi(edisi) {
  return edisi === 'id'
    ? 'https://www.goal.com/id/livescore'
    : `https://www.goal.com/${edisi}/live-scores`
}

async function ambilLivescore(edisi = 'id') {
  const res = await axios.get(urlEdisi(edisi), { headers: HEADER, timeout: 15000 })
  const html = res.data
  const cocok = html.match(/__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s)
  if (!cocok) throw new Error('Gagal nemu __NEXT_DATA__, mungkin struktur halaman berubah')
  const json = JSON.parse(cocok[1])
  const liveScores = json?.props?.pageProps?.content?.liveScores
  if (!liveScores) throw new Error('Gagal nemu data liveScores di __NEXT_DATA__')
  return liveScores
}

function statusIndo(status) {
  const map = {
    FIXTURE: 'Belum Mulai',
    LIVE: 'Berlangsung',
    FINISHED: 'Selesai',
    RESULT: 'Selesai',
    POSTPONED: 'Ditunda',
    CANCELLED: 'Dibatalkan',
    HALF_TIME: 'Turun Minum'
  }
  return map[status] || status
}

function rapikan(dataMentah) {
  return dataMentah.map(grup => ({
    kompetisi: grup.competition?.name || '-',
    kompetisiId: grup.competition?.id || null,
    area: grup.competition?.area?.name || '-',
    pertandingan: (grup.matches || []).map(m => ({
      id: m.id,
      status: statusIndo(m.status),
      statusMentah: m.status,
      waktu: m.startDate,
      venue: m.venue?.name || null,
      tuanRumah: m.teamA?.name,
      tandang: m.teamB?.name,
      skorTuanRumah: m.score?.teamA ?? null,
      skorTandang: m.score?.teamB ?? null,
      kartuMerahTuanRumah: m.redCards?.teamA ?? 0,
      kartuMerahTandang: m.redCards?.teamB ?? 0,
      periode: m.period || null
    }))
  }))
}

export default {
  name: "Livescore",
  description: "Jadwal dan skor langsung sepakbola",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["edisi", "raw"],
  paramsSchema: {
    edisi: { type: "string", required: false, default: "id", description: "Edisi bahasa (id/en/...)", example: "id" },
    raw: { type: "string", required: false, default: "false", description: "Jika 'true', return data mentah" }
  },

  async run(req, res) {
    try {
      const { edisi, raw } = { ...req.query, ...req.body }
      const data = await ambilLivescore(edisi || 'id')
      const result = raw === 'true' ? data : rapikan(data)
      return res.json({ status: true, result })
    } catch (err) {
      logger.error(`[LIVESCORE] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || 'Gagal ambil livescore' })
    }
  }
}
