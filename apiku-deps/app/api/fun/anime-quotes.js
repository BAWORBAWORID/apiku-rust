const API = "https://raw.githubusercontent.com/Ditzzx-vibecoder/Assets/main/anime-quotes.json";

let _cache = null;

async function fetchQuotes() {
  if (_cache) return _cache;

  const res = await fetch(API, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json, text/plain, */*"
    }
  });

  if (!res.ok) throw new Error(`Gagal mengambil data quotes: HTTP ${res.status}`);

  const data = await res.json();

  const list = Array.isArray(data) ? data
    : Array.isArray(data.quotes) ? data.quotes
    : Array.isArray(data.result) ? data.result
    : Array.isArray(data.data) ? data.data
    : [];

  if (!list.length) throw new Error("Data quotes kosong");

  _cache = list;
  return list;
}

export default {
  name: "Anime Quotes",
  description: "Dapatkan quote anime random dari 205 koleksi quotes.",
  category: "Fun",
  methods: ["GET", "POST"],
  params: [],

  paramsSchema: {},

  async run(req, res) {
    try {
      const quotes = await fetchQuotes();
      const selected = quotes[Math.floor(Math.random() * quotes.length)];

      return res.json({
        status: true,
        total: quotes.length,
        result: {
          quote: selected.quote || selected.text || selected.kata || null,
          character: selected.character || selected.char || selected.name || selected.tokoh || null,
          anime: selected.anime || selected.title || selected.source || null
        }
      });
    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || "Gagal mengambil anime quotes" });
    }
  }
};
