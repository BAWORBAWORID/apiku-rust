import yts from "yt-search"

async function searchYouTube(query) {
  const ytResults = await yts.search(query)
  const videos = ytResults.videos.map(video => ({
    title: video.title,
    channel: video.author?.name || 'Unknown',
    channelUrl: video.author?.url || null,
    duration: video.duration.timestamp,
    durationSeconds: video.duration.seconds,
    thumbnail: video.thumbnail,
    url: video.url,
    views: video.views,
    uploadedAt: video.ago,
    description: video.description?.substring(0, 200) || null
  }))

  if (videos.length === 0) {
    throw new Error(`Video "${query}" tidak ditemukan.`)
  }

  return videos
}

export default {
  name: "YouTube Search",
  description: "Cari video di YouTube.",
  category: "Search",
  methods: ["GET"],
  params: ["query"],

  paramsSchema: {
    query: {
      type: "string",
      required: true,
      description: "Kata kunci pencarian video"
    }
  },

  features: {
    platform: "YouTube",
    region: "Global"
  },

  async run(req, res) {
    try {
      const { query } = req.query || {}

      if (!query || typeof query !== "string" || query.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'query' wajib diisi",
        })
      }

      const result = await searchYouTube(query.trim())

      res.json({
        status: true,
        result: {
          total: result.length,
          videos: result.map((v, i) => ({
            index: i + 1,
            title: v.title,
            channel: v.channel,
            channelUrl: v.channelUrl,
            duration: v.duration,
            durationSeconds: v.durationSeconds,
            thumbnail: v.thumbnail,
            url: v.url,
            views: v.views,
            uploadedAt: v.uploadedAt,
            description: v.description
          }))
        },
        timestamp: Date.now(),
      })

    } catch (err) {
      console.error("YouTube Search Error:", err.message)

      let statusCode = 500
      let errorMessage = err.message || "Gagal mencari video"

      if (err.message.includes("tidak ditemukan")) {
        statusCode = 404
      }

      res.status(statusCode).json({
        status: false,
        message: errorMessage,
        timestamp: Date.now()
      })
    }
  },
}
