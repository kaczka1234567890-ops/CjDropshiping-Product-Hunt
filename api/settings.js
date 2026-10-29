import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const DATA_DIR = path.join(projectRoot, "data");
const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

export function readSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSettings(next) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
}

export function getCjApiKey() {
  const stored = String(readSettings().cjApiKey || "").trim();
  if (stored) return stored;
  return String(process.env.CJ_ACCESS_TOKEN || "").trim();
}

export function cjKeySource() {
  if (String(readSettings().cjApiKey || "").trim()) return "settings";
  if (String(process.env.CJ_ACCESS_TOKEN || "").trim()) return "env";
  return "none";
}

export function setCjApiKey(key) {
  const trimmed = String(key || "").trim();
  const settings = readSettings();
  if (trimmed) {
    settings.cjApiKey = trimmed;
    settings.cjKeyUpdatedAt = new Date().toISOString();
  } else {
    delete settings.cjApiKey;
    delete settings.cjKeyUpdatedAt;
  }
  writeSettings(settings);
}

export function maskApiKey(key) {
  const value = String(key || "");
  if (!value) return "";
  if (value.length <= 10) return "••••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function apiKeyFingerprint(key) {
  return crypto.createHash("sha256").update(String(key || "")).digest("hex").slice(0, 12);
}

export function settingsSummary() {
  const key = getCjApiKey();
  return {
    cjKeySet: Boolean(key),
    cjKeyMasked: maskApiKey(key),
    cjKeySource: cjKeySource()
  };
}
