//―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
//  ┏  TextPro.me Scraper  ┓
//  Bypass: Puppeteer + Stealth + jQuery AJAX submit
//  Flow:  load page → set text → jQuery submit → capture AJAX JSON → download image
//  Credit: Alip MY / Codebuff
//―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――

const puppeteerExtra = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteerExtra.use(StealthPlugin());

const path = require("path");
const fs = require("fs");
const bundledChrome = path.resolve(__dirname, "..", "..", "src", "function", "chrome", "chrome", "linux-150.0.7843.0", "chrome-linux64", "chrome");
const CHROME_PATH =
	process.env.CHROME_PATH || process.env.CHROME_BIN ||
	(fs.existsSync(bundledChrome) ? bundledChrome : null) ||
	"/usr/bin/google-chrome-stable";

const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Generate text effect from textpro.me
 * @param {string} url - TextPro effect page URL (e.g. https://textpro.me/...html)
 * @param {string|string[]} text - Text(s) to apply
 * @returns {Promise<Buffer>} Image buffer
 */
async function textpro(url, text) {
	if (!/^https:\/\/textpro\.me\/.+\..+$/.test(url))
		throw new Error("Invalid URL: must be from textpro.me");
	if (typeof text === "string") text = [text];
	if (!Array.isArray(text) || text.length === 0)
		throw new Error("Text parameter is required");

	const browser = await puppeteerExtra.launch({
		headless: "new",
		executablePath: CHROME_PATH,
		args: [
			"--no-sandbox",
			"--disable-setuid-sandbox",
			"--disable-dev-shm-usage",
		],
	});

	try {
		const page = await browser.newPage();
		await page.setViewport({ width: 1280, height: 720 });
		await page.setUserAgent(USER_AGENT);

		// Step 1: Load page (bypasses Cloudflare)
		await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
		await page.waitForSelector('input[name="text[]"]', { timeout: 15000 });

		// Step 2: Set text values + bypass reCAPTCHA field
		await page.evaluate((texts) => {
			const inputs = document.querySelectorAll('input[name="text[]"]');
			for (let i = 0; i < texts.length && i < inputs.length; i++) {
				inputs[i].value = texts[i];
			}
			document
				.querySelectorAll('input[name="grecaptcharesponse"]')
				.forEach((el) => (el.value = "bypass"));
		}, text);

		// Step 3: Capture AJAX response AND trigger jQuery submit
		const [response] = await Promise.all([
			page.waitForResponse(
				(res) =>
					res.url().includes("effect/create-image") &&
					res.request().method() === "POST",
				{ timeout: 30000 }
			),
			page.evaluate(() => {
				jQuery("#main-form").submit();
			}),
		]);

		// Step 4: Parse JSON from AJAX response
		const json = JSON.parse(await response.text());
		if (!json.success || !json.fullsize_image)
			throw new Error(json.info || "Failed to generate image");

		const imageUrl = json.fullsize_image.startsWith("http")
			? json.fullsize_image
			: `https://textpro.me${json.fullsize_image}`;

		// Step 5: Download image
		const imgPage = await browser.newPage();
		await imgPage.setUserAgent(USER_AGENT);
		const imgRes = await imgPage.goto(imageUrl, {
			waitUntil: "networkidle0",
			timeout: 30000,
		});
		const buffer = await imgRes.buffer();
		await imgPage.close();

		return buffer;
	} finally {
		await browser.close();
	}
}

module.exports = textpro;
