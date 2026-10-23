/**
 * TempMail API - 1sec.email / mail.tm
 * GET/POST /api/tempmail/onesec-mail?action=create&username=custom
 * GET/POST /api/tempmail/onesec-mail?action=inbox&token=xxx
 * GET/POST /api/tempmail/onesec-mail?action=delete&token=xxx
 */

import fetch from "node-fetch"
import logger from "../../src/utils/logger.js"

const BASE_URL = "https://api.mail.tm"
const TIMEOUT = 15000

async function getActiveDomain() {
  try {
    const res = await fetch(`${BASE_URL}/domains?page=1`, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT)
    })
    const data = await res.json()
    return data?.find(d => d.isActive)?.domain || data?.[0]?.domain || "uberip.com"
  } catch (e) {
    logger.warn(`[OneSec-Mail] Get domain failed: ${e.message}`)
    return "uberip.com"
  }
}

async function createAccount(username = null) {
  const domain = await getActiveDomain()
  const localPart = username || `user${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`
  const address = `${localPart}@${domain}`
  const password = "temp123456"

  const res = await fetch(`${BASE_URL}/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ address, password }),
    signal: AbortSignal.timeout(TIMEOUT)
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data?.message || data?.detail || `HTTP ${res.status}`)

  // Get token
  const tokenRes = await fetch(`${BASE_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ address, password }),
    signal: AbortSignal.timeout(TIMEOUT)
  })

  const tokenData = await tokenRes.json()
  if (!tokenRes.ok) throw new Error(tokenData?.message || `Token HTTP ${tokenRes.status}`)

  return {
    email: address,
    password,
    token: tokenData.token,
    domain,
    id: data.id
  }
}

async function getInbox(token) {
  const res = await fetch(`${BASE_URL}/messages`, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.json()
}

async function getMessage(token, id) {
  const res = await fetch(`${BASE_URL}/messages/${id}`, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.json()
}

async function deleteAccount(token) {
  const res = await fetch(`${BASE_URL}/accounts/me`, {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT)
  })
  return res.ok
}

export default {
  name: "OneSec Mail (mail.tm)",
  description: "Temporary email via 1sec.email / mail.tm - create, inbox, delete",
  category: "Email",
  methods: ["GET", "POST"],
  params: ["action", "token", "username"],
  paramsSchema: {
    action: { 
      type: "string", 
      required: true, 
      enum: ["create", "inbox", "delete", "message"],
      description: "Action to perform" 
    },
    token: { 
      type: "string", 
      required: false, 
      description: "Auth token from create action" 
    },
    username: { 
      type: "string", 
      required: false, 
      description: "Custom username (optional, random if omitted)" 
    },
    id: { 
      type: "string", 
      required: false, 
      description: "Message ID for message action" 
    }
  },
  async run(req, res) {
    const { action, token, username, id } = { ...req.query, ...req.body }

    if (!action) {
      return res.status(400).json({ 
        status: false, 
        error: "Parameter 'action' wajib: create, inbox, delete, message",
        example: { create: "?action=create&username=custom", inbox: "?action=inbox&token=xxx" }
      })
    }

    try {
      if (action === "create") {
        const result = await createAccount(username)
        return res.json({
          status: true,
          result,
          message: "Email created. Save token for inbox/delete.",
          timestamp: new Date().toISOString()
        })
      }

      if (!token) {
        return res.status(400).json({ status: false, error: "Token wajib untuk action: " + action })
      }

      if (action === "inbox") {
        const messages = await getInbox(token)
        return res.json({
          status: true,
          result: { count: messages.length, messages },
          timestamp: new Date().toISOString()
        })
      }

      if (action === "message") {
        if (!id) return res.status(400).json({ status: false, error: "Parameter 'id' wajib untuk message" })
        const msg = await getMessage(token, id)
        return res.json({ status: true, result: msg, timestamp: new Date().toISOString() })
      }

      if (action === "delete") {
        await deleteAccount(token)
        return res.json({ status: true, message: "Account deleted", timestamp: new Date().toISOString() })
      }

      return res.status(400).json({ status: false, error: "Action tidak valid: " + action })

    } catch (e) {
      logger.error(`[OneSec-Mail] ${action} error: ${e.message}`)
      return res.status(500).json({ status: false, error: e.message, timestamp: new Date().toISOString() })
    }
  }
}
