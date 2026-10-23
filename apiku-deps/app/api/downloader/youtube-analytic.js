/**
 * YouTube Downloader & Analyzer API
 * Provider: Recapio API
 * Parameter: url
 */

import axios from "axios"

const BASE_URL = "https://api.recapio.com"

/* ===============================
   EXTRACT VIDEO ID FROM URL
================================ */
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([0-9A-Za-z_-]{11})/,
    /(?:v=|\/)([0-9A-Za-z_-]{11})/
  ]
  
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  
  return null
}

/* ===============================
   RECAPIO CLIENT CLASS
================================ */
class RecapioClient {
  constructor(videoUrl) {
    this.videoUrl = videoUrl
    this.videoId = extractVideoId(videoUrl)
    this.fingerprint = Buffer.from(Date.now().toString()).toString('base64')
    this.headers = {
      authority: 'api.recapio.com',
      'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      origin: 'https://recapio.com',
      referer: 'https://recapio.com/',
      'sec-ch-ua': '"Chromium";v="132", "Not:A-Brand";v="24", "Google Chrome";v="132"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
      'x-app-language': 'en',
      'x-device-fingerprint': this.fingerprint
    }
  }

  /* ===============================
     INITIATE VIDEO PROCESSING
  ================================ */
  async initiate() {
    try {
      const response = await axios.post(
        `${BASE_URL}/youtube-chat/initiate`,
        { url: this.videoUrl },
        { 
          headers: this.headers,
          timeout: 30000
        }
      )
      return response.data
    } catch (error) {
      throw new Error(`Initiate failed: ${error.message}`)
    }
  }

  /* ===============================
     CHECK PROCESSING STATUS
  ================================ */
  async checkStatus(slug) {
    try {
      const response = await axios.get(
        `${BASE_URL}/youtube-chat/status/by-slug/${slug}`,
        {
          params: { fingerprint: this.fingerprint },
          headers: this.headers,
          timeout: 30000
        }
      )

      if (response.data?.transcript) {
        try {
          response.data.transcript = JSON.parse(response.data.transcript)
        } catch {
          response.data.transcript = []
        }
      }
      return response.data
    } catch (error) {
      throw new Error(`Status check failed: ${error.message}`)
    }
  }

  /* ===============================
     START FULL PROCESS
  ================================ */
  async start() {
    try {
      const init = await this.initiate()
      const status = await this.checkStatus(init.slug)

      return {
        info: init,
        slug_ai: status
      }
    } catch (error) {
      throw error
    }
  }

  /* ===============================
     SEND MESSAGE TO AI CHAT
  ================================ */
  async sendMessage(prompt) {
    try {
      const response = await axios.post(
        `${BASE_URL}/youtube-chat/message`,
        {
          message: prompt,
          video_id: this.videoId,
          fingerprint: this.fingerprint
        },
        {
          headers: {
            ...this.headers,
            'content-type': 'application/json'
          },
          responseType: 'text',
          timeout: 60000
        }
      )

      let result = ''
      const lines = response.data.split('\n')

      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            const data = line.slice(5).trim()
            if (data) {
              const chunk = JSON.parse(data)
              result += chunk.chunk || ''
            }
          } catch {
            continue
          }
        }
      }

      return result
    } catch (error) {
      throw new Error(`Message failed: ${error.message}`)
    }
  }

  /* ===============================
     GET VIDEO SUMMARY
  ================================ */
  async getSummary() {
    try {
      const videoData = await this.start()

      const summary = await this.sendMessage(
        'Extract the most important bullet points from this video, organized in a clear, structured format.'
      )

      return {
        success: true,
        video: {
          id: videoData.info.id,
          title: videoData.info.title,
          duration: videoData.info.duration,
          slug: videoData.info.slug,
          thumbnail: videoData.info.thumbnail_url,
          channel: videoData.info.channel_title || null,
          views: videoData.info.view_count || null,
          likes: videoData.info.like_count || null,
          upload_date: videoData.info.published_at || null
        },
        summary: summary.trim(),
        transcript: videoData.slug_ai.transcript || [],
        has_captions: videoData.slug_ai.has_captions || false,
        processing_time: videoData.slug_ai.processing_time || null
      }
    } catch (error) {
      throw error
    }
  }

  /* ===============================
     GET CUSTOM ANALYSIS
  ================================ */
  async analyze(prompt = "Summarize this video") {
    try {
      const videoData = await this.start()
      const analysis = await this.sendMessage(prompt)

      return {
        success: true,
        video: {
          id: videoData.info.id,
          title: videoData.info.title,
          duration: videoData.info.duration,
          thumbnail: videoData.info.thumbnail_url,
          channel: videoData.info.channel_title || null
        },
        analysis: analysis.trim(),
        transcript_available: !!(videoData.slug_ai.transcript && videoData.slug_ai.transcript.length > 0)
      }
    } catch (error) {
      throw error
    }
  }
}

/* ===============================
   MAIN DOWNLOADER/ANALYZER FUNCTION
================================ */
async function youtubeDownloader(url, options = {}) {
  const { 
    action = 'summary',  // 'summary', 'analyze', or 'transcript'
    prompt = null 
  } = options

  try {
    if (!url || typeof url !== 'string') {
      throw new Error('URL is required')
    }

    const videoId = extractVideoId(url)
    if (!videoId) {
      throw new Error('Invalid YouTube URL')
    }

    const client = new RecapioClient(url)

    switch (action) {
      case 'summary':
        return await client.getSummary()
      
      case 'analyze':
        const customPrompt = prompt || "Provide a detailed analysis of this video"
        return await client.analyze(customPrompt)
      
      case 'transcript':
        const videoData = await client.start()
        return {
          success: true,
          video: {
            id: videoData.info.id,
            title: videoData.info.title,
            duration: videoData.info.duration,
            channel: videoData.info.channel_title || null
          },
          transcript: videoData.slug_ai.transcript || [],
          has_captions: videoData.slug_ai.has_captions || false
        }
      
      default:
        throw new Error(`Unknown action: ${action}`)
    }
  } catch (error) {
    throw error
  }
}

/* ===============================
   EXPORT API (KEEPING YOUR STYLE)
================================ */

export default {
  name: "YouTube Downloader & Analyzer",
  description: "Download YouTube video transcripts, summaries, and AI analysis",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      default: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    },
    action: {
      type: "string",
      required: false,
      default: "summary",
      enum: ["summary", "analyze", "transcript"],
    },
    prompt: {
      type: "string",
      required: false,
    }
  },

  async run(req, res) {
    try {
      const { url, action = "summary", prompt } = { ...req.query, ...req.body }

      if (!url || typeof url !== "string") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
          help: "Contoh: https://youtube.com/watch?v=VIDEO_ID atau https://youtu.be/VIDEO_ID"
        })
      }

      const result = await youtubeDownloader(url, { action, prompt })

      res.json({
        status: true,
        //provider: "recapio.com",
        input: url,
        action: action,
        timestamp: Date.now(),
        ...result
      })
    } catch (err) {
      const statusCode = err.message.includes('Invalid') ? 400 : 500
      
      res.status(statusCode).json({
        status: false,
        message: err.message || "YouTube processing failed",
        timestamp: Date.now()
      })
    }
  },
}
/*
// Example usage (for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
  // Test the function
  const testUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  
  youtubeDownloader(testUrl, { action: 'summary' })
    .then(result => {
      console.log("Success:", JSON.stringify(result, null, 2))
    })
    .catch(error => {
      console.error("Error:", error.message)
    })
}
*/