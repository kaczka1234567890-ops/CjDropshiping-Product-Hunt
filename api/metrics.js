import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const DATA_DIR = path.join(projectRoot, "data");
const STORE_PATH = path.join(DATA_DIR, "product-metrics.json");
const MAX_DAYS = 60;

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
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(cache));
  } catch (error) {
    console.warn("Could not save product metrics:", error.message);
  }
}

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function prune(snapshots) {
  const cutoff = dayKey(new Date(Date.now() - MAX_DAYS * 86400000));
  for (const key of Object.keys(snapshots)) {
    if (key < cutoff) delete snapshots[key];
  }
}

export function recordSnapshots(entries) {
  const store = load();
  const today = dayKey();
  let dirty = false;
  for (const entry of entries) {
    if (!entry || entry.id === null || entry.id === undefined || entry.id === "") continue;
    const id = String(entry.id);
    const stock = entry.stock === null || entry.stock === undefined || !Number.isFinite(Number(entry.stock))
      ? null : Number(entry.stock);
    const listedNum = entry.listedNum === null || entry.listedNum === undefined || !Number.isFinite(Number(entry.listedNum))
      ? null : Number(entry.listedNum);
    if (stock === null && listedNum === null) continue;
    if (!store[id]) store[id] = { snapshots: {} };
    const existing = store[id].snapshots[today] || {};
    store[id].snapshots[today] = {
      stock: stock !== null ? stock : (existing.stock ?? null),
      listedNum: listedNum !== null ? listedNum : (existing.listedNum ?? null)
    };
    prune(store[id].snapshots);
    dirty = true;
  }
  if (dirty) save();
}

function windowChange(snapshots, days) {
  const today = dayKey();
  const cutoff = days === null ? "0000-00-00" : dayKey(new Date(Date.now() - days * 86400000));
  const dates = Object.keys(snapshots).filter((d) => d >= cutoff && d <= today).sort();
  if (dates.length < 2) return null;
  const oldest = snapshots[dates[0]];
  const newest = snapshots[dates[dates.length - 1]];
  const diff = (a, b) =>
    Number.isFinite(Number(a)) && Number.isFinite(Number(b)) ? Number(a) - Number(b) : null;
  return {
    from: dates[0],
    to: dates[dates.length - 1],
    snapshots: dates.length,
    stockChange: diff(oldest.stock, newest.stock),
    listedChange: diff(oldest.listedNum, newest.listedNum)
  };
}

export function getMetrics(id) {
  if (!id) return null;
  const store = load();
  const entry = store[String(id)];
  if (!entry || !entry.snapshots) return null;
  const dates = Object.keys(entry.snapshots).sort();
  if (!dates.length) return null;
  return {
    trackingSince: dates[0],
    snapshotCount: dates.length,
    windows: {
      dAll: windowChange(entry.snapshots, null),
      d7: windowChange(entry.snapshots, 7),
      d30: windowChange(entry.snapshots, 30)
    }
  };
}
