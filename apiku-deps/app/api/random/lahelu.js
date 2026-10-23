/**
 * Random Lahelu Posts API
 * Simple version - no parameters
 */

import axios from "axios"
import logger from "../../src/utils/logger.js"

// Format post data
const formatPostInfo = (postInfo) => ({
  ...postInfo,
  postURL: `https://lahelu.com/post/${postInfo.postID}`,
  media: `${postInfo.media}`,
  mediaThumbnail: postInfo.mediaThumbnail 
    ? `https://cache.lahelu.com/${postInfo.mediaThumbnail}`
    : null,
  userURL: `https://lahelu.com/user/${postInfo.userUsername}`,
  userAvatar: postInfo.userAvatar 
    ? `https://cache.lahelu.com/${postInfo.userAvatar}`
    : null,
  createTime: new Date(postInfo.createTime).toISOString()
})

// Get random posts from Lahelu
async function getRandomLaheluPosts() {
  try {
    // Generate random cursor
    const randomNumber = Math.floor(Math.random() * 10)
    const randomCursor = `${randomNumber}-${Date.now()}`
    
    const options = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json"
      },
      timeout: 10000,
    }

    const response = await axios.get(
      `https://lahelu.com/api/post/get-recommendations?field=7&cursor=${randomCursor}`,
      options
    )

    if (response.data?.postInfos) {
      const allPosts = response.data.postInfos.map(formatPostInfo)
      
      // Get 1-3 random posts from the response
      const count = Math.floor(Math.random() * 3) + 1
      const selectedPosts = []
      
      for (let i = 0; i < Math.min(count, allPosts.length); i++) {
        const randomIndex = Math.floor(Math.random() * allPosts.length)
        selectedPosts.push(allPosts[randomIndex])
      }
      
      return selectedPosts
    }
    
    throw new Error("No posts found")
    
  } catch (error) {
    logger.error(`[LAHELU_ERROR] ${error.message}`)
    throw error
  }
}

/* ===============================
   EXPORT API MODULE
================================ */

export default {
  name: "Random Lahelu",
  description: "Get random meme posts (Indonesian platform)",
  category: "Random",
  methods: ["GET"],
  params: [],

  sources: [
    {
      name: "Lahelu",
      url: "https://lahelu.com"
    }
  ],

  async run(req, res) {
    try {
      logger.info(`[LAHELU_API] Request from ${req.ip}`)
      
      const posts = await getRandomLaheluPosts()
      
      // Response headers
      res.setHeader("Content-Type", "application/json")
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate")
      res.setHeader("Pragma", "no-cache")
      res.setHeader("Expires", "0")
      
      return res.json({
        status: true,
        data: posts,
        total: posts.length,
        timestamp: Date.now(),
        //source: "lahelu.com"
      })
      
    } catch (err) {
      logger.error(`[LAHELU_API_ERROR] ${err.message}`)
      
      return res.status(500).json({
        status: false,
        message: "Failed to get random Lahelu posts",
        timestamp: Date.now()
      })
    }
  }
}