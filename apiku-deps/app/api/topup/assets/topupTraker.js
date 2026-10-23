import fs from "fs"
import path from "path"
import logger from "../../../src/utils/logger.js"

const TRACKER_FILE = path.join(process.cwd(), "data", "topup.json")

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(TRACKER_FILE, "utf-8"))
    return data.files || []
  } catch {
    return []
  }
}

function save(files) {
  fs.writeFileSync(TRACKER_FILE, JSON.stringify({ files }, null, 2))
}

export function trackQR(orderId, orderCode, type, filePath, url) {
  const files = load()
  files.push({
    path: filePath,
    url,
    orderId,
    orderCode,
    type,
    createdAt: Date.now(),
    expiresAt: Date.now() + 300000,
  })
  save(files)
}

export function cleanup() {
  const files = load()
  const now = Date.now()
  const remaining = []
  let cleaned = 0

  for (const entry of files) {
    const fileExists = fs.existsSync(entry.path)
    if (!fileExists) {
      cleaned++
      continue
    }
    if (now > entry.expiresAt) {
      try {
        fs.unlinkSync(entry.path)
        logger.info(`[TOPUP-CLEANUP] Hapus file expired: ${entry.path}`)
      } catch {}
      cleaned++
      continue
    }
    remaining.push(entry)
  }

  if (cleaned > 0) {
    save(remaining)
    logger.info(`[TOPUP-CLEANUP] Dibersihkan: ${cleaned} entri`)
  }
}

cleanup()
