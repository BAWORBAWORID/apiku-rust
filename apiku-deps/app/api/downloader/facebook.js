/* Facebook Downloader — getmyfb.com */

import axios from 'axios';
import * as cheerio from 'cheerio';

const ENDPOINT = 'https://getmyfb.com/process';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';

async function getMyFb(url) {
  const body = new URLSearchParams({ id: url, locale: 'id' });

  const { data } = await axios.post(ENDPOINT, body.toString(), {
    headers: {
      'HX-Request': 'true',
      'HX-Trigger': 'form',
      'HX-Target': 'target',
      'HX-Current-URL': 'https://getmyfb.com/id',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      'Referer': 'https://getmyfb.com/id',
    },
    timeout: 30000,
  });

  const $ = cheerio.load(data);

  const result = {
    thumbnail: $('.results-item-image').attr('src') || null,
    title: $('.results-item-text').text().trim() || null,
    hd: null,
    sd: null,
    mp3: null,
  };

  $('.results-list-item').each((_, el) => {
    const text = $(el).text().trim();
    const link = $(el).find('a').attr('href');
    if (!link) return;
    if (/720p/i.test(text)) {
      result.hd = link;
    } else if (/360p/i.test(text)) {
      result.sd = link;
    } else if (/MP3/i.test(text)) {
      result.mp3 = link;
    }
  });

  if (!result.hd && !result.sd && !result.mp3) {
    throw new Error('Video Facebook tidak ditemukan');
  }

  return result;
}

export default {
  name: 'Facebook Downloader',
  description:
    "Download video Facebook — support HD (720p), SD (360p), dan MP3. Masukkan URL video/post Facebook.",
  category: 'Downloader',
  methods: ['GET', 'POST'],
  params: ['url'],
  paramsSchema: {
    url: {
      type: 'string',
      required: true,
      description: 'URL video Facebook (share link, post link, atau video URL)',
      example: 'https://www.facebook.com/share/r/18wcg5u7M7/',
      minLength: 10,
    },
  },

  async run(req, res) {
    const { url } = { ...req.query, ...req.body };

    if (!url || typeof url !== 'string' || url.trim() === '') {
      return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" });
    }

    try {
      const result = await getMyFb(url.trim());
      return res.json({ status: true, result });
    } catch (err) {
      const msg = err.message || 'Gagal mengunduh video Facebook';
      return res.status(400).json({ status: false, message: msg });
    }
  },
};
