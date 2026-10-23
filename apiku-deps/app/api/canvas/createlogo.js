import axios from "axios"
import logger from "../../src/utils/logger.js"

/* ===============================
   SOLOGO AI - LOGO GENERATOR
================================ */
async function generateLogo({ title, idea, slogan }) {
  try {
    logger.info(`[SOLOGO] Generating logo for: ${title}`)

    const payload = {
      ai_icon: [333276, 333279],
      height: 300,
      idea: idea,
      industry_index: "N",
      industry_index_id: "",
      pagesize: 4,
      session_id: "",
      slogan: slogan,
      title: title,
      whiteEdge: 80,
      width: 400
    }

    const { data } = await axios.post(
      "https://www.sologo.ai/v1/api/logo/logo_generate",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Origin": "https://www.sologo.ai",
          "Referer": "https://www.sologo.ai/"
        },
        timeout: 30000 // 30 detik karena generate logo
      }
    )
    
    if (!data?.data?.logoList || data.data.logoList.length === 0) {
      throw new Error("Tidak ada logo yang dihasilkan")
    }

    // Format response
    const logos = data.data.logoList.slice(0, 4).map((logo, index) => ({
      id: index + 1,
      thumb_url: logo.logo_thumb,
      full_url: logo.logo_url || logo.logo_thumb,
      description: logo.description || null,
      tags: logo.tags || []
    }))

    return formatResponse({
      title: title.trim(),
      idea: idea.trim(),
      slogan: slogan.trim(),
      logos,
      total_generated: data.data.logoList.length
    })

  } catch (error) {
    logger.error(`[SOLOGO] Generate error: ${error.message}`)

    if (error.response) {
      if (error.response.status === 400) {
        throw new Error("Parameter tidak valid")
      }
      if (error.response.status === 429) {
        throw new Error("Terlalu banyak permintaan. Coba lagi nanti")
      }
      if (error.response.status === 500) {
        throw new Error("Server Sologo mengalami gangguan")
      }
    }

    if (error.code === 'ECONNABORTED') {
      throw new Error("Request timeout - Server terlalu lambat")
    }

    throw new Error(`Gagal generate logo: ${error.message}`)
  }
}

/* ===============================
   FORMAT RESPONSE
================================ */
function formatResponse(data) {
  return {
    status: true,
    service: "Sologo AI",
    data: {
      title: data.title,
      idea: data.idea,
      slogan: data.slogan,
      logos: data.logos,
      total_generated: data.total_generated
    }
  }
}

/* ===============================
   MAIN API - LOGO GENERATOR
================================ */
export default {
  name: "AI Logo Generator",
  description: "Generate professional logos using AI based on title, idea, and slogan",
  category: "Canvas",
  methods: ["GET", "POST"],
  
  params: ["title", "idea", "slogan"],
  
  paramsSchema: {
    title: {
      type: "string",
      required: true,
      description: "Brand or company name",
      default: "Miyako",
      minLength: 2,
      maxLength: 50
    },
    idea: {
      type: "string",
      required: true,
      description: "Creative concept or description",
      default: "A modern tech company logo",
      minLength: 3,
      maxLength: 100
    },
    slogan: {
      type: "string",
      required: true,
      description: "Brand slogan or tagline",
      default: "Innovate the Future",
      minLength: 3,
      maxLength: 100
    }
  },
  
  async run(req, res) {
    const startTime = Date.now()
    
    try {
      // Get parameters
      let title, idea, slogan
      
      if (req.method === 'GET') {
        title = req.query.title
        idea = req.query.idea
        slogan = req.query.slogan
      } else {
        title = req.body?.title
        idea = req.body?.idea
        slogan = req.body?.slogan
      }
      
      // Validation - Title
      if (!title) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'title' is required",
          example: {
            GET: "/api/ai/createlogo?title=Miyako&idea=teknologi%20modern&slogan=Innovate%20the%20Future",
            POST: { "title": "Miyako", "idea": "teknologi modern", "slogan": "Innovate the Future" }
          }
        })
      }
      
      if (typeof title !== 'string' || title.trim().length < 2) {
        return res.status(400).json({
          status: false,
          message: "Title must be at least 2 characters"
        })
      }
      
      // Validation - Idea
      if (!idea) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'idea' is required"
        })
      }
      
      if (typeof idea !== 'string' || idea.trim().length < 3) {
        return res.status(400).json({
          status: false,
          message: "Idea must be at least 3 characters"
        })
      }
      
      // Validation - Slogan
      if (!slogan) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'slogan' is required"
        })
      }
      
      if (typeof slogan !== 'string' || slogan.trim().length < 3) {
        return res.status(400).json({
          status: false,
          message: "Slogan must be at least 3 characters"
        })
      }
      
      // Clean inputs
      const cleanTitle = title.trim()
      const cleanIdea = idea.trim()
      const cleanSlogan = slogan.trim()
      
      // Log request
      const clientIp = req.ip || req.connection.remoteAddress
      logger.info(`[SOLOGO] Request from ${clientIp} for: ${cleanTitle}`)
      
      // Generate logo
      const response = await generateLogo({
        title: cleanTitle,
        idea: cleanIdea,
        slogan: cleanSlogan
      })
      
      
      // Log success
      logger.info(`[SOLOGO] Success for ${cleanTitle} | time: ${Date.now() - startTime}ms`)
      
      return res.json(response)
      
    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`[SOLOGO] Error after ${duration}ms: ${error.message}`)
      
      const statusCode = error.message.includes("tidak valid") ? 400 :
                        error.message.includes("banyak permintaan") ? 429 :
                        error.message.includes("gangguan") ? 503 : 400
      
      return res.status(statusCode).json({
        status: false,
        message: error.message,
        duration: `${duration}ms`,
        suggestion: getSuggestion(error.message)
      })
    }
  }
}

/* ===============================
   HELPER FUNCTIONS
================================ */
function getSuggestion(errorMsg) {
  if (errorMsg.includes("tidak ada logo")) {
    return "Coba dengan judul, ide, atau slogan yang berbeda"
  }
  
  if (errorMsg.includes("timeout") || errorMsg.includes("lambat")) {
    return "Server AI sedang sibuk. Coba lagi dalam beberapa detik"
  }
  
  if (errorMsg.includes("banyak permintaan")) {
    return "Kurangi frekuensi request. Tunggu 1-2 menit"
  }
  
  if (errorMsg.includes("parameter")) {
    return "Pastikan format input benar: title|idea|slogan"
  }
  
  return "Coba lagi dengan input yang berbeda"
}