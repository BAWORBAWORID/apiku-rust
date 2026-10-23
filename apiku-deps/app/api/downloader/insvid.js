import axios from "axios"
import logger from "../../src/utils/logger.js"

function extractVideoId(input) {
  try {
    const url = new URL(input);

    if (url.hostname === "youtu.be") {
      return url.pathname.substring(1);
    }

    if (url.pathname.startsWith("/shorts/")) {
      return url.pathname.split("/")[2];
    }

    if (url.pathname.startsWith("/embed/")) {
      return url.pathname.split("/")[2];
    }

    return url.searchParams.get("v");
  } catch (e) {
    if (/^[A-Za-z0-9_-]{11}$/.test(input)) {
      return input;
    }
    return null;
  }
}

async function processMedia(youtubeUrl, fileType = 'MP3') {
  try {
    const videoId = extractVideoId(youtubeUrl);

    if (!videoId) {
      return {
        status: false,
        code: 400,
        input_url: youtubeUrl,
        result_url: null,
        error: "Invalid YouTube URL or video ID"
      };
    }

    const converterUrl = 'https://ac.insvid.com/converter';
    const headers = {
      'host': 'ac.insvid.com',
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'content-type': 'application/json',
      'origin': 'https://ac.insvid.com',
      'referer': `https://ac.insvid.com/widget?url=https://www.youtube.com/watch?v=${videoId}&el=147`,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0'
    };

    const payload = {
      id: videoId,
      fileType: fileType
    };

    const response = await axios.post(converterUrl, payload, { headers, timeout: 30000 });

    if (response.data && response.data.status === 'ok' && response.data.link) {
      logger.info(`[Insvid] Success: ${videoId} (${fileType})`);
      return {
        status: true,
        code: 200,
        input_url: youtubeUrl,
        video_id: videoId,
        file_type: fileType,
        result_url: response.data.link
      };
    }

    logger.warn(`[Insvid] Failed: ${videoId} - ${JSON.stringify(response.data)}`);
    return {
      status: false,
      code: 400,
      input_url: youtubeUrl,
      video_id: videoId,
      result_url: null,
      error: response.data?.message || "Gagal mendapatkan link download"
    };

  } catch (error) {
    logger.error(`[Insvid] Error: ${error.message}`);
    return {
      status: false,
      code: error.response?.status || 500,
      input_url: youtubeUrl,
      result_url: null,
      error: error.message
    };
  }
}

export default {
  name: "Insvid YouTube Downloader",
  description: "Download YouTube video/audio (MP3/MP4)",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url", "fileType"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "YouTube URL atau Video ID",
      example: "https://youtu.be/fB7qjlBTSqI"
    },
    fileType: {
      type: "string",
      required: false,
      description: "Format file (MP3 atau MP4)",
      example: "MP3",
      enum: ["MP3", "MP4"]
    }
  },
  async run(req, res) {
    try {
      const { url, fileType } = { ...req.query, ...req.body };

      if (!url || typeof url !== 'string') {
        return res.status(400).json({
          status: false,
          error: "Parameter 'url' wajib diisi"
        });
      }

      const format = (fileType || 'MP3').toUpperCase();
      if (!['MP3', 'MP4'].includes(format)) {
        return res.status(400).json({
          status: false,
          error: "Parameter 'fileType' harus 'MP3' atau 'MP4'"
        });
      }

      const result = await processMedia(url, format);
      const statusCode = result.status ? 200 : (result.code || 500);
      return res.status(statusCode).json(result);

    } catch (err) {
      logger.error(`[Insvid] Handler Error: ${err.message}`);
      return res.status(500).json({ status: false, error: err.message });
    }
  }
}