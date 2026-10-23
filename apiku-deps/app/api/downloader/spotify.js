import puppeteer from "puppeteer";

function extractDownloadUrl(html) {
  const match = html.match(/href="(https:\/\/rapid\.spotidown\.app\/v2\?token=[^"]+)"/);
  return match ? match[1] : null;
}

function extractTrackInfo(html) {
  const title = html.match(/<h1[^>]*>([^<]+)<\/h1>/) || html.match(/title="([^"]+)"/);
  const artist = html.match(/<p><span>([^<]+)<\/span><\/p>/);
  const cover = html.match(/<img[^>]+src="([^"]+)"[^>]*alt="[^"]*"/);
  return {
    title: title ? title[1] : null,
    artist: artist ? artist[1] : null,
    cover: cover ? cover[1] : null
  };
}

async function fetchTrack(spotifyUrl) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  let downloadUrl = null;
  let trackHtml = null;

  await page.setRequestInterception(true);
  page.on("request", request => {
    if (request.method() === "POST" && request.url().includes("/action")) {
      request.continue();
    } else {
      request.continue();
    }
  });

  page.on("response", async response => {
    const url = response.url();
    try {
      if (url.endsWith("/action/track") && response.status() === 200) {
        const json = await response.json();
        if (!json.error && json.data) {
          trackHtml = json.data;
          downloadUrl = extractDownloadUrl(json.data);
        }
      }
    } catch {}
  });

  await page.goto("https://spotidown.app/en3", { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForSelector('input[name="url"]', { timeout: 10000 });
  await page.type('input[name="url"]', spotifyUrl, { delay: 30 });
  await page.click('button[type="submit"]');
  await page.waitForSelector(".abutton", { timeout: 30000 });
  await new Promise(r => setTimeout(r, 1000));

  const btn = await page.$(".abutton");
  if (btn) {
    await Promise.all([
      new Promise(resolve => {
        page.on("response", async response => {
          if (response.url().endsWith("/action/track") && response.status() === 200) {
            await new Promise(r => setTimeout(r, 500));
            resolve();
          }
        });
      }),
      btn.click()
    ]);
  }
  await new Promise(r => setTimeout(r, 2000));
  await browser.close();

  const info = trackHtml ? extractTrackInfo(trackHtml) : null;
  return { info, download_url: downloadUrl };
}

export default {
  name: "Spotify Downloader",
  description: "Download lagu dari Spotify — masukkan URL track, dapatkan MP3 langsung",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      default: "https://open.spotify.com/track/3y8RcMPYG22fRnrOi4oFJ1",
      description: "URL Spotify track (https://open.spotify.com/track/...)",
      example: "https://open.spotify.com/track/3y8RcMPYG22fRnrOi4oFJ1"
    }
  },

  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body };

      if (!url || typeof url !== "string" || !url.includes("open.spotify.com/track")) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi dengan URL Spotify track yang valid"
        });
      }

      const result = await fetchTrack(url.trim());

      if (!result.download_url) {
        return res.status(500).json({
          status: false,
          message: "Gagal mendapatkan link download"
        });
      }

      return res.json({
        status: true,
        result: {
          title: result.info?.title || null,
          artist: result.info?.artist || null,
          cover: result.info?.cover || null,
          download_url: result.download_url
        }
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Spotify download failed"
      });
    }
  }
};
