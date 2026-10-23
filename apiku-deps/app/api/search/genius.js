const headers = {
  'Accept-Encoding': 'gzip',
  'x-genius-app-background-request': '0',
  'x-genius-logged-out': 'true',
  'x-genius-android-version': '8.1.1',
  'user-agent': 'Genius/8.1.1 (Android; Android 13; ZN/Android)',
};

function parseLyrics(node) {
  if (typeof node === 'string') return node;
  if (!node || !node.children) return '';
  if (node.tag === 'br') return '\n';
  return node.children.map(parseLyrics).join('');
}

async function detail(id) {
  const res = await fetch(`https://api.genius.com/songs/${id}`, { headers });
  const data = await res.json();
  const song = data.response.song;
  return {
    id: song.id,
    title: song.title,
    artist: song.artist_names,
    header_image_url: song.header_image_url,
    song_art_image_url: song.song_art_image_url,
    instrumental: song.instrumental,
    is_music: song.is_music,
    hidden: song.hidden,
    explicit: song.explicit,
    release_date: song.release_date_for_display,
    url: song.url,
    lyrics: song.lyrics ? parseLyrics(song.lyrics.dom).trim() : null,
  };
}

async function search(query) {
  const res = await fetch(`https://api.genius.com/search/multi?q=${encodeURIComponent(query)}`, { headers });
  const data = await res.json();
  const seen = new Set();
  const songs = [];
  for (const section of data.response.sections) {
    if (section.type === 'song' || section.type === 'top_hit') {
      for (const hit of section.hits) {
        if (hit.type === 'song' && !seen.has(hit.result.id)) {
          seen.add(hit.result.id);
          const s = hit.result;
          songs.push({
            id: s.id,
            title: s.title,
            artist: s.artist_names,
            header_image_url: s.header_image_url,
            url: s.url,
          });
        }
      }
    }
  }
  return songs;
}

export default {
  name: 'Genius Lyrics',
  description: 'Cari lagu atau ambil detail + lirik dari Genius. Tanpa API key.',
  category: 'Search',
  methods: ['GET', 'POST'],
  params: ['query', 'id'],
  paramsSchema: {
    query: {
      type: 'string',
      required: true,
      description: 'Kata kunci pencarian lagu.',
      example: 'bergema sampai selamanya',
    },
    id: {
      type: 'string',
      required: false,
      description: 'ID lagu Genius. Jika diisi, mengembalikan detail + lirik (mengabaikan query).',
      example: '11422842',
    },
  },

  async run(req, res) {
    try {
      const query = req.query?.query || req.body?.query;
      const id = req.query?.id || req.body?.id;

      if (id) {
        const d = await detail(id);
        return res.json({ status: true, result: d });
      }

      if (!query) {
        return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi." });
      }

      const songs = await search(query);
      return res.json({ status: true, result: songs });
    } catch (err) {
      console.error('[Genius Error]', err.message);
      return res.status(500).json({ status: false, message: err.message || 'Internal error' });
    }
  },
};
