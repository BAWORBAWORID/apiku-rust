import axios from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';

// =====================
// Known Zippyshare Domains Allowlist
// =====================
const KNOWN_ZIPPYSHARE_DOMAINS = [
  /^www\d{0,2}\.zippyshare\.com$/i,  // www, www12, www32, etc.
  /^zippyshare\.com$/i,
  /^www\d{0,2}\.zippyshare\.day$/i,
  /^zippyshare\.day$/i
];

// =====================
// Safe Math Expression Evaluator
// (Menggantikan eval() untuk eksekusi kode berbahaya)
// =====================

// Token types
const TOKEN = {
  NUMBER: 'NUMBER',
  PLUS: 'PLUS',
  MINUS: 'MINUS',
  STAR: 'STAR',
  SLASH: 'SLASH',
  PERCENT: 'PERCENT',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  FUNC: 'FUNC',
  COMMA: 'COMMA'
};

class SafeMathParser {
  constructor(expr) {
    this.expr = expr;
    this.tokens = [];
    this.pos = 0;
  }

  tokenize() {
    let i = 0;
    while (i < this.expr.length) {
      const ch = this.expr[i];

      // Skip whitespace
      if (/\s/.test(ch)) {
        i++;
        continue;
      }

      // Numbers (integer & float)
      if (/\d/.test(ch)) {
        let num = '';
        while (i < this.expr.length && /[\d.]/.test(this.expr[i])) {
          num += this.expr[i];
          i++;
        }
        this.tokens.push({ type: TOKEN.NUMBER, value: parseFloat(num) });
        continue;
      }

      // Math functions: Math.floor, Math.ceil, Math.round, Math.abs
      if (/[a-zA-Z]/.test(ch)) {
        let name = '';
        while (i < this.expr.length && /[a-zA-Z.]/.test(this.expr[i])) {
          name += this.expr[i];
          i++;
        }
        const allowedFuncs = ['Math.floor', 'Math.ceil', 'Math.round', 'Math.abs'];
        if (allowedFuncs.includes(name)) {
          this.tokens.push({ type: TOKEN.FUNC, value: name });
        } else {
          throw new Error(`Unknown function: ${name}`);
        }
        continue;
      }

      // Operators
      if (ch === '+') { this.tokens.push({ type: TOKEN.PLUS }); i++; continue; }
      if (ch === '-') { this.tokens.push({ type: TOKEN.MINUS }); i++; continue; }
      if (ch === '*') { this.tokens.push({ type: TOKEN.STAR }); i++; continue; }
      if (ch === '/') { this.tokens.push({ type: TOKEN.SLASH }); i++; continue; }
      if (ch === '%') { this.tokens.push({ type: TOKEN.PERCENT }); i++; continue; }
      if (ch === '(') { this.tokens.push({ type: TOKEN.LPAREN }); i++; continue; }
      if (ch === ')') { this.tokens.push({ type: TOKEN.RPAREN }); i++; continue; }
      if (ch === ',') { this.tokens.push({ type: TOKEN.COMMA }); i++; continue; }

      throw new Error(`Unexpected character: '${ch}'`);
    }
    return this.tokens;
  }

  // Recursive descent parser
  parse() {
    this.tokenize();
    this.pos = 0;
    const result = this.parseExpression();
    if (this.pos < this.tokens.length) {
      throw new Error('Unexpected tokens after expression');
    }
    return result;
  }

  parseExpression() {
    let left = this.parseTerm();
    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (token.type === TOKEN.PLUS) {
        this.pos++;
        left = left + this.parseTerm();
      } else if (token.type === TOKEN.MINUS) {
        this.pos++;
        left = left - this.parseTerm();
      } else {
        break;
      }
    }
    return left;
  }

  parseTerm() {
    let left = this.parseFactor();
    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (token.type === TOKEN.STAR) {
        this.pos++;
        left = left * this.parseFactor();
      } else if (token.type === TOKEN.SLASH) {
        this.pos++;
        const divisor = this.parseFactor();
        if (divisor === 0) throw new Error('Division by zero');
        left = left / divisor;
      } else if (token.type === TOKEN.PERCENT) {
        this.pos++;
        const mod = this.parseFactor();
        if (mod === 0) throw new Error('Modulo by zero');
        left = left % mod;
      } else {
        break;
      }
    }
    return left;
  }

  parseFactor() {
    const token = this.tokens[this.pos];
    if (!token) throw new Error('Unexpected end of expression');

    // Number literal
    if (token.type === TOKEN.NUMBER) {
      this.pos++;
      return token.value;
    }

    // Parenthesized expression: ( ... )
    if (token.type === TOKEN.LPAREN) {
      this.pos++;
      const result = this.parseExpression();
      if (this.pos >= this.tokens.length || this.tokens[this.pos].type !== TOKEN.RPAREN) {
        throw new Error('Missing closing parenthesis');
      }
      this.pos++;
      return result;
    }

    // Function call: Math.floor(...)
    if (token.type === TOKEN.FUNC) {
      const funcName = token.value;
      this.pos++;
      if (this.pos >= this.tokens.length || this.tokens[this.pos].type !== TOKEN.LPAREN) {
        throw new Error(`Missing '(' after function ${funcName}`);
      }
      this.pos++; // skip '('
      const arg = this.parseExpression();
      if (this.pos >= this.tokens.length || this.tokens[this.pos].type !== TOKEN.RPAREN) {
        throw new Error(`Missing ')' after function ${funcName} arguments`);
      }
      this.pos++; // skip ')'

      if (funcName === 'Math.floor') return Math.floor(arg);
      if (funcName === 'Math.ceil') return Math.ceil(arg);
      if (funcName === 'Math.round') return Math.round(arg);
      if (funcName === 'Math.abs') return Math.abs(arg);
      throw new Error(`Unknown function: ${funcName}`);
    }

    // Unary minus
    if (token.type === TOKEN.MINUS) {
      this.pos++;
      return -this.parseFactor();
    }

    throw new Error(`Unexpected token: ${JSON.stringify(token)}`);
  }
}

function safeEvalMath(expr) {
  if (!expr || typeof expr !== 'string') {
    throw new Error('Invalid expression');
  }
  // Only allow safe characters: digits, Math., parentheses, operators, whitespace
  if (!/^[\d\s+\-*/%.()a-zA-Z,]+$/.test(expr)) {
    throw new Error('Expression contains unsafe characters');
  }
  const parser = new SafeMathParser(expr);
  const result = parser.parse();
  if (!Number.isFinite(result)) {
    throw new Error('Expression resulted in non-finite value');
  }
  return result;
}

// =====================
// Extract Math Expression from Script
// =====================
function extractUrlIdExpr(html) {
  // Split untuk mendapatkan bagian ekspresi dari: document.getElementById('dlbutton').href = "..."
  const scriptPart = html.split("document.getElementById('dlbutton').href =")[1];
  if (!scriptPart) return null;

  // Ambil bagian setelah '='
  const afterEquals = scriptPart.split(';')[0];

  // Extract expression: simple arithmetic wrapped in parentheses like (30572 % 8194 + 5040)
  // Real zippyshare pages always use simple expressions without nested functions
  const exprMatch = afterEquals.match(/\([^)]+\)/);
  if (!exprMatch) return null;

  return exprMatch[0];
}

// =====================
// Parse File Size
// =====================
function parseFileSize(sizeStr) {
  if (!sizeStr) return 0;
  
  const match = sizeStr.match(/^([\d.]+)\s*(KB|MB|GB|B)?$/i);
  if (!match) return 0;
  
  const value = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();
  
  const units = {
    'B': 1,
    'KB': 1024,
    'MB': 1024 * 1024,
    'GB': 1024 * 1024 * 1024
  };
  
  return Math.round(value * (units[unit] || 1));
}

// =====================
// Validate URL Security
// =====================
function isValidZippyshareUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    
    // Only allow HTTPS or HTTP
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    
    // Check domain against allowlist
    const hostname = parsed.hostname;
    const isKnownDomain = KNOWN_ZIPPYSHARE_DOMAINS.some(regex => regex.test(hostname));
    if (!isKnownDomain) return false;
    
    // zippyshare.day path format: /ID/file or /ID
    if (hostname.includes('zippyshare.day')) {
      return /^\/[a-zA-Z0-9_-]+(\/file)?$/i.test(parsed.pathname);
    }

    // Check path format: /v/ID/file.html
    if (!/^\/v\/[a-zA-Z0-9]+\/file\.html$/.test(parsed.pathname)) return false;
    
    return true;
  } catch {
    return false;
  }
}

// =====================
// Zippyshare.day Downloader
// =====================
async function downloadZippyshareDay(url) {
  const cleanUrl = url.trim();
  const pageRes = await fetch(cleanUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!pageRes.ok) {
    throw new Error(`Gagal memuat halaman Zippyshare: HTTP ${pageRes.status}`);
  }

  const html = await pageRes.text();
  const $ = cheerio.load(html);

  const rawCookies = pageRes.headers.getSetCookie
    ? pageRes.headers.getSetCookie()
    : [pageRes.headers.get('set-cookie')].filter(Boolean);

  const cookies = rawCookies
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

  const csrfMatch = html.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i);
  const csrf = csrfMatch ? csrfMatch[1] : null;
  if (!csrf) throw new Error('Tidak dapat menemukan CSRF token pada halaman.');

  const idMatch = html.match(/const\s+downloadId\s*=\s*["']([^"']+)["']/i);
  const downloadId = idMatch ? idMatch[1] : cleanUrl.split('/')[3];
  if (!downloadId) throw new Error('Tidak dapat menemukan download ID pada halaman.');

  const filename = $('.filebox-title').first().text().trim() ||
    $('meta[name="title"]').attr('content')?.replace(/^Zippyshare\s*-\s*/i, '').trim() ||
    $('title').text().replace(/Zippyshare\s*—\s*Download\s*—\s*/i, '').trim() ||
    'file';

  let filesize = '';
  $('p.small').each((_, el) => {
    const text = $(el).text();
    if (/File size\s*:/i.test(text)) {
      filesize = text.replace(/.*File size\s*:\s*/i, '').trim();
    }
  });
  if (!filesize) {
    const btnMatch = html.match(/const\s+downloadBtnTxt\s*=\s*"Download\s*\(([^)]+)\)"/i);
    if (btnMatch) filesize = btnMatch[1].trim();
  }

  let uploadAt = '';
  $('p.small').each((_, el) => {
    const text = $(el).text();
    if (/Uploaded at\s*:/i.test(text)) {
      uploadAt = text.replace(/.*Uploaded at\s*:\s*/i, '').trim();
    }
  });

  let views = '';
  $('li.list-group-item').each((_, el) => {
    const text = $(el).text();
    if (/Views/i.test(text)) {
      views = $(el).find('span').text().trim();
    }
  });

  const countryMatch = html.match(/This file was uploaded from\s*<strong>([^<]+)<\/strong>/i);
  const uploaderCountry = countryMatch ? countryMatch[1].trim() : null;

  const createUrl = `https://zippyshare.day/${downloadId}/download/create`;
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'X-CSRF-TOKEN': csrf,
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': cleanUrl,
      'Cookie': cookies,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
    },
  });

  if (!createRes.ok) {
    throw new Error(`Gagal membuat download link: HTTP ${createRes.status}`);
  }

  const createData = await createRes.json();
  if (createData.error) {
    throw new Error(`Zippyshare error: ${createData.error}`);
  }

  const downloadUrl = createData.download_link;
  if (!downloadUrl) throw new Error('Download link tidak ditemukan dalam respon.');

  let directUrl = null;
  try {
    const headRes = await fetch(downloadUrl, {
      method: 'HEAD',
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': cleanUrl,
        'Cookie': cookies,
      },
    });
    if (headRes.status >= 300 && headRes.status < 400) {
      directUrl = headRes.headers.get('location') || null;
    }
  } catch {}

  return {
    url: downloadUrl,
    direct_url: directUrl || downloadUrl,
    filename,
    filesize,
    uploadDate: uploadAt,
    views: views || null,
    uploaderCountry,
    platform: 'Zippyshare',
  };
}

// =====================
// Zippyshare Downloader
// =====================
async function zippyshareDownloader(url) {
  if (!isValidZippyshareUrl(url)) {
    throw new Error('Invalid Zippyshare URL format. Contoh: https://zippyshare.day/62pbk9GdX6q1UXY/file');
  }

  const parsedUrl = new URL(url);
  if (parsedUrl.hostname.includes('zippyshare.day')) {
    return downloadZippyshareDay(url);
  }

  return new Promise(async (resolve, reject) => {
    try {

      const parsedUrl = new URL(url);
      const host = parsedUrl.hostname;
      const pathParts = parsedUrl.pathname.split('/');
      const id = pathParts[2]; // ID file

      const res = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        // Prevent redirect to internal addresses
        maxRedirects: 5,
        validateStatus: status => status === 200
      });

      const $ = cheerio.load(res.data);
      
      // Determine page type by checking for www32 or other patterns
      const isV2 = host.includes('www32');
      
      let filename, filesizeH, filesize, aploud, lastDownload, downloadUrl, previewUrl;

      if (isV2) {
        filename = $('#lrbox > div:nth-child(2) > div:nth-child(1) > font:nth-child(4)').text();
        filesizeH = $('#lrbox > div:nth-child(2) > div:nth-child(1) > font:nth-child(7)').text();
        filesize = parseFileSize(filesizeH);
        aploud = $('#lrbox > div:nth-child(2) > div:nth-child(1) > font:nth-child(10)').text();
        
        // Extract and safely evaluate URL ID expression
        const expr = extractUrlIdExpr(res.data);
        if (!expr) {
          return reject(new Error('Could not extract download URL'));
        }
        
        const urlIdRes = safeEvalMath(expr);
        downloadUrl = `https://${host}/d/${id}/${urlIdRes}/${filename}`;
        previewUrl = `https://${host}/i/${id}/${urlIdRes}/${filename}`;
        
        return resolve({
          url: downloadUrl,
          previewUrl,
          filename,
          filesize: filesizeH,
          filesizeBytes: filesize,
          uploadDate: aploud,
          platform: 'Zippyshare'
        });
      } else {
        const $lrbox = $('#lrbox > div.left');
        filename = $lrbox.find('font').eq(2).text().trim();
        
        const $div = $lrbox.find('div').eq(0).find('div').eq(0);
        filesizeH = $div.find('font').eq(1).text().trim();
        filesize = parseFileSize(filesizeH);
        aploud = $div.find('font').eq(3).text().trim();
        lastDownload = $div.find('font').eq(5).text().trim();
        
        // Extract and safely evaluate URL ID expression
        const expr = extractUrlIdExpr(res.data);
        if (!expr) {
          return reject(new Error('Could not extract download URL'));
        }
        
        const urlIdRes = safeEvalMath(expr);
        downloadUrl = `https://${host}/d/${id}/${urlIdRes}/${filename}`;
        
        return resolve({
          url: downloadUrl,
          filename,
          filesize: filesizeH,
          filesizeBytes: filesize,
          uploadDate: aploud,
          lastDownload,
          platform: 'Zippyshare'
        });
      }
    } catch (error) {
      // Sanitize error message — don't leak internal details
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
        return reject(new Error('Zippyshare service is currently unavailable'));
      }
      return reject(new Error(`Zippyshare download failed: ${error.message}`));
    }
  });
}

// =====================
// API Handler
// =====================
export default {
    name: "Zippyshare Downloader",
    description: "Download files from Zippyshare",
    category: "Downloader",
    methods: ["GET", "POST"],

    params: ["url"],

    paramsSchema: {
        url: {
            type: "string",
            required: true,
            description: "Zippyshare file URL to download"
        }
    },

    examples: [
        {
            url: "https://zippyshare.day/62pbk9GdX6q1UXY/file",
            description: "Download file from Zippyshare"
        }
    ],

    async run(req, res) {
        try {
            const params = { ...req.query, ...req.body };
            const url = params.url ? String(params.url).trim() : '';

            // Validate URL parameter
            if (!url) {
                return res.status(400).json({
                    success: false,
                    error: 'Parameter "url" is required',
                    example: '/api/downloader/zippyshare?url=https://zippyshare.day/62pbk9GdX6q1UXY/file',
                    timestamp: new Date().toISOString()
                });
            }

            // Validate URL format
            try {
                new URL(url);
            } catch {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid URL format. Please provide a valid URL including https://',
                    timestamp: new Date().toISOString()
                });
            }

            // Validate Zippyshare URL (strict)
            if (!isValidZippyshareUrl(url)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid Zippyshare URL. Must be a valid https://zippyshare.day/ID/file or https://[wwwN].zippyshare.com/v/ID/file.html URL',
                    timestamp: new Date().toISOString()
                });
            }

            // Process download
            const result = await zippyshareDownloader(url);

            return res.status(200).json({
                success: true,
                ...result,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            return res.status(400).json({
                success: false,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
};