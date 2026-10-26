import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const STORE_PATH = path.join(projectRoot, "data", "sales-cache.json");
const TTL_MS = 12 * 3600 * 1000;
const MAX_ENTRIES = 5000;

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    cache = {};
  }
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) cache = {};
  return cache;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(cache));
  } catch (error) {
    console.warn("Could not save sales cache:", error.message);
  }
}

export function getSalesCache(pid) {
  if (!pid) return null;
  const entry = load()[String(pid)];
  if (!entry || !entry.fetchedAt) return null;
  const fetchedAt = Date.parse(entry.fetchedAt);
  if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt > TTL_MS) return null;
  return entry;
}

export function setSalesCache(pid, data) {
  if (!pid || !data || typeof data !== "object") return;
  const store = load();
  store[String(pid)] = { ...data, fetchedAt: new Date().toISOString() };
  const keys = Object.keys(store);
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => Date.parse(store[a]?.fetchedAt || 0) - Date.parse(store[b]?.fetchedAt || 0));
    for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) delete store[key];
  }
  save();
}
