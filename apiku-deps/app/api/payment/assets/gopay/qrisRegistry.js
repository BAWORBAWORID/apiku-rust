import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../../../data/gopay-qris.json');

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch {
    cache = {};
  }
  return cache;
}

function save(db) {
  cache = db;
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Key = created_at (timestamp registry), dipakai GoPay Qris Status untuk lookup.
 */
export function registerQris(entry) {
  const createdAt = entry?.created_at;
  if (!createdAt) return null;
  const db = load();
  db[createdAt] = {
    amount: entry.amount ?? null,
    image_url: entry.image_url || null,
    created_at: createdAt,
    registered_at: new Date().toISOString()
  };
  save(db);
  return db[createdAt];
}

export function getQris(createdAt) {
  return load()[createdAt] || null;
}

export function removeQris(createdAt) {
  const db = load();
  const entry = db[createdAt];
  delete db[createdAt];
  save(db);
  return entry || null;
}

export function listQris() {
  return Object.values(load()).sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at))
  );
}
