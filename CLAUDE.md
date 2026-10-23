# CLAUDE.md — apiku / Zyyvor API

Panduan untuk Claude Code saat mengerjakan project API ini.
**Last Updated:** September 13, 2026 (v2.1.2)

---

## 📋 Project Overview

| Atribut | Nilai |
|---------|-------|
| **Nama** | apiku / Zyyvor API |
| **Versi** | 2.1.2 (September 13, 2026) |
| **Runtime** | Node.js 20+ (ESM — `"type": "module"`) |
| **Framework** | Express.js 4.x |
| **Author** | BAWORBAWORID |
| **Lisensi** | GPL-3.0 |
| **Repository** | https://github.com/BAWORBAWORID/apiku.git |
| **Deployment** | Standard Node (port 3000), Docker, Vercel serverless, Pterodactyl |
| **Live URL** | https://api.zyvor.my.id |
| **Telegram** | @ZyyvorAPI |
| **Total Endpoints** | 423 (auto-loaded via HMR) |

---

## 🏗️ Arsitektur

```
/root/apiku/
├── index.js                          # Main entry — Express server (port 3000)
├── api/index.js                      # Vercel serverless entry (export app)
├── configuration.json                # Central config — endpoints, rate limits, announcements, releases
├── api-stats.json / api-stats.db     # Request stats (SQLite WAL mode + JSON)
├── AGENT.md                          # Full project documentation for AI agents
├── CLAUDE.md                         # ← THIS FILE — Claude Code instructions
│
├── src/                              # CORE ENGINE
│   ├── app/index.js                  # Main Express app (proxy, stats, admin, routes)
│   ├── app/responseFormatter.js      # JSON response wrapper
│   ├── routes/setupRoutes.js         # All admin route handlers (hot-reloadable via chokidar)
│   ├── middleware/                    # rateLimiter, adminAuth, apiKeyAuth, telegram bot
│   ├── utils/                        # logger, color, hmrLoader, session, apiStatsDb, visitorTracker, safeFetch, configCache, botShield, apiCache, cacheCleaner, chromePath, gameCache, circuitBreaker, logApiRequest, amService, apiKeysStore, cloudStorage
│   ├── update/report.js              # Telegram report (CHAT_ID: 5323386592)
│   ├── function/                     # orkut3.js (QRIS), textpro.cjs (Puppeteer), chrome/ binary
│   └── images/                       # Static images (logo, avatars)
│
├── api/                              # ALL API ENDPOINTS (auto-loaded via HMR)
│   ├── ai/                           # 63 AI chat endpoints
│   ├── am/                           # 5 AlightMotion endpoints
│   ├── anime/                        # 6 anime streaming/info endpoints
│   ├── canvas/                       # 20 canvas [Deprecated]
│   ├── checknumber/                  # 4 phone number checkers
│   ├── download/                     # 1 FLAC direct download
│   ├── downloader/                   # 43 downloaders
│   ├── ephoto/                       # 3 ephoto effects
│   ├── fun/                          # 6 fun endpoints
│   ├── games/                        # 27 games
│   ├── hdvidio/                      # 3 HD video processors
│   ├── image/                        # 17 image processing
│   ├── imageai/                      # 10 AI image generation
│   ├── imagehd/                      # 21 image HD/upscale
│   ├── maker/                        # 45 maker endpoints
│   ├── nsfw/                         # 2 NSFW endpoints
│   ├── payment/                      # 4 payment endpoints
│   ├── primbon/                      # 10 Javanese fortune-telling
│   ├── random/                       # 5 random content generators
│   ├── search/                       # 38 search tools
│   ├── solve/                        # 12 captcha solvers
│   ├── stalker/                      # 13 stalkers
│   ├── tempmail/                     # 15 temp mail services
│   ├── tools/                        # 35 tools (incl. magma/ subdir)
│   ├── topup/                        # 4 topup/PPOB
│   ├── v1/                           # 2 OpenAI proxy endpoints
│   └── v3/                           # 2 HCNsec AI gateway (models, chat/completions)
│
├── public/                           # Static HTML pages (index, docs, stats, changelog, support, admin, legal)
├── data/                             # JSON data storage (admin, keys, bans, sessions, logs)
├── files/                            # Uploaded/Generated files
├── logs/                             # Application logs
├── proxy/                            # Proxy files directory (auto-loaded)
├── proxy.txt                         # Legacy proxy file
├── Dockerfile                        # Ubuntu 22.04 + Node 20 + Chrome
└── vercel.json                       # Vercel deployment (region: sin1)
```

---

## 🧠 Endpoint System (HMR)

Semua file di `api/` didaftarkan otomatis via `src/utils/hmrLoader.js` (chokidar watcher).

### Format Endpoint Wajib
```js
export default {
  name: "Nama Endpoint",
  description: "Deskripsi singkat",
  category: "AI",
  methods: ["GET", "POST"],
  params: ["text"],
  paramsSchema: {
    teks: { type: "string", required: true, description: "...", example: "HALO", minLength: 1, maxLength: 200 }
  },
  run(req, res) {
    // Handler — langsung return response
  }
};
```

**Pattern parameter:** `const { param } = { ...req.query, ...req.body };` (support GET+POST)

---

## 🎯 Aturan Koding

1. **ESM Modules** (`"type": "module"`) — pakai `import`, jangan `require()`. Kalau perlu CJS: `createRequire(import.meta.url)`
2. **Canvas** — pakai `canvas` package (node-canvas), register font via `registerFont(path, { family })` dengan temp file
3. **Video** — pakai ffmpeg, cleanup temp dir setelah selesai, return `res.send(videoBuffer)` dengan `Content-Type: video/mp4`
4. **Image response** — langsung `res.send(buffer)`, jangan write ke file dulu
5. **Proxy Manager** — `import { proxy, PROXY_MANAGER } from "../../src/app/index.js"`
   ```js
   proxy()                                        // Random proxy URL
   PROXY_MANAGER.getProxy(['caliph', 'eu'])       // Filter by name
   PROXY_MANAGER.getProxyByProtocol('socks5')     // Filter by protocol (http/https/socks4/socks5)
   PROXY_MANAGER.getProxyAgent()                  // Ready-to-use proxy agent untuk fetch/axios
   ```
   Default proxies (12): caliph, eu, rpoxy, prox, aged, wave, hill, icy, fazri, spring, sizable, jiashu
6. **Logger** — `import logger from "../../src/utils/logger.js"` → `logger.info/warn/error/ready`
7. **Configuration** — baca dari `configuration.json` via `fs.readFileSync`
8. **Jangan hapus file dari `api/` tanpa konfirmasi**
9. **Jangan `npm install -g`, `git push`, atau `git commit` tanpa persetujuan**
10. **Test endpoint** setelah membuat perubahan dengan curl ke localhost:3000

---

## 🧩 Daftar Endpoint (416 total)

### 🤖 AI Chat (`api/ai/` — 64)
aichatting, aiseek, apodex, askme, chatai, chatgptis, chatgpt, chatgpt-org, chatilm, claude-v2, cloudai, deep-ai, deepai, deepseek, deepseek-flash, deepseek-r1, deepseek-v3, duckai, edubrain, feelbetter, felo, freetochat, gemini, gemini-flash, gemini-pro, geminiv2, genspark, gpt4, gpt4o-mini, gpt4v2, gpt5, gpt5-4, halodoc, heck-ai, humanizer, jolly, kimi, langchain, lumo, luna, manus, mathgpt, mistral, muslimai, nova-ai, notegpt, notrack, nvidia, olabiba, perplexity, quily-ai, qwen, qwen3-coder, qwen-coder-v2, qwenguest, qwenv2, sakana, scite-ai, turboseek, tutorgpt, unlimited, venice, voidchat, wormgpt

### 📱 Check Number (`api/checknumber/` — 4)
checkban, simdopul, tricheck, xlcheck

### 🎬 Anime (`api/anime/` — 7)
anichi, anichin, anichin-help, animexin, animeav1, livechart, winbu

### ⬇️ Downloader (`api/downloader/` — 43)
allinone, allinonev2, apkmody, capcut, capcutv2, drama, facebook, frama, gdrive, getdl, gtw, insvid, lk21, lk21v2, mediafire, mediafirev2, meganz, omnify, pinterest, pinterest-dl, pinvid, rednote, savefrom, savefromins, savetube, snapany, spotify, terabox, tiktok, tiktokio, tiktokv2, tiktokv3, tiktokv4, tiktokv5, webtoon, weibo, wow-dl, youtube2, youtube3, youtube4, youtube-analytic, ytplay, zippyshare

### 💾 Download FLAC (`api/download/` — 1)
flac

### 🛠️ Maker (`api/maker/` — 45)
bounty, ektp, fake-afinitas-ml, fakebca, fakeboard, fakebook, fakecall-andro, fakecall-ios, fakech, fakedev, fake-ff, fakegc, fakeig, fakeigprofile, fakeigprofilev2, fake-ml, fake-nokia, fakenote, fakenotif, fakenotifwa, fake-profile-ff, fake-tele, fake-tweet, igstory, iqc, iqc-dark, iqc-pink, jarvis-meme, motivasi, nulis, post-ig, profilejson, qcwa, quotecard, quotes-anime, resize, rusdi-quote, saldo-dana, saldo-gopay, saldo-ovo, sertifikat-nasa, textvideo, ttqc, twobuttons, wafat

### 🛠️ Tools (`api/tools/` — 35)
binner2text, catbox, cekplat, crypto, crypto-price, cuaca-bmkg, dns, encrypt, fakedata, ff-guest, font, html2img, iptraker, kodepos, ngl-spam, nikparse, ocr, password-generator, proxy, proxy2, qr2text, scanweb, spam-otp, ssweb, sub4unlock, subdomain-finder, teks2binner, text2qr, translate, upload, upload2, upload-v3, web2apk, magma/catalog, magma/status

### 🎉 Fun (`api/fun/` — 6)
anime-quotes, philosopher-quotes, reach-ch, tikboost, tiktokview, tiktokviewstatus

### 🔓 Solve (`api/solve/` — 13)
bypasslink, bypasslinkv2, bypasslinkv3, bypass-safelinku, getsitekey, ouo-bypass, recaptcha-v2, recaptcha-v3, shrinkme, turnstile, uam, waf, wellbypass

### 📧 Temp Mail (`api/tempmail/` — 15)
1timetech, akunlama, boomlify, emailtick, freetempmail, guerrilla, imailedu, mailtm, multidomain, tempamail, tempmailchat, tempmailing, tempmailio, temporarymail, tmailor

### 🎮 Games (`api/games/` — 28)
akinator, asahotak, caklontong, cc-sd, family100, lengkapikalimat, math, susunkata, tebakan, tebakbendera, tebakbendera2, tebakgambar, tebakgame, tebakheroml, tebakjkt48, tebakkabupaten, tebakkalimat, tebakkarakterff, tebakkartun, tebakkata, tebakkimia, tebaklagu, tebaklirik, tebaklogo, tebaksiapa, tebaksurah, tebakwarna, tekateki

### 🖼️ Image (`api/image/` — 17)
blur, faceswap, gibli, lego, nanobanana, nanobanana-lite, nanobananav2, nanobananav3, nsfw-check, removebg, removebgbgv2, removewm, removewm-v2, toanimev2, unblur, unblurv2, unwatermark

### 🤖 AI Image Gen (`api/imageai/` — 10)
aiseek, bingimg, dezgo, freeforai, nanobanana, pollinations, quil-image, text2image, text2imgv2, text2imgv3

### 📺 HD/Upscale (`api/imagehd/` — 21)
ai-enhance, ai-enhancev2, ai-enhancev3, ai-enhancev4, ai-enhancev5, ai-enhancev6, ai-enhancev7, ai-enhancev8, clearpng, imageupscaler, nexupscale, optimole, photoihancer, remini, sparkpix, super-resolution, upscale, upscalev2, upscalev3, webability, wink-hd

### 🎬 HD Video (`api/hdvidio/` — 3)
ai-upscale-vidio, tohd, wink-hd-video

### 🔎 Search (`api/search/` — 39)
4kwallpapers, anime, bacakomik, cekbansos, cinesubz, cookpad, dapodik, douyin-search, flac, gempa, ipa-pelajaran, jadwalbola, jadwal-sepakbola, jadwaltv, lazada, livescore, manhwaindo, manhwaland, mcpedl, moviedetail, murotal-quran, nasa, nowsecure, otakudesu, pinterest, pinvid-search, playstore, prodi, search-song, sinopsis, soundcloud, spotify, spotifyv2, tiktok-search, tokusatsu, voratoon, webtoon, wikipedia, youtube-search

### 🔮 Primbon (`api/primbon/` — 10)
artinama, cocokpasangan, nomorhoki, penyakit, ramalanjodohbali, ramaljodoh, rezekihokiweton, sifatusaha, tafsirmimpi, zodiac

### 🔍 Stalker (`api/stalker/` — 13)
deepsearch, freefire, getcontact, github, instagram, ml, ml-id, roblox, telegram, tiktok, whatsapp, x, youtube

### 📸 Ephoto (`api/ephoto/` — 3)
ephoto, photooxy, textpro

### 💳 Payment (`api/payment/` — 4)
qris-static, qris-static-v2, sociabuzz-create, sociabuzz-status

### 🎲 Random (`api/random/` — 5)
blue-archive, lahelu, quotesanime, seegore, waifu

### 💰 Topup/PPOB (`api/topup/` — 4)
cek, dana, ff, ml

### 🔞 NSFW (`api/nsfw/` — 2)
foot, masturbation

### 🎨 Canvas (`api/canvas/` — 20) [Deprecated]
applemusic, boarding-nasa, brat, brat-anime, brat-gojo, brat-vermeil, bratvid-gojo, bratvid-vermeil, carbon, createlogo, drake, reminder, roblox, sertifikat-tolol, struk-generator, welcomev1, welcomev2, welcomev3, welcomev4, wmp

### 🔗 OpenAI Proxy (`api/v1/` — 2)
models, chat/completions

### 🔗 HCNsec AI Gateway (`api/v3/` — 2)
models, chat/completions

### 🎨 AlightMotion (`api/am/` — 5)
bulk, send, sendv2, verify, verifv2

---

## 🔐 Security

| Mekanisme | Detail |
|-----------|--------|
| **Turnstile CAPTCHA** | Cloudflare Turnstile di admin login |
| **Admin Session** | Express session (httpOnly, 24h), adminAuth middleware |
| **API Key Auth** | X-API-Key header / query / Bearer untuk premium |
| **Rate Limiter** | Configurable req/day per IP (default 20.000), violations = permanent ban, Telegram notif |
| **IP Spoofing Fix** | `getClientIP()` hanya trust `cf-connecting-ip` dari Cloudflare edge IP; `trust proxy: 1` |
| **SSRF Protection** | Centralized middleware blocks private IPs, DNS rebinding, non-HTTP protocols untuk semua user-supplied URLs |
| **Session Secret** | Random ephemeral secret jika `SESSION_SECRET` env tidak diset (warning di startup) |
| **Global Lock** | Auto-lock >100 unique IP dalam 2 menit |
| **IP Whitelist** | `data/whitelist-ips.json` |
| **IP Banlist** | `data/banned-ips.json` |
| **Privacy Guard** | `/admin/*` hanya dari localhost |
| **Bot Shield** | `src/utils/botShield.js` — Smart firewall blokir scanner/probe berbahaya |
| **Path Traversal Fix** | `path.basename()` + `startsWith` check di `/files/:filename` dan `/src/images/:filename` |

---

## 🚀 Deployment

```bash
npm run dev        # Nodemon development
npm start          # Production
pm2 stop api && pm2 start api   # Restart PM2

# Docker
docker build -t apiku .
docker run -p 3000:3000 apiku
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `SESSION_SECRET` | Express session secret |
| `ADMIN_KEY` | Admin key untuk unban/reset violations |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key (default: testing key `1x00000000000000000000AA`) |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key (default: testing key, always passes) |
| `CHROME_PATH` | Custom Chrome path untuk Puppeteer |
| `ID_TOKEN` | Telegram bot token |
| `VERCEL` | Set ke `"true"` di Vercel |
| `PUPPETEER_SKIP_DOWNLOAD` | Skip download Puppeteer Chrome |
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | Skip download Playwright browser |
| `PAKASIR_PROJECT` | Payment gateway project name |
| `PAKASIR_APIKEY` | Payment gateway API key |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `CLOUDFLARE_ZONE_ID` | Cloudflare Zone ID |

---

## ⚙️ Configuration (`configuration.json`)

Struktur utama:
```json
{
  "notifications": { "enabled": false, "title": "...", "message": "...", "buttonText": "...", "sourceCodeUrl": "..." },
  "feedbackButton": { "enabled": false, "url": "..." },
  "announcements": { "enabled": true, "items": [{ "title": "...", "description": "...", "date": "...", "releaseVersion": "..." }] },
  "releases": [{ "version": "1.9.4", "date": "June 6, 2026", "changelog": [...] }],
  "rateLimit": { "enabled": true, "windowMs": 10000, "maxRequests": 1000 },
  "spamDetection": { "windowMs": 10000, "maxRequests": 100, "maxViolations": 60, "maxUniqueIPs": 100 },
  "endpointsStatus": { "/api/ai/gemini": "online", "/api/image/nanobanana": "premium", ... }
}
```

Status values: `"online"` | `"offline"` | `"maintenance"` | `"premium"`  
Rate limit & spamDetection config-driven — editable via Admin Dashboard tanpa restart server.

---

## 🔄 Changelog v2.0.0 (July 27, 2026)

**Admin Route Hot-Reload, V5 AI Gateway & Superadmin Role (July 27):**
- **Admin Route HMR** — Semua handler admin routes diekstrak ke `src/routes/setupRoutes.js` dan di-load dynamic via chokidar + `import()` cache buster. Perubahan langsung aktif tanpa restart server.
- **Error Handler Cleanup** — `removeAdminRouteLayers()` sekarang juga membersihkan 404/500 error handler dari Express stack agar tidak memblokir route baru setelah reload.
- **V5 HCNsec Gateway** — Kategori baru `api/v5/` dengan 2 endpoint: `models` (GET, daftar 13 model) dan `chat/completions` (POST, OpenAI-compatible). 10 rotating API keys (round-robin).
- **Superadmin Role** — Backend & frontend guard: hanya role `"superadmin"` yang bisa ubah status endpoint. Role `"admin"` hanya lihat dashboard.
- **Total endpoint:** 305 → **307** (net +2).

## 🔄 Changelog v1.9.8 (July 18, 2026)

### Security Hardening & Endpoint Sync (July 18):**
- **IP Spoofing Fix** — Rewrite `getClientIP()` di `src/middleware/rateLimiter.js`: hanya trust `cf-connecting-ip` jika socket berasal dari Cloudflare edge IP; jika socket = localhost (Cloudflare proxy), fallback ke `req.ip` dari X-Forwarded-For. `trust proxy` diubah dari `true` ke `1`.
- **Session Secret Hardcoded** — Hapus fallback `"SCBOT"` → random ephemeral secret via `crypto.randomBytes(32)`. Cookie name `"SCBOT"` → `"apiku.sid"`. Startup warning jika `SESSION_SECRET` env tidak diset.
- **SSRF Protection** — Centralized middleware di `src/app/index.js` validasi semua user-supplied URLs (`url`, `image`, `avatar`, `pp`, `ppurl`, `avatarUrl`, `source_url`, `target_url`, `profilePhoto`, `mainPhoto`) sebelum sampai endpoint handler. Blokir: private IPs (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x), `file://`, `gopher://`, DNS rebinding. Utility: `src/utils/safeFetch.js`.
- **CLAUDE.md Sync** — Full rescan filesystem: 265 → 303 endpoints. Perubahan: AI 44→47, Canvas 18→20, Downloader 25→26, Fun 5→6, Image 12→14, ImageHD 8→9, Maker 14→29, Payment 10→11, Search 19→20, Solve 8→9, TempMail 9→13, Tools 22→27. Hapus `api/am/` (tidak ada di disk). Tambah kategori baru: `nsfw/` (2), `v1/` (2). Update src/utils: tambah botShield, apiCache, cacheCleaner, chromePath, gameCache, circuitBreaker, logApiRequest, safeFetch.

## 🔄 Changelog v1.9.7 (July 5, 2026)

**SQLite→JSON, Security Fixes & HMR Notifications (July 5):**
- **SQLite→JSON** — Migrasi `api-stats.db` (better-sqlite3) ke `api-stats.json` (zero external deps). Hapus dependency better-sqlite3.
- **Path Traversal Fix** — `/files/:filename` dan `/src/images/:filename` diamankan dengan `path.basename()` + `startsWith` check.
- **Hardcoded Credentials Cleanup** — Hapus GitHub PAT fallback di `api/solve/recaptcha-v2.js`, hapus AES key hardcoded di `api/solve/waf.js`, ganti session secret `"SCBOT"` jadi env variable.
- **HMR Notifications** — Log otomatis `endpoint added / changed / removed` saat HMR reload.
- **Cleanup** — Hapus `data/session/`, `api/v1/messages.js`, 13 stale endpoint dari `api-stats.json`.
- **Config Cleanup** — Menghapus 10 stale entries dari `configuration.json` yang tidak ada di disk (claude-overchat, gpt4.1-nano, minimax, qwen3, z-ai, zelai, allinonev3, tiktokv5, reachch, reachvh). Total endpoint status: 265.
- **CLAUDE.md Sync** — Memperbarui total endpoint 255→265, AI 50→44, Maker 10→14, Payment 3→10, Tools 21→22, Solve 9→8, TempMail 8→9, dan menambahkan kategori topup/ (4 endpoint) serta endpoint baru: fakebook, fakeboard, iqc-dark, quotecard (maker), gopay-* (payment), ipa-pelajaran (search), tempmailv10 (tempmail), ocr (tools), cek/dana/ff/ml (topup).
- **Dead Endpoints Removed** — claude-overchat, gpt4.1-nano, minimax, qwen3, z-ai, zelai (AI), hcaptcha (solve), allinonev3, tiktokv5 (downloader), reachch, reachvh (fun).
- **Total endpoint:** 255 → **265**.

## 🔄 Changelog v1.9.6 (June 26, 2026)

**New Endpoints & Refactory (June 26):**
- **Sakana AI** — `/api/ai/sakana` Chat dengan Sakana AI (Namazu). Support 5 model (namazu, sakana, namazu-v2, namazu-pro, llama), web search, dan thinking mode. Guest auth via Firebase.
- **BMKG Cuaca Scraper** — `/api/tools/cuaca-bmkg` Informasi prakiraan cuaca dari BMKG. 7 actions: search, weather, current, provinces, districts, subdistricts, villages.
- **Docs Params Refactory** — Menyederhanakan tampilan Parameters di docs — hanya nama + REQUIRED badge. Semua parameter enum di AI dijadikan `required: true`. Playground auto-fill dengan default/example value.
- **Total endpoint:** 251 → **253** (net +2).

## 🔄 Changelog v1.9.6 (June 28, 2026)

**New Image HD & Fixes (June 28):**
- **Image Upscaler** — `/api/imagehd/imageupscaler` Upscale gambar 2x/4x/6x via imageupscaler.com. Scraper WordPress AJAX dengan session auto-renew. Support GET & POST (parameter `url` wajib, `scale` opsional).
- **Pinterest Video Search Fix** — `/api/search/pinvid-search.js` dibuat ulang dari file kosong menjadi Pinterest video search endpoint yang berfungsi.
- **DeepSeek Flash & Gemini Flash Revived** — Menghapus hardcoded `503` early return di `/api/ai/deepseek-flash` dan `/api/ai/gemini-flash`. Kedua endpoint kini aktif kembali.
- **Canvas Deprecation Status** — 18 endpoint Canvas diubah statusnya dari `"online"` menjadi `"maintenance"` di `configuration.json`.
- **Category Typo Fix** — `"AligMotion"` → `"AlightMotion"` di `/api/am/email` dan `/api/am/verify`.
- **Dead Endpoint Cleanup** — 18 entry endpoint mati dihapus dari `configuration.json` (bstation, facebook, mimo, blackbox, dll).
- **Total endpoint:** 253 → **255** (net +2).

## 🔄 Changelog v1.9.5 (June 26, 2026)

**New AI Chat Endpoints (June 26):**
- **FreeToChat AI** — `/api/ai/freetochat` AI Chat gratis dengan 15 model (Grok 4.3, GPT-5 Mini, DeepSeek V4, Kimi K2.7, dll). Default model grok-4.3 dengan parameter `model` sebagai enum. Support session multi-turn via session utility.
- **MiniMax M3** — `/api/ai/minimax` AI Chat model MiniMax M3 via notegpt.io. Support input gambar via parameter `image`.

## 🔄 Changelog v1.9.5 (June 25, 2026)

**New TempMail Endpoint (June 25):**
- **TempMail v9** — Menambahkan kembali `/api/tempmail/tempmailv9` menggunakan provider `mail-server.1timetech.com`. Aksi `inbox` disederhanakan dan hanya memerlukan input parameter `email`.

## 🔄 Changelog v1.9.5 (June 23, 2026)

**New AI & Maker Endpoints (June 23):**
- **TurboSeek AI** — `/api/ai/turboseek` fitur AI Web Research yang mengembalikan sumber referensi real-time beserta pertanyaan serupa.
- **TikTok Quote Chat** — `/api/maker/ttqc` generator meme TikTok chat dengan dukungan font offline (PlusJakartaSans).
- **Fake WhatsApp Notif** — `/api/maker/fake-notif-wa` generator fake notifikasi WhatsApp dengan support auto sizing font Poppins.
- **Fake Tweet X** — `/api/maker/fake-tweet` generator tweet palsu Twitter/X lengkap dengan gambar template lokal dan font Poppins.
- Total endpoint bertambah 4.

## 🔄 Changelog v1.9.5 (June 21, 2026)

**Updates, Fixes & Deprecations (June 21):**
- **New Category "AlightMotion" (AM)**: Menambahkan `/api/am/email` (kirim email verifikasi) dan `/api/am/verify` (verifikasi tautan) dengan status premium.
- **New AI Chat Endpoint**: Menambahkan `/api/ai/nova-ai` via okhttp Android client (dukungan session multi-turn offline).
- **TriCheck Parameter Fix**: Memperbaiki request body & query parsing parameter `number` pada `/api/checknumber/tricheck`.
- **WhatsApp Reaction Deprecation**: Menghapus `/api/fun/react-wa` dan `/api/fun/reach-wa-v2`.
- **Maker Cleanup**: Menghapus `fake-wa` dan `fakenotif` versi lama (menggunakan host eksternal `tmpfile.link` yang kedaluwarsa).
- **Canvas Deprecation**: Menandai seluruh kategori `api/canvas/` (18 file) sebagai deprecated (status masih tersetel online di server).

## 🔄 Changelog v1.9.5 (June 20, 2026)

**Dead Endpoint Cleanup (June 20 — sore):**
- **Hapus AI Mati:** Menghapus `/api/ai/mimo` (upstream "Invalid API key") dan `/api/ai/qwen-codex-v2` (duplikat persis `/api/ai/qwen-coder-v2`).
- **Hapus OpenAI API Proxy:** Menghapus kategori `api/v1/` (`/api/v1/chat/completions` & `/api/v1/models`) — upstream `panelnya.online` down (HTTP 500). Dead code `src/agent/openai.js` juga dihapus.
- **Homepage Health Bar:** Menambahkan health-bar (API Status / Avg Latency / Uptime / Version / Endpoints) ke `public/index.html` dengan CSS & HTML identik dengan halaman `/docs`.
- **Total endpoint:** 241 → **237**.

**Updates & Cleanups (June 20):**
- **New Search Endpoint:** Menambahkan endpoint pencarian baru `/api/search/jadwal-sepakbola` untuk mengambil jadwal sepakbola live dari jadwaltv.net berdasarkan StarLabs code snippet.
- **Categorization Update:** Menyelaraskan seluruh kategori search (`prodi.js`, `jadwalbola.js`, `jadwaltv.js`) menjadi `"SEARCH"` agar terkelompok seragam di filter dokumentasi `/docs`.
- **Prodi Parameter Fix:** Mengubah parameter `mode` pada `/api/search/prodi` kembali menjadi opsional (`required: false`) dengan nilai `default: "all"` agar request tanpa `mode` berhasil mengeksekusi mode default.
- **TempMail Cleanup:** Menghapus endpoint `tempmailv7` dan `tempmailv9` yang tidak lagi aktif/mengalami error dari server provider eksternal.

## 🔄 Changelog v1.9.5 (June 14, 2026)

**New Category & Cleanup (June 14):**
- Maker Motivasi — `/api/maker/motivasi` untuk men-generate gambar quotes/motivasi (Canvas)
- Halodoc AI — `/api/ai/halodoc` untuk AI konsultasi kesehatan (Hilda)
- Kategori Baru "Maker" (`/api/maker`) — Memindahkan generator notifikasi dan saldo palsu (`fake-wa`, `fakeig`, `fakenotif`, `saldo-dana`, `saldo-gopay`) ke folder baru `api/maker/` dengan kategori `"Maker"`.
- Perbaikan Parameter POST — Memperbaiki parsing parameter POST untuk `/api/downloader/youtube2` dan `/api/downloader/youtube-analytic`.
- Perbaikan TikTok DL — Memperbaiki circular dependency isu di `/api/downloader/tiktok` menggunakan global proxy helper.
- Pembersihan API Mati — Menghapus 11 endpoint yang tidak berfungsi (Bstation, Facebook, Github, ReelsVidio, Sfile, YouTube v1, TikTok v3, TikTok v4, Brat Patrick, Truecaller).
- OpenAI API Proxy — Penambahan reverse proxy untuk kompatibilitas client OpenAI (`/api/v1/chat/completions` dan `/api/v1/models`).

## 🔄 Changelog v1.9.4 (June 13, 2026)

**New Endpoints & Updates (June 13):**
- Mistral AI Chat — `/api/ai/mistral` via tRPC scraper (Le Chat, gratis)
- MuslimAI v2 — `/api/ai/muslimai` upgrade ke streaming `/api/chat` dengan Quran sources
- AI Humanizer — `/api/ai/humanizer` (ZeroGPT-based)
- Qwen Coder V2 & Qwen3 Coder — `/api/ai/qwen-coder-v2`, `/api/ai/qwen-codex-v2`, & `/api/ai/qwen3-coder`
- Canvas Brat Vermeil & Bratvid Vermeil — `/api/canvas/brat-vermeil` & `/api/canvas/bratvid-vermeil`
- Sertifikat Tolol — `/api/canvas/sertifikat-tolol` (port dari Generator-Sertifikat-Tolol)
- Downloader Baru — `/api/downloader/allinonev2`, `/api/downloader/allinonev3`, `/api/downloader/tiktokv3`, `/api/downloader/tiktokv4`, `/api/downloader/tiktokv5`, `/api/downloader/drama`, `/api/downloader/frama`, `/api/downloader/lk21`
- Fun — `/api/fun/reach-wa-v2`
- Wink HD Video & Image Upscaler — `/api/hdvidio/wink-hd-video` & `/api/imagehd/wink-hd`
- DeepAI Image Edit — `/api/image/deepai-edit`
- Crypto & Search Tools — `/api/tools/crypto`, `/api/search/search-song`, `/api/search/spotify`
- Turnstile Solver — `/api/solve/turnstile` (Bypass manual browser-based diaktifkan kembali dan diperbarui)

**New Endpoints (June 10):**

**Solve Module Update (June 9):**
- UAM Solver diupgrade ke rebrowser-puppeteer + stealth — bypass Cloudflare UAM, dapat cf_clearance ~7-10s ✅
- reCAPTCHA v3 disederhanakan — hanya param `url` + `sitekey`, response time ~95ms ✅
- reCAPTCHA v2 — FAIL (Qwen AI solver timeout) ❌
- Turnstile endpoint — dihapus 🗑️

**Docs Fix (June 9):**
- Copy URL di `docs.html` kini otomatis include nilai `default` dari paramsSchema
- Animasi "Copied" toast dihapus dari tombol Copy URL

**Optimasi I/O:**
- UUID caching tempmailv6, stream timeout fix (langchain & z-ai)
- Async fs 8 file: pakasir-create, pakasir-status, brat-anime, fakeig, saldo-gopay, toanimev2, upload, upload2
- Zero disk write: brat-anime & toanimev2 pure in-memory (getBufferAsync)
- SparkPix response simplified (langsung result & download URL)

**UI Fixes:**
- Legal pages & docs header di-center
- Route /legal/privacy-policy & /legal/terms-of-service fix
- support.html Our Team section di-center

**Perubahan Lain:**
- react-wa dipindah dari `api/tools/` ke `api/fun/` (kategori baru: Fun)
- react-wa response disederhanakan — field `details[]` dihapus, hanya return `{ status, result: { url, emojis, message } }`

**Removed:** claude (not working), deepimg & dream (API deprecated), neko (not working), turnstile (deleted)

**Total endpoint:** 190 → 244

**New Endpoints (June 10):**
- Telegram Stalker — `/api/stalker/telegram` scrape t.me untuk info profil publik (avatar, bio, verified status, member_count)
- WhatsApp Channel Stalker — `/api/stalker/whatsapp` scrape whatsapp.com/channel (nama, followers, description)
- Windows Media Player Canvas — `/api/canvas/wmp` overlay teks ke template WMP (NexaDev, pipe separator untuk GET)
- Image to Lego — `/api/image/lego` ubah gambar jadi Lego pixel art (24 warna palette, canvas-based, tanpa ImageMagick)
- DeepSeek R1 — `/api/ai/deepseek-r1` model reasoning DeepSeek R1
- Gemini V2 — `/api/ai/geminiv2` versi baru Google Gemini
- Carbon — `/api/canvas/carbon` code screenshot generator
- Anime Quotes & Philosopher Quotes — `/api/fun/anime-quotes` & `/api/fun/philosopher-quotes`
- Wikipedia Search — `/api/search/wikipedia`
- Remove Watermark — `/api/image/removewm` via EZRemove AI
- TempMail v7 & v8 — `/api/tempmail/tempmailv7` & `/api/tempmail/tempmailv8`
- Solve Module Upgrade — bypass diganti 4 endpoint baru: `/api/solve/bypasslink`, `bypasslinkv2`, `bypass-safelinku`, `waf`
- Quil Image — `/api/imageai/quil-image` AI image generator via Quillbot (category: IMAGE AI)

**Kategori AI diubah:** `"AI"` → `"AI CHAT"` (konsisten)

**Fix bug:**
- `/configuration` route sekarang panggil `reloadConfig()` sebelum `getConfig()` — announcement & data selalu fresh
- HMR sekarang watch `src/` directory juga — file source engine auto-di-reimport ke registry

---

## 🔄 Changelog v1.9.3 (May 29, 2026)

- **Brat Gojo Image** — `/api/canvas/brat-gojo` (Gojo dengan teks custom, auto center/wrap/resize)
- **Brat Gojo Video** — `/api/canvas/bratvid-gojo` (video Gojo teks muncul bertahap per kata, ffmpeg)
- **Auto-Update Endpoint Count** — index.html & docs.html auto-update jumlah endpoint dari API
- **Auto-Update Meta Tags** — Meta description, OG, Twitter cards, JSON-LD schema auto-update
- **Welcome v4 Fix** — URL validation diperbaiki, support semua URL image
- **Total endpoint:** 190

---

## 🔄 Changelog v1.9.2 (May 2026)

- **Endpoint Baru** — chatgpt-org, langchain, nvidia, scite-ai, zelai (AI), playstore & youtube-search (search)
- **Solve** — recaptcha-v2, bypass ditambahkan
- **Stalker** — ml ditambahkan
- **Total endpoint:** ~190

---

## 🔄 Changelog v1.9.1 (May 26, 2026)

- **4 Endpoint Baru** — gemini-pro (AI), nowsecure & pinterest (search), tempmailv5 (temp mail)
- **Solve Rewrite** — Turnstile & UAM solver di-rewrite ke Playwright langsung (anti-detection, lebih reliable)
- **reCAPTCHA v3 Upgrade** — Default values, GET+POST, enums (action, hl), response timing
- **Dynamic Rate Limiter** — maxRequests, windowMs, maxViolations, maxUniqueIPs config-driven dari configuration.json
- **Admin Dashboard** — Spam Detection settings + enhanced Rate Limit settings
- **Claude Endpoint Fix** — Internal references diperbaiki
- **ssweb** — Support GET+POST

---

## 🔄 Changelog v1.9.0 (May 23, 2026)

- **Kategori baru `checknumber/`** — 4 endpoint: simdopul, tricheck, truecaller, xlcheck
- **AI endpoint baru** — mimo (5 Xiaomi MiMo models: V2.5 Pro, V2 Pro, V2.5, V2 Omni, V2 Flash)
- **ImageHD endpoint baru** — sparkpix (SparkPix AI 4K/6K/8K upscale + face enhance)
- **TempMail v4** — temporarymail.com integration
- **Fix: Random Waifu** — provider lama (waifu.pics) down, diganti waifu.im
- **SQLite stats** — `api-stats.db` via better-sqlite3 (WAL mode)
- **Admin dashboard** — Turnstile CAPTCHA, session auth, API key management
- **Notification feed** — `data/notifications-feed.json` untuk dashboard

---

## 🔄 Changelog v1.8.0

- **Admin dashboard awal** — login, dashboard, user management
- **API Key management** — premium endpoint support (X-API-Key / Bearer)
- **Rate limiter** — 500 req/day, 20 violations = permanent ban, Telegram notif
- **Global lock** — auto-lock >100 unique IP dalam 2 menit (anti-DDoS)
- **Proxy Manager** — support HTTP, HTTPS, SOCKS4, SOCKS5 dari proxy/ dir + proxy.txt
- **Visitor tracker** — `data/visitors.json`
- **src/images/** — static images (logo, avatars)
- **public/legal/** — privacy-policy & terms-of-service pages

---

## 🔄 Changelog v2.1.0 (August 18, 2026)

**Major Endpoint Expansion & Architecture Sync (August 18):**
- **Total Endpoints:** 307 → **350** (+43 net new endpoints across 15 categories)
- **AI Chat (9 baru):** `notegpt` (multi-model GPT-4o/Gemini/DeepSeek dengan auto temp-mail auth, vision, reasoning, token pool), `duckai`, `edubrain`, `jolly`, `deepai`, `genspark`, `gpt5-4`, `qwen3-coder`, `voidchat`
- **Maker (10 baru):** `fakech` (Fake CH iOS canvas), `fake-nokia`, `fake-profile-ff`, `fake-tele` (Fake Telegram Profile canvas), `igstory`, `iqc-pink`, `nulis` (handwriting canvas), `profilejson`, `fakeigprofilev2`, `fakecall-andro`
- **Downloader (5 baru):** `apkmody` (APKModY search/detail/history/download), `capcut`, `pinterest-dl`, `weibo`, `tokusatsu`
- **Tools (3 baru):** `catbox` (file upload), `sub4unlock` (link unlocker), `subdomain-finder` (7 sources + DNS bruteforce)
- **Search (7 baru):** `anime`, `cookpad`, `dapodik`, `manhwaindo`, `manhwaland`, `murotal-quran`, `tokusatsu`
- **Image HD (7 baru):** `ai-enhancev3`–`v8` (8 versions), `webability` (WebAbility AI upscaler scale 2/4, models: esrgan/realesrgan/anime)
- **Stalker (2 baru):** `instagram` (merged igService.js, 12 posts + user_id), `ml-id` (MLBB ID checker triple redundancy: Gopay/Caliph/Smile.One)
- **Image AI (1 baru):** `dezgo` (Dezgo AI image generation)
- **Payment Cleanup:** Removed 7 gopay-* endpoints + 2 pakasir-* endpoints (not functional); remaining: qris-static, qris-static-v2, sociabuzz-create, sociabuzz-status
- **Gateway Migration:** v5 HCNsec Gateway removed → v3 HCNsec Gateway added (2 endpoints: models, chat/completions)
- **Configuration:** Announcements updated (Aug 5, Aug 1), endpoint statuses refreshed
- **Subdomain Finder Rewrite:** Complete rewrite with 7 sources (crt.sh, hackertarget, threatcrowd, bufferover, rapidapi, securitytrails, virustotal) + DNS bruteforce

## 🔄 Changelog v2.1.1 (September 12, 2026)

**EKTP Generator Refactor & Full Filesystem Sync (September 12):**
- **EKTP Generator Refactor** — `/api/maker/ektp` di-refactor total mengikuti `update.md`: konfigurasi koordinat terpusat (`POS` object), helper `drawText()` (font/ukuran/alignment/baseline/uppercase/maxWidth, font di-reset tiap panggilan), NIK dinormalisasi ke format mockup `XXXX-XXXX-XXXX-XXXX` (invalid → `0000-0000-0000-0000`), foto pakai cover-crop eksplisit (aspek ratio terjaga, fallback `default_photo.jpg`), watermark wajib diagonal `CONTOH — TIDAK BERLAKU`, guard panjang teks per field + sanitasi string agar tidak keluar canvas. API compatibility (GET/POST, `req.query`/`req.body`, `image/png`) dipertahankan.
- **CLAUDE.md Sync** — Full rescan filesystem: 350 → **416** endpoints. Perubahan: AI 56→63, CheckNumber 3→4, Downloader 31→43, Image 14→17, ImageAI 7→10, ImageHD 16→21, Maker 41→45, Search 27→38, Solve 10→12, Stalker 10→13, TempMail 13→15, Tools 30→35, Topup 5→4, AM 3→5. Tambah kategori baru `anime/` (6) dan `download/` (1: flac). Hapus AI mati dari daftar: copilot, grokv2. Fix note #23: v5 → v3 HCNsec Gateway (v5 sudah dihapus).

## 🔄 Changelog v2.1.3 (September 14, 2026)

**New Endpoints, MAGMA Fix & Description Cleanup (September 14):**
- **TutorGPT AI** — `/api/ai/tutorgpt`: AI chat gratis multi-turn (session), pilihan model default gpt-5.6-luna, opsi tone & length output. GET+POST.
- **Akinator Game** — `/api/games/akinator`: game tebak karakter via id.akinator.com, action start/answer/back/exclude/stop, 3 tema (characters, animals, objects). Session disimpan via `src/utils/session.js` ke `data/session/akinator_*.json`.
- **MAGMA Fix** — `/api/tools/magma/status`: bug 500 (stale `X-CSRF-TOKEN` dari masa lalu) diperbaiki. Sekarang memakai `fetch` + cookie jar + alur warm-up session (GET home → warm POST utk cookie `magma_indonesia` → bootstrap CSRF fresh → POST real). `/api/tools/magma/catalog`: hapus duplikat `export default` (baris 93) yang menyebabkan ESM error/gagal HMR load. Keduanya terverifikasi (Semeru Level III, catalog 69 gunung).
- **Wallpaper 4K** — `/api/search/4kwallpapers`: scraper wallpaper resolusi 4K dengan 9 action (recent, popular, featured, random, search, category, categories, collections, collection detail). GET+POST.
- **Description Cleanup** — 146 file `api/` deskripsinya dibersihkan dari sebutan sumber/upstream website (183 flagged, 0 tersisa) agar tidak membocorkan provider scraper.
- **Total endpoint:** 420 → **423** (net +3).

---

## ⚠️ Important Notes

1. **Heavy dependencies** — Puppeteer (~280MB Chrome), Playwright, Canvas, Sharp
2. **Vercel** — set `PUPPETEER_SKIP_DOWNLOAD=true` (tidak support Puppeteer)
3. **HMR aktif** — file baru di `api/` auto-terload. Restart manual untuk `src/app/index.js` (kecuali admin routes di `src/routes/` yang hot-reload via chokidar)
4. **api-stats.json** — Request stats stored in JSON. Jangan hapus saat server running
5. **Chrome binary** — `src/function/chrome/chrome/linux-150.0.7843.0/chrome-linux64/chrome`
6. **Canvas font** — registerFont dengan temp file, bukan buffer
7. **Video** — ffmpeg + cleanup temp dir
8. **Telegram** — @ZyyvorAPI
9. **Response formatter** — `responseFormatter.js` otomatis inject `statusCode`, `timestamp`, `attribution` ke semua `res.json()`. Jangan tambahkan manual.
10. **Config cache** — selalu gunakan `import { getConfig } from "../../src/utils/configCache.js"` dan panggil `getConfig()`, bukan `fs.readFileSync` langsung ke `configuration.json`.
11. **Session utility** — `import { loadSession, saveSession } from "../../src/utils/session.js"`. File disimpan di `data/session/<filename>.json`. Dipakai untuk AI endpoints yang perlu history percakapan.
12. **react-wa `details[]`** — field `details` (per-key error/success dari upstream) sengaja TIDAK dikembalikan di response `/api/fun/react-wa`. Jangan tambahkan kembali.
13. **api/fun/** — kategori baru untuk endpoint "Fun" (react-wa sudah dipindah dari `api/tools/` ke sini sejak 2026-06-08).
14. **Solve module status** — UAM ✅ (rebrowser-puppeteer+stealth), reCAPTCHA-v3 ✅ (~95ms), reCAPTCHA-v2 ❌ (timeout), turnstile DELETED.
15. **UAM/Solve browser** — pakai `rebrowser-puppeteer` + `puppeteer-extra-plugin-stealth` + `/usr/bin/google-chrome`. Fallback Xvfb jika headless gagal. Bukan Playwright.
16. **docs.html Copy URL** — otomatis include `default` dari paramsSchema sebagai nilai parameter. Jangan pakai `example` sebagai fallback.
17. **HMR src watch** — HMR sekarang watch `src/` directory juga (selain `api/`). File `src/` yang berubah di-reimport ke HMR registry. Untuk apply penuh pada middleware/engine, restart server tetap diperlukan.
18. **Configuration cache** — Route `/configuration` panggil `reloadConfig()` setiap request untuk mastiin data fresh. Jangan hapus `reloadConfig()` dari route handler.
19. **HMR Auto-Retry & Delay** — File saving yang cepat bisa menyebabkan `Module not found` error sementara saat lock file OS. Telah ditambahkan delay 150ms dan mekanisme auto-retry (max 3x) di `hotLoader.js`.
20. **Global Anti-Crash** — `index.js` memiliki global listener `uncaughtException` dan `unhandledRejection`. Error sintaksis fatal dari HMR API tidak akan membunuh proses Node.js utama.
21. **Hotfix Changelog (Unlinked)** — Menambah pengumuman hotfix agar tampil teratas di `/changelog` cukup dengan menambahkan item di `announcements` file `configuration.json` dan menyetel `"releaseVersion": ""`. Frontend `/changelog` akan otomatis meletakkannya di urutan teratas sebelum daftar rilis.
22. **Admin Route HMR** — `src/routes/setupRoutes.js` di-watch oleh chokidar di `src/app/index.js`. Perubahan langsung di-reload via dynamic `import()` dengan cache buster. Gunakan `removeAdminRouteLayers()` sebelum `loadRoutes()` untuk membersihkan Express stack lama (termasuk 404/500 handler). Jangan edit `src/routes/setupRoutes.js` lewat HMR endpoint API biasa — hanya chokidar watcher di `index.js` yang handle reload.
23. **V3 Endpoint Structure** — `api/v3/models.js` (GET, daftar model) dan `api/v3/chat/completions.js` (POST, OpenAI-compatible). HCNsec AI Gateway. Jangan expose API keys di response.
24. **Superadmin Role** — Hanya role `"superadmin"` yang bisa mengubah status endpoint (`/admin/api/endpoints/status`). Role `"admin"` hanya bisa lihat dashboard. Guard ada di backend (`setupRoutes.js`) dan frontend (`dashboard.html`).
25. **Setup Routes File** — `src/routes/setupRoutes.js` diekstrak dari `src/app/index.js` untuk mendukung hot-reload. Berisi semua handler admin routes (login, endpoints, keys, users, IP management, settings, notifications, stats). Jangan tambahkan route handler langsung di `index.js` — tambahkan di file ini.
