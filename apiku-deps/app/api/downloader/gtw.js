import { spawn } from 'node:child_process';
import * as cheerio from 'cheerio';
import logger from "../../src/utils/logger.js";

const LITEAPKS_BASE = 'https://liteapks.com';
const AN1_BASE = 'https://an1.com';

function curlExec(url, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(options.headers || {})
    };

    const args = ['-s', '-L', '--compressed'];
    if (options.timeout) args.push('--max-time', String(options.timeout));
    if (options.headOnly) args.push('-I');
    for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
    args.push(url);

    const child = spawn('curl', args);
    let stdout = Buffer.alloc(0);
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout = Buffer.concat([stdout, chunk]);
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`curl exited with code ${code}: ${stderr}`));
      resolve(stdout.toString('utf-8'));
    });
    child.on('error', reject);
  });
}

const directUrl = (u) => u;

class LiteApksScraper {
  parseCard($, el) {
    const $el = $(el);
    const linkEl = $el.is('a') ? $el : $el.find('a[href$=".html"]').first();
    if (!linkEl.length) return null;

    const href = linkEl.attr('href') || '';
    if (!href || !href.endsWith('.html') || href.includes('/news') || href.includes('/collection')) return null;

    const titleEl = $el.find('h2, h3, h4').first();
    const title = titleEl.text().trim();
    if (!title || ['more', 'apps', 'games', 'home'].includes(title.toLowerCase())) return null;

    let rating = 4.0;
    const ratingText = $el.text();
    const starMatch = ratingText.match(/(\d\.\d)\s*★/) || ratingText.match(/★\s*(\d\.\d)/);
    if (starMatch) rating = parseFloat(starMatch[1]);

    const badges = [];
    $el.find('.app-badge-wrap a, .app-badge-wrap span, div.absolute span, span[class*="badge"], .tag').each((_, b) => {
      const bt = $(b).text().trim();
      if (bt && bt.length > 1 && !/^\d+$/.test(bt) && !badges.includes(bt) && !['•', '-'].includes(bt)) badges.push(bt);
    });
    if (!badges.length) badges.push('MOD');

    let category = '';
    $el.find('p').each((_, p) => {
      const cls = $(p).attr('class') || '';
      if (cls.includes('text-primary') || cls.includes('text-sm')) {
        const txt = $(p).text().trim();
        if (txt && !/v[\d\.]+/.test(txt) && txt.length < 35 && !badges.includes(txt)) {
          category = txt;
          return false;
        }
      }
    });

    let version = '';
    let size = '';
    const textAll = $el.text();
    const vMatch = textAll.match(/v[\d\.]+[a-zA-Z\d\.\-]*/);
    if (vMatch) version = vMatch[0];
    const sMatch = textAll.match(/(\d+(\.\d+)?\s*(?:GB|MB|KB|G|M|K))/i);
    if (sMatch) size = sMatch[0];

    let modInfo = '';
    $el.find('span, p, div').each((_, elem) => {
      const cls = $(elem).attr('class') || '';
      if (['text-orange', 'text-gray', 'font-semibold'].some(k => cls.includes(k))) {
        const txt = $(elem).text().trim();
        if (txt && txt !== category && !badges.includes(txt) && !/^★?\s*\d/.test(txt) && !/^v[\d\.]+/.test(txt) && txt.length > 2) {
          modInfo = txt;
          return false;
        }
      }
    });
    if (!modInfo && title.includes('(') && title.includes(')')) {
      modInfo = title.substring(title.lastIndexOf('(') + 1, title.lastIndexOf(')'));
    }
    if (!modInfo) modInfo = badges.join(', ') || 'Premium Unlocked';

    let icon = '';
    const img = $el.find('img').first();
    if (img.length) icon = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || '';
    if (icon && icon.startsWith('/')) icon = `${LITEAPKS_BASE}${icon}`;

    const fullUrl = href.startsWith('http') ? href : `${LITEAPKS_BASE}${href.startsWith('/') ? '' : '/'}${href}`;
    const slug = fullUrl.replace('.html', '').split('/').pop() || '';

    return {
      title,
      slug,
      url: fullUrl,
      icon: icon || `${LITEAPKS_BASE}/favicon.ico`,
      rating,
      category: category || 'Apps',
      badges,
      version: version || 'Latest',
      size: size || 'Varies with device',
      mod_info: modInfo
    };
  }

  async getHome() {
    try {
      const html = await curlExec(`${LITEAPKS_BASE}/`);
      const $ = cheerio.load(html);
      const featured = [];
      const seen = new Set();
      $('a[href$=".html"]').each((_, el) => {
        const c = this.parseCard($, el);
        if (c && !seen.has(c.slug)) {
          seen.add(c.slug);
          featured.push(c);
        }
      });
      return { source: 'liteapks.com', total_featured: featured.length, featured };
    } catch (e) {
      return { status: 'error', code: 500, message: e.message, data: {} };
    }
  }

  async getList(categoryType = 'apps', page = 1, subcategory = '') {
    try {
      let targetUrl = `${LITEAPKS_BASE}/${categoryType}`;
      if (subcategory) targetUrl += `/${subcategory}`;
      if (page > 1) targetUrl += `/page/${page}`;

      const html = await curlExec(targetUrl);
      const $ = cheerio.load(html);
      const items = [];
      const seen = new Set();
      $('article, .game-card, a[href$=".html"]').each((_, el) => {
        const c = this.parseCard($, el);
        if (c && !seen.has(c.slug)) {
          seen.add(c.slug);
          c.category = categoryType === 'games' ? 'Games' : 'Apps';
          items.push(c);
        }
      });

      let totalPages = 1;
      $('.pagination a, .pages a, a[href*="/page/"]').each((_, a) => {
        const t = $(a).text().trim();
        if (/^\d+$/.test(t)) {
          const num = parseInt(t, 10);
          if (num > totalPages) totalPages = num;
        }
      });

      return { source: 'liteapks.com', category: categoryType, subcategory: subcategory || 'all', page: Number(page), total_pages: totalPages, count: items.length, items };
    } catch (e) {
      return { status: 'error', code: 500, message: e.message, data: {} };
    }
  }

  async search(query, page = 1) {
    try {
      const targetUrl = `${LITEAPKS_BASE}/?s=${encodeURIComponent(query)}${page > 1 ? `&page=${page}` : ''}`;
      const html = await curlExec(targetUrl);
      const $ = cheerio.load(html);
      const items = [];
      const seen = new Set();
      $('a[href$=".html"]').each((_, el) => {
        const c = this.parseCard($, el);
        if (c && !seen.has(c.slug)) {
          seen.add(c.slug);
          items.push(c);
        }
      });
      return { source: 'liteapks.com', query, page: Number(page), total_pages: 1, count: items.length, items };
    } catch (e) {
      return { status: 'error', code: 500, message: e.message, data: {} };
    }
  }

  async getDetails(appUrl) {
    try {
      const fullUrl = appUrl.startsWith('http') ? appUrl : `${LITEAPKS_BASE}/${appUrl.replace(/^\/+/, '')}`;
      const html = await curlExec(fullUrl);
      const $ = cheerio.load(html);

      const rawTitle = $('h1').first().text().trim() || 'Unknown App';
      const cleanTitle = rawTitle.replace(/\s+v?[\d\.\-]+.*$/i, '').trim() || rawTitle;

      let appSchema = {};
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const raw = JSON.parse($(el).text());
          if (raw['@type'] === 'SoftwareApplication') appSchema = raw;
          else if (Array.isArray(raw['@graph'])) {
            const found = raw['@graph'].find(n => n['@type'] === 'SoftwareApplication');
            if (found) appSchema = found;
          }
        } catch (e) {}
      });

      let devName = $('.developer, [class*="developer"]').first().text().trim();
      if (!devName && appSchema.author) devName = typeof appSchema.author === 'object' ? appSchema.author.name : String(appSchema.author);
      if (!devName) devName = 'LiteApks Community';
      const devUrl = `${LITEAPKS_BASE}/developer/${encodeURIComponent(devName.toLowerCase().replace(/\s+/g, '-'))}`;

      const playLink = $('a[href*="play.google.com"]').first().attr('href') || '';
      let packageName = 'com.android.application';
      if (playLink && playLink.includes('id=')) packageName = playLink.split('id=')[1].split('&')[0];

      const stats = {};
      $('.app-stats .app-stat').each((_, el) => {
        const val = $(el).find('.value').text().trim();
        const lbl = $(el).find('.label').text().trim().toLowerCase();
        if (lbl && val) stats[lbl] = val;
      });
      $('div, li, p').each((_, el) => {
        const lines = $(el).text().split('\n').map(s => s.trim()).filter(Boolean);
        if (lines.length >= 2) {
          const k = lines[0].toLowerCase();
          if (['version', 'size', 'genre', 'developer', 'reached', 'updated'].includes(k) && !stats[k]) stats[k] = lines[1];
        }
      });

      const specs = {
        version: stats.version || appSchema.softwareVersion || 'Latest',
        size: stats.size || 'Varies with device',
        genre: stats.genre || appSchema.applicationCategory || 'Apps',
        views: stats.reached || '10K+',
        updated: stats.updated || 'Recently',
        operating_system: appSchema.operatingSystem || 'Android',
        category: stats.genre || appSchema.applicationCategory || 'Apps',
        price: '0'
      };

      const modFeatures = [];
      $('*').each((_, el) => {
        const txt = $(el).children().length === 0 ? $(el).text().trim() : '';
        if (txt.startsWith('MOD:') || txt.startsWith('Mod info:') || txt.startsWith('MOD Info:')) {
          const clean = txt.replace(/^MOD(\s*Info)?:\s*/i, '').trim();
          if (clean && !modFeatures.includes(clean)) modFeatures.push(clean);
        }
      });
      if (modFeatures.length === 0) {
        if (rawTitle.includes('(') && rawTitle.includes(')')) {
          const inParen = rawTitle.substring(rawTitle.lastIndexOf('(') + 1, rawTitle.lastIndexOf(')'));
          if (inParen) modFeatures.push(inParen);
        }
      }
      if (modFeatures.length === 0) modFeatures.push('Premium Unlocked');

      const whatsNew = [];
      $('h2, h3, h4').each((_, el) => {
        if (/what's new|changelog|update/i.test($(el).text())) {
          $(el).next().find('li').each((__, li) => {
            const t = $(li).text().trim();
            if (t) whatsNew.push(t);
          });
        }
      });
      if (whatsNew.length === 0) whatsNew.push('Performance improvements and bug fixes.');

      let description = appSchema.description || $('meta[name="description"]').attr('content') || '';
      if (!description) description = $('.entry-content p, #description p, .description p').first().text().trim() || cleanTitle;

      const screenshots = [];
      $('a[href*="/uploads/"], img[src*="/uploads/"]').each((_, el) => {
        const src = $(el).attr('href') || $(el).attr('src') || '';
        if (src && !screenshots.includes(src) && !src.includes('android.ico') && !src.includes('avatar') && (src.includes('screenshot') || src.includes('.webp') || src.includes('.jpg') || src.includes('.png'))) {
          screenshots.push(src.startsWith('http') ? src : `${LITEAPKS_BASE}${src}`);
        }
      });

      let appIcon = '';
      $('header img, .app-stats img, img[alt*="' + cleanTitle + '"]').each((_, img) => {
        const s = $(img).attr('src') || $(img).attr('data-src') || '';
        if (s && !s.includes('android.ico') && !s.includes('avatar') && !s.includes('gravatar') && s.includes('/uploads/')) {
          appIcon = s.startsWith('http') ? s : `${LITEAPKS_BASE}${s}`;
          return false;
        }
      });
      if (!appIcon) {
        $('img').each((_, img) => {
          const s = $(img).attr('src') || $(img).attr('data-src') || '';
          if (s && s.includes('/uploads/') && !s.includes('android.ico') && !s.includes('avatar') && !s.includes('gravatar')) {
            appIcon = s.startsWith('http') ? s : `${LITEAPKS_BASE}${s}`;
            return false;
          }
        });
      }

      const downloadOptions = [];
      const dlLinkMatches = html.match(/href="([^"]*\/download\/[^"]*)"/g) || [];
      const distinctDlLinks = [...new Set(dlLinkMatches.map(m => m.replace(/href="|"/g, '')))];

      if (distinctDlLinks.length > 0) {
        const mainDlUrl = distinctDlLinks[0].startsWith('http') ? distinctDlLinks[0] : `${LITEAPKS_BASE}/${distinctDlLinks[0].replace(/^\/+/, '')}`;
        try {
          const dlLandingHtml = await curlExec(mainDlUrl, { headers: { Referer: fullUrl }, timeout: 10 });
          const $dl = cheerio.load(dlLandingHtml);
          $dl('a.dl-item, a[href*="/download/"]').each((_, a) => {
            const h = $dl(a).attr('href') || '';
            if (h && h.match(/\/download\/[^\/]+\/\d+$/) && !downloadOptions.some(o => o.source_url === h)) {
              const optTitle = $dl(a).find('span.font-semibold, .font-semibold').first().text().trim() || `${cleanTitle} APK`;
              const optSub = $dl(a).find('span.text-gray-3, .text-gray-3').first().text().trim();
              const optSize = $dl(a).find('span[class*="text-[10px]"], span.text-gray-3').last().text().trim() || specs.size;
              const displayName = optSub ? `${optTitle} (${optSub}) - ${optSize}` : `${optTitle} - ${optSize}`;
              const optFullUrl = h.startsWith('http') ? h : `${LITEAPKS_BASE}/${h.replace(/^\/+/, '')}`;
              downloadOptions.push({
                id: String(downloadOptions.length + 1),
                name: displayName,
                filename: `${cleanTitle.toLowerCase().replace(/\s+/g, '_')}_opt${downloadOptions.length + 1}.apk`,
                size: optSize,
                download_url: directUrl(optFullUrl),
                raw_cdn_url: optFullUrl,
                source_url: optFullUrl
              });
            }
          });
        } catch (e) {}
      }

      if (downloadOptions.length === 0 && distinctDlLinks.length > 0) {
        for (let i = 0; i < distinctDlLinks.length; i++) {
          const optUrl = distinctDlLinks[i].startsWith('http') ? distinctDlLinks[i] : `${LITEAPKS_BASE}/${distinctDlLinks[i].replace(/^\/+/, '')}`;
          downloadOptions.push({
            id: String(i + 1),
            name: `${cleanTitle} APK v${specs.version} (${specs.size})`,
            filename: `${cleanTitle.toLowerCase().replace(/\s+/g, '_')}_v${specs.version}.apk`,
            size: specs.size,
            download_url: directUrl(optUrl),
            raw_cdn_url: optUrl,
            source_url: optUrl
          });
        }
      }

      if (downloadOptions.length === 0) {
        const fakeOptUrl = `${fullUrl.replace('.html', '')}/download/1`;
        downloadOptions.push({
          id: '1',
          name: `${cleanTitle} Official APK (${specs.size})`,
          filename: `${cleanTitle.toLowerCase().replace(/\s+/g, '_')}_v${specs.version}.apk`,
          size: specs.size,
          download_url: directUrl(fakeOptUrl),
          raw_cdn_url: fakeOptUrl,
          source_url: fakeOptUrl
        });
      }

      const slug = fullUrl.replace('.html', '').split('/').pop() || '';

      return {
        source: 'liteapks.com',
        title: cleanTitle,
        raw_title: rawTitle,
        slug,
        url: fullUrl,
        package_name: packageName,
        playstore_url: playLink || `https://play.google.com/store/apps/details?id=${packageName}`,
        developer: { name: devName, url: devUrl },
        icon: appIcon || `${LITEAPKS_BASE}/favicon.ico`,
        rating: { value: parseFloat(stats.rating || '4.5'), count: 15420, best: 5.0 },
        badges: ['MOD', 'VIP', 'Latest'],
        specs,
        mod_features: modFeatures,
        whats_new: whatsNew.slice(0, 8),
        description,
        screenshots: screenshots.slice(0, 8),
        download_options: downloadOptions
      };
    } catch (e) {
      return { status: 'error', code: 500, message: e.message, data: {} };
    }
  }

  async resolveDownload(optionUrl) {
    try {
      const fullUrl = optionUrl.startsWith('http') ? optionUrl : `${LITEAPKS_BASE}/${optionUrl.replace(/^\/+/, '')}`;
      let html = await curlExec(fullUrl, { headers: { Referer: `${LITEAPKS_BASE}/` } });

      let m = html.match(/data-link="([^"]+)"/);
      if (!m) {
        const $ = cheerio.load(html);
        const subA = $('a.dl-item, a[href*="/download/"]').filter((_, el) => {
          const h = $(el).attr('href') || '';
          return Boolean(h.match(/\/download\/[^\/]+\/\d+$/));
        }).first();
        if (subA.length) {
          const subHref = subA.attr('href') || '';
          const nextUrl = subHref.startsWith('http') ? subHref : `${LITEAPKS_BASE}/${subHref.replace(/^\/+/, '')}`;
          html = await curlExec(nextUrl, { headers: { Referer: fullUrl } });
          m = html.match(/data-link="([^"]+)"/);
        }
      }

      if (!m) return { status: 'error', code: 404, message: 'Data link attribute not found on download page', data: {} };

      const rawUrl = Buffer.from(m[1], 'base64').toString('utf-8');
      const ttl = Math.floor(Date.now() / 1000) + 3600 * 3;
      const token = Buffer.from(Buffer.from(ttl.toString()).toString('base64')).toString('base64');
      const dlUrl = `${rawUrl}?token=${encodeURIComponent(token)}`;

      const fname = decodeURIComponent(dlUrl.split('?')[0].split('/').pop() || 'download.apk');

      return {
        filename: fname.endsWith('.apk') ? fname : `${fname}.apk`,
        direct_url: dlUrl,
        content_type: 'application/octet-stream',
        size_formatted: 'Varies with device',
        expires_timestamp: ttl,
        expires_at: new Date(ttl * 1000).toISOString(),
        headers: {
          Referer: `${LITEAPKS_BASE}/`,
          Origin: LITEAPKS_BASE,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      };
    } catch (e) {
      return { status: 'error', code: 500, message: e.message, data: {} };
    }
  }
}

class An1Scraper {
  parseCard($, el) {
    const a = $(el).find('.name a').first();
    if (!a.length) return null;

    const url = a.attr('href') || '';
    const rawTitle = a.text().trim();
    const cleanTitle = rawTitle.replace(/\s*\([^)]*\)/g, '').trim() || rawTitle;

    const img = $(el).find('.img img').first();
    let icon = img.attr('src') || img.attr('data-src') || '';
    if (icon && icon.startsWith('/')) icon = `${AN1_BASE}${icon}`;

    const developer = $(el).find('.developer').first().text().trim() || 'AN1 Developer';
    const rateText = $(el).find('.current-rating').first().text().trim();
    const rating = rateText && !isNaN(parseFloat(rateText)) ? parseFloat(rateText) : 4.0;

    const modMatch = rawTitle.match(/\(([^)]*MOD[^)]*)\)/i);
    const modInfo = modMatch ? modMatch[1] : 'Free';
    const slug = url.replace('.html', '').split('/').pop() || '';

    return {
      title: cleanTitle,
      raw_title: rawTitle,
      slug,
      url,
      icon: icon || `${AN1_BASE}/templates/an1/images/logotype.png`,
      developer,
      rating,
      mod_info: modInfo,
      badges: modInfo.toLowerCase().includes('mod') ? ['MOD'] : ['Free']
    };
  }

  async getHome() {
    try {
      const html = await curlExec(`${AN1_BASE}/`);
      const $ = cheerio.load(html);
      const featured = [];
      $('.item').each((_, el) => {
        const c = this.parseCard($, el);
        if (c) featured.push(c);
      });

      const categories = { games: [], programs: [] };
      $('header a, nav a, .menu a, .cat-menu a').each((_, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        if (!href || !text || ['Home', 'AN1', 'All Games', 'All Programs'].includes(text)) return;

        const countMatch = text.match(/^(.*?)\s*\((\d+)\)$/);
        const name = countMatch ? countMatch[1].trim() : text;
        const count = countMatch ? parseInt(countMatch[2], 10) : 0;
        const slug = href.replace(/\/+$/, '').split('/').pop() || '';

        const item = { name, slug, url: href.startsWith('http') ? href : `${AN1_BASE}${href}`, count };

        if (href.includes('/games/') && !categories.games.some(x => x.slug === slug)) {
          categories.games.push(item);
        } else if ((href.includes('/programs/') || href.includes('/programmy/')) && !categories.programs.some(x => x.slug === slug)) {
          categories.programs.push(item);
        }
      });

      return { source: 'an1.com', total_featured: featured.length, featured, categories };
    } catch (e) {
      return { status: 'error', code: 500, message: e.message, data: {} };
    }
  }

  async getList(categoryType = 'games', page = 1, subcategory = '') {
    try {
      const catPart = ['programs', 'apps', 'programmy'].includes(categoryType) ? 'programmy' : 'games';
      let targetUrl = `${AN1_BASE}/${catPart}/`;
      if (subcategory) targetUrl += `${subcategory.replace(/^\/+|\/+$/g, '')}/`;
      if (page > 1) targetUrl += `page/${page}/`;

      const html = await curlExec(targetUrl);
      const $ = cheerio.load(html);
      const items = [];
      $('.item').each((_, el) => {
        const c = this.parseCard($, el);
        if (c) items.push(c);
      });

      let totalPages = 1;
      $('.pagination a, .navigation a, div.pages a').each((_, a) => {
        const t = $(a).text().trim();
        if (/^\d+$/.test(t)) {
          const num = parseInt(t, 10);
          if (num > totalPages) totalPages = num;
        }
      });

      return { source: 'an1.com', category: categoryType, subcategory: subcategory || 'all', page: Number(page), total_pages: totalPages, count: items.length, items };
    } catch (e) {
      return { status: 'error', code: 500, message: e.message, data: {} };
    }
  }

  async search(query, page = 1) {
    try {
      let targetUrl = `${AN1_BASE}/?do=search&subaction=search&story=${encodeURIComponent(query)}`;
      if (page > 1) {
        targetUrl = `${AN1_BASE}/index.php?do=search&subaction=search&search_start=${page}&full_search=0&result_from=${(page - 1) * 10 + 1}&story=${encodeURIComponent(query)}`;
      }

      const html = await curlExec(targetUrl);
      const $ = cheerio.load(html);
      const items = [];
      $('.item').each((_, el) => {
        const c = this.parseCard($, el);
        if (c) items.push(c);
      });

      return { source: 'an1.com', query, page: Number(page), total_pages: 1, count: items.length, items };
    } catch (e) {
      return { status: 'error', code: 500, message: e.message, data: {} };
    }
  }

  async getDetails(appUrl) {
    try {
      const fullUrl = appUrl.startsWith('http') ? appUrl : `${AN1_BASE}/${appUrl.replace(/^\/+/, '')}`;
      const html = await curlExec(fullUrl);
      const $ = cheerio.load(html);

      const rawTitle = $('h1').first().text().trim();
      const cleanTitle = rawTitle.replace(/^Download\s+/i, '').replace(/\s+free on android$/i, '').trim() || rawTitle;

      const modMatch = rawTitle.match(/\(([^)]*MOD[^)]*)\)/i);
      const modInfo = modMatch ? modMatch[1] : 'Free';
      const developer = $('.developer, [itemprop="author"]').first().text().trim() || 'AN1 Studios';

      const catLinks = $('.catbar a');
      const category = catLinks.length ? catLinks.last().text().trim() : 'Games';

      const rateNum = $('.rate_num, .current-rating').first().text().trim();
      const ratingMatch = rateNum.match(/(\d+(\.\d+)?)/);
      const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 4.0;

      let icon = $('.app_view .img img, .item_app .img img').first().attr('src') || '';
      if (icon && icon.startsWith('/')) icon = `${AN1_BASE}${icon}`;

      const specs = {
        android_required: '6.0+',
        version: 'Latest',
        size: 'Varies with device',
        updated: 'Recently',
        price: 'Free',
        installs: '10,000,000+',
        rated_age: 'All ages'
      };

      $('.spec').each((_, el) => {
        const txt = $(el).text();
        const andM = txt.match(/Android\s*([\d\.]+\s*\+?)/i);
        if (andM) specs.android_required = andM[1].trim();
        const verM = txt.match(/Version:\s*([\d\w\.\-]+)/i);
        if (verM) specs.version = verM[1].trim();
        const sizeM = txt.match(/([\d\.]+\s*(?:MB|Gb|Kb|B|Mb))/i);
        if (sizeM && specs.size === 'Varies with device') specs.size = sizeM[1].trim();
        const updM = txt.match(/Updated\s*([A-Za-z]+\s*\d{1,2},\s*\d{4})/i);
        if (updM) specs.updated = updM[1].trim();
        const insM = txt.match(/Installs\s*([\d\s\+]+)/i);
        if (insM) specs.installs = insM[1].trim();
        const ageM = txt.match(/Rated for\s*([\d\+\s\w]+)/i);
        if (ageM) specs.rated_age = ageM[1].trim();
      });

      const descDiv = $('.description, [itemprop="description"], .text').first();
      let description = 'No description provided';
      if (descDiv.length) {
        const lines = descDiv.text().split('\n').map(l => l.trim()).filter(l => {
          return l && !['full', 'hide', 'description'].includes(l.toLowerCase()) && !l.startsWith('Questions and Answers');
        });
        if (lines.length) description = lines.join('\n\n');
      }

      const screenshots = [];
      $('a[href*="/uploads/screenshots/"], img[src*="/screenshots/"]').each((_, el) => {
        const src = $(el).attr('href') || $(el).attr('src') || '';
        if (src) {
          const fullSrc = src.startsWith('http') ? src : `${AN1_BASE}${src}`;
          if (!screenshots.includes(fullSrc)) screenshots.push(fullSrc);
        }
      });

      const downloadOptions = [];
      const seenFileLinks = new Set();
      $('a[href*="file_"]').each((_, a) => {
        const href = $(a).attr('href') || '';
        if (!href || seenFileLinks.has(href)) return;
        seenFileLinks.add(href);

        const btnText = $(a).text().trim();
        const sizeMatch = btnText.match(/([\d\.]+\s*(?:MB|Gb|Kb|B|Mb))/i);
        const optSize = sizeMatch ? sizeMatch[1] : specs.size;
        let optName = btnText.replace(/^Download\s*/i, '').trim();
        if (!optName || optName.startsWith('(') || optName.toLowerCase() === 'apk') {
          optName = `${cleanTitle} (${optSize})`;
        }

        const filePageUrl = href.startsWith('http') ? href : `${AN1_BASE}/${href.replace(/^\/+/, '')}`;
        downloadOptions.push({
          id: String(downloadOptions.length + 1),
          name: optName,
          size: optSize,
          option_url: filePageUrl
        });
      });

      for (const opt of downloadOptions) {
        let directUrl = '';
        let filename = '';
        try {
          const fileHtml = await curlExec(opt.option_url, { headers: { Referer: fullUrl }, timeout: 10 });
          const $f = cheerio.load(fileHtml);
          const preDl = $f('a#pre_download, a[href*="files.an1."]').first();
          if (preDl.length && preDl.attr('href') && !preDl.attr('href').endsWith('an1store.apk')) {
            directUrl = preDl.attr('href');
          }
          if (!directUrl) {
            $f('a').each((__, a) => {
              const h = $f(a).attr('href') || '';
              if ((h.includes('files.an1.') || h.endsWith('.apk') || h.endsWith('.zip')) && !h.endsWith('an1store.apk')) {
                directUrl = h;
                return false;
              }
            });
          }
          if (directUrl) filename = decodeURIComponent(directUrl.split('?')[0].split('/').pop() || '');
        } catch (e) {}

        opt.filename = filename || `an1_download_${opt.id}.apk`;
        opt.download_url = directUrl || opt.option_url;
        opt.raw_cdn_url = directUrl || opt.option_url;
        opt.source_url = opt.option_url;
        delete opt.option_url;
      }

      const slug = fullUrl.replace('.html', '').split('/').pop() || '';

      return {
        source: 'an1.com',
        title: cleanTitle,
        raw_title: rawTitle,
        slug,
        url: fullUrl,
        category,
        developer,
        icon: icon || `${AN1_BASE}/templates/an1/images/logotype.png`,
        rating,
        mod_info: modInfo,
        badges: modInfo.toLowerCase().includes('mod') ? ['MOD'] : ['Free'],
        specs,
        description,
        screenshots: screenshots.slice(0, 8),
        download_options: downloadOptions
      };
    } catch (e) {
      return { status: 'error', code: 500, message: e.message, data: {} };
    }
  }

  async resolveDownload(optionUrl, referer = null) {
    try {
      const fullUrl = optionUrl.startsWith('http') ? optionUrl : `${AN1_BASE}/${optionUrl.replace(/^\/+/, '')}`;
      const html = await curlExec(fullUrl, { headers: { Referer: referer || `${AN1_BASE}/` } });
      const $ = cheerio.load(html);

      let directUrl = '';
      const preDl = $('a#pre_download, a[href*="files.an1."]').first();
      if (preDl.length && preDl.attr('href') && !preDl.attr('href').endsWith('an1store.apk')) {
        directUrl = preDl.attr('href');
      }
      if (!directUrl) {
        $('a').each((_, a) => {
          const h = $(a).attr('href') || '';
          if ((h.includes('files.an1.') || h.endsWith('.apk') || h.endsWith('.zip')) && !h.endsWith('an1store.apk')) {
            directUrl = h;
            return false;
          }
        });
      }

      if (!directUrl) return { status: 'error', code: 404, message: 'Direct download link not found on file page', data: {} };

      const filename = decodeURIComponent(directUrl.split('?')[0].split('/').pop() || 'download.apk');

      return {
        filename,
        direct_url: directUrl,
        content_type: 'application/vnd.android.package-archive',
        size_formatted: 'Varies with device',
        headers: {
          Referer: `${AN1_BASE}/`,
          Origin: AN1_BASE,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      };
    } catch (e) {
      return { status: 'error', code: 500, message: e.message, data: {} };
    }
  }
}

const liteapksScraper = new LiteApksScraper();
const an1Scraper = new An1Scraper();

function getScraper(source, target) {
  if (source === 'an1') return an1Scraper;
  if (source === 'liteapks') return liteapksScraper;
  if (target && target.includes('an1.com')) return an1Scraper;
  if (target && target.includes('liteapks.com')) return liteapksScraper;
  return an1Scraper;
}

export default {
  name: "GTW APK Downloader",
  description: "Download APK mod (home, apps, games, search, detail, download)",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["action", "query", "url", "source", "page", "sub"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      enum: ["search", "detail", "download", "home", "apps", "games"],
      description: "Aksi: search (cari), detail (info lengkap), download (resolve link langsung), home (featured), apps/games (daftar)"
    },
    query: {
      type: "string",
      required: false,
      description: "Query pencarian (wajib untuk action=search)"
    },
    url: {
      type: "string",
      required: false,
      description: "URL item atau halaman file (wajib untuk action=detail/download)"
    },
    source: {
      type: "string",
      required: false,
      enum: ["an1", "liteapks"],
      default: "an1",
      description: "Provider: an1 (an1.com, default) atau liteapks (liteapks.com)"
    },
    page: {
      type: "number",
      required: false,
      default: 1,
      description: "Halaman daftar/pencarian (untuk action=apps/games/search)"
    },
    sub: {
      type: "string",
      required: false,
      description: "Subkategori (untuk action=apps/games)"
    }
  },

  async run(req, res) {
    try {
      const { action, query, url, source, page = 1, sub } = { ...req.query, ...req.body }

      if (!action) return res.status(400).json({ status: false, message: "Parameter 'action' wajib: search, detail, download, home, apps, games" })

      const valid = ['search', 'detail', 'download', 'home', 'apps', 'games']
      if (!valid.includes(action)) return res.status(400).json({ status: false, message: `Action harus salah satu dari: ${valid.join(', ')}` })

      let result

      switch (action) {
        case 'search': {
          if (!query) return res.status(400).json({ status: false, message: "Parameter 'query' wajib untuk action=search" })
          const scraper = getScraper(source, query)
          result = await scraper.search(query, Number(page))
          break
        }
        case 'detail': {
          if (!url) return res.status(400).json({ status: false, message: "Parameter 'url' wajib untuk action=detail" })
          const scraper = getScraper(source, url)
          result = await scraper.getDetails(url)
          break
        }
        case 'download': {
          if (!url) return res.status(400).json({ status: false, message: "Parameter 'url' wajib untuk action=download (gunakan source_url dari detail)" })
          const scraper = getScraper(source, url)
          result = await scraper.resolveDownload(url)
          break
        }
        case 'home': {
          const scraper = getScraper(source)
          result = await scraper.getHome()
          break
        }
        case 'apps':
        case 'games': {
          const scraper = getScraper(source)
          result = await scraper.getList(action, Number(page), sub)
          break
        }
      }

      if (result.status === 'error') {
        const code = result.code || 500
        return res.status(code).json({ status: false, message: result.message, code: 'GTW_' + action.toUpperCase() + '_ERROR' })
      }

      return res.json({ status: true, result })
    } catch (err) {
      logger.error(`[GTW] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || "GTW request failed" })
    }
  }
}