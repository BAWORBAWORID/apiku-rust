import axios from "axios"
import logger from "../../src/utils/logger.js" // Sesuaikan path logger

/* ===============================
   IN-MEMORY CACHE (auto-managed)
   Penting: GitHub API punya rate limit (60 req/jam tanpa auth)
   Cache membantu menghemat kuota request.
================================ */
const cache = new Map()
const CACHE_TTL = 10 * 60 * 1000 // 10 menit
const CLEANUP_INTERVAL = 60 * 1000 // Cleanup setiap 1 menit

/* ===============================
   AUTO CLEANUP EXPIRED CACHE
================================ */
setInterval(() => {
  const now = Date.now()
  let cleaned = 0
  
  for (const [key, item] of cache.entries()) {
    if (now > item.expires) {
      cache.delete(key)
      cleaned++
    }
  }
  
  if (cleaned > 0) {
    logger.info(`[GITHUB] Cleaned ${cleaned} expired cache entries`)
  }
}, CLEANUP_INTERVAL)

/* ===============================
   CACHE MANAGEMENT
================================ */
function getFromCache(username) {
  const key = username.toLowerCase()
  const item = cache.get(key)
  
  if (item && Date.now() < item.expires) {
    item.hits++
    return item
  }
  return null
}

function saveToCache(username, data) {
  const key = username.toLowerCase()
  const item = {
    data,
    expires: Date.now() + CACHE_TTL,
    created: new Date().toISOString(),
    hits: 1
  }
  cache.set(key, item)
  logger.info(`[GITHUB] Cache created for user: ${username}`)
  return item
}

/* ===============================
   GITHUB STALKER CORE
================================ */
async function stalkGithub(username) {
  try {
    const cleanUsername = username.trim()
    
    // Headers wajib untuk GitHub API
    const headers = {
      "User-Agent": "NodeJS-Stalker/1.0", 
      "Accept": "application/vnd.github.v3+json"
    }
    
    logger.info(`[GITHUB] Fetching profile: ${cleanUsername}`)
    
    const { data } = await axios.get(`https://api.github.com/users/${cleanUsername}`, {
      headers,
      timeout: 10000
    })
    
    return data
    
  } catch (error) {
    logger.error(`[GITHUB] Error: ${error.message}`)
    
    if (error.response?.status === 404) {
      throw new Error(`GitHub user '${username}' not found`)
    }
    
    if (error.response?.status === 403) {
      throw new Error("GitHub API rate limit exceeded. Please try again later.")
    }
    
    throw new Error(`Failed to fetch GitHub data: ${error.message}`)
  }
}

/* ===============================
   HELPER: FORMAT RESPONSE
================================ */
function formatResponse(data, fromCache = false, hits = 1) {
  return {
    user: {
      username: data.login,
      nickname: data.name || data.login,
      id: data.id,
      node_id: data.node_id,
      type: data.type,
      admin: data.site_admin,
      
      profile: {
        avatar: data.avatar_url,
        url: data.html_url,
        bio: data.bio || "",
        blog: data.blog || "",
        company: data.company || "",
        location: data.location || "",
        email: data.email || null,
        twitter: data.twitter_username || null
      },
      
      stats: {
        public_repos: data.public_repos,
        public_gists: data.public_gists,
        followers: data.followers,
        following: data.following
      },
      
      dates: {
        created_at: data.created_at,
        updated_at: data.updated_at
      }
    },
    metadata: {
      cached: fromCache,
      cache_hits: hits,
      source: "api.github.com",
      timestamp: new Date().toISOString()
    }
  }
}

/* ===============================
   MAIN API STRUCTURE
================================ */
export default {
  name: "GitHub Stalker",
  description: "Get detailed GitHub user profile info",
  category: "Stalker",
  methods: ["GET", "POST"],
  
  params: ["username"],
  
  paramsSchema: {
    username: {
      type: "string",
      required: true,
      description: "GitHub username",
      example: "octocat",
      minLength: 1,
      maxLength: 39
    }
  },
  
  async run(req, res) {
    const startTime = Date.now()
    
    try {
      // 1. Get Parameter
      let username
      if (req.method === 'GET') {
        username = req.query.username || req.query.user
      } else {
        username = req.body?.username || req.body?.user
      }
      
      // 2. Validation
      if (!username) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'username' is required",
          example: {
            GET: "/api/stalk/github?username=octocat",
            POST: { "username": "octocat" }
          }
        })
      }

      if (typeof username !== 'string' || username.trim().length === 0) {
         return res.status(400).json({
          status: false,
          message: "Username must be a valid string"
        })
      }
      
      const targetUser = username.trim()
      
      // 3. Check Cache
      let rawData
      let fromCache = false
      let hits = 1
      
      const cachedItem = getFromCache(targetUser)
      
      if (cachedItem) {
        rawData = cachedItem.data
        fromCache = true
        hits = cachedItem.hits
        logger.info(`[GITHUB] Serving from cache: ${targetUser}`)
      } else {
        // 4. Fetch Fresh Data
        rawData = await stalkGithub(targetUser)
        // Save to cache
        saveToCache(targetUser, rawData)
      }
      
      // 5. Format & Send Response
      const response = formatResponse(rawData, fromCache, hits)
      response.metadata.processing_time = `${Date.now() - startTime}ms`
      
      return res.json({
        status: true,
        ...response
      })
      
    } catch (error) {
      const duration = Date.now() - startTime
      
      return res.status(error.message.includes("not found") ? 404 : 500).json({
        status: false,
        message: error.message,
        duration: `${duration}ms`
      })
    }
  }
}