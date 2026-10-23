import fs from 'fs'
import os from 'os'
import path from 'path'
import net from 'net'
import { spawn, execSync } from 'child_process'
import { proxy } from '../../src/app/index.js'

const ITEMS_PER_PAGE = 5

const VALID_REGION_CODES = new Set([
  'ID', 'US', 'MY', 'JP', 'VN', 'TH', 'SG', 'PH', 'KR', 'CN', 'TW', 'HK',
  'GB', 'UK', 'CA', 'AU', 'NZ', 'DE', 'FR', 'ES', 'IT', 'NL', 'BR', 'MX',
  'AR', 'CL', 'CO', 'PE', 'IN', 'PK', 'BD', 'RU', 'UA', 'TR', 'SA', 'AE',
  'EG', 'ZA', 'ALL', 'ANY', '*'
])

const activeProcesses = new Set()
const activeTempDirs = new Set()

function cleanupAllResources() {
  for (const proc of activeProcesses) {
    try { proc.kill('SIGKILL') } catch (e) {}
  }
  activeProcesses.clear()
  for (const tempDir of activeTempDirs) {
    try {
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
    } catch (e) {}
  }
  activeTempDirs.clear()
}

function formatRegionLabel(regionCode) {
  const code = (regionCode || 'ID').toUpperCase()
  const map = {
    'ID': 'ID (Indonesia)', 'US': 'US (United States)', 'MY': 'MY (Malaysia)',
    'JP': 'JP (Japan)', 'VN': 'VN (Vietnam)', 'TH': 'TH (Thailand)',
    'SG': 'SG (Singapore)', 'PH': 'PH (Philippines)', 'KR': 'KR (South Korea)',
    'GB': 'GB/UK (United Kingdom)', 'UK': 'GB/UK (United Kingdom)',
    'ALL': 'ALL (Global / Worldwide)', 'ANY': 'ALL (Global / Worldwide)'
  }
  return map[code] || `${code}`
}

function evaluatePrecision(item, keyword, targetRegion = 'ID') {
  const itemRegion = (item.region || '').toUpperCase()
  const desiredRegion = targetRegion.toUpperCase()

  if (desiredRegion !== 'ALL' && desiredRegion !== 'ANY' && desiredRegion !== '*') {
    if (itemRegion && itemRegion !== desiredRegion && itemRegion !== 'ALL') {
      return { score: 0, label: `REJECTED_NON_${desiredRegion}_REGION` }
    }
  }

  const rawCaption = (item.title || '').toLowerCase()
  const rawKeyword = keyword.toLowerCase().trim()
  const cleanKwJoined = rawKeyword.replace(/\s+/g, '')
  const queryWords = rawKeyword.split(/\s+/).filter(w => w.length > 0)

  const authorName = (item.author?.nickname || '').toLowerCase()
  const username = (item.author?.unique_id || '').toLowerCase()
  const fullText = `${rawCaption} ${authorName} ${username}`

  if (rawCaption.includes(rawKeyword) || fullText.includes(rawKeyword)) {
    return { score: 100, label: 'EXACT_MATCH' }
  }

  if (fullText.includes(cleanKwJoined) || fullText.includes(`#${cleanKwJoined}`)) {
    return { score: 95, label: 'HASHTAG_EXACT' }
  }

  const tokens = rawCaption.split(/[\s,#._\-!?:;"'()\[\]{}]+/)
  const wordPositions = queryWords.map(word => {
    const indices = []
    tokens.forEach((token, idx) => {
      if (token.includes(word)) indices.push(idx)
    })
    return indices
  })

  const hasAnyWordMatch = wordPositions.some(posList => posList.length > 0)
  const hasAllWordsMatch = wordPositions.every(posList => posList.length > 0)

  if (!hasAnyWordMatch) return { score: 0, label: 'NO_MATCH' }
  if (!hasAllWordsMatch) return { score: 75, label: 'PARTIAL_MATCH' }

  let minSpan = Infinity
  function findSpan(wordIndex, currentPosList) {
    if (wordIndex === wordPositions.length) {
      const min = Math.min(...currentPosList)
      const max = Math.max(...currentPosList)
      const span = max - min
      if (span < minSpan) minSpan = span
      return
    }
    for (const pos of wordPositions[wordIndex]) {
      findSpan(wordIndex + 1, [...currentPosList, pos])
    }
  }
  findSpan(0, [])

  const maxAllowedSpan = queryWords.length + 3
  if (minSpan <= maxAllowedSpan) {
    const proximityScore = 90 - (minSpan * 5)
    return { score: Math.max(proximityScore, 70), label: 'CLOSE_PROXIMITY' }
  }

  return { score: 65, label: 'RELEVANT_MATCH' }
}

function getStoredCookie() {
  let raw = ''
  if (process.env.TIKTOK_COOKIE) {
    raw = process.env.TIKTOK_COOKIE.trim()
  } else {
    const cookiePath = path.join(process.cwd(), 'cookie.txt')
    if (fs.existsSync(cookiePath)) {
      try { raw = fs.readFileSync(cookiePath, 'utf8').trim() } catch (e) {}
    }
  }
  if (!raw) return ''
  if (raw.startsWith('[') && raw.endsWith(']')) {
    try {
      const arr = JSON.parse(raw)
      return arr.map(c => `${c.name}=${c.value}`).join('; ')
    } catch (e) {}
  }
  if (raw.includes('\n')) {
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    const pairs = []
    for (const line of lines) {
      if (line.includes('=')) {
        pairs.push(line.replace(/;+$/, ''))
      } else {
        const tabs = line.split(/\t+/)
        if (tabs.length >= 2) pairs.push(`${tabs[0]}=${tabs[1]}`)
      }
    }
    return pairs.join('; ')
  }
  return raw
}

function findBrowserPath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH
  if (process.env.BROWSER_PATH && fs.existsSync(process.env.BROWSER_PATH)) return process.env.BROWSER_PATH

  if (process.platform !== 'win32') {
    try {
      const found = execSync('which chromium || which chromium-browser || which google-chrome || which google-chrome-stable || which chrome', {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1000
      }).toString().trim()
      if (found && fs.existsSync(found)) return found
    } catch (e) {}
  }

  const possible = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium'
  ]
  for (const p of possible) {
    if (fs.existsSync(p)) return p
  }
  return null
}

async function fetchAwemeVideoDetails(videoId) {
  if (!videoId) return null
  const rawCookie = getStoredCookie()
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Referer': 'https://www.tiktok.com/',
    'Cookie': rawCookie
  }

  const endpoints = [
    `https://api22-normal-c-useast2a.tiktokv.com/aweme/v1/feed/?aweme_id=${videoId}`,
    `https://api22-normal-c-alisg.tiktokv.com/aweme/v1/feed/?aweme_id=${videoId}`,
    `https://api16-normal-c-useast1a.tiktokv.com/aweme/v1/feed/?aweme_id=${videoId}`,
    `https://api22-va.tiktokv.com/aweme/v1/feed/?aweme_id=${videoId}`,
    `https://api.tiktokv.com/aweme/v1/feed/?aweme_id=${videoId}`,
    `https://api19-va.tiktokv.com/aweme/v1/feed/?aweme_id=${videoId}`
  ]

  const fetchSingle = async (ep) => {
    const res = await fetch(ep, { headers, signal: AbortSignal.timeout(3000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    if (!text.startsWith('{')) throw new Error('Invalid JSON body')
    const data = JSON.parse(text)
    const item = (data.aweme_list || [])[0]
    if (!item || !item.statistics) throw new Error('No aweme item')
    const stats = item.statistics || {}
    const video = item.video || {}
    const music = item.music || {}
    const author = item.author || {}
    return {
      views: stats.play_count !== undefined ? Number(stats.play_count).toLocaleString() : 'N/A',
      likes: stats.digg_count !== undefined ? Number(stats.digg_count).toLocaleString() : 'N/A',
      comments: stats.comment_count !== undefined ? Number(stats.comment_count).toLocaleString() : 'N/A',
      shares: stats.share_count !== undefined ? Number(stats.share_count).toLocaleString() : 'N/A',
      saves: stats.collect_count !== undefined ? Number(stats.collect_count).toLocaleString() : 'N/A',
      duration: video.duration ? `${(video.duration / 1000).toFixed(1)}s` : 'N/A',
      music_title: music.title || '',
      music_author: music.author || '',
      mp3_url: music.play_url?.url_list?.[0] || '',
      cover: video.origin_cover?.url_list?.[0] || video.cover?.url_list?.[0] || '',
      dynamic_cover: video.dynamic_cover?.url_list?.[0] || '',
      play_addr: video.play_addr?.url_list?.[0] || '',
      author_name: author.nickname || '',
      author_username: author.unique_id ? `@${author.unique_id}` : '',
      avatar: author.avatar_larger?.url_list?.[0] || author.avatar_thumb?.url_list?.[0] || ''
    }
  }

  try {
    return await Promise.any([fetchSingle(endpoints[0]), fetchSingle(endpoints[1])])
  } catch (e) {
    for (let i = 2; i < endpoints.length; i++) {
      try { return await fetchSingle(endpoints[i]) } catch (err) {}
    }
  }
  return null
}

async function fetchOembedMeta(videoUrl) {
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(3000)
    })
    if (res.ok) return await res.json()
  } catch (e) {}
  return null
}

async function resolveDirectDownloads(videoUrl) {
  try {
    const res = await fetch('https://ssstik.io/abc?url=dl', {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'HX-Request': 'true',
        'HX-Trigger': '_gcaptcha_pt',
        'HX-Target': 'target',
        'HX-Current-URL': 'https://ssstik.io/en'
      },
      body: `id=${encodeURIComponent(videoUrl)}&locale=en&tt=0`,
      signal: AbortSignal.timeout(3500)
    })
    if (res.ok) {
      const html = await res.text()
      const allLinks = Array.from(html.matchAll(/href="([^"]+)"/g)).map(m => m[1])
      const noWm = allLinks.find(l => (l.includes('tikcdn.io/ssstik/') && !l.includes('/m/')) || l.includes('download_link'))
      const mp3 = allLinks.find(l => l.includes('tikcdn.io/ssstik/m/'))
      if (noWm || mp3) return { stream_mp4_no_wm: noWm || '', mp3_url: mp3 || '' }
    }
  } catch (e) {}

  try {
    const res = await fetch('https://lovetik.com/api/ajax/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': 'Mozilla/5.0' },
      body: `query=${encodeURIComponent(videoUrl)}`,
      signal: AbortSignal.timeout(3500)
    })
    if (res.ok) {
      const data = await res.json()
      const mp4Link = (data.links || []).find(l => l.t && l.t.includes('MP4') && !l.t.includes('Watermark'))
      const audioLink = (data.links || []).find(l => l.t && l.t.includes('MP3'))
      return { stream_mp4_no_wm: mp4Link?.a || '', mp3_url: audioLink?.a || '' }
    }
  } catch (e) {}

  return { stream_mp4_no_wm: '', mp3_url: '' }
}

async function fetchTikTokSearchViaBrowser(keyword, page = 1, region = 'ID') {
  const browserPath = findBrowserPath()
  if (!browserPath) throw new Error('Browser Chrome/Chromium tidak ditemukan di sistem.')

  const port = await new Promise(res => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => res(p))
    })
  })

  const baseTmpDir = process.env.TMPDIR || os.tmpdir()
  const tempDir = path.join(baseTmpDir, `tt_browser_${process.pid}_${Date.now()}`)
  activeTempDirs.add(tempDir)

  const isHeadlessShell = browserPath.includes('headless_shell')

  const browserArgs = isHeadlessShell ? [
    `--remote-debugging-port=${port}`,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--ignore-certificate-errors',
    '--disable-web-security',
    `--user-data-dir=${tempDir}`
  ] : [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-sync',
    '--ignore-certificate-errors',
    '--allow-running-insecure-content',
    '--disable-web-security',
    '--test-type',
    '--window-size=1440,900',
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    `--user-data-dir=${tempDir}`
  ]

  const chromeProc = spawn(browserPath, [...browserArgs, 'about:blank'])

  let procError = null
  let procStderr = ''
  chromeProc.on('error', (err) => { procError = err })
  chromeProc.stderr?.on('data', (d) => { procStderr += d.toString() })

  activeProcesses.add(chromeProc)

  const cleanupInstance = () => {
    activeProcesses.delete(chromeProc)
    try { chromeProc.kill() } catch (e) {}
    activeTempDirs.delete(tempDir)
    try {
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
    } catch (e) {}
  }

  try {
    let isReady = false
    for (let i = 0; i < 40; i++) {
      if (procError) break
      try {
        const checkRes = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })
        if (checkRes.ok) { isReady = true; break }
      } catch (e) { await new Promise(r => setTimeout(r, 200)) }
    }

    if (!isReady) {
      if (procError) throw new Error(`Gagal mengeksekusi Chromium binary (${browserPath}): ${procError.message}`)
      const errSnippet = procStderr.trim() ? ` [Detail: ${procStderr.trim().slice(-200)}]` : ''
      throw new Error(`Chromium tidak merespons di port ${port}.${errSnippet}`)
    }

    let tabWsUrl = ''
    try {
      const listRes = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })
      if (listRes.ok) {
        const tabs = await listRes.json()
        const pageTab = tabs.find(t => t.url && t.url.includes('tiktok.com') && t.webSocketDebuggerUrl) ||
                        tabs.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
        if (pageTab) tabWsUrl = pageTab.webSocketDebuggerUrl
      }
    } catch (e) {}

    if (!tabWsUrl) {
      const newTab = await fetch(`http://127.0.0.1:${port}/json/new`, { method: 'PUT', signal: AbortSignal.timeout(2000) }).then(r => r.json())
      tabWsUrl = newTab.webSocketDebuggerUrl
    }

    if (!tabWsUrl) throw new Error('Gagal mendapatkan WebSocket debugger URL dari browser.')

    const ws = new WebSocket(tabWsUrl)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    })

    let id = 1
    const pending = new Map()
    function send(method, params = {}, timeoutMs = 8000) {
      return new Promise((resolve, reject) => {
        const reqId = id++
        const timer = setTimeout(() => {
          if (pending.has(reqId)) { pending.delete(reqId); resolve({}) }
        }, timeoutMs)
        pending.set(reqId, {
          resolve: (val) => { clearTimeout(timer); resolve(val) },
          reject: (err) => { clearTimeout(timer); reject(err) }
        })
        try { ws.send(JSON.stringify({ id: reqId, method, params })) }
        catch (e) { clearTimeout(timer); resolve({}) }
      })
    }

    let rawSearchList = []
    const searchReqIds = new Set()

    ws.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.id && pending.has(msg.id)) {
          const entry = pending.get(msg.id)
          pending.delete(msg.id)
          if (msg.error) entry.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
          else entry.resolve(msg.result)
        }
        if (msg.method === 'Network.responseReceived') {
          const u = msg.params?.response?.url || ''
          if (u.includes('/api/search/general/full/') || u.includes('/api/search/item/full/') || u.includes('/api/search/video/full/')) {
            searchReqIds.add(msg.params.requestId)
          }
        }
        if (msg.method === 'Network.loadingFinished' && searchReqIds.has(msg.params.requestId)) {
          try {
            const bodyRes = await send('Network.getResponseBody', { requestId: msg.params.requestId }, 3000)
            if (bodyRes && bodyRes.body) {
              let text = bodyRes.body
              if (bodyRes.base64Encoded) text = Buffer.from(text, 'base64').toString('utf8')
              if (text.trim().startsWith('{')) {
                const data = JSON.parse(text)
                const list = data.data || data.item_list || data.search_data || []
                if (list.length > 0) rawSearchList = list
              }
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

    await Promise.all([
      send('Network.enable', { maxTotalBufferSize: 100000000, maxResourceBufferSize: 10000000 }, 3000),
      send('Page.enable', {}, 3000),
      send('Network.setUserAgentOverride', { userAgent: DESKTOP_UA, acceptLanguage: 'en-US,en;q=0.9,id;q=0.8', platform: 'Win32' }, 3000),
      send('Emulation.setUserAgentOverride', { userAgent: DESKTOP_UA, platform: 'Win32' }, 3000),
      send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, 3000)
    ])

    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'id'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        window.chrome = { runtime: {} };
      `
    }, 3000)

    const rawCookie = getStoredCookie()
    if (rawCookie) {
      const cookiePairs = rawCookie.split(';').map(c => c.trim()).filter(Boolean)
      const cookiesToSet = []
      for (const pair of cookiePairs) {
        const idx = pair.indexOf('=')
        if (idx > 0) {
          cookiesToSet.push({
            name: pair.substring(0, idx).trim(),
            value: pair.substring(idx + 1).trim(),
            domain: '.tiktok.com',
            path: '/'
          })
        }
      }
      if (cookiesToSet.length > 0) await send('Network.setCookies', { cookies: cookiesToSet }, 3000)
    }

    const searchUrl = `https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}`
    await send('Page.navigate', { url: searchUrl }, 5000)

    for (let poll = 0; poll < 12; poll++) {
      await new Promise(r => setTimeout(r, 1200))
      if (rawSearchList.length > 0) break

      try {
        const domRes = await send('Runtime.evaluate', {
          expression: `
            (() => {
              const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'));
              let tryAgainBtn = buttons.find(b => {
                const txt = (b.innerText || '').toLowerCase().trim();
                return txt === 'try again' || txt === 'refresh' || txt === 'coba lagi';
              });
              if (!tryAgainBtn) {
                const allEls = Array.from(document.querySelectorAll('*'));
                tryAgainBtn = allEls.find(el => el.children.length === 0 && (el.innerText || '').toLowerCase().trim() === 'try again');
              }
              if (tryAgainBtn) {
                tryAgainBtn.focus();
                ['mousedown', 'mouseup', 'click'].forEach(eventType => {
                  tryAgainBtn.dispatchEvent(new MouseEvent(eventType, { bubbles: true, cancelable: true, view: window, buttons: 1 }));
                });
              }
              const allLinks = Array.from(document.querySelectorAll('a[href*="/video/"]'));
              const nonNav = allLinks.filter(a => !a.closest('header, nav, aside, [data-e2e*="nav"], [data-e2e*="inbox"], [data-e2e*="notification"], [class*="DivSideNav"], [class*="DivInbox"]'));
              const seen = new Set();
              const results = [];
              for (const a of nonNav) {
                const m = a.href.match(/\\/video\\/(\\d+)/);
                if (!m) continue;
                const videoId = m[1];
                if (seen.has(videoId)) continue;
                seen.add(videoId);
                const card = a.closest('[data-e2e*="search"]') || a.closest('[class*="DivItemContainer"]') || a.parentElement;
                const desc = card ? (card.querySelector('[data-e2e*="desc"], [data-e2e*="caption"]')?.innerText || card.innerText) : '';
                const authorA = card ? card.querySelector('a[href*="/@"]') : null;
                const authorName = authorA ? authorA.innerText.trim() : '';
                results.push({
                  id: videoId,
                  desc: desc || 'TikTok Video',
                  author: {
                    nickname: authorName,
                    uniqueId: authorA?.href?.split('/@')?.[1]?.split('?')?.[0] || ''
                  }
                });
              }
              return results;
            })()
          `,
          returnByValue: true
        }, 3000)

        if (domRes?.result?.value && domRes.result.value.length > 0) {
          rawSearchList = domRes.result.value
          break
        }
      } catch (e) {}

      try { await send('Runtime.evaluate', { expression: 'window.scrollBy(0, 600);' }, 1500) } catch (e) {}
    }

    if (page > 1 && rawSearchList.length > 0) {
      const scrollSteps = (page - 1) * 2
      for (let s = 0; s < scrollSteps; s++) {
        await send('Runtime.evaluate', { expression: 'window.scrollBy(0, 1500);' })
        await new Promise(r => setTimeout(r, 800))
      }
    }

    try { ws.close() } catch (e) {}

    const parsedVideos = []
    const seenIds = new Set()
    const sourceType = rawSearchList.length > 0 && rawSearchList[0]?.item_list ? 'api' :
                       rawSearchList.length > 0 && (rawSearchList[0]?.item || rawSearchList[0]?.video) ? 'api' : 'dom'

    for (const item of rawSearchList) {
      const it = item.item || item
      if (!it || !it.id) continue
      if (seenIds.has(it.id)) continue
      seenIds.add(it.id)

      const author = it.author || {}
      const stats = it.stats || {}
      const desc = it.desc || it.title || ''
      const videoUrl = `https://www.tiktok.com/@${author.uniqueId || author.unique_id || 'user'}/video/${it.id}`
      const tags = (desc.match(/#[^\s#]+/g) || []).map(t => '#' + t.replace(/^#/, ''))

      parsedVideos.push({
        id: it.id,
        region: region,
        title: desc,
        upload_date: it.createTime ? new Date(it.createTime * 1000).toLocaleDateString() : 'N/A',
        hashtags: tags,
        stats: {
          views: stats.playCount !== undefined ? Number(stats.playCount).toLocaleString() : 'N/A',
          likes: stats.diggCount !== undefined ? Number(stats.diggCount).toLocaleString() : 'N/A',
          comments: stats.commentCount !== undefined ? Number(stats.commentCount).toLocaleString() : 'N/A',
          shares: stats.shareCount !== undefined ? Number(stats.shareCount).toLocaleString() : 'N/A',
          saves: stats.collectCount !== undefined ? Number(stats.collectCount).toLocaleString() : 'N/A'
        },
        author: {
          unique_id: author.uniqueId || author.unique_id || '',
          nickname: author.nickname || author.uniqueId || '',
          avatar: author.avatarLarger || author.avatarThumb || ''
        },
        cover: it.video?.cover || '',
        tiktok_url: videoUrl,
        _sourceType: sourceType
      })
    }

    return parsedVideos
  } finally {
    cleanupInstance()
  }
}

let isSearchBusy = false
const searchQueue = []

function executeWithLock(fn) {
  return new Promise((resolve, reject) => {
    searchQueue.push({ fn, resolve, reject })
    processQueue()
  })
}

async function processQueue() {
  if (isSearchBusy || searchQueue.length === 0) return
  isSearchBusy = true
  const task = searchQueue.shift()
  try { task.resolve(await task.fn()) }
  catch (err) { task.reject(err) }
  finally { isSearchBusy = false; processQueue() }
}

async function searchTikTok(keyword, page = 1, regionTarget = 'ID') {
  return executeWithLock(async () => {
    try {
      const rawVideos = await fetchTikTokSearchViaBrowser(keyword, page, regionTarget)
      const isDomSource = rawVideos.length > 0 && rawVideos[0]?._sourceType === 'dom'

      let topVideos
      if (isDomSource) {
        topVideos = rawVideos.slice(0, ITEMS_PER_PAGE).map(item => ({ item, score: 85, label: 'SEARCH_RESULT' }))
      } else {
        const enrichedVideos = await Promise.all(
          rawVideos.slice(0, 15).map(async (item) => {
            if (!item.title || item.title === 'TikTok Video' || item.title.trim().length === 0) {
              try {
                const [aweme, oemb] = await Promise.all([
                  fetchAwemeVideoDetails(item.id),
                  fetchOembedMeta(item.tiktok_url)
                ])
                if (oemb?.title) item.title = oemb.title
                else if (aweme?.desc) item.title = aweme.desc
                if (aweme?.author_username) item.author.unique_id = aweme.author_username
              } catch (e) {}
            }
            return item
          })
        )

        const evaluated = enrichedVideos
          .map(item => {
            const evalResult = evaluatePrecision(item, keyword, regionTarget)
            return { item, score: evalResult.score, label: evalResult.label }
          })
          .filter(entry => entry.score > 0)
          .sort((a, b) => b.score - a.score)

        const startIndex = (page - 1) * ITEMS_PER_PAGE
        topVideos = evaluated.slice(startIndex, startIndex + ITEMS_PER_PAGE)
        if (topVideos.length === 0 && evaluated.length > 0) topVideos = evaluated.slice(0, ITEMS_PER_PAGE)
        if (topVideos.length === 0 && enrichedVideos.length > 0) {
          topVideos = enrichedVideos.slice(startIndex, startIndex + ITEMS_PER_PAGE).map(item => ({ item, score: 60, label: 'SEARCH_RESULT' }))
        }
      }

      const results = []
      for (let i = 0; i < topVideos.length; i++) {
        const entry = topVideos[i]
        const item = entry.item
        const author = item.author || {}

        const [awemeDetail, oembed, dlInfo] = await Promise.all([
          fetchAwemeVideoDetails(item.id),
          fetchOembedMeta(item.tiktok_url),
          resolveDirectDownloads(item.tiktok_url)
        ])

        const finalTitle = oembed?.title || item.title
        const finalAuthorName = awemeDetail?.author_name || oembed?.author_name || author.nickname || author.unique_id
        const finalUsername = awemeDetail?.author_username || (oembed?.author_unique_id ? `@${oembed.author_unique_id}` : (author.unique_id ? `@${author.unique_id}` : '@user'))
        const finalAvatar = awemeDetail?.avatar || author.avatar || ''
        const finalCover = awemeDetail?.cover || oembed?.thumbnail_url || item.cover || ''
        const finalDynamicCover = awemeDetail?.dynamic_cover || ''
        const finalDuration = awemeDetail?.duration || 'N/A'
        const extractedHashtags = (finalTitle.match(/#[^\s#]+/g) || item.hashtags || [])

        results.push({
          accuracy: `${entry.score}% (${entry.label})`,
          region: item.region || regionTarget,
          title: finalTitle,
          upload_date: item.upload_date || 'N/A',
          duration: finalDuration,
          hashtags: extractedHashtags,
          stats: {
            views: awemeDetail?.views && awemeDetail.views !== 'N/A' ? awemeDetail.views : (item.stats?.views || 'N/A'),
            likes: awemeDetail?.likes && awemeDetail.likes !== 'N/A' ? awemeDetail.likes : (item.stats?.likes || 'N/A'),
            comments: awemeDetail?.comments && awemeDetail.comments !== 'N/A' ? awemeDetail.comments : (item.stats?.comments || 'N/A'),
            shares: awemeDetail?.shares && awemeDetail.shares !== 'N/A' ? awemeDetail.shares : (item.stats?.shares || 'N/A'),
            saves: awemeDetail?.saves && awemeDetail.saves !== 'N/A' ? awemeDetail.saves : (item.stats?.saves || 'N/A')
          },
          creator: {
            name: finalAuthorName,
            username: finalUsername,
            avatar: finalAvatar
          },
          audio: {
            title: awemeDetail?.music_title || `Original Sound - ${finalAuthorName}`,
            author: awemeDetail?.music_author || finalAuthorName,
            mp3_url: awemeDetail?.mp3_url || dlInfo?.mp3_url || ''
          },
          links: {
            tiktok_web: item.tiktok_url,
            stream_mp4_no_wm: dlInfo?.stream_mp4_no_wm || awemeDetail?.play_addr || '',
            stream_mp4_wm: awemeDetail?.play_addr || '',
            cover_image: finalCover,
            animated_gif: finalDynamicCover
          }
        })

        if (i < topVideos.length - 1) await new Promise(r => setTimeout(r, 150))
      }

      return results
    } catch (error) {
      return []
    }
  })
}

process.once('exit', cleanupAllResources)
process.once('SIGINT', () => { cleanupAllResources(); process.exit(0) })
process.once('SIGTERM', () => { cleanupAllResources(); process.exit(0) })

export default {
  name: "TikTok Search v2 (CDP Browser)",
  description: "TikTok search dengan CDP browser automation, precision scoring, multi-datacenter aweme enrich, oEmbed, direct download resolver (SSSTik/LoveTik)",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["query", "page", "region", "type", "count"],
  paramsSchema: {
    query: { type: "string", required: true, description: "Kata kunci pencarian", example: "ironman edit" },
    page: { type: "number", default: 1, required: false, description: "Halaman pencarian" },
    region: { type: "string", default: "ID", required: false, description: "Kode region (ID, US, MY, JP, ALL, dll)", enum: ["ID", "US", "MY", "JP", "VN", "TH", "SG", "PH", "KR", "GB", "ALL"] },
    type: { type: "string", enum: ["video", "photo"], default: "video", required: false },
    count: { type: "number", default: 5, required: false, description: "Jumlah hasil per halaman" }
  },

  async run(req, res) {
    try {
      const { query, page = 1, region = 'ID', type = 'video', count = 5 } = { ...req.query, ...req.body }

      if (!query) {
        return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi" })
      }

      if (!VALID_REGION_CODES.has(region.toUpperCase()) && region.toUpperCase() !== 'ALL' && region.toUpperCase() !== 'ANY' && region !== '*') {
        return res.status(400).json({ status: false, message: `Region '${region}' tidak valid. Gunakan: ID, US, MY, JP, ALL, dll` })
      }

      if (isSearchBusy) {
        return res.status(429).json({ status: false, message: "Search sedang sibuk, coba beberapa saat lagi", queue_length: searchQueue.length })
      }

      const results = await searchTikTok(query, parseInt(page) || 1, region.toUpperCase())

      return res.json({
        status: true,
        search_info: {
          keyword: query,
          current_page: parseInt(page) || 1,
          current_region: formatRegionLabel(region),
          items_per_page: parseInt(count) || ITEMS_PER_PAGE,
          total_items_found: results.length
        },
        data: results
      })
    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || "TikTok search failed" })
    }
  }
}
