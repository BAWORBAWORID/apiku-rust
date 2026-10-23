import axios from 'axios'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import logger from "../../src/utils/logger.js"

const __dirname = path.dirname(new URL(import.meta.url).pathname)

const headers = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
  'Accept-Language': 'id-ID,id;q=0.9,en-AU;q=0.8,en;q=0.7,en-US;q=0.6'
}

function parseCookies(arr) {
  return Object.fromEntries(
    (arr || []).map(c => {
      const [pair] = c.split(';')
      const i = pair.indexOf('=')
      return i < 0 ? [] : [pair.slice(0, i).trim(), pair.slice(i + 1).trim()]
    }).filter(e => e.length)
  )
}

async function startSession() {
  const page = await axios.get('https://notegpt.io/ai-agent', {
    headers: { ...headers, Accept: 'text/html' }
  }).catch(() => ({ headers: {} }))

  const jar = parseCookies(page.headers['set-cookie'])
  const anonId = jar.anonymous_user_id || crypto.randomUUID()
  const gaRand = Math.floor(Math.random() * 1e9)
  const nowSec = Math.floor(Date.now() / 1000)
  const crispId = crypto.randomUUID()
  const fakeIp = `${Math.floor(Math.random() * 150) + 50}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

  jar.anonymous_user_id = anonId
  if (!jar._ga) jar._ga = `GA1.2.${gaRand}.${nowSec}`
  if (!jar._gid) jar._gid = `GA1.2.${gaRand}.${nowSec}`
  jar[`crisp-client%2Fsession%2F${crispId}`] = `session_${crispId}`
  jar.g_state = `{"i_l":0,"i_ll":${Date.now()},"i_b":"yeFk1wDsyGfoayFEOiLa/IjWhdrP/E9mGw1Dbyp63TU","i_e":{"enable_itp_optimization":24},"i_et":${Date.now()}}`

  return {
    Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
    'X-Forwarded-For': fakeIp,
    'X-Real-IP': fakeIp
  }
}

let wasmExports
let wasmAllocLen = 0
let wasmBufferCache = null
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true })

function getMem() {
  return new Uint8Array(wasmExports.memory.buffer)
}

function decodeStr(ptr, len) {
  return decoder.decode(getMem().subarray(ptr >>> 0, (ptr >>> 0) + len))
}

function encodeStr(str, mallocFn) {
  const enc = encoder.encode(str)
  const ptr = mallocFn(enc.length, 1) >>> 0
  getMem().subarray(ptr, ptr + enc.length).set(enc)
  wasmAllocLen = enc.length
  return ptr
}

function catchException(ptr) {
  const err = wasmExports.__wbindgen_externrefs.get(ptr)
  wasmExports.__externref_table_dealloc(ptr)
  return err
}

function handleException(fn, args) {
  try {
    return fn.apply(this, args)
  } catch (err) {
    const ptr = wasmExports.__externref_table_alloc()
    wasmExports.__wbindgen_externrefs.set(ptr, err)
    wasmExports.__wbindgen_exn_store(ptr)
  }
}

async function initWasm() {
  if (wasmExports) return

  if (!wasmBufferCache) {
    const res = await axios.get(
      'https://cdn.notegpt.io/notegpt/pages/public/_nuxt/crypto_util_bg.Bd4ztPln.wasm',
      { responseType: 'arraybuffer', timeout: 30000 }
    )

    const wasmBuf = Buffer.from(res.data)
    const pat = Buffer.from([0x41, 0xda, 0xa0, 0xc0, 0x00])
    const idx = wasmBuf.indexOf(pat)

    if (idx !== -1) {
      Buffer.from([0x1a, 0x41, 0x01, 0x01, 0x01, 0x01, 0x01]).copy(wasmBuf, idx - 16)
    }

    wasmBufferCache = wasmBuf
  }

  const imports = {
    './crypto_util_bg.js': {
      __wbg___wbindgen_is_falsy_f8005c4864e74c90: e => !e,
      __wbg___wbindgen_is_function_d4c2480b46f29e33: e => typeof e === 'function',
      __wbg___wbindgen_is_object_e04e3a51a90cde43: e => typeof e === 'object' && !!e,
      __wbg___wbindgen_is_string_3db04af369717583: e => typeof e === 'string',
      __wbg___wbindgen_is_undefined_5957b329897cc39c: e => e === undefined,
      __wbg___wbindgen_throw_bd5a70920abf0236: (e, t) => { throw Error(decodeStr(e, t)) },
      __wbg_appendChild_023bbb6d63210eba: () => 0,
      __wbg_body_36314a75ae5381db: () => 0,
      __wbg_call_1aea13500fe8ff6c: function () {
        return handleException((e, t, n) => e.call(t, n), arguments)
      },
      __wbg_children_9fc528ade3ea173f: () => [],
      __wbg_clientWidth_8043da2fcb723102: () => 1920,
      __wbg_createElement_22af76933a7b7e81: () => 0,
      __wbg_crypto_38df2bab126b63dc: () => globalThis.crypto || crypto.webcrypto,
      __wbg_documentElement_f146626e6bc2f644: () => 0,
      __wbg_document_8d00b6db6f4e3e5e: () => 0,
      __wbg_getComputedStyle_54985c5cd0d50b68: () => 0,
      __wbg_getHours_defd69626029ce3f: () => new Date().getHours(),
      __wbg_getPropertyValue_60177298ed778c76: () => 0,
      __wbg_getRandomValues_c44a50d8cfdaebeb: function () {
        return handleException((e, t) => e.getRandomValues(t), arguments)
      },
      __wbg_get_d8a3d51a73d14c8a: function () {
        return handleException((e, t) => Reflect.get(e, t), arguments)
      },
      __wbg_has_509eb022105825c9: function () {
        return handleException((e, t) => Reflect.has(e, t), arguments)
      },
      __wbg_href_42d0a7d79a5a0fe5: () => 0,
      __wbg_instanceof_HtmlElement_51b34b7de7e6e993: () => false,
      __wbg_instanceof_Window_4bfad3a9470c25c9: () => false,
      __wbg_item_4ab2528204fdf759: () => 0,
      __wbg_length_090b6aa6235450ba: e => e.length,
      __wbg_location_bb43558c9f37b0ca: () => 0,
      __wbg_msCrypto_bd5a034af96bcba6: () => globalThis.crypto || crypto.webcrypto,
      __wbg_navigator_cda717510f3a4a47: () => 0,
      __wbg_new_0_1211b165db93342c: () => new Date(),
      __wbg_new_ebde992a0bf6bdf6: (e, t) => Error(decodeStr(e, t)),
      __wbg_new_with_length_a90559ebda3954f8: e => new Uint8Array(e >>> 0),
      __wbg_node_84ea875411254db1: () => process,
      __wbg_now_cd850b0a28a6e656: () => Date.now(),
      __wbg_process_44c7a14e11e9f69e: () => process,
      __wbg_prototypesetcall_7dca54d31cb9d2dc: (e, t, n) => {
        Uint8Array.prototype.set.call(getMem().subarray(e >>> 0, (e >>> 0) + t), n)
      },
      __wbg_randomFillSync_6c25eac9869eb53c: function () {
        return handleException((e, t) => e.randomFillSync(t), arguments)
      },
      __wbg_random_d9645defc0204485: () => Math.random(),
      __wbg_removeChild_5fbc36e12df0c63a: () => 0,
      __wbg_require_b4edbdcf3e2a1ef0: function () {
        return handleException(() => import.meta.require, arguments)
      },
      __wbg_setAttribute_81f03c9a783fca26: () => 0,
      __wbg_set_id_e047efbc2bf2e248: () => 0,
      __wbg_set_innerHTML_fb75cf5a1a8b7074: () => 0,
      __wbg_static_accessor_GLOBAL_44bef9fa6011e260: () => globalThis,
      __wbg_static_accessor_GLOBAL_THIS_13002645baf43d84: () => globalThis,
      __wbg_static_accessor_SELF_91d0abd4d035416c: () => globalThis,
      __wbg_static_accessor_WINDOW_513f857c65724fc7: () => globalThis,
      __wbg_subarray_fb60755cb1b4a498: (e, t, n) => e.subarray(t >>> 0, n >>> 0),
      __wbg_userAgent_6dfab2ad96d4e4e4: () => 0,
      __wbg_versions_276b2795b1c6a219: () => process.versions,
      __wbindgen_cast_0000000000000001: (e, t) => getMem().subarray(e >>> 0, (e >>> 0) + t),
      __wbindgen_cast_0000000000000002: (e, t) => decodeStr(e, t),
      __wbindgen_init_externref_table: () => {
        const e = wasmExports.__wbindgen_externrefs
        const t = e.grow(4)
        e.set(0, undefined)
        e.set(t, undefined)
        e.set(t + 1, null)
        e.set(t + 2, true)
        e.set(t + 3, false)
      }
    }
  }

  const mod = new WebAssembly.Module(wasmBufferCache)
  const inst = new WebAssembly.Instance(mod, imports)
  wasmExports = inst.exports
  wasmExports.__wbindgen_start()
}

function signPayload(body, appId = 'notegpt_8c92b6') {
  function format(v) {
    if (v === null) return String(v)
    if (Array.isArray(v)) return JSON.stringify(v)
    if (typeof v === 'object') {
      const obj = {}
      Object.keys(v).sort().forEach(k => (obj[k] = v[k]))
      return JSON.stringify(obj)
    }
    return String(v)
  }

  const query = Object.keys(body)
    .filter(k => body[k] !== undefined)
    .sort()
    .map(k => `${k}=${format(body[k])}`)
    .join('&')

  let p, l

  try {
    const appPtr = encodeStr(appId, wasmExports.__wbindgen_malloc)
    const appLen = wasmAllocLen

    const queryPtr = encodeStr(query, wasmExports.__wbindgen_malloc)
    const queryLen = wasmAllocLen

    const res = wasmExports.sign(appPtr, appLen, queryPtr, queryLen)

    p = res[0]
    l = res[1]

    if (res[3]) throw catchException(res[2])

    return decodeStr(p, l)
  } finally {
    wasmExports.__wbindgen_free(p, l, 1)
  }
}

async function chatStream(prompt, session, conversationId = null, parentMessageId = null, options = {}) {
  await initWasm()
  const appId = 'notegpt_8c92b6'

  let opt = {}
  if (typeof options === 'object') {
    opt = { ...options }
  }

  const convId = conversationId || crypto.randomUUID()
  const model = opt.model || 'gemini-3.1-flash-lite'
  const isWebSearch = Boolean(opt.webSearch || opt.enable_web_search)

  const payload = {
    message: String(prompt),
    language: opt.language || 'auto',
    model,
    tone: opt.tone || 'default',
    length: opt.length || 'moderate',
    conversation_id: convId,
    image_urls: [],
    chat_mode: opt.chat_mode || 'standard',
    enable_web_search: isWebSearch,
    app_id: appId,
    t: Math.floor(Date.now() / 1000)
  }

  if (parentMessageId) {
    payload.parent_message_id = parentMessageId
  }

  if (Array.isArray(opt.history_messages)) {
    payload.history_messages = opt.history_messages
  }

  payload.sign = signPayload(payload, appId)

  const stream = await axios.post('https://notegpt.io/api/v2/chat/stream', payload, {
    headers: {
      ...headers,
      ...session,
      'Content-Type': 'application/json',
      Origin: 'https://notegpt.io',
      Referer: 'https://notegpt.io/ai-agent'
    },
    responseType: 'stream',
    timeout: 60000
  })

  return new Promise((resolve, reject) => {
    let fullText = ''
    let messageId = null

    stream.data.on('data', chunk => {
      const lines = chunk.toString().split('\n')
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const j = JSON.parse(line.slice(6))
            if (j.text) fullText += j.text
            if (j.message_id) messageId = j.message_id
            if (j.id && !messageId) messageId = j.id
          } catch {}
        }
      }
    })

    stream.data.on('end', () => {
      resolve({
        text: fullText.trim(),
        model,
        conversationId: convId,
        messageId: messageId || crypto.randomUUID(),
        auth: session
      })
    })

    stream.data.on('error', reject)
  })
}

export default {
  name: "NoteGPT AI Chat v2 (Anonymous)",
  description: "NoteGPT AI Chat via anonymous session + WASM signing (gemini-3.1-flash-lite, web search, multi-turn)",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["message", "model", "conversation_id", "parent_message_id", "web_search", "tone", "length", "language", "chat_mode"],
  paramsSchema: {
    message: { type: "string", required: true, description: "Pertanyaan/pesan untuk AI", example: "Halo, apa kabar?" },
    model: {
      type: "string",
      required: false,
      default: "gemini-3.1-flash-lite",
      enum: [
        "gemini-3.1-flash-lite",
        "gemini-2.5-flash",
        "gemini-3-flash-preview",
        "gpt-4o-mini",
        "gpt-4o",
        "gpt-4.1-mini",
        "deepseek-chat",
        "deepseek-reasoner"
      ],
      description: "Model AI"
    },
    conversation_id: { type: "string", required: false, description: "ID percakapan untuk multi-turn (opsional)" },
    parent_message_id: { type: "string", required: false, description: "ID pesan parent untuk konteks (opsional)" },
    web_search: { type: "boolean", required: false, default: false, description: "Aktifkan web search" },
    tone: { type: "string", required: false, default: "default", description: "Tone: default, professional, casual, creative" },
    length: { type: "string", required: false, default: "moderate", description: "Panjang jawaban: short, moderate, long" },
    language: { type: "string", required: false, default: "auto", description: "Bahasa: auto, id, en, dll" },
    chat_mode: { type: "string", required: false, default: "standard", description: "Mode chat: standard, reasoning" }
  },
  async run(req, res) {
    try {
      const {
        message,
        model = 'gemini-3.1-flash-lite',
        conversation_id,
        parent_message_id,
        web_search = false,
        tone = 'default',
        length = 'moderate',
        language = 'auto',
        chat_mode = 'standard'
      } = { ...req.query, ...req.body }

      if (!message) {
        return res.status(400).json({ status: false, message: "Parameter 'message' wajib diisi" })
      }

      logger.info(`[NoteGPTv2] Chat: "${message.substring(0, 50)}..." | model: ${model} | webSearch: ${web_search}`)

      const session = await startSession()
      const result = await chatStream(message, session, conversation_id, parent_message_id, {
        model,
        webSearch: web_search,
        tone,
        length,
        language,
        chat_mode
      })

      return res.json({
        status: true,
        result: {
          text: result.text,
          model: result.model,
          conversation_id: result.conversationId,
          message_id: result.messageId
        }
      })
    } catch (err) {
      logger.error(`[NoteGPTv2] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || 'NoteGPTv2 request failed' })
    }
  }
}