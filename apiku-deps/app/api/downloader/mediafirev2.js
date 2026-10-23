/**
 * MediaFire Downloader API
 * Tanpa Puppeteer/Playwright - Hanya menggunakan fetch
 */

import logger from "../../src/utils/logger.js"

// ============================
//     FUNCTION MEDIAFIRE DL
// ============================
async function mediafireDownload(url) {
  try {
    // Fetch MediaFire page
    const response = await fetch(url, {
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "accept-encoding": "gzip, deflate, br",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "sec-ch-ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    // Extract download URL
    const urlMatch = html.match(/href="(.+?)"\s+id="downloadButton"/);
    if (!urlMatch) {
      // Try alternative patterns
      const altMatch = html.match(/href="(https:\/\/download[^"]+mediafire[^"]+)"/);
      if (!altMatch) {
        throw new Error("Download link not found - file may be removed or private");
      }
      urlMatch = altMatch;
    }

    const downloadUrl = urlMatch[1].replace(/&amp;/g, '&');

    // Extract file information
    const fileTypeMatch = html.match(/class="filetype"><span>(.+?)<\s*(?:.+?)\s*\((.+?)\)/);
    const fileType = fileTypeMatch ? `${fileTypeMatch[1]} ${fileTypeMatch[2]}` : 'Unknown';

    const descriptionMatch = html.match(/<div class="description">(.+?)<\/div>/s);
    let titleExt = 'No title';
    let descriptionExt = 'No description';
    
    if (descriptionMatch) {
      const titleMatch = descriptionMatch[1].match(/subheading">(.+?)</);
      if (titleMatch) titleExt = titleMatch[1];
      
      const descMatch = descriptionMatch[1].match(/<p>(.+?)<\/p>/);
      if (descMatch) descriptionExt = descMatch[1];
    }

    const fileSize = html.match(/File size:\s*<span>(.+?)<\/span>/)?.[1] || 'Unknown';
    const uploaded = html.match(/Uploaded:\s*<span>(.+?)<\/span>/)?.[1] || 'Unknown';
    const fileName = html.match(/class="filename">(.+?)<\/div>/)?.[1] || 'Unknown';
    
    // Extract file name from URL as fallback
    let cleanFileName = fileName;
    if (cleanFileName === 'Unknown') {
      const urlPath = new URL(url).pathname;
      const pathParts = urlPath.split('/');
      const possibleName = pathParts[pathParts.length - 2] || pathParts[pathParts.length - 1];
      if (possibleName && possibleName !== 'file') {
        cleanFileName = decodeURIComponent(possibleName);
      }
    }

    // Clean up HTML entities
    cleanFileName = cleanFileName
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();

    // Get direct file information
    const fileExtension = cleanFileName.split('.').pop().toLowerCase();
    
    // Determine MIME type from extension
    const mimeTypes = {
      // Archives
      'zip': 'application/zip',
      'rar': 'application/vnd.rar',
      '7z': 'application/x-7z-compressed',
      'tar': 'application/x-tar',
      'gz': 'application/gzip',
      
      // Documents
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'txt': 'text/plain',
      
      // Images
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'svg': 'image/svg+xml',
      'bmp': 'image/bmp',
      
      // Audio
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'ogg': 'audio/ogg',
      'flac': 'audio/flac',
      'm4a': 'audio/mp4',
      
      // Video
      'mp4': 'video/mp4',
      'mkv': 'video/x-matroska',
      'avi': 'video/x-msvideo',
      'mov': 'video/quicktime',
      'wmv': 'video/x-ms-wmv',
      'flv': 'video/x-flv',
      'webm': 'video/webm',
      
      // Android
      'apk': 'application/vnd.android.package-archive',
      
      // Executables
      'exe': 'application/x-msdownload',
      'msi': 'application/x-msi',
      'deb': 'application/x-deb',
      'rpm': 'application/x-rpm',
    };

    const mimetype = mimeTypes[fileExtension] || 'application/octet-stream';

    return {
      filename: cleanFileName,
      filesize: fileSize,
      mimetype: mimetype,
      link: downloadUrl,
      ext: fileExtension,
      uploaded: uploaded,
      filetype: fileType,
      title: titleExt,
      description: descriptionExt,
      status: 'active'
    };

  } catch (error) {
    logger.error(`[MEDIAFIRE] Fetch error: ${error.message}`);
    throw new Error(`MediaFire Download Failed: ${error.message}`);
  }
}

// ============================
//     MAIN API HANDLER
// ============================
export default {
  name: "MediaFire Downloader",
  description: "Extract download links from MediaFire without browser automation",
  category: "Downloader",
  methods: ["GET", "POST"],
  
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "MediaFire File URL",
      example: "https://www.mediafire.com/file/jkluhveafn7bw97/r.js",
      pattern: "mediafire\\.com"
    }
  },

  features: {
    no_browser: true,
    fast_scraping: true,
    direct_links: true,
    file_info: true
  },

  async run(req, res) {
    const startTime = Date.now();
    
    try {
      // 1. Get URL from request
      let url;
      if (req.method === 'GET') {
        url = req.query.url;
      } else {
        url = req.body?.url || req.query?.url;
      }

      // 2. Validate URL
      if (!url || typeof url !== "string" || url.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' is required",
          example: "https://www.mediafire.com/file/jkluhveafn7bw97/r.js"
        });
      }

      // Clean URL
      url = url.trim();
      
      // Validate MediaFire URL
      try {
        const urlObj = new URL(url);
        if (!urlObj.hostname.includes('mediafire.com')) {
          return res.status(400).json({
            status: false,
            message: "Invalid MediaFire URL",
            valid_format: "https://www.mediafire.com/file/{file_id}/{filename}/file"
          });
        }
      } catch (urlError) {
        return res.status(400).json({
          status: false,
          message: "Invalid URL format",
        });
      }

      logger.info(`[MEDIAFIRE] Processing: ${url.substring(0, 100)}...`);

      // 3. Process MediaFire URL
      const result = await mediafireDownload(url);

      if (!result.link) {
        return res.status(404).json({
          status: false,
          message: "Download link not found. File may be deleted, private, or requires password.",
        });
      }

      const duration = Date.now() - startTime;

      // 4. Successful Response
      return res.json({
        status: true,
        provider: "MediaFire",
        input: url,
        result: result,
        timestamp: Date.now(),
        duration: `${duration}ms`,
        note: "Use the 'link' field for direct download"
      });

    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[MEDIAFIRE] Failed after ${duration}ms: ${err.message}`);
      
      // Determine appropriate status code
      let statusCode = 500;
      let errorMessage = err.message;
      
      if (err.message.includes('HTTP 4')) {
        statusCode = 404;
        errorMessage = "MediaFire page not found or access denied";
      } else if (err.message.includes('not found')) {
        statusCode = 404;
      } else if (err.message.includes('Invalid URL')) {
        statusCode = 400;
      } else if (err.message.includes('timeout')) {
        statusCode = 504;
        errorMessage = "Request timeout to MediaFire";
      }

      return res.status(statusCode).json({
        status: false,
        message: errorMessage,
        provider: "MediaFire",
        duration: `${duration}ms`,
        timestamp: Date.now(),
        suggestion: "Check if the URL is correct and the file is still available"
      });
    }
  }
};