import fs from "node:fs/promises"
import path from "node:path"

const SESSION_DIR = path.join(process.cwd(), "data", "session")
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000 // 24 jam

async function ensureSessionDir() {
  try {
    await fs.mkdir(SESSION_DIR, { recursive: true })
  } catch (err) {
    if (err.code !== 'EEXIST') throw err
  }
}

async function cleanupExpiredSessions() {
  try {
    await ensureSessionDir()
    const now = Date.now()
    const files = await fs.readdir(SESSION_DIR)
    let deleted = 0
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const filePath = path.join(SESSION_DIR, file)
      try {
        const stat = await fs.stat(filePath)
        if (now - stat.mtimeMs > SESSION_MAX_AGE) {
          await fs.unlink(filePath)
          deleted++
        }
      } catch {}
    }
    if (deleted > 0) {
      const logger = await import('./logger.js')
      logger.default.info(`[Session Cleanup] Removed ${deleted} expired session files`)
    }
  } catch (err) {
    // Silent fail — session cleanup is non-critical
  }
}

async function loadSession(filename, defaults) {
  await ensureSessionDir()
  const filePath = path.join(SESSION_DIR, filename)
  try {
    const raw = await fs.readFile(filePath, "utf8")
    return JSON.parse(raw)
  } catch {
    return defaults
  }
}

async function saveSession(filename, data) {
  await ensureSessionDir()
  const filePath = path.join(SESSION_DIR, filename)
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8")
}

export { loadSession, saveSession, cleanupExpiredSessions }
