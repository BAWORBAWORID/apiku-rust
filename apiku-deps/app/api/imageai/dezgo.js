import { createRequire } from "module"
import path from "path"
import { fileURLToPath } from "url"
import getChromePath from "../../src/utils/chromePath.js"
import logger from "../../src/utils/logger.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const puppeteer = require("puppeteer-extra")
const StealthPlugin = require("puppeteer-extra-plugin-stealth")
puppeteer.use(StealthPlugin())

const MODELS = [
  "realdream_12", "anyphoto", "rpg", "sdv15", "dreamlike",
  "dreamshaper", "cyberrealistic", "absolute", "majic_mix",
  "chilloutmix", "rev_animated", "openjourney", "analog_diffusion",
  "deliberate", "realistic_vision", "photon", "sdxl_lightning",
  "flux", "flux_2", "grok_imagine"
]

const SAMPLERS = [
  "dpmpp_2m_karras", "dpmpp_2m", "dpmpp_sde_karras",
  "euler", "euler_a", "heun", "lcm", "ddim", "pndm"
]

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function generateImage(options = {}) {
  const {
    prompt, model = "realdream_12", width = 512, height = 512,
    steps = 16, guidance = 7, sampler = "dpmpp_2m_karras",
    negativePrompt = "ugly, tiling, poorly drawn hands, poorly drawn feet, poorly drawn face, out of frame, extra limbs, disfigured, deformed, body out of frame, blurry, bad anatomy, blurred, watermark, grainy, signature, cut off, draft",
    timeout = 120000
  } = options

  const chromePath = getChromePath()
  if (!chromePath) throw new Error("Chrome executable not found")

  let browser
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: [
        "--no-sandbox", "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage"
      ]
    })

    const page = await browser.newPage()
    await page.setViewport({ width: 1920, height: 1080 })
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

    let imageBuffer = null

    page.on("response", async (resp) => {
      if (imageBuffer) return
      const url = resp.url()
      const contentType = resp.headers()["content-type"] || ""

      if (url.includes("api.dezgo.com") && contentType.includes("image/")) {
        try {
          const buf = await resp.buffer()
          if (buf.length > 5000) {
            imageBuffer = buf
          }
        } catch {}
      }

      if (url.startsWith("https://api.dezgo.com/async/")) {
        try {
          const text = await resp.text()
          if (text && text.length > 100) {
            if (text.startsWith("data:image")) {
              const match = text.match(/^data:image\/\w+;base64,(.+)$/)
              if (match) {
                imageBuffer = Buffer.from(match[1], "base64")
              }
            } else if (text.startsWith("http")) {
              try {
                const imgResp = await fetch(text.trim())
                imageBuffer = Buffer.from(await imgResp.arrayBuffer())
              } catch {}
            }
          }
        } catch {}
      }
    })

    await page.goto("https://dezgo.com/app/text2image", {
      waitUntil: "networkidle2",
      timeout: 60000
    })
    await sleep(3000)

    const textareas = await page.$$("textarea")
    if (textareas.length < 1) throw new Error("Prompt textarea not found")

    await textareas[0].click({ clickCount: 3 })
    await page.keyboard.press("Backspace")
    await page.keyboard.type(prompt, { delay: 10 })

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.includes("More options"))
      if (btn) btn.click()
    })
    await sleep(1000)

    const allTextareas = await page.$$("textarea")
    if (allTextareas.length >= 2) {
      await allTextareas[1].click({ clickCount: 3 })
      await page.keyboard.press("Backspace")
      await page.keyboard.type(negativePrompt, { delay: 5 })
    }

    await page.evaluate((modelName) => {
      const items = Array.from(document.querySelectorAll(".mud-list-item"))
      const target = items.find(item =>
        item.textContent.toLowerCase().includes(modelName.toLowerCase().replace(/_/g, " "))
      )
      if (target) target.click()
    }, model)
    await sleep(1000)

    await page.evaluate(({ w, h }) => {
      const setInput = (label, value) => {
        const lbl = Array.from(document.querySelectorAll(".mud-input-label"))
          .find(l => l.textContent.trim() === label)
        if (!lbl) return
        const input = lbl.closest(".mud-input-control")?.querySelector("input")
        if (!input) return
        input.focus()
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, "value"
        ).set
        setter.call(input, String(value))
        input.dispatchEvent(new Event("input", { bubbles: true }))
        input.dispatchEvent(new Event("change", { bubbles: true }))
      }
      setInput("Width", w)
      setInput("Height", h)
    }, { w: width, h: height })
    await sleep(1000)

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Run")
      if (btn) btn.click()
    })

    const start = Date.now()
    while (Date.now() - start < timeout && !imageBuffer) {
      await sleep(2000)
    }

    if (!imageBuffer) {
      const imgEl = await page.$("img[src*='blob:'], img[src*='data:image']")
      if (imgEl) {
        const screenshot = await imgEl.screenshot({ encoding: "base64" })
        imageBuffer = Buffer.from(screenshot, "base64")
      }
    }

    await browser.close()

    if (!imageBuffer) throw new Error("Image generation failed or timed out")

    return imageBuffer
  } catch (err) {
    if (browser) await browser.close().catch(() => {})
    throw err
  }
}

export default {
  name: "Dezgo Image Generator",
  description: "Generate gambar dengan 20 model AI (flux, realdream, grok_imagine, dll). Support puppeteer stealth bypass Cloudflare.",
  category: "Image AI",
  methods: ["GET", "POST"],
  params: ["text", "model", "width", "height", "negative"],

  paramsSchema: {
    text: { type: "string", required: true, description: "Prompt / deskripsi gambar", example: "a beautiful landscape" },
    model: { type: "string", required: false, description: "Model AI", default: "realdream_12", enum: MODELS },
    width: { type: "number", required: false, description: "Lebar gambar", default: 512 },
    height: { type: "number", required: false, description: "Tinggi gambar", default: 512 },
    negative: { type: "string", required: false, description: "Negative prompt", default: "" },
    steps: { type: "number", required: false, description: "Jumlah steps", default: 16 },
    guidance: { type: "number", required: false, description: "Guidance scale", default: 7 },
    sampler: { type: "string", required: false, description: "Sampler method", default: "dpmpp_2m_karras", enum: SAMPLERS },
  },

  async run(req, res) {
    try {
      const { text, model = "realdream_12", width = 512, height = 512, negative = "", steps = 16, guidance = 7, sampler = "dpmpp_2m_karras" } = { ...req.query, ...req.body }

      if (!text || typeof text !== "string" || text.trim().length === 0) {
        return res.status(400).json({ status: false, message: "Parameter 'text' wajib diisi" })
      }

      logger.info(`[DEZGO] Generating: "${text.trim().substring(0, 60)}" | model=${model} | ${width}x${height}`)

      const buffer = await generateImage({
        prompt: text.trim(),
        model,
        width: Number(width),
        height: Number(height),
        steps: Number(steps),
        guidance: Number(guidance),
        sampler,
        negativePrompt: negative || "ugly, tiling, poorly drawn hands, poorly drawn feet, poorly drawn face, out of frame, extra limbs, disfigured, deformed, body out of frame, blurry, bad anatomy, blurred, watermark, grainy, signature, cut off, draft",
        timeout: 120000
      })

      logger.info(`[DEZGO] Success | ${(buffer.length / 1024).toFixed(2)}KB`)

      res.setHeader("Content-Type", "image/png")
      res.setHeader("Content-Length", buffer.length)
      res.setHeader("Cache-Control", "public, max-age=86400")
      res.setHeader("X-Image-Generator", "dezgo.com")

      return res.send(buffer)

    } catch (err) {
      logger.error(`[DEZGO] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || "Dezgo image generation failed" })
    }
  }
}
