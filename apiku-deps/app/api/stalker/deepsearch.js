/**
 * Deep Search Stalker API
 * Search people info via ChatAI/Begamob deep-search API
 *
 * GET  /api/stalker/deepsearch?name=jokowi
 * POST /api/stalker/deepsearch -d {"name": "jokowi"}
 */

import crypto from "crypto"
import logger from "../../src/utils/logger.js"

const API = "https://chat-ai.begamob.com"
const APP_VERSION = "1.5.5"
const APP_BUNDLE = "com.chat.chatai.chatbot.aichatbot"
const OS = "android"
const BASE_HEADERS = {
  "x-app-version": APP_VERSION,
  "x-app-bundle-id": APP_BUNDLE,
  "x-os": OS,
  "Content-Type": "application/json; charset=UTF-8",
  "User-Agent": "okhttp/4.12.0",
}

let cachedSession = null

function randomDeviceId() {
  return crypto.randomBytes(32).toString("hex")
}

function decodeExp(token) {
  try {
    const p = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
    return JSON.parse(Buffer.from(p, "base64").toString("utf8")).exp * 1000
  } catch {
    return 0
  }
}

async function login(deviceId) {
  const res = await fetch(`${API}/api/v1/auth/login`, {
    method: "POST",
    headers: BASE_HEADERS,
    body: JSON.stringify({ deviceId, type: "guest" }),
  })
  const json = await res.json()
  if (!json.success) throw new Error("Login gagal: " + JSON.stringify(json))
  return json.data
}

async function refreshAccessToken(session) {
  const res = await fetch(`${API}/api/v1/auth/refresh-token`, {
    method: "POST",
    headers: BASE_HEADERS,
    body: JSON.stringify({ refreshToken: session.refreshToken, deviceId: session.deviceId, type: "guest" }),
  })
  const json = await res.json()
  if (!json.success) throw new Error("Refresh gagal: " + JSON.stringify(json))
  return json.data
}

async function getAccessToken(session) {
  if (session.accessToken) {
    const exp = decodeExp(session.accessToken)
    if (exp > Date.now() + 60_000) return session.accessToken
  }
  try {
    const d = await refreshAccessToken(session)
    session.accessToken = d.accessToken
    session.refreshToken = d.refreshToken || session.refreshToken
    cachedSession = session
    return d.accessToken
  } catch {
    const d = await login(session.deviceId)
    session.accessToken = d.accessToken
    session.refreshToken = d.refreshToken
    cachedSession = session
    return d.accessToken
  }
}

function buildHeaders(token, deviceId) {
  return {
    Authorization: `Bearer ${token}`,
    "User-Authorization": token,
    "user-header": `bundleId:${APP_BUNDLE}/versionApp:${APP_VERSION}/OS:Android/osVersion:35/userId:/deviceId:${deviceId}`,
    "language-code": "en",
    "x-adjust-id": "",
    "x-app-version": APP_VERSION,
    "x-app-bundle-id": APP_BUNDLE,
    "x-os": OS,
    "Content-Type": "application/json; charset=UTF-8",
    "User-Agent": "okhttp/4.12.0",
  }
}

async function deepSearch(token, deviceId, name) {
  const res = await fetch(`${API}/api/v2/deep-search/person/find?limit=10`, {
    method: "POST",
    headers: buildHeaders(token, deviceId),
    body: JSON.stringify({ platform: "android", name }),
  })
  return res.json()
}

async function ensureSession() {
  if (cachedSession && cachedSession.accessToken && cachedSession.refreshToken) {
    const exp = decodeExp(cachedSession.accessToken)
    if (exp > Date.now() + 60_000) return cachedSession
  }
  const deviceId = cachedSession?.deviceId || randomDeviceId()
  const auth = await login(deviceId)
  cachedSession = {
    deviceId,
    user: auth.user,
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
  }
  return cachedSession
}

export default {
  name: "Deep Search Stalker",
  description: "Search people information by name — career, source, demographics",
  category: "Stalker",
  methods: ["GET", "POST"],

  params: ["name"],

  paramsSchema: {
    name: {
      type: "string",
      required: true,
      description: "Person name to search",
      example: "jokowi",
      minLength: 1,
      maxLength: 100,
    },
  },

  async run(req, res) {
    const startTime = Date.now()

    try {
      const { name } = { ...req.query, ...req.body }

      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'name' wajib diisi",
          example: {
            GET: "/api/stalker/deepsearch?name=jokowi",
            POST: { name: "jokowi" },
          },
        })
      }

      const cleanName = name.trim()
      logger.info(`[DEEPSEARCH] Searching: "${cleanName}"`)

      const session = await ensureSession()
      const token = await getAccessToken(session)
      const result = await deepSearch(token, session.deviceId, cleanName)

      if (!result.success) {
        logger.error(`[DEEPSEARCH] API error: ${JSON.stringify(result)}`)
        return res.status(502).json({
          status: false,
          message: "Upstream API error",
          raw: result,
          metadata: { processing_time: `${Date.now() - startTime}ms` },
        })
      }

      const people = (result.data || []).map((p) => ({
        name: p.name || null,
        career: p.demographics?.career || null,
        source: p.information?.primary_source || null,
        demographics: p.demographics || null,
        information: p.information || null,
      }))

      const duration = Date.now() - startTime
      logger.info(`[DEEPSEARCH] Found ${people.length} results for "${cleanName}" | ${duration}ms`)

      return res.json({
        status: true,
        query: cleanName,
        total: people.length,
        result: people,
        metadata: { processing_time: `${duration}ms` },
      })
    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`[DEEPSEARCH] Error: ${error.message}`)

      return res.status(500).json({
        status: false,
        message: error.message,
        metadata: { processing_time: `${duration}ms` },
      })
    }
  },
}
