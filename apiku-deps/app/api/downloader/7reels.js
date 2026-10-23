import axios from 'axios';
import logger from '../../src/utils/logger.js';

let cachedEmbedKey = null;

const BASE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
};

/**
 * Dynamically extract the live embedKey from 7reels.cc bundles
 */
async function getEmbedKey() {
  if (cachedEmbedKey) {
    return cachedEmbedKey;
  }

  try {
    const homeRes = await axios.get('https://7reels.cc', {
      headers: BASE_HEADERS,
      timeout: 8000,
    });

    const matchIndex =
      homeRes.data.match(/src="(\/assets\/index-[a-zA-Z0-9]{8}\.js)"/) ||
      homeRes.data.match(/href="(\/assets\/index-[a-zA-Z0-9]{8}\.js)"/);
    if (!matchIndex) {
      throw new Error('Could not find main assets/index JS bundle on 7reels');
    }

    const mainBundleUrl = `https://7reels.cc${matchIndex[1]}`;
    const mainBundleRes = await axios.get(mainBundleUrl, {
      headers: BASE_HEADERS,
      timeout: 8000,
    });

    const matchChunk = mainBundleRes.data.match(
      /([a-zA-Z0-9_-]*AdSafetyWarning-[a-zA-Z0-9]{8}\.js)/
    );
    if (!matchChunk) {
      throw new Error('Could not find AdSafetyWarning chunk inside index JS');
    }

    const warningChunkUrl = `https://7reels.cc/assets/${matchChunk[1]}`;
    const warningRes = await axios.get(warningChunkUrl, {
      headers: BASE_HEADERS,
      timeout: 8000,
    });

    const matchKey = warningRes.data.match(/key_[a-f0-9]+/i);
    if (!matchKey) {
      throw new Error('Could not find embedKey pattern in warning chunk');
    }

    cachedEmbedKey = matchKey[0];
    return cachedEmbedKey;
  } catch {
    cachedEmbedKey = 'key_c90081fa77254eb5';
    return cachedEmbedKey;
  }
}

/**
 * Resolve Stream Embed URLs for all players
 * @param {string|number} id - TMDB ID
 * @param {string} type - Media type ('movie' or 'tv')
 * @param {number} seasonNum - Season number (required for TV)
 * @param {number} episodeNum - Episode number (required for TV)
 */
async function getStreamUrls(id, type = 'movie', seasonNum = null, episodeNum = null) {
  const isTv = type === 'tv';
  const embedKey = await getEmbedKey();

  const players = [
    { key: 'strigil', label: 'Strigil', quality: '4K HDR' },
    { key: 'videasy', label: 'VidEasy', quality: '4K' },
    { key: 'vidsuper', label: 'VidSuper', quality: '4K' },
    { key: 'vidcore', label: 'VidCore', quality: '1080p' },
    { key: 'vidrock', label: 'AdRock', quality: '1080p' },
    { key: 'vidnest', label: 'VidNest', quality: '1080p' },
    { key: 'vidlink', label: 'VidLink', quality: '1080p' },
    { key: 'vidify', label: 'Vidify', quality: '1080p' },
    { key: 'vidzee', label: 'VidZee', quality: '1080p' },
    { key: 'vidsrc0', label: 'VidSrc', quality: '1080p' },
    { key: '2embed', label: '2Embed', quality: '1080p' },
  ];

  const resolvedUrls = [];

  for (const player of players) {
    let streamUrl = '';

    if (!isTv) {
      switch (player.key) {
        case '2embed':
          streamUrl = `https://www.2embed.cc/embed/${id}`;
          break;
        case 'strigil':
          streamUrl = `https://strigil.cc/embed/movie/${id}?embedKey=${embedKey}&autoPlay=true&theme=16A085&sub=en`;
          break;
        case 'vidsuper':
          streamUrl = `https://vidsuper.net/movie/${id}?overlay=true&color=16A085`;
          break;
        case 'videasy':
          streamUrl = `https://player.videasy.net/movie/${id}?overlay=true&color=16A085`;
          break;
        case 'vidcore':
          streamUrl = `https://vidcore.net/movie/${id}?autoPlay=true&sub=en`;
          break;
        case 'vidsrc0':
          streamUrl = `https://vidsrc.mov/embed/movie/${id}`;
          break;
        case 'vidrock':
          streamUrl = `https://vidrock.net/movie/${id}`;
          break;
        case 'vidnest':
          streamUrl = `https://vidnest.fun/movie/${id}`;
          break;
        case 'vidlink':
          streamUrl = `https://vidlink.pro/movie/${id}`;
          break;
        case 'vidify':
          streamUrl = `https://player.vidify.top/embed/movie/${id}`;
          break;
        case 'vidzee':
          streamUrl = `https://player.vidzee.wtf/embed/movie/${id}`;
          break;
      }
    } else {
      const s = seasonNum || 1;
      const ep = episodeNum || 1;

      switch (player.key) {
        case '2embed':
          streamUrl = `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${ep}`;
          break;
        case 'strigil':
          streamUrl = `https://strigil.cc/embed/tv/${id}/${s}/${ep}?embedKey=${embedKey}&autoPlay=true&theme=16A085&sub=en`;
          break;
        case 'vidsuper':
          streamUrl = `https://vidsuper.net/tv/${id}/${s}/${ep}?nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true&overlay=true&color=16A085`;
          break;
        case 'videasy':
          streamUrl = `https://player.videasy.net/tv/${id}/${s}/${ep}?nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true&overlay=true&color=16A085`;
          break;
        case 'vidcore':
          streamUrl = `https://vidcore.net/tv/${id}/${s}/${ep}?autoPlay=true&sub=en`;
          break;
        case 'vidsrc0':
          streamUrl = `https://vidsrc.mov/embed/tv/${id}/${s}/${ep}`;
          break;
        case 'vidrock':
          streamUrl = `https://vidrock.net/tv/${id}/${s}/${ep}`;
          break;
        case 'vidnest':
          streamUrl = `https://vidnest.fun/tv/${id}/${s}/${ep}`;
          break;
        case 'vidlink':
          streamUrl = `https://vidlink.pro/tv/${id}/${s}/${ep}`;
          break;
        case 'vidify':
          streamUrl = `https://player.vidify.top/embed/tv/${id}/${s}/${ep}`;
          break;
        case 'vidzee':
          streamUrl = `https://player.vidzee.wtf/embed/tv/${id}/${s}/${ep}`;
          break;
      }
    }

    if (streamUrl) {
      resolvedUrls.push({
        server: player.label,
        key: player.key,
        quality: player.quality,
        url: streamUrl,
      });
    }
  }

  return resolvedUrls;
}

/**
 * Helper to resolve page-based player encryption (VidCore, VidUp, VidFast)
 */
async function resolvePagePlayer(playerKey, domain, tmdbId, type, seasonNum, episodeNum) {
  const isTv = type === 'tv';
  const baseUrl = isTv
    ? `https://${domain}/tv/${tmdbId}/${seasonNum || 1}/${episodeNum || 1}/`
    : `https://${domain}/movie/${tmdbId}/`;

  const pageRes = await axios.get(baseUrl, {
    headers: BASE_HEADERS,
    timeout: 10000,
  });

  const match =
    pageRes.data.match(/\\"en\\":\\"(.*?)\\"/) ||
    pageRes.data.match(/"en":"(.*?)"/);
  if (!match) {
    throw new Error(`Failed to find encrypted content on ${domain}`);
  }
  const text = match[1];

  const encUrl = `https://enc-dec.app/api/enc-${playerKey}?text=${text}`;
  const partsRes = await axios.get(encUrl, { timeout: 10000 });
  if (partsRes.data.status !== 200) {
    throw new Error(partsRes.data.error || 'Encryption failed');
  }
  const { servers, stream, token } = partsRes.data.result;

  const headers = {
    ...BASE_HEADERS,
    Referer: `https://${domain}/`,
    'X-Requested-With': 'XMLHttpRequest',
    'X-CSRF-Token': token,
  };

  const serversEncRes = await axios.post(servers, {}, { headers, timeout: 10000 });

  const decServersRes = await axios.post(
    `https://enc-dec.app/api/dec-${playerKey}`,
    { text: serversEncRes.data },
    { timeout: 10000 }
  );
  if (decServersRes.data.status !== 200) {
    throw new Error('Failed to decrypt servers');
  }
  const serversDecrypted = decServersRes.data.result;

  const serverData = serversDecrypted[0].data;
  const streamEncUrl = `${stream}/${serverData}`;

  const streamEncRes = await axios.post(streamEncUrl, {}, { headers, timeout: 10000 });

  const decStreamRes = await axios.post(
    `https://enc-dec.app/api/dec-${playerKey}`,
    { text: streamEncRes.data },
    { timeout: 10000 }
  );
  if (decStreamRes.data.status !== 200) {
    throw new Error('Failed to decrypt stream');
  }

  return decStreamRes.data.result;
}

/**
 * Get direct stream (.m3u8) source with auto-fallback
 */
async function getDirectStreamWithFallback(id, type = 'movie', seasonNum = null, episodeNum = null, preferredPlayer = 'vidcore') {
  const playerList = [
    preferredPlayer.toLowerCase(),
    'vidcore',
    'vidup',
    'vidfast',
  ].filter((v, i, a) => a.indexOf(v) === i);

  const playerConfigs = {
    vidcore: { key: 'vidcore', domain: 'vidcore.net' },
    vidup: { key: 'vidup', domain: 'vidup.to' },
    vidfast: { key: 'vidfast', domain: 'vidfast.vc' },
  };

  let lastError = null;

  for (const pKey of playerList) {
    const config = playerConfigs[pKey];
    if (!config) continue;

    try {
      const data = await resolvePagePlayer(
        config.key,
        config.domain,
        id,
        type,
        seasonNum,
        episodeNum
      );
      if (data && data.url) {
        return {
          status: 'success',
          player: pKey,
          result: data,
        };
      }
    } catch (err) {
      lastError = err;
    }
  }

  return {
    status: 'error',
    message: lastError ? lastError.message : 'No direct stream server responded.',
  };
}

export default {
  name: '7REELS Movie & TV Stream Downloader',
  description:
    'Ambil link streaming embed player (11 server) dan direct stream (.m3u8) film / series dari 7reels.cc.',
  category: 'Downloader',
  methods: ['GET', 'POST'],

  params: ['id', 'type', 'season', 'episode', 'player', 'mode'],

  paramsSchema: {
    id: {
      type: 'string',
      required: true,
      description: 'TMDB ID film atau serial TV (contoh: 157336 untuk Interstellar, 1396 untuk Breaking Bad)',
      example: '157336',
    },
    type: {
      type: 'string',
      required: false,
      enum: ['movie', 'tv'],
      default: 'movie',
      description: 'Tipe media: movie atau tv',
      example: 'movie',
    },
    season: {
      type: 'number',
      required: false,
      default: 1,
      description: 'Nomor season (wajib jika type=tv)',
      example: 1,
    },
    episode: {
      type: 'number',
      required: false,
      default: 1,
      description: 'Nomor episode (wajib jika type=tv)',
      example: 1,
    },
    player: {
      type: 'string',
      required: false,
      enum: ['vidcore', 'vidup', 'vidfast'],
      default: 'vidcore',
      description: 'Pilihan server direct stream (vidcore, vidup, vidfast)',
      example: 'vidcore',
    },
    mode: {
      type: 'string',
      required: false,
      enum: ['all', 'stream', 'direct'],
      default: 'all',
      description: 'Mode output: all (embed + direct), stream (hanya embed server), direct (hanya direct m3u8)',
      example: 'all',
    },
  },

  async run(req, res) {
    const startTime = Date.now();

    try {
      const {
        id,
        type = 'movie',
        season = 1,
        episode = 1,
        player = 'vidcore',
        mode = 'all',
      } = { ...req.query, ...req.body };

      if (!id) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'id' (TMDB ID) wajib diisi",
          example: '/api/downloader/7reels?id=157336&type=movie',
        });
      }

      const cleanType = String(type).toLowerCase().trim() === 'tv' ? 'tv' : 'movie';
      const cleanSeason = parseInt(season, 10) || 1;
      const cleanEpisode = parseInt(episode, 10) || 1;
      const cleanMode = String(mode).toLowerCase().trim();

      logger.info(
        `[7REELS Downloader] id=${id} | type=${cleanType} | season=${cleanSeason} | episode=${cleanEpisode} | mode=${cleanMode}`
      );

      let embedServers = null;
      let directStream = null;

      if (cleanMode === 'all' || cleanMode === 'stream') {
        embedServers = await getStreamUrls(id, cleanType, cleanSeason, cleanEpisode);
      }

      if (cleanMode === 'all' || cleanMode === 'direct') {
        directStream = await getDirectStreamWithFallback(
          id,
          cleanType,
          cleanSeason,
          cleanEpisode,
          player
        );
      }

      const duration = Date.now() - startTime;

      const responsePayload = {
        status: true,
        id: String(id),
        type: cleanType,
        mode: cleanMode,
      };

      if (cleanType === 'tv') {
        responsePayload.season = cleanSeason;
        responsePayload.episode = cleanEpisode;
      }

      if (embedServers) {
        responsePayload.total_servers = embedServers.length;
        responsePayload.servers = embedServers;
      }

      if (directStream) {
        responsePayload.direct_stream = directStream;
      }

      responsePayload.metadata = {
        processing_time: `${duration}ms`,
      };

      return res.json(responsePayload);
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[7REELS Downloader] Error: ${err.message}`);

      return res.status(500).json({
        status: false,
        message: err.message || 'Gagal memproses stream 7REELS',
        metadata: {
          processing_time: `${duration}ms`,
        },
      });
    }
  },
};
