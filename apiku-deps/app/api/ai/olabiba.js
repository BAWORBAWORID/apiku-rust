import crypto from "node:crypto"
import { loadSession, saveSession } from "../../src/utils/session.js"
import puppeteer from "puppeteer-extra"
import StealthPlugin from "puppeteer-extra-plugin-stealth"

puppeteer.use(StealthPlugin())

const BASE = "https://www.olabiba.com"
const SESSION_BASE = "olabiba"

function getSessionFile(sessionId) {
  return sessionId ? `${SESSION_BASE}-${sessionId}.json` : `${SESSION_BASE}.json`
}

export default {
  name: "Olabiba AI",
  description: "AI Chat dengan Puppeteer bypass",
  category: "AI Chat",
  methods: ["GET"],
  params: ["teks", "session"],

  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Pertanyaan atau perintah untuk AI",
    },
    session: {
      type: "string",
      required: false,
      description: "ID sesi kustom untuk percakapan terpisah (opsional)",
    },
  },

  async run(req, res) {
    let browser
    try {
      const { teks, session: sessionId } = req.query

      if (!teks || typeof teks !== "string" || teks.trim().length === 0) {
        return res.status(400).json({ status: false, message: "Parameter 'teks' wajib diisi" })
      }

      const session = await loadSession(getSessionFile(sessionId?.trim() || ""), {
        sessionId: crypto.randomUUID(),
        messages: []
      })

      // Build context from history
      const history = session.messages.slice(-10).map(msg => {
        return `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`
      }).join("\n")
      const prompt = history ? `${history}\n\nUser: ${teks.trim()}` : teks.trim()

      browser = await puppeteer.launch({
        headless: "new",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu"
        ]
      })

      const page = await browser.newPage()
      await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")

      // Intercept stream responses
      let streamAnswer = ""
      page.on("response", async (response) => {
        const url = response.url()
        if (url.includes("stream.php") || url.includes("message.php")) {
          try {
            const text = await response.text()
            // Parse SSE data
            const lines = text.split("\n")
            for (const line of lines) {
              if (line.startsWith("data:")) {
                const data = line.slice(5).trim()
                if (data && data !== "[DONE]") {
                  streamAnswer += data
                }
              }
            }
          } catch {}
        }
      })

      // Navigate to olabiba
      await page.goto(BASE, { waitUntil: "networkidle2", timeout: 30000 })
      await new Promise(r => setTimeout(r, 2000))

      // Find and fill textarea/input
      const inputSelectors = ['textarea', 'input[type="text"]', '#text-input', '[name="text"]']
      let inputEl = null
      for (const sel of inputSelectors) {
        inputEl = await page.$(sel)
        if (inputEl) break
      }

      if (!inputEl) {
        // Debug: get page content
        const html = await page.content()
        await browser.close()
        return res.status(500).json({
          status: false,
          message: "Could not find input element",
          debug: html.substring(0, 500)
        })
      }

      await inputEl.click()
      await inputEl.type(prompt, { delay: 10 })

      // Find and click send button
      const btnSelectors = ['button[type="submit"]', 'button.send', 'button:has-text("Send")', '.send-btn', 'button']
      let sendBtn = null
      for (const sel of btnSelectors) {
        try {
          sendBtn = await page.$(sel)
          if (sendBtn) break
        } catch {}
      }

      if (sendBtn) {
        await sendBtn.click()
      } else {
        // Try pressing Enter
        await page.keyboard.press("Enter")
      }

      // Wait for response
      await new Promise(r => setTimeout(r, 10000))

      // Get all visible text from page
      const pageText = await page.evaluate(() => {
        return document.body.innerText
      })

      await browser.close()

      // Clean up the answer
      let answer = streamAnswer || ""

      // If no stream answer, try to extract from page text
      if (!answer && pageText) {
        // Look for response patterns
        const lines = pageText.split("\n").filter(l => l.trim().length > 10)
        // Get the last few lines that look like a response
        const responseLines = lines.slice(-5)
        answer = responseLines.join(" ").trim()
      }

      // Clean HTML entities and artifacts
      answer = answer
        .replaceAll("&nbsp;", " ")
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&#039;", "'")
        .replaceAll("&#39;", "'")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\[FOLLOWUP(?::[^\]]*)?\][\s\S]*?(?:\[\/FOLLOWUP\])?/gi, "")
        .replace(/\[ELABORATE\]/gi, "")
        .replace(/\\n/g, " ")
        .replace(/[\n\r]/g, " ")
        .replace(/\s+/g, " ")
        .trim()

      if (answer) {
        session.messages.push(
          { id: crypto.randomUUID(), role: "user", content: teks.trim() },
          { id: crypto.randomUUID(), role: "assistant", content: answer }
        )
        await saveSession(getSessionFile(sessionId?.trim() || ""), session)
      }

      res.json({
        status: Boolean(answer),
        input: teks.trim(),
        result: answer,
        session_id: sessionId?.trim() || null
      })

    } catch (err) {
      if (browser) await browser.close().catch(() => {})
      res.status(500).json({ status: false, message: err.message || "Olabiba request failed" })
    }
  }
}
