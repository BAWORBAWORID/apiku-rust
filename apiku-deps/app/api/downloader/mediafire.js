import { chromium } from "playwright"
import logger from "../../src/utils/logger.js"

/* ===============================
   MEDIAFIRE SCRAPER CORE
================================ */
async function mediafireScrape(url) {
  let browser = null
  
  try {
    // Launch Browser
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-blink-features=AutomationControlled", // Mencegah deteksi bot
      ],
    })

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    })

    const page = await context.newPage()

    // Block resource berat (gambar/font) agar cepat
    await page.route("**/*", (route) => {
      const type = route.request().resourceType()
      if (["image", "stylesheet", "font", "media"].includes(type)) {
        route.abort()
      } else {
        route.continue()
      }
    })

    // Navigate
    await page.goto(url, { timeout: 60000, waitUntil: "domcontentloaded" })
    
    // Tunggu sebentar untuk render JS
    await page.waitForTimeout(2000)

    // Close Popups jika ada
    try {
      const popupSelectors = [".close-btn", ".modal-close", '[data-dismiss="modal"]', ".popup-close"]
      for (const selector of popupSelectors) {
        if (await page.$(selector)) await page.click(selector).catch(() => {})
      }
    } catch (e) {}

    /* ===============================
       EXTRACT DATA
    ================================ */
    const fileInfo = await page.evaluate(() => {
      // Helper: Get Filename
      const getFileName = () => {
        const els = [".filename", ".dl-filename", "h1.filename", ".file-title"]
        for (const sel of els) {
          const el = document.querySelector(sel)
          if (el && el.textContent.trim()) return el.textContent.trim()
        }
        return document.title.split(" - ")[0].trim() || "Unknown File"
      }

      // Helper: Get Size
      const getFileSize = () => {
        const els = [".details > li:first-child > span", ".file_size", ".dl-info > div:first-child"]
        for (const sel of els) {
          const el = document.querySelector(sel)
          if (el && el.textContent.trim()) return el.textContent.trim()
        }
        // Fallback: Regex body text
        const match = document.body.innerText.match(/(\d+\.?\d*)\s*(KB|MB|GB)/i)
        return match ? match[0] : "Unknown Size"
      }

      // Helper: Get Link
      const getLink = () => {
        const btn = document.querySelector("#downloadButton") || document.querySelector("a[aria-label*='Download']")
        if (btn && btn.href && !btn.href.includes("javascript:")) return btn.href
        return null
      }

      return {
        name: getFileName(),
        size: getFileSize(),
        link: getLink()
      }
    })

    // Jika link belum ketemu (biasanya karena harus diklik atau ada timer)
    if (!fileInfo.link) {
      try {
        const downloadBtn = await page.$("#downloadButton")
        if (downloadBtn) {
          // Klik tombol download untuk memicu generate link
          await downloadBtn.click({ modifiers: ['Alt'] }) // Alt click mencegah download start di browser playwright
          await page.waitForTimeout(2000)
          
          // Cek lagi href nya
          const href = await page.$eval("#downloadButton", el => el.href)
          if (href && !href.includes("javascript:")) {
            fileInfo.link = href
          }
        }
      } catch (e) {
        // Ignore click errors
      }
    }

    // Determine MIME Type
    const ext = fileInfo.name.split('.').pop().toLowerCase()
    const mimeTypes = {
      zip: "application/zip", rar: "application/x-rar-compressed",
      mp4: "video/mp4", mp3: "audio/mpeg", 
      jpg: "image/jpeg", png: "image/png",
      pdf: "application/pdf", apk: "application/vnd.android.package-archive"
    }
    const mime = mimeTypes[ext] || "application/octet-stream"

    return {
      filename: fileInfo.name,
      filesize: fileInfo.size,
      mimetype: mime,
      link: fileInfo.link,
      ext: ext
    }

  } catch (error) {
    logger.error(`[MEDIAFIRE] Scrape error: ${error.message}`)
    throw new Error(`MediaFire Scrape Failed: ${error.message}`)
  } finally {
    if (browser) await browser.close()
  }
}

/* ===============================
   MAIN API HANDLER
================================ */
export default {
  name: "MediaFire Downloader",
  description: "Download file from MediaFire",
  category: "Downloader",
  methods: ["GET", "POST"],
  
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "MediaFire File URL",
      example: "https://www.mediafire.com/file/jkluhveafn7bw97/r.js"
    }
  },

  async run(req, res) {
    const startTime = Date.now()
    
    try {
      // 1. Get URL
      let url
      if (req.method === 'GET') url = req.query.url
      else url = req.body?.url

      // 2. Validate
      if (!url || typeof url !== "string") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' is required"
        })
      }

      if (!url.includes("mediafire.com")) {
        return res.status(400).json({
          status: false,
          message: "Invalid MediaFire URL"
        })
      }

      logger.info(`[MEDIAFIRE] Processing: ${url}`)

      // 3. Process
      const result = await mediafireScrape(url.trim())

      if (!result.link) {
        throw new Error("Failed to extract download link (File might be deleted or premium only)")
      }

      // 4. Response
      return res.json({
        status: true,
        data: result,
      })

    } catch (err) {
      const duration = Date.now() - startTime
      logger.error(`[MEDIAFIRE] Failed after ${duration}ms: ${err.message}`)
      
      return res.status(500).json({
        status: false,
        message: err.message,
        duration: `${duration}ms`
      })
    }
  }
}