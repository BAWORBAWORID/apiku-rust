/**
 * Created by : febry.is-a.dev
 * GitHub     : vandebry10-star
 * Date       : 10-07-2026
 * * Do not remove the creator's watermark, please respect the creator.
 * 
 * Adapted for Apiku Boilerplate (/api/solve/ouo-bypass)
 */

import { createRequire } from "module";
import getChromePath from "../../src/utils/chromePath.js";
import logger from "../../src/utils/logger.js";

const require = createRequire(import.meta.url);
const { addExtra } = require("puppeteer-extra");
const rebrowser = require("rebrowser-puppeteer");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const AdblockerPlugin = require("puppeteer-extra-plugin-adblocker");

const puppeteer = addExtra(rebrowser);
puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

const CHROME_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-blink-features=AutomationControlled",
  "--disable-infobars",
  "--disable-notifications",
  "--disable-popup-blocking",
  "--window-size=1366,768",
  "--hide-scrollbars",
  "--mute-audio"
];

async function ouoBypass(url) {
  const meta = { creator: "febry.is-a.dev", github: "vandebry10-star" };
  const chromePath = await getChromePath();

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath || undefined,
    args: CHROME_ARGS
  });

  try {
    const page = await browser.newPage();
    page.wskAuthor = meta.creator;

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});

    await page
      .waitForFunction(
        () => !document.title.includes("moment") && !document.querySelector("#challenge-running"),
        { timeout: 30000 }
      )
      .catch(() => {});

    await page.waitForSelector("#form-captcha", { timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));

    const hasForm = await page.$("#form-captcha");
    if (hasForm) {
      await page.evaluate(() => {
        const xt = document.querySelector("#x-token");
        if (xt) xt.value = "bypass";
      });

      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
        page.click("#btn-main").catch(() =>
          page.evaluate(() => document.querySelector("#form-captcha")?.submit())
        )
      ]);

      await new Promise((r) => setTimeout(r, 2000));
      await page.waitForSelector("#form-captcha", { timeout: 15000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));

      const hasForm2 = await page.$("#form-captcha");
      if (hasForm2) {
        await page.evaluate(() => {
          const xt = document.querySelector("#x-token");
          if (xt) xt.value = "bypass";
        });
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
          page.click("#btn-main").catch(() =>
            page.evaluate(() => document.querySelector("#form-captcha")?.submit())
          )
        ]);
        await new Promise((r) => setTimeout(r, 3000));
        await page.waitForFunction(() => !location.hostname.includes("ouo."), { timeout: 15000 }).catch(() => {});
      }
    }

    return {
      original_url: url,
      bypassed_url: page.url()
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

export default {
  name: "Ouo.io Link Bypass",
  description: "Bypass shortlink ouo.io / ouo.press",
  category: "Bypass",
  methods: ["GET", "POST"],
  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: false,
      default: "https://ouo.io/pmCe1P",
      description: "URL shortlink ouo.io atau ouo.press yang ingin di-bypass (default: https://ouo.io/pmCe1P)",
      example: "https://ouo.io/pmCe1P"
    }
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const params = { ...req.query, ...req.body };
      const url = params.url || "https://ouo.io/pmCe1P";

      logger.info(`[OuoBypass] Bypassing: ${url}`);
      const result = await ouoBypass(url);
      const duration = Date.now() - startTime;

      return res.status(200).json({
        status: true,
        message: "Successfully bypassed ouo.io / ouo.press link",
        data: result,
        duration: `${duration}ms`
      });
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error(`[OuoBypass] Error after ${duration}ms: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: "Failed to bypass ouo link",
        error: err.message
      });
    }
  }
};
