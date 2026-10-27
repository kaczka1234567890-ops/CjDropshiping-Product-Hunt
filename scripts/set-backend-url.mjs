// Point the extension at your deployed backend.
//
//   node scripts/set-backend-url.mjs https://your-project.vercel.app
//
// Updates the two places that hardcode the backend URL:
//   1. extension/manifest.json  → host_permissions (so Chrome allows the calls)
//   2. extension/popup.js       → DEFAULT_API_BASE (so the UI knows where to call)
//
// Run this AFTER `vercel deploy` (or linking with `vercel link`).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const raw = process.argv[2];
if (!raw) {
  console.error("Usage: node scripts/set-backend-url.mjs https://your-project.vercel.app");
  process.exit(1);
}

const base = String(raw).trim().replace(/\/+$/, "");
let url;
try {
  url = new URL(base);
} catch {
  console.error(`"${raw}" is not a valid URL. Example: https://cj-product-hunter.vercel.app`);
  process.exit(1);
}
if (!/^https?:$/.test(url.protocol)) {
  console.error("The backend URL must start with http:// or https://");
  process.exit(1);
}

// 1. manifest.json → host_permissions
const manifestPath = path.join(root, "extension", "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const originPattern = `${url.origin}/*`;
const keep = (manifest.host_permissions || []).filter(
  (p) => p.startsWith("http://localhost") && !p.includes("YOUR-PROJECT")
);
manifest.host_permissions = [...new Set([...keep, originPattern])];
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// 2. popup.js → DEFAULT_API_BASE
const popupPath = path.join(root, "extension", "popup.js");
let popup = fs.readFileSync(popupPath, "utf8");
const before = popup;
popup = popup.replace(
  /const DEFAULT_API_BASE = "[^"]*";/,
  `const DEFAULT_API_BASE = ${JSON.stringify(url.origin)};`
);
if (popup === before) {
  console.error("Could not find DEFAULT_API_BASE in extension/popup.js — update it manually.");
  process.exit(1);
}
fs.writeFileSync(popupPath, popup);

console.log("Backend URL set to:", url.origin);
console.log("  extension/manifest.json → host_permissions:", manifest.host_permissions.join(", "));
console.log("  extension/popup.js       → DEFAULT_API_BASE =", url.origin);
console.log("\nReload the extension in chrome://extensions to apply.");
