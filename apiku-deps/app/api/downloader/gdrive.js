import axios from "axios"
import * as cheerio from "cheerio"

async function driveScrape(url) {
  try {
    if (!/drive\.google\.com\/file\/d\//gi.test(url)) {
      throw new Error("Invalid URL")
    }
    
    const res = await axios.get(url, { 
      timeout: 30000, 
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" 
      } 
    }).then(v => v.data)
    
    const $ = cheerio.load(res)
    const id = url.split("/")[5]
    
    return {
      name: $("title").text().split("-")[0].trim(),
      download: `https://drive.usercontent.google.com/uc?id=${id}&export=download`,
      link: url,
      id: id
    }
    
  } catch (e) {
    throw new Error(`GDrive: ${e.message}`)
  }
}

export default {
  name: "Google Drive Downloader",
  description: "Download file dari Google Drive",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
    },
  },
    
  async run(req, res) {
    try {
      const { url } = req.method === "POST" ? req.body : req.query
      
      if (!url) {
        return res.status(400).json({
          status: false,
          message: "URL wajib diisi"
        })
      }

      const result = await driveScrape(url.trim())
      
      return res.status(200).json({
        status: true,
        data: result,
        timestamp: new Date().toISOString()
      })
      
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: error.message,
        timestamp: new Date().toISOString()
      })
    }
  }
}