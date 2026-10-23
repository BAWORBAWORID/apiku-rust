import 'dotenv/config';
import { connect } from 'puppeteer-real-browser';
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID, createHash } from 'crypto';

import { getChromePath } from '../../src/utils/chromePath.js';
process.env.CHROME_PATH = getChromePath() || process.env.CHROME_PATH;

let OSS;
try { OSS = (await import('ali-oss')).default; } catch { OSS = null; }

// ═══════════════════════════════════════════════════════════════════
// Default Qwen AI credentials (override via QWEN_EMAIL / QWEN_PASSWORD env vars)
// ═══════════════════════════════════════════════════════════════════
const QWEN_EMAIL = process.env.QWEN_EMAIL || '';
const QWEN_PASSWORD = process.env.QWEN_PASSWORD || '';

// ═══════════════════════════════════════════════════════════════════
// Shared browser + Qwen — auto-init saat module load (1x saja)
// ═══════════════════════════════════════════════════════════════════

let sharedBrowser = null;
let sharedQwen = null;
let sharedInitDone = false;

async function initShared() {
  if (sharedInitDone) return;

  try {
    const { browser } = await connect({
      headless: false,
      turnstile: false,
      connectOption: {
        executablePath: getChromePath(),
        defaultViewport: { width: 1280, height: 720 },
        timeout: 120000,
        protocolTimeout: 300000,
        args: [
          '--window-size=1280,720',
          '--no-sandbox', '--disable-setuid-sandbox',
          '--disable-dev-shm-usage', '--disable-gpu',
          '--disable-web-security',
          '--disable-blink-features=AutomationControlled',
        ],
      },
      disableXvfb: false,
    });

    sharedBrowser = browser;
    sharedQwen = new QwenClient({
      model: 'qwen3.6-plus',
      thinkingEnabled: false,
      autoSearch: false,
      email: QWEN_EMAIL,
      password: QWEN_PASSWORD,
    });

    const qwenPage = await browser.newPage();
    await qwenPage.setDefaultTimeout(120000);
    await qwenPage.setDefaultNavigationTimeout(120000);
    await qwenPage.setViewport({ width: 1280, height: 720 });
    sharedQwen.page = qwenPage;

    if (!QWEN_EMAIL || !QWEN_PASSWORD) {
      console.warn('[Shared] Qwen login dilewati: QWEN_EMAIL / QWEN_PASSWORD belum dikonfigurasi di .env');
    } else {
      try {
        await sharedQwen.browserLogin();
        console.log('[Shared] Qwen login berhasil saat module load');
      } catch (err) {
        console.warn('[Shared] Qwen login gagal:', err.message);
        console.warn('[Shared] Fallback: login akan dicoba per-request jika perlu');
      }
    }

    sharedInitDone = true;
  } catch (err) {
    console.error('[Shared] Init browser gagal:', err.message);
    sharedInitDone = false;
  }
}

initShared();

// ═══════════════════════════════════════════════════════════════════
// QwenClient — versi terbaru (guest, token, login)
// ═══════════════════════════════════════════════════════════════════

class QwenClient {
  constructor(options = {}) {
    this.baseUrl = 'https://chat.qwen.ai';
    this.model = options.model || 'qwen3.6-plus';
    this.thinkingEnabled = options.thinkingEnabled ?? true;
    this.autoSearch = options.autoSearch ?? true;
    this.token = options.token || null;
    this.email = options.email || null;
    this.password = options.password || null;
    this.guestMode = !options.token && !options.email && !options.password;
    this.page = options.page || null;
  }

  // ─── Browser-based API ──────────────────────────────────────────

  async _browserFetch(endpoint, bodyData) {
    if (!this.page) throw new Error('Qwen browser page not initialized');
    const result = await this.page.evaluate(async (ep, data) => {
      const token = localStorage.getItem('token') || localStorage.getItem('access_token') || '';
      const headers = {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Version': '0.2.57',
        'source': 'h5',
        'Timezone': new Date().toString(),
        'bx-v': '2.5.36',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`https://chat.qwen.ai${ep}`, {
        method: 'POST', headers, body: JSON.stringify(data),
      });
      return { ok: res.ok, status: res.status, text: await res.text() };
    }, endpoint, bodyData);
    if (!result.ok) throw new Error(`Qwen API ${endpoint} error: ${result.text.substring(0, 200)}`);
    return JSON.parse(result.text);
  }

  async _browserFetchStream(endpoint, bodyData) {
    if (!this.page) throw new Error('Qwen browser page not initialized');
    return this.page.evaluate(async (ep, data) => {
      const token = localStorage.getItem('token') || localStorage.getItem('access_token') || '';
      const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Accel-Buffering': 'no',
        'Accept-Language': 'en-US,en;q=0.9',
        'Version': '0.2.57',
        'source': 'h5',
        'Timezone': new Date().toString(),
        'bx-v': '2.5.36',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`https://chat.qwen.ai${ep}`, {
        method: 'POST', headers, body: JSON.stringify(data),
      });
      if (!res.ok) return 'ERROR:' + res.status;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '', answer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === '[DONE]') continue;
          try {
            const chunk = JSON.parse(raw);
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.phase === 'answer' && delta.content) answer += delta.content;
          } catch {}
        }
      }
      return answer;
    }, endpoint, bodyData);
  }

  async browserLogin() {
    if (!this.page) throw new Error('Qwen browser page not initialized');
    const page = this.page;

    await page.goto('https://chat.qwen.ai/auth?action=signin', {
      waitUntil: 'load', timeout: 60000,
    });
    await new Promise(r => setTimeout(r, 2000));

    const hasToken = await page.evaluate(() => {
      try { return !!localStorage.getItem('token'); } catch { return false; }
    });

    if (hasToken) {
      this.token = await page.evaluate(() => localStorage.getItem('token'));
      console.log('[QwenClient] Already logged in (browser)');
      return;
    }

    if (!this.email || !this.password) {
      throw new Error('Email atau password Qwen belum dikonfigurasi (isi QWEN_EMAIL dan QWEN_PASSWORD di .env)');
    }

    // Switch ke login password jika saat ini berada di tampilan login OTP/verification code
    const switchBtn = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('button, div, a'));
      return btns.find(b => /Log in with a password/i.test(b.innerText || ''));
    });
    if (switchBtn.asElement()) {
      await switchBtn.asElement().click().catch(() => {});
    }
    await new Promise(r => setTimeout(r, 1500));

    // Tunggu input password ter-render di DOM
    await page.waitForSelector('input[name="password"]', { timeout: 15000 });

    await page.$eval('input[name="email"]', (el, v) => {
      const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
    }, this.email);
    await new Promise(r => setTimeout(r, 300));

    await page.$eval('input[name="password"]', (el, v) => {
      const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
    }, this.password);
    await new Promise(r => setTimeout(r, 1000));

    // Klik tombol Sign in
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const submitBtn = btns.find(b => b.innerText && /Sign in|Continue|Submit/i.test(b.innerText.trim()));
      if (submitBtn) submitBtn.click();
    });
    await new Promise(r => setTimeout(r, 15000));

    this.token = await page.evaluate(() => {
      try { return localStorage.getItem('token'); } catch { return null; }
    });

    if (!this.token) {
      await page.screenshot({ path: '/tmp/qwen_login_fail.png' });
      throw new Error('Qwen login gagal (browser)');
    }

    console.log('[QwenClient] Login berhasil (browser)');
    await page.goto('https://chat.qwen.ai/', { waitUntil: 'load', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2000));
  }

  // ─── Legacy Node.js fetch methods (fallback) ────────────────────

  _hashPassword(plain) {
    return createHash('sha256').update(plain).digest('hex');
  }

  async login(email, password) {
    const em = email || this.email;
    const pw = password || this.password;
    if (!em || !pw) throw new Error('email dan password wajib diisi');
    const res = await fetch(`${this.baseUrl}/api/v2/auths/signin`, {
      method: 'POST',
      headers: this._getBaseHeaders(),
      body: JSON.stringify({ email: em, password: this._hashPassword(pw) }),
    });
    const json = await res.json();
    if (!json.success) throw new Error('Login failed: ' + JSON.stringify(json));
    this.token = json.data.token;
    this.userId = json.data.id;
    this.expiresAt = json.data.expires_at;
    this.guestMode = false;
    return json.data;
  }

  async _ensureAuth() {
    if (this.page) {
      const hasToken = await this.page.evaluate(() => {
        try { return !!localStorage.getItem('token'); } catch { return false; }
      });
      if (hasToken) return;
      if (this.email && this.password) { await this.browserLogin(); return; }
      throw new Error('Belum login (browser)');
    }
    if (this.guestMode) return;
    if (this.token) return;
    if (this.email && this.password) { await this.login(); return; }
    throw new Error('Belum login.');
  }

  _getBaseHeaders() {
    return {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Version': '0.2.57',
      'source': 'h5',
      'X-Request-Id': randomUUID(),
      'Timezone': new Date().toString(),
      'bx-v': '2.5.36',
    };
  }

  _getBxHeaders() {
    return {
      'bx-umidtoken': this.bxUmidtoken || 'T2gADAC71QNAtYaOv1YPlxdx1O4AG-lzInSfQUshNSBjRkA_I-yA4gORDzFvkuqmjVI=',
      'bx-ua': this._pickBxUa(),
      'bx-v': '2.5.36',
    };
  }

  _pickBxUa() {
    if (this.bxUa) return this.bxUa;
    const pool = [
      '231!YA03f+mUPBR+joF+fk3OmdGjUq/YvqY2leOxacSC80vTPuB9lMZY9mRWFzrwLE2ZjAyWrjyX3x1x24qGF/JmJRUW8k0G0Yw2/rJn1AXfJJmkIaLzE0V3Jm3+rTsItXe2qIDZyX9A0rRJ0QhlxRZxe5SDrgkDAP/K/VtYnM7/z9T5W/xvHJb6sBks7XVgflJ7yeS+wDHqJER06V+qeHeqn/c1EgNxYOlx3ko10QD3yE3oHFx4E+cLwqWCCfk+++3+qiz4nUKfj4m8Le+46wtmSCK8sejO9A++vCz+lU9244msCi+468z+jCgUxVn99+mLsCG4+IeWykMUPBS+s8po+KFU+jTa9NGjNCFhBIQd++mUv1++TZA+kVFg3+j090koqCS4kJB8n8ehFAk3+pxVYfVmkkkmED415o3kp7Y5vVr2RNPutMvjeEuvUaqMBIFK7RuphGQgUmQtpN0iYkPoqeRRJtkA0eC9RK8wsWSM8ipTNlYYu2GIv6Q2a2QdGPNBhL6xcHaLNgpdGra7n5w7bbFHzohUPB7VvgMG9Bm7yay4A/fo5PHkJWX15cAdDE32fcwBPq0oaT+o9AqZd38n7oXiMB+cXyv29D1BsLe7zOfGOtvYrTwtkDQQjm1buPrSKiGa3aMapr2jv9oXXqStd1KQ/ZmVH9iBlkDOpZtUGc55fq9Y3bcQ52SG++AvhYMySwfCPP57NhAnWQavxNUXRULzNODtQOQ7HNC8REtbfqmw7HbEqRxtoaPqyVfp9EjodQ4cXziD23Fa2/ACMDDsvI/RBJfzCIyLFuKYHJVd5+awJKZkF8nR7QdIhbT8TsddADap74DhefNSHhWod28duBkchksbq5iAbKspmwhxWzznIg5rOcPyS6P9f5buSIDdHZtVwARS7wwapcs/xoU94vkAQGbcJSKE0Y6rlSwPzcFP3qjDohowT1AcN3sL0fqj2at8jaozVt1+qS7O9NEYhWP3ZZQMKRYT/ofE/6CJdD+PvcQoPDyOWMlUfLKHv38wJCYzeVYi2fUkiV3SOa5HGkwyW+tFrf9lJGFJ55uymm1p6yjiNpTrp8a5p2EJP4O8OysSBDAG5gNUNJS8AvDyenLs8Wnavrn8L1yEqgMNqNJ/Q3StKzTXN4aWpplt4T0PE/o2Kydk/qdmcUPOSXbKUvFrUDB6klpns0mR059iPyxYQzzh61YandnvJJ2I2LmjzAkuTC08aJXS++nq5d6zifKjASZvjx0eBmBB/MfzFiyCoTzdE4dCEpa6eOuQeDhXsa1hKoHwFenumAvY+45dFHQwuafBaaX9pnyYOoaNTOV3Y6Bee0k39hLtyX+G6aV/qvtbV1L9v2B8tj3fPVIqcubNDExRtIh9Ic4Ee2yFeIHeZ5o/MptfxJVNoFTnwb0dSmxYj3iuLikX/a3rfsKPOh3hGEyTwrk0JT9ropZWl1Fl8+fRRoSCUWSv6pqYHhZir4Nhr/pDAWeEr7a+U63GJ/fNTP0DCFf9v5DOvBIFisU6UBBc8xW9N2DZ7M2gTHcboPCw5EGD3yRxrF+HZPLRvbcs2Qa0tK+BfP1LAKw4icHDjB8I',
      '231!E6v3u4mU8RB+joqBl47/qgRjUqp0h7B0VexF7m2/f1/S2MIhO5riNiekdwI4lfdYzMVILB1aw3EGPSUF3kKmZ8lPiAIfiP5ggDTsMqhdbDRP2VwVGrcFQnSuePu45kjz2dZoVXXAbtm2PSK0XMYTb9IZu/4oZRDBn6U1BbeXMvFwJBWqMXPv7IEpm+xE0lsa14X6ZNRlZP56er1LW7myBDTn7RmTqvReDag9gqzOq4iN4Ojmd035PhjG1jRDGMzL9EVCgXAw5Yznr1weeiLK1z8buXPoYcCL0FRM3ko10QD3yE3oHFx4E+cLwqWCCU3+++3+qiG+KPmRj4oeir+46bz++yHW+Iea9sG8qCz++IeX+4j7s/kk6wB3+KgCjTAO9a4jY0BA5ltWsrFWqA++6I3j+JU0hnj0V+/oqCS++8Tc+7n3Yai+6fE++ySSD+m09+z+8kGk3IeW+mlgqA+4FwG8rgi4FAk3kDfAwjWcDOwPjzPicxmeGf1xR8U/L2O5q5PJO9vsPZ6oVz4nav7ELXCNLovG3va8hmCveA8WDk6OehEK8pxUmAQik/bKYGSHzNVHaNzadFFMUDhUMGcTnqRrCaMr+LAcmyX8LzE04ssfXbXCYFotV2dSdIWwnAEg5kjSdMpgshW3Hmzla2ln3ejyYxMXCisCVbwPkk3d0cJfFdaH/w65T2kEWSjMkmhDnbx5ew0JP/Fu8GYKncmljC7jjc0nJnx0KeiMwBLYMH3jlnSsTBzPeCRTP9qfwJzrIHmeCVWTjVou9AvMcayRzW4KxQDl6LEZ8eghIdL4lHVGIgHVFEuEp6OwXA/uXMbjPKduHdvqP/NZTUTPPYPidRh2Kb4/2p8svGl4YSK4oXGNAYe2W5xoC+Mrja/0YHVHRKghunv/ixHcFsA+2+o6ZodP8CL75YHv7SDEpM/GZtRLd7h0sxWI4s+h/YS5v2C5xVVD1QKjLQpkGoz0kAhads3pDHp3z7vW7ISZmTD22JOckykmjh6AqDpyK8rfu4URZxLkqHWm7+ZaYH07UaJfCGJHUHO6azS/nRlsUGZiIDjxQs51QcE7MMv0FX/rCxza6+HeKKYddDOq/YQPcPd2eoybB2k6yWCSh10RjwG/U1GhZiXfMadWVFFDtNzl9s92kckfbbSWRMdSON11NejPbyQIYaZIp2o24FuzqfzGZCKczzeuIXyUTTYM+kdyNlR4YZ0emdi6bXE8DpyLTTOWmcDHVlNV6rrAtW+yP/v1R5CNu75/lnAV3Vy1IoPc05CS8+XQ610Ho0fgt8rafLeHlkb9DxbX6wBIv1K/7NK6yDop9MelHR1B2j+XMdith/Jctb31I7QFDOuDLiSH3OL5jMZQHgG3WnMABDxfxRZ4ur/3h2fj3cuRTNuTb+FnWxHuDrDXESbHp9q2EAKLKHDuGhpscoZdqSUDmBEhec5T/vEqUofT+9WytcjEWN/Nn0KgQ7QTKAWS9LgXG/FSOO2IbUaRJODBOk2XdTt3rLdvtCyGrJN+WiceiZtI0AtiJxAhKjsi9cOaE2FZmB+bJ8Pci/YHMzwJR3x8LoFFvLqGSYpd0wZsUwX6GAAXi0hPdLRww0DAhJjiMHW0rSahGo4k8cA=',
      '231!cMv3VAmUIoB+jjEkfA3ORhzjUq/YvqY2leOxacSC80vTPuB9lMZY9mRWFzrwLE2ZjAyWrjyX3x1x24qGF/JmJRUW8k0G0Yw2/rJn1AXfJJmkIaLzE0V3Jm3+rTsItXe2qImKr5ix7FBMGmC+6mE9W2MCGuc07roLwyJ14gU6QsEtnLdPAfcmr6INhKaQEMfboZhLGbGIRRPDoT6V+oBqNzEvkO3xzQbdEjD+zu8rjmdj+gxs0h+hblKdHgci+++j+yzF+I2AO+R+pSRk3ItW++mgqAj06fgFjXgW++j0Lk3+eFnDDInKj+IWHkrSwbup+K6y/DzO9HRUqCz++Iei+4mYsopA6D4m+XgU++j594jRiy6z4IQd++mUIo++s8kM+jEJDjj09A+GNCz+3IlZjpF3PPGDjDoTzm49qrwntAL7G96A0FTzuOjcl8Y6vXE2lsbfJtBx4EL33sfj98NgXaAfJj8wV5kHf3Sjd1DI6RrdIVcwYAG8Svm7UXFIJNyBFsXNwdUx1Y1oc1HhrRG2CG7ex1H69wk7QLfobzj9rZiYjO5ztxo+UatDXK1/XPEZam1Uxo0UbIDk1BLTGry4wZIkf0rbSL5vym2Jbw0AZ0eaiiVFXVaxfLrJcn2+S8lxnMjSIbzdb5TW3p0LGs1FbqS9MxAEw4PrwQOdGGBvj4qrqY3PWcU77LsjNfdXwRhMe5qmHVljEj/4bYiEgdGXrPFQds8h+sg3M2+SzzwnDWcQB71KLbR2i0BSEMwpuaHauIHdQfzFCQFinXdZz2Wy/rD9tQYD6PGT7dIVUBgXhSjLmlqRB2JIttc+/U1Sfq+RsujJ3FH5wu7hfpl7l5dd0oEvfIdy+88U6W/YDY5nEacMf+x4MRXIHJz3i1LdKnTdMehlOH+n8Ch8W1zw+5gm/QIbjz4DGx+J+8X3HueJmf3N048CVsIdjADEpcB6pc835e4/0v7LKRP9jndP+cAk2bPufUjK8mNGIauhosf/YGcKd3eJ35BrwsY6gaJzYBCgZrzucPdd+coTxpv7owLqdFbYYzhipk7x6NeMTtg1hHfNOBIDstKf75ofqeHQrz4dzB2ZuzYlRe3WVAF0E25uo9kN2WAoB1uRt/XFi3/UUfMzyQK4pa6ofqyVOORifwKC7jMhHx+P8xG9gUzwOMS2lJWeXXlJl48WXMZbZ4uuFOTYJH3x1UYnFZgWdfbFUffPTJDScsxFENPGXky6FPsqJ+1Ts/Ef4m9W5REHN6F6nQc+n7WIfJMZlXEiBx6LThdO9ZxrcRKp7ARy2VIiVw231V+PV22CerShdiGuVE6nqZV9x9g79ksa2J2EqF+xVlEEEpdPO1c+eXo4bSWJt5UBfmzv36u64eKeIgdAwXrwIg9F6ZD+xFzIrk1BhZ0K4C2wDoQsxzbSeNc7TPxtrkBu52cxUML8+1W/9U2GZxKbYDBfX3/s2i+SalSR64ZUhrYU0ZaLnw2xOEjfUY5B56GCeY4MMwqjZEoFXlAyor6sWN2qTxt0mriOEihdqGAeDnWRyoDjC9gBfkmV5fmPoRRbUrdGA==',
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  _getHeaders(extra = {}) {
    return {
      ...this._getBaseHeaders(),
      ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
      ...extra,
    };
  }

  _chatMode() {
    return this.guestMode ? 'guest' : 'normal';
  }

  // ─── Image Upload ─────────────────────────────────────────────

  async _getStsToken(filename, filesize, filetype = 'image') {
    if (this.page) {
      const json = await this._browserFetch('/api/v2/files/getstsToken', { filename, filesize, filetype });
      if (!json.success) throw new Error('getStsToken failed: ' + JSON.stringify(json));
      return json.data;
    }
    const res = await fetch(`${this.baseUrl}/api/v2/files/getstsToken`, {
      method: 'POST',
      headers: this._getHeaders(this._getBxHeaders()),
      body: JSON.stringify({ filename, filesize, filetype }),
    });
    const json = await res.json();
    if (!json.success) throw new Error('getStsToken failed: ' + JSON.stringify(json));
    return json.data;
  }

  async _uploadToOss(buffer, sts, contentType) {
    if (!OSS) throw new Error('ali-oss not installed. Run: npm install ali-oss');
    const client = new OSS({
      region: sts.region,
      accessKeyId: sts.access_key_id,
      accessKeySecret: sts.access_key_secret,
      stsToken: sts.security_token,
      bucket: sts.bucketname,
      endpoint: `https://${sts.endpoint}`,
      secure: true,
    });
    await client.put(sts.file_path, buffer, {
      headers: { 'Content-Type': contentType },
    });
  }

  async uploadImage(filePathOrBuffer, filename, contentType) {
    await this._ensureAuth();

    let buffer, fname = filename, ctype = contentType;

    if (Buffer.isBuffer(filePathOrBuffer)) {
      buffer = filePathOrBuffer;
      if (!fname) throw new Error('filename wajib saat passing Buffer');
    } else {
      buffer = fs.readFileSync(filePathOrBuffer);
      fname = fname || path.basename(filePathOrBuffer);
    }

    if (!ctype) {
      const mimeMap = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.png': 'image/png', '.gif': 'image/gif',
        '.webp': 'image/webp', '.bmp': 'image/bmp',
      };
      ctype = mimeMap[path.extname(fname).toLowerCase()] || 'image/jpeg';
    }

    const sts = await this._getStsToken(fname, buffer.length, 'image');
    await this._uploadToOss(buffer, sts, ctype);

    const now = Date.now();
    return {
      type: 'image',
      file: {
        created_at: now,
        data: {},
        filename: fname,
        hash: null,
        id: sts.file_id,
        user_id: this.userId || null,
        meta: { name: fname, size: buffer.length, content_type: ctype },
        update_at: now,
      },
      id: sts.file_id,
      url: sts.file_url,
      name: fname,
      collection_name: '',
      progress: 0,
      status: 'uploaded',
      greenNet: 'success',
      size: buffer.length,
      error: '',
      itemId: randomUUID(),
      file_type: ctype,
      showType: 'image',
      file_class: 'vision',
      uploadTaskId: randomUUID(),
    };
  }

  // ─── Chat ─────────────────────────────────────────────────────

  async createChat(title = 'New Chat') {
    await this._ensureAuth();
    if (this.page) {
      const json = await this._browserFetch('/api/v2/chats/new', {
        title, models: [this.model], chat_mode: this._chatMode(),
        chat_type: 't2t', timestamp: Date.now(), project_id: '',
      });
      if (!json.success) throw new Error('Failed to create chat: ' + JSON.stringify(json));
      return json.data.id;
    }
    const res = await fetch(`${this.baseUrl}/api/v2/chats/new`, {
      method: 'POST',
      headers: this._getHeaders(this._getBxHeaders()),
      body: JSON.stringify({
        title,
        models: [this.model],
        chat_mode: this._chatMode(),
        chat_type: 't2t',
        timestamp: Date.now(),
        project_id: '',
      }),
    });
    const json = await res.json();
    if (!json.success) throw new Error('Failed to create chat: ' + JSON.stringify(json));
    return json.data.id;
  }

  _featureConfig() {
    return {
      thinking_enabled: this.thinkingEnabled,
      output_schema: 'phase',
      research_mode: 'normal',
      auto_thinking: true,
      thinking_mode: 'Auto',
      thinking_format: 'summary',
      auto_search: this.autoSearch,
    };
  }

  _buildMessages(history, userMessage, files = [], parentId = null) {
    const messages = [];
    for (const msg of history) {
      messages.push({
        fid: randomUUID(),
        parentId: null,
        childrenIds: [],
        role: msg.role,
        content: msg.content,
        user_action: 'chat',
        files: msg.files || [],
        timestamp: Math.floor(Date.now() / 1000),
        models: [this.model],
        chat_type: 't2t',
        feature_config: this._featureConfig(),
        extra: { meta: { subChatType: 't2t' } },
        sub_chat_type: 't2t',
        parent_id: null,
      });
    }
    messages.push({
      fid: randomUUID(),
      parentId,
      childrenIds: [randomUUID()],
      role: 'user',
      content: userMessage,
      user_action: 'chat',
      files,
      timestamp: Math.floor(Date.now() / 1000),
      models: [this.model],
      chat_type: 't2t',
      feature_config: this._featureConfig(),
      extra: { meta: { subChatType: 't2t' } },
      sub_chat_type: 't2t',
      parent_id: parentId,
    });
    return messages;
  }

  async _doRequest(chatId, messages, parentId = null) {
    if (this.page) {
      const answer = await this._browserFetchStream(`/api/v2/chat/completions?chat_id=${chatId}`, {
        stream: true,
        version: '2.1',
        incremental_output: true,
        chat_id: chatId,
        chat_mode: this._chatMode(),
        model: this.model,
        parent_id: parentId,
        messages,
        timestamp: Date.now(),
      });
      return { answer, thinking: null, responseId: null, usage: null };
    }
    const res = await fetch(
      `${this.baseUrl}/api/v2/chat/completions?chat_id=${chatId}`,
      {
        method: 'POST',
        headers: this._getHeaders({
          'Accept': 'application/json',
          'X-Accel-Buffering': 'no',
          ...this._getBxHeaders(),
        }),
        body: JSON.stringify({
          stream: true,
          version: '2.1',
          incremental_output: true,
          chat_id: chatId,
          chat_mode: this._chatMode(),
          model: this.model,
          parent_id: parentId,
          messages,
          timestamp: Date.now(),
        }),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res;
  }

  async sendMessage(chatId, userMessage, opts = {}) {
    await this._ensureAuth();
    const messages = this._buildMessages(opts.history || [], userMessage, opts.files || [], opts.parentId || null);
    const res = await this._doRequest(chatId, messages, opts.parentId || null);
    if (this.page) return res; // already parsed
    return this._parseSSE(res.body);
  }

  async sendMessageStream(chatId, userMessage, onChunk, opts = {}) {
    await this._ensureAuth();
    const messages = this._buildMessages(opts.history || [], userMessage, opts.files || [], opts.parentId || null);
    const res = await this._doRequest(chatId, messages, opts.parentId || null);
    if (this.page) {
      if (res.answer) onChunk(res.answer, 'answer');
      return res;
    }
    return this._parseSSEStream(res.body, onChunk);
  }

  async _parseSSE(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let answer = '';
    let thinking = '';
    let responseId = null;
    let usage = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        let chunk;
        try { chunk = JSON.parse(raw); } catch { continue; }

        if (chunk.response_id && !responseId) responseId = chunk.response_id;
        if (!chunk.choices) continue;
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.phase === 'answer' && delta.content) answer += delta.content;
        else if (delta.phase === 'thinking_summary') {
          const t = delta.extra?.summary_thought?.content;
          if (Array.isArray(t)) thinking += t.join('\n');
        }
        if (chunk.usage) usage = chunk.usage;
      }
    }
    return { answer, thinking: thinking || null, responseId, usage };
  }

  async _parseSSEStream(body, onChunk) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let answer = '';
    let thinking = '';
    let responseId = null;
    let usage = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        let chunk;
        try { chunk = JSON.parse(raw); } catch { continue; }

        if (chunk.response_id && !responseId) responseId = chunk.response_id;
        if (!chunk.choices) continue;
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.phase === 'answer' && delta.content) {
          answer += delta.content;
          onChunk(delta.content, 'answer');
        } else if (delta.phase === 'thinking_summary' && delta.extra?.summary_thought?.content) {
          const t = delta.extra.summary_thought.content;
          if (Array.isArray(t)) thinking = t.join('\n');
          if (delta.status === 'finished') onChunk(thinking, 'thinking');
        }
        if (chunk.usage) usage = chunk.usage;
      }
    }
    return { answer, thinking: thinking || null, responseId, usage };
  }

  async createSession(chatId) {
    const id = chatId || await this.createChat();
    let parentId = null;
    const send = async (message, opts = {}) => {
      const result = await this.sendMessage(id, message, { ...opts, parentId });
      if (result.responseId) parentId = result.responseId;
      return result;
    };
    const sendStream = async (message, onChunk, opts = {}) => {
      const result = await this.sendMessageStream(id, message, onChunk, { ...opts, parentId });
      if (result.responseId) parentId = result.responseId;
      return result;
    };
    return { chatId: id, send, sendStream, getParentId: () => parentId };
  }

  async chat(userMessage) {
    const chatId = await this.createChat();
    const result = await this.sendMessage(chatId, userMessage);
    return { chatId, ...result };
  }

  async chatStream(userMessage, onChunk) {
    const chatId = await this.createChat();
    const result = await this.sendMessageStream(chatId, userMessage, onChunk);
    return { chatId, ...result };
  }

  async chatWithImage(question, image, filename) {
    const chatId = await this.createChat();
    const fileObj = await this.uploadImage(image, filename);
    const result = await this.sendMessage(chatId, question, { files: [fileObj] });
    return { chatId, fileObj, ...result };
  }
}


// ═══════════════════════════════════════════════════════════════════
// RecaptchaV2Solver — SEKARANG DENGAN OPSI QWEN (guest/token/login)
// ═══════════════════════════════════════════════════════════════════

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

class RecaptchaV2Solver {
  /**
   * @param {object} opts
   * @param {string} [opts.qwenModel]   - model Qwen (default 'qwen3.6-plus')
   * @param {string} [opts.qwenToken]   - token Qwen (jika ada, mode token)
   * @param {string} [opts.qwenEmail]   - email Qwen (jika login)
   * @param {string} [opts.qwenPassword]- password Qwen (jika login)
   * @param {number} opts.timeout       - ms tunggu token (default 120000)
   * @param {boolean} opts.record       - aktifkan screen recording (default false)
   * @param {string}  opts.recordDir    - folder simpan recording (default './recordings')
   * @param {object}  opts.proxy        - { host, port, username, password }
   * @param {number}  opts.width        - viewport width (default 1280)
   * @param {number}  opts.height       - viewport height (default 720)
   * @param {number}  opts.maxAttempts  - max retry image challenge (default 5)
   */
  constructor(opts = {}) {
    // Inisialisasi QwenClient dengan opsi dari pengguna (fallback ke default/env)
    this.qwen = new QwenClient({
      model: opts.qwenModel || 'qwen3.6-plus',
      thinkingEnabled: false,
      autoSearch: false,
      token: opts.qwenToken || null,
      email: opts.qwenEmail || QWEN_EMAIL,
      password: opts.qwenPassword || QWEN_PASSWORD,
    });

    this.timeout      = opts.timeout      ?? 120000;
    this.record       = opts.record       ?? false;
    this.recordDir    = opts.recordDir    ?? path.join(process.cwd(), 'recordings');
    this.proxy        = opts.proxy        ?? null;
    this.width        = opts.width        ?? 1280;
    this.height       = opts.height       ?? 720;
    this.maxAttempts  = opts.maxAttempts  ?? 5;

    this.browser = null;
    this.isReady = false;
  }

  // ─── Browser lifecycle ────────────────────────────────────────────────────

  async _ensureBrowserHealthy() {
    if (!sharedBrowser || sharedBrowser.isClosed?.() === true) {
      sharedBrowser = null;
      sharedInitDone = false;
      sharedQwen = null;
    }
    
    // Test if browser is still responsive
    if (sharedBrowser) {
      try {
        await sharedBrowser.version();
      } catch (e) {
        sharedBrowser = null;
        sharedInitDone = false;
        sharedQwen = null;
      }
    }
    
    if (!sharedBrowser) {
      await initShared();
    }
  }

  async initialize() {
    if (this.isReady) {
      await this._ensureBrowserHealthy();
      this.browser = sharedBrowser;
      return;
    }

    await this._ensureBrowserHealthy();
    this.browser = sharedBrowser;
    this.isReady = true;

    const useCustomAuth = this.qwen.token || (this.qwen.email !== QWEN_EMAIL) || (this.qwen.password !== QWEN_PASSWORD);
    if (useCustomAuth) {
      const qwenPage = await this.browser.newPage();
      await qwenPage.setViewport({ width: 1280, height: 720 });
      this.qwen.page = qwenPage;
      try {
        await this.qwen.browserLogin();
      } catch (err) {
        console.warn('[RecaptchaV2] Qwen login warning:', err.message);
      }
    } else {
      this.qwen = sharedQwen;
    }
  }

  async cleanup() {
    this.isReady = false;
  }

  // ─── Recording ───────────────────────────────────────────────────────────

  async _startRecording(page, label) {
    if (!this.record) return null;
    ensureDir(this.recordDir);

    const safe   = label.replace(/[^a-z0-9_-]/gi, '_');
    const output = path.join(this.recordDir, `${safe}_${Date.now()}.mp4`);

    const recorder = new PuppeteerScreenRecorder(page, {
      followNewTab: true,
      fps: 25,
      videoFrame: { width: this.width, height: this.height },
      videoCrf: 18,
      videoCodec: 'libx264',
      videoPreset: 'ultrafast',
      aspectRatio: '16:9',
    });

    await recorder.start(output);
    return { recorder, output };
  }

  async _stopRecording(rec) {
    if (!rec) return;
    try { await rec.recorder.stop(); } catch (err) {
      console.warn('[RecaptchaV2] Failed to stop recording:', err.message);
    }
  }

  // ─── Page helpers ─────────────────────────────────────────────────────────

  async _newPage() {
    const page = await this.browser.newPage();
    await page.setDefaultTimeout(30000);
    await page.setDefaultNavigationTimeout(60000);
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    if (this.proxy?.username && this.proxy?.password) {
      await page.authenticate({
        username: this.proxy.username,
        password: this.proxy.password,
      });
    }
    return page;
  }

  async _waitForAnchorFrame(page, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const anchor = page.frames().find(f =>
        f.url().includes('/recaptcha/') && f.url().includes('anchor')
      );
      if (anchor) return anchor;
      await sleep(300);
    }
    const urls = page.frames().map(f => f.url());
    throw new Error(`Timeout: anchor frame tidak muncul. Frames: ${JSON.stringify(urls)}`);
  }

  async _waitForBframe(page, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const bframe = page.frames().find(f =>
        f.url().includes('/recaptcha/') && f.url().includes('bframe')
      );
      if (bframe) return bframe;
      await sleep(300);
    }
    return null;
  }

  async _waitForToken(page) {
    const deadline = Date.now() + this.timeout;
    while (Date.now() < deadline) {
      const token = await page.evaluate(() => {
        const ta = document.querySelector(
          '#g-recaptcha-response, textarea[name="g-recaptcha-response"]'
        );
        return ta?.value ?? null;
      });
      if (token && token.length > 20) return token;
      await sleep(800);
    }
    throw new Error('Timeout: g-recaptcha-response tidak terisi');
  }

  async _clickCheckbox(page) {
    await page.waitForSelector('iframe[src*="recaptcha"][src*="anchor"]', {
      timeout: 20000,
    });
    await sleep(2500);

    const anchorFrame = await this._waitForAnchorFrame(page, 15000);
    await anchorFrame.waitForSelector('#recaptcha-anchor', { timeout: 10000 });
    await sleep(500 + Math.random() * 700);
    await anchorFrame.click('#recaptcha-anchor');
  }

  // ─── Qwen image challenge solver ─────────────────────────────────────────

  async _getChallengeInfo(bframe) {
    return bframe.evaluate(() => {
      const desc = document.querySelector(
        '.rc-imageselect-desc-no-canonical, .rc-imageselect-desc'
      );
      const table = document.querySelector(
        '.rc-imageselect-table-44, .rc-imageselect-table-33'
      );
      if (!desc || !table) return null;

      const strong = desc.querySelector('strong');
      const promptText = strong
        ? strong.textContent.trim()
        : (desc.textContent.match(/Select all images with (.*?)(?:$|\.)/i)?.[1] ?? '').trim();

      return {
        promptText,
        gridType: table.className.includes('44') ? '4x4' : '3x3',
      };
    });
  }

  async _analyzeWithQwen(bframe, promptText, gridType) {
    const challengeArea = await bframe.$('.rc-imageselect-challenge');
    if (!challengeArea) return [];

    const tmpPath = path.join(os.tmpdir(), `rcap_${Date.now()}.png`);
    await challengeArea.screenshot({ path: tmpPath });

    try {
      const gridDesc = gridType === '4x4'
        ? `[1,1][1,2][1,3][1,4] / [2,1][2,2][2,3][2,4] / [3,1][3,2][3,3][3,4] / [4,1][4,2][4,3][4,4]`
        : `[1,1][1,2][1,3] / [2,1][2,2][2,3] / [3,1][3,2][3,3]`;

      const prompt = `You are solving a reCAPTCHA image challenge.
Task: Select all tiles that contain "${promptText.toUpperCase()}".
Grid layout (row, column) — rows top to bottom: ${gridDesc}

For each tile, respond ONLY with a JSON object like:
{"[1,1]": true, "[1,2]": false, ...}
where true = tile contains the object, false = does not.
Respond with JSON only, no markdown, no explanation.`;

      const { answer } = await this.qwen.chatWithImage(prompt, tmpPath, 'recaptcha.png');
      let text = answer.trim();
      text = text.replace(/```json|```/g, '').trim();

      const parsed = JSON.parse(text);
      const toClick = Object.entries(parsed)
        .filter(([, v]) => v === true)
        .map(([k]) => k);

      return toClick;

    } catch (err) {
      console.warn('[RecaptchaV2] Qwen error:', err.message);
      return [];
    } finally {
      fs.unlink(tmpPath, () => {});
    }
  }

  async _clickTile(bframe, coord) {
    await bframe.evaluate((coord) => {
      const [row, col] = coord.replace(/[\[\]]/g, '').split(',').map(Number);
      const tiles = document.querySelectorAll('.rc-imageselect-tile');
      const gridSize = tiles.length === 16 ? 4 : 3;
      const idx = (row - 1) * gridSize + (col - 1);
      if (tiles[idx]) tiles[idx].click();
    }, coord);
  }

  async _solveImageChallenge(bframe, page) {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      await sleep(1500);

      const info = await this._getChallengeInfo(bframe);
      if (!info) {
        await sleep(1000);
        continue;
      }

      const tilesToClick = await this._analyzeWithQwen(bframe, info.promptText, info.gridType);

      for (const coord of tilesToClick) {
        await this._clickTile(bframe, coord);
        await sleep(400 + Math.random() * 400);
      }

      await sleep(800);

      const verifyBtn = await bframe.$('#recaptcha-verify-button');
      if (verifyBtn) {
        await verifyBtn.click();
        await sleep(2500);
      }

      const token = await page.evaluate(() => {
        const ta = document.querySelector(
          '#g-recaptcha-response, textarea[name="g-recaptcha-response"]'
        );
        return ta?.value ?? null;
      });

      if (token && token.length > 20) {
        return token;
      }

      const stillChallenge = await bframe.$('.rc-imageselect-challenge').catch(() => null);
      if (!stillChallenge) {
        break;
      }
    }

    return false;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  async solve(url) {
    if (!this.isReady) await this.initialize();

    const t0   = Date.now();
    const page = await this._newPage();
    const rec  = await this._startRecording(page, 'recaptcha_v2');

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this._clickCheckbox(page);

      await sleep(2000);

      let token = await page.evaluate(() => {
        const ta = document.querySelector(
          '#g-recaptcha-response, textarea[name="g-recaptcha-response"]'
        );
        return ta?.value ?? null;
      });

      if (!token || token.length <= 20) {
        const bframe = await this._waitForBframe(page, 8000);

        if (bframe) {
          const challengeToken = await this._solveImageChallenge(bframe, page);

          if (challengeToken && typeof challengeToken === 'string') {
            token = challengeToken;
          } else {
            token = await this._waitForToken(page);
          }
        } else {
          token = await this._waitForToken(page);
        }
      }

      await this._stopRecording(rec);
      await page.close();

      return {
        success: true,
        token,
        time: +((Date.now() - t0) / 1000).toFixed(3),
      };
    } catch (err) {
      await this._stopRecording(rec);
      try { await page.close(); } catch {}
      return {
        success: false,
        error: err.message,
        time: +((Date.now() - t0) / 1000).toFixed(3),
      };
    }
  }

  async solveWithSitekey(pageUrl, sitekey) {
    if (!this.isReady) await this.initialize();

    const t0   = Date.now();
    const page = await this._newPage();
    const rec  = await this._startRecording(page, `recaptcha_v2_${sitekey}`);

    const fakeHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>reCAPTCHA v2</title>
  <script src="https://www.google.com/recaptcha/api.js" async defer></script>
</head>
<body>
  <div class="g-recaptcha" data-sitekey="${sitekey}"></div>
</body>
</html>`;

    try {
      await page.setRequestInterception(true);
      const baseUrl = pageUrl.endsWith('/') ? pageUrl : pageUrl + '/';
      page.on('request', async (req) => {
        if ([pageUrl, baseUrl].includes(req.url()) && req.resourceType() === 'document') {
          await req.respond({ status: 200, contentType: 'text/html', body: fakeHtml });
        } else {
          await req.continue().catch(() => {});
        }
      });

      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this._clickCheckbox(page);

      await sleep(2000);

      let token = await page.evaluate(() => {
        const ta = document.querySelector(
          '#g-recaptcha-response, textarea[name="g-recaptcha-response"]'
        );
        return ta?.value ?? null;
      });

      if (!token || token.length <= 20) {
        const bframe = await this._waitForBframe(page, 8000);
        if (bframe) {
          const challengeToken = await this._solveImageChallenge(bframe, page);
          if (challengeToken && typeof challengeToken === 'string') {
            token = challengeToken;
          } else {
            token = await this._waitForToken(page);
          }
        } else {
          token = await this._waitForToken(page);
        }
      }

      await this._stopRecording(rec);
      await page.close();

      return {
        success: true,
        token,
        time: +((Date.now() - t0) / 1000).toFixed(3),
      };
    } catch (err) {
      await this._stopRecording(rec);
      try { await page.close(); } catch {}
      return {
        success: false,
        error: err.message,
        time: +((Date.now() - t0) / 1000).toFixed(3),
      };
    }
  }
}

export { RecaptchaV2Solver };
export default {
  name: "Recaptcha V2 Solver",
  description: "Solve Google Recaptcha V2 using Puppeteer + Qwen AI (support GET & POST)",
  category: "Solve",
  methods: ["GET", "POST"],
  params: ["url", "sitekey"],

  paramsSchema: {
    url: {
      type: "string",
      required: false,
      default: "https://www.google.com/recaptcha/api2/demo",
    },
    sitekey: {
      type: "string",
      required: false,
      default: "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI",
    },
  },

  async run(req, res) {
    const startTime = Date.now();
    const params = { ...req.query, ...req.body };
    const { sitekey, proxy, qwenToken, qwenEmail, qwenPassword, record, timeout, maxAttempts } = params;
    const url = params.url || 'https://www.google.com/recaptcha/api2/demo';
    const finalSitekey = sitekey || '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI';

    let proxyObj = null;
    if (proxy) {
      try {
        proxyObj = typeof proxy === 'string' ? JSON.parse(proxy) : proxy;
      } catch { proxyObj = null; }
    }

    const solverOpts = {
      qwenToken: qwenToken || null,
      qwenEmail: qwenEmail || QWEN_EMAIL,
      qwenPassword: qwenPassword || QWEN_PASSWORD,
      record: record === true || record === 'true',
      timeout: timeout ? Number(timeout) : 120000,
      maxAttempts: maxAttempts ? Number(maxAttempts) : 5,
      proxy: proxyObj,
    };

    try {
      const solver = new RecaptchaV2Solver(solverOpts);
      let result;

      if (finalSitekey && url) {
        result = await solver.solveWithSitekey(url, finalSitekey);
      } else if (url) {
        result = await solver.solve(url);
      } else {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi (dan opsional 'sitekey')",
        });
      }

      await solver.cleanup();
      const endTime = Date.now();
      const responseTime = endTime - startTime;

      return res.json({
        status: result.success,
        result: {
          token: result.token,
          responseTime: `${responseTime}ms`,
          solveTime: result.time ? `${result.time}s` : undefined,
        },
        error: result.error || undefined,
      });
    } catch (err) {
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      return res.status(500).json({
        status: false,
        message: err.message || "Failed to solve recaptcha v2",
        result: { responseTime: `${responseTime}ms` },
      });
    }
  },
};
