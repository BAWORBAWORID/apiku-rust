import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const API_KEYS_PATH = path.join(__dirname, '../../data/api-keys.json')

let _cache = null

export function loadApiKeys() {
  if (_cache) return _cache
  try {
    const raw = fs.readFileSync(API_KEYS_PATH, 'utf-8')
    _cache = JSON.parse(raw)
  } catch {
    _cache = { keys: [] }
  }
  return _cache
}

export function saveApiKeys(keys) {
  _cache = keys
  fs.writeFileSync(API_KEYS_PATH, JSON.stringify(keys, null, 2), 'utf-8')
}

export function invalidateApiKeysCache() {
  _cache = null
}

try {
  fs.watch(API_KEYS_PATH, (eventType) => {
    if (eventType === 'change') _cache = null
  })
} catch {}