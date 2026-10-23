import axios from "axios";
import logger from "../../src/utils/logger.js";

export default {
  name: "Get Sitekey",
  description: "Ekstrak Cloudflare Turnstile sitekey dari URL target",
  category: "Solve",
  methods: ["GET", "POST"],
  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL target website untuk extract sitekey",
      example: "https://example.com",
    },
  },

  async run(req, res) {
    try {
      const url = req.query?.url || req.body?.url;

      if (!url || typeof url !== "string" || url.trim().length === 0) {
        return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" });
      }

      const targetUrl = url.trim();

      const { data: html } = await axios.get(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 15000,
      });

      const sitekeys = new Set();

      const scriptMatches = html.match(/0x[A-Za-z0-9_-]{20,}/g);
      if (scriptMatches) {
        scriptMatches.forEach((k) => sitekeys.add(k));
      }

      const domMatches = html.match(/data-sitekey=["'](0x[A-Za-z0-9_-]{20,})["']/g);
      if (domMatches) {
        domMatches.forEach((m) => {
          const key = m.match(/0x[A-Za-z0-9_-]{20,}/);
          if (key) sitekeys.add(key[0]);
        });
      }

      if (sitekeys.size > 0) {
        logger.info(`[GetSitekey] Found ${sitekeys.size} sitekey(s) from ${targetUrl}`);
        return res.json({
          status: true,
          url: targetUrl,
          method: "HTML/DOM",
          count: sitekeys.size,
          sitekeys: [...sitekeys],
        });
      }

      const jsFiles = [...html.matchAll(/src=["']([^"']*?\.js[^"']*?)["']/g)]
        .map((m) => m[1])
        .filter((src) => src && !src.startsWith("data:"));

      const fullJsUrls = jsFiles
        .map((src) => {
          try {
            return new URL(src, targetUrl).href;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .slice(0, 10);

      for (const jsUrl of fullJsUrls) {
        try {
          const { data: jsContent } = await axios.get(jsUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            timeout: 5000,
          });

          const jsMatches = jsContent.match(/0x[A-Za-z0-9_-]{20,}/g);
          if (jsMatches) {
            jsMatches.forEach((k) => sitekeys.add(k));
          }
        } catch {
          continue;
        }
      }

      if (sitekeys.size > 0) {
        logger.info(`[GetSitekey] Found ${sitekeys.size} sitekey(s) via JS scan from ${targetUrl}`);
        return res.json({
          status: true,
          url: targetUrl,
          method: "External JS Scan",
          count: sitekeys.size,
          sitekeys: [...sitekeys],
        });
      }

      logger.info(`[GetSitekey] No sitekey found at ${targetUrl}`);

      res.json({
        status: false,
        url: targetUrl,
        method: "None",
        count: 0,
        sitekeys: [],
        message: "Tidak ada Cloudflare Turnstile sitekey ditemukan di URL ini",
      });
    } catch (err) {
      const message = err?.message || "Gagal extract sitekey";
      logger.error(`[GetSitekey] Error: ${message}`);
      res.status(500).json({ status: false, message });
    }
  },
};