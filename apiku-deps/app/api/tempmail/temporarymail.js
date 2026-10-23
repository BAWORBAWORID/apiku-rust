/**
 * TempMail v4 - Using temporarymail.com
 * GET /api/tempmail/temporarymail?action=create
 * GET /api/tempmail/temporarymail?action=inbox&secretKey=xxx
 * GET /api/tempmail/temporarymail?action=detail&secretKey=xxx&emailId=xxx
 */

import logger from "../../src/utils/logger.js"

const BASE_URL = "https://temporarymail.com/api/"
const REQUEST_TIMEOUT = 15000
const MAX_AGE = 60 * 60 * 1000 // 1 jam

const sessions = {}

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 16; Infinix X6837 Build/BP2A.250605.031.A2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.137 Mobile Safari/537.36',
    'Accept': '*/*',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'sec-ch-ua-platform': '"Android"',
    'x-requested-with': 'XMLHttpRequest',
    'sec-ch-ua': '"Android WebView";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    'sec-ch-ua-mobile': '?1',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    'referer': 'https://temporarymail.com/',
    'accept-language': 'en-ID,en;q=0.9,id-ID;q=0.8,id;q=0.7,en-US;q=0.6',
    'priority': 'u=1, i'
}

function formatTimeRemaining(ms) {
    if (ms < 0) return "Expired"
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    if (minutes > 0) return `${minutes} menit ${seconds % 60} detik`
    return `${seconds} detik`
}

function cleanupExpiredSessions() {
    const now = Date.now()
    let expiredCount = 0
    Object.keys(sessions).forEach(sessionId => {
        if (now > sessions[sessionId].expiresAt) {
            delete sessions[sessionId]
            expiredCount++
        }
    })
    if (expiredCount > 0) {
        logger.info(`[TempMail-v4] Cleaned up ${expiredCount} expired sessions`)
    }
}

setInterval(cleanupExpiredSessions, 5 * 60 * 1000)

async function createMail(sessionId) {
    try {
        logger.info(`[TempMail-v4] Creating new email for session=${sessionId}`)

        const url = `${BASE_URL}?action=requestEmailAccess&key=&value=random&r=https://www.google.com/`
        const response = await fetch(url, {
            method: 'GET',
            headers: HEADERS,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT)
        })

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`)

        const data = await response.json()

        if (!data.address || !data.secretKey) {
            throw new Error("Gagal mendapatkan email dari temporarymail.com")
        }

        const expiresAt = Date.now() + MAX_AGE

        sessions[sessionId] = {
            address: data.address,
            secretKey: data.secretKey,
            createdAt: Date.now(),
            expiresAt: expiresAt
        }

        logger.info(
            `[TempMail-v4] Created | session=${sessionId} | ` +
            `email=${data.address} | expires=${new Date(expiresAt).toISOString()}`
        )

        return {
            email: data.address,
            secretKey: data.secretKey,
            createdAt: Date.now(),
            expiresAt: expiresAt,
            timeRemaining: MAX_AGE,
            timeRemainingHuman: formatTimeRemaining(MAX_AGE),
            note: "Email akan otomatis expired setelah 60 menit"
        }

    } catch (error) {
        logger.error(`[TempMail-v4] Create error: ${error.message} | session=${sessionId}`)
        throw new Error(`Gagal membuat email sementara: ${error.message}`)
    }
}

async function checkMailInbox(sessionId) {
    const s = sessions[sessionId]
    if (!s) throw new Error("Session tidak ditemukan")

    if (Date.now() > s.expiresAt) {
        delete sessions[sessionId]
        throw new Error("Email sementara telah kedaluwarsa (maksimal 60 menit)")
    }

    try {
        logger.info(`[TempMail-v4] Checking inbox for ${s.address}...`)

        const url = `${BASE_URL}?action=checkInbox&value=${s.secretKey}`
        const response = await fetch(url, {
            method: 'GET',
            headers: HEADERS,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT)
        })

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`)

        const data = await response.json()
        const messages = Object.values(data)

        const formattedMessages = messages.map(msg => ({
            id: msg.id,
            from: msg.from,
            name: msg.name || null,
            subject: msg.subject,
            date: msg.date ? new Date(msg.date * 1000).toISOString() : null,
            snippet: msg.snippet || null
        }))

        logger.info(
            `[TempMail-v4] Check inbox | session=${sessionId} | ` +
            `email=${s.address} | messages=${messages.length}`
        )

        return {
            email: s.address,
            messages: formattedMessages,
            inboxCount: messages.length,
            createdAt: s.createdAt,
            expiresAt: s.expiresAt,
            timeRemaining: s.expiresAt - Date.now(),
            timeRemainingHuman: formatTimeRemaining(s.expiresAt - Date.now())
        }

    } catch (error) {
        logger.error(`[TempMail-v4] Check inbox error: ${error.message} | session=${sessionId}`)
        throw error
    }
}

async function getEmailDetail(sessionId, emailId) {
    const s = sessions[sessionId]
    if (!s) throw new Error("Session tidak ditemukan")

    if (Date.now() > s.expiresAt) {
        delete sessions[sessionId]
        throw new Error("Email sementara telah kedaluwarsa (maksimal 60 menit)")
    }

    if (!emailId) throw new Error("Parameter 'emailId' wajib diisi")

    try {
        logger.info(`[TempMail-v4] Getting email detail for id=${emailId}`)

        const url = `${BASE_URL}?action=getEmail&value=${emailId}`
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                ...HEADERS,
                'origin': 'https://temporarymail.com',
                'content-length': '0'
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT)
        })

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`)

        const data = await response.json()
        const detail = data[emailId]

        if (!detail) throw new Error("Email tidak ditemukan")

        logger.info(`[TempMail-v4] Got email detail | id=${emailId}`)

        return {
            id: detail.id,
            from: detail.from,
            name: detail.name || null,
            subject: detail.subject,
            date: detail.date ? new Date(detail.date * 1000).toISOString() : null,
            body: detail.body || null,
            html: detail.html || null,
            attachments: detail.attachments || []
        }

    } catch (error) {
        logger.error(`[TempMail-v4] Get detail error: ${error.message}`)
        throw error
    }
}

export default {
    name: "TempMail - TemporaryMail.com",
    description: "Temporary email service - Expires in 60 minutes",
    category: "Email",
    methods: ["GET", "POST"],

    params: ["sessionId", "action", "emailId"],

    paramsSchema: {
        sessionId: {
            type: "string",
            required: true,
            description: "Session ID untuk menyimpan email (custom)",
        },
        action: {
            type: "string",
            required: true,
            enum: ["create", "inbox", "detail"],
            description: "Aksi: create (buat email), inbox (cek inbox), detail (lihat isi email)",
        },
        emailId: {
            type: "string",
            required: false,
            description: "ID email untuk melihat detail (hanya untuk action=detail)",
        }
    },

    async run(req, res) {
        const startTime = Date.now()

        try {
            const { sessionId, action, emailId } = { ...req.query, ...req.body }

            if (!sessionId) {
                return res.status(400).json({
                    status: false,
                    message: "Parameter 'sessionId' wajib diisi",
                    code: "MISSING_SESSION_ID"
                })
            }

            if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
                return res.status(400).json({
                    status: false,
                    message: "Parameter 'sessionId' harus berupa string yang tidak kosong",
                    code: "INVALID_SESSION_ID"
                })
            }

            if (!action || !["create", "inbox", "detail"].includes(action)) {
                return res.status(400).json({
                    status: false,
                    message: "Parameter 'action' harus 'create', 'inbox', atau 'detail'",
                    code: "INVALID_ACTION"
                })
            }

            logger.info(
                `[TempMail-v4] Request | ip=${req.ip} | ` +
                `session=${sessionId} | action=${action}`
            )

            let result

            switch (action) {
                case "create":
                    result = await createMail(sessionId.trim())
                    break
                case "inbox":
                    result = await checkMailInbox(sessionId.trim())
                    break
                case "detail":
                    result = await getEmailDetail(sessionId.trim(), emailId)
                    break
            }

            const processingTime = Date.now() - startTime

            res.setHeader("Content-Type", "application/json")
            res.setHeader("X-Processing-Time", processingTime)
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0")
            res.setHeader("Pragma", "no-cache")
            res.setHeader("Expires", "0")

            res.json({
                status: true,
                action,
                sessionId: sessionId.trim(),
                result: result,
                timestamp: Date.now(),
                processingTimeMs: processingTime
            })

            logger.info(
                `[TempMail-v4] Response | ip=${req.ip} | ` +
                `session=${sessionId} | action=${action} | ` +
                `time=${processingTime}ms`
            )

        } catch (err) {
            const processingTime = Date.now() - startTime

            logger.error(
                `[TempMail-v4] Error | ip=${req.ip} | ` +
                `time=${processingTime}ms | message=${err.message}`
            )

            if (err.message.includes("Session tidak ditemukan")) {
                return res.status(404).json({
                    status: false,
                    message: "Session tidak ditemukan. Buat email terlebih dahulu dengan action=create",
                    code: "SESSION_NOT_FOUND",
                    metadata: { processingTimeMs: processingTime }
                })
            }

            if (err.message.includes("kedaluwarsa")) {
                return res.status(410).json({
                    status: false,
                    message: "Email sementara telah kedaluwarsa (maksimal 60 menit). Buat email baru dengan action=create",
                    code: "EMAIL_EXPIRED",
                    metadata: { processingTimeMs: processingTime }
                })
            }

            res.status(500).json({
                status: false,
                message: err.message || "TempMail v4 request failed",
                code: "TEMPMAIL_V4_ERROR",
                metadata: { processingTimeMs: processingTime }
            })
        }
    },
}
