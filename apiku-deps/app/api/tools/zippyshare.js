import path from 'path';
import mime from 'mime-types';
import logger from '../../src/utils/logger.js';

const BASE_URL = 'https://zippyshare.day';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Upload buffer to Zippyshare CDN storage
 */
async function uploadBufferToZippyshare(buffer, filename, options = {}) {
  const mimeType = options.mimeType || mime.lookup(filename) || 'application/octet-stream';
  const password = options.password || '';
  const autoDelete = parseInt(options.autoDelete || options.exp, 10) || 0;
  const size = buffer.length;

  // 1. Get CSRF & cookies
  const homeRes = await fetch(BASE_URL + '/', {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(20000),
  });

  if (!homeRes.ok) throw new Error(`Gagal membuka Zippyshare: HTTP ${homeRes.status}`);

  const html = await homeRes.text();
  const rawCookies = homeRes.headers.getSetCookie
    ? homeRes.headers.getSetCookie()
    : [homeRes.headers.get('set-cookie')].filter(Boolean);

  const cookies = rawCookies.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
  const csrf = (html.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i) || [])[1];
  if (!csrf) throw new Error('Gagal mengekstrak CSRF token dari Zippyshare.');

  // 2. Request presigned upload URL
  const presignRes = await fetch(`${BASE_URL}/upload/presign`, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      'X-CSRF-TOKEN': csrf,
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': `${BASE_URL}/`,
      'Cookie': cookies,
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      filename,
      size,
      mime: mimeType,
      password,
      upload_auto_delete: autoDelete,
      folder_id: null,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!presignRes.ok) throw new Error(`Presign Zippyshare gagal: HTTP ${presignRes.status}`);

  const presignData = await presignRes.json();
  if (presignData.type === 'error' || !presignData.presigned_url) {
    throw new Error(presignData.msg || 'Gagal mendapatkan URL presign dari Zippyshare.');
  }

  // 3. Upload raw file to Cloudflare R2 presigned storage
  const r2Res = await fetch(presignData.presigned_url, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: buffer,
    signal: AbortSignal.timeout(60000),
  });

  if (!r2Res.ok && r2Res.status !== 200 && r2Res.status !== 204) {
    throw new Error(`Upload storage R2 gagal: HTTP ${r2Res.status}`);
  }

  // 4. Complete upload
  const completeRes = await fetch(`${BASE_URL}/upload/complete`, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      'X-CSRF-TOKEN': csrf,
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': `${BASE_URL}/`,
      'Cookie': cookies,
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      token: presignData.token,
      mime: mimeType,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!completeRes.ok) throw new Error(`Complete upload gagal: HTTP ${completeRes.status}`);

  const completeData = await completeRes.json();
  if (completeData.type !== 'success') {
    throw new Error(completeData.msg || 'Konfirmasi upload Zippyshare gagal.');
  }

  const pageUrl = completeData.download_link;
  let downloadUrl = pageUrl;
  let cdnUrl = null;

  // 5. Ambil link direct download & direct CDN link dari Cloudflare R2
  try {
    const downloadId = pageUrl.split('/')[3];
    const dlRes = await fetch(`${BASE_URL}/${downloadId}/download/create`, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': csrf,
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': pageUrl,
        'Cookie': cookies,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(20000),
    });

    if (dlRes.ok) {
      const dlData = await dlRes.json();
      if (dlData?.download_link) {
        downloadUrl = dlData.download_link;
        const headRes = await fetch(dlData.download_link, {
          method: 'HEAD',
          redirect: 'manual',
          headers: { 'User-Agent': USER_AGENT, 'Referer': pageUrl, 'Cookie': cookies },
          signal: AbortSignal.timeout(15000),
        });
        if (headRes.status >= 300 && headRes.status < 400) {
          cdnUrl = headRes.headers.get('location') || null;
        }
      }
    }
  } catch (err) {
    logger.warn(`[ZIPPYSHARE-CDN] Error resolving CDN link: ${err.message}`);
  }

  return {
    filename,
    filesize: formatBytes(size),
    filesize_bytes: size,
    mimetype: mimeType,
    download_id: completeData.download_id,
    page_url: pageUrl,
    download_url: downloadUrl,
    cdn_url: cdnUrl || downloadUrl,
  };
}

export default {
  name: 'Zippyshare Uploader',
  description: 'Upload semua jenis file ke Zippyshare CDN storage — mengembalikan link halaman, download link, dan direct CDN link',
  category: 'Tools',
  methods: ['GET', 'POST'],
  params: ['file', 'url', 'password', 'auto_delete'],
  paramsSchema: {
    file: {
      type: 'file',
      required: false,
      description: 'File yang ingin di-upload (multipart/form-data: field name "file")',
    },
    url: {
      type: 'string',
      required: false,
      description: 'URL file eksternal untuk di-upload secara remote (GET atau POST JSON)',
      example: 'https://example.com/sample.png',
    },
    password: {
      type: 'string',
      required: false,
      description: 'Password opsional untuk memproteksi file',
    },
    auto_delete: {
      type: 'number',
      required: false,
      description: 'Waktu hapus otomatis file dalam menit (default: 0 = permanen/durasi standar)',
      example: 0,
    },
  },

  async run(req, res) {
    const { default: multer } = await import('multer');
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max lewat API
    });

    upload.single('file')(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ status: false, message: 'Ukuran file melebihi batas (maks 100MB)' });
        }
        return res.status(400).json({ status: false, message: err.message || 'Error upload file' });
      }

      try {
        const params = { ...req.query, ...req.body };
        let buffer = null;
        let filename = '';
        let mimeType = '';

        if (req.file) {
          buffer = req.file.buffer;
          filename = req.file.originalname || `upload_${Date.now()}.bin`;
          mimeType = req.file.mimetype || mime.lookup(filename) || 'application/octet-stream';
        } else if (params.url) {
          const targetUrl = String(params.url).trim();
          logger.info(`[ZIPPYSHARE-UPLOAD] Remote upload from: ${targetUrl}`);
          const fetchRes = await fetch(targetUrl, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(45000),
          });
          if (!fetchRes.ok) {
            return res.status(400).json({ status: false, message: `Gagal mengunduh file remote: HTTP ${fetchRes.status}` });
          }
          const arrayBuf = await fetchRes.arrayBuffer();
          buffer = Buffer.from(arrayBuf);
          const urlPath = new URL(targetUrl).pathname;
          filename = path.basename(urlPath) || `remote_${Date.now()}.bin`;
          mimeType = fetchRes.headers.get('content-type') || mime.lookup(filename) || 'application/octet-stream';
        } else {
          return res.status(400).json({
            status: false,
            message: 'Parameter "file" (multipart) atau "url" wajib diisi',
            example: {
              multipart: 'POST /api/tools/zippyshare dengan form-data file=<binary>',
              json: 'POST /api/tools/zippyshare dengan {"url": "https://example.com/file.jpg"}',
            },
          });
        }

        const result = await uploadBufferToZippyshare(buffer, filename, {
          mimeType,
          password: params.password,
          autoDelete: params.auto_delete || params.exp,
        });

        logger.info(`[ZIPPYSHARE-UPLOAD] Berhasil: ${filename} -> ${result.page_url}`);

        return res.status(200).json({
          status: true,
          action: 'upload',
          result,
        });
      } catch (e) {
        logger.error(`[ZIPPYSHARE-UPLOAD] Gagal: ${e.message}`);
        return res.status(500).json({
          status: false,
          message: e.message || 'Terjadi kesalahan saat upload ke Zippyshare',
        });
      }
    });
  },
};
