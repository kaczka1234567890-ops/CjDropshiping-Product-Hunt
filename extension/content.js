// content.js — minimal content script for CJdropshipping pages
// Injects the CJ Product Hunter panel on the right side of cjdropshipping.com pages
console.log("Content script loaded successfully");

// ── Detect if we're on CJdropshipping ───────────────────────────────
const isCJ = /cjdropshipping\.com/.test(window.location.hostname);

if (!isCJ) {
  // Not on CJ — nothing to inject
  console.log("Not on CJdropshipping page — content script inactive");
}

// ── Inject floating panel on CJ pages ───────────────────────────────
function injectPanel() {
  if (!isCJ) return;

  // Don't inject twice
  if (document.getElementById("cj-ph-panel")) {
    console.log("CJ Product Hunter panel already injected");
    return;
  }

  // Create panel container
  const panel = document.createElement("div");
  panel.id = "cj-ph-panel";
  panel.style.cssText = `
    position: fixed;
    top: 0;
    right: 0;
    width: 380px;
    height: 100vh;
    z-index: 2147483647;
    background: #fff;
    border-left: 1px solid #ccc;
    box-shadow: -2px 0 10px rgba(0,0,0,0.15);
    display: flex;
    flex-direction: column;
    font-family: system-ui, sans-serif;
    font-size: 13px;
    color: #2b2b2b;
  `;

  // Header
  const header = document.createElement("div");
  header.style.cssText = `
    padding: 14px 16px;
    background: #ff7700;
    color: #fff;
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 700;
    font-size: 15px;
  `;
  header.innerHTML = `
    <div style="width:28px;height:28px;background:#fff;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#ff7700">PH</div>
    <div>CJ Product Hunter <small style="opacity:0.8;font-size:11px">v1.0.9</small></div>
  `;

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.style.cssText = `
    margin-left: auto;
    background: none;
    border: none;
    color: #fff;
    font-size: 18px;
    cursor: pointer;
    padding: 0 6px;
  `;
  closeBtn.onclick = () => { panel.style.display = "none"; toggleBtn.style.display = "block"; };
  header.appendChild(closeBtn);

  // Content area
  const content = document.createElement("div");
  content.style.cssText = `
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    background: #f5f5f7;
  `;
  content.innerHTML = `
    <div style="padding:8px;font-size:12px;color:#666;">
      🔐 <strong>Sign in to start</strong><br>
      Click the extension icon to open full app.
    </div>
    <div style="margin-top:12px;text-align:center;">
      <button id="cj-ph-open-app" style="
        background:#ff7700;color:#fff;border:none;padding:10px 16px;
        border-radius:8px;font-weight:700;cursor:pointer;width:100%;
      ">🔓 Open App</button>
    </div>
    <div id="cj-ph-status" style="margin-top:10px;font-size:11px;color:#666;min-height:40px;"></div>
  `;

  // Open app button → communicate with background to open popup/sidepanel
  content.querySelector("#cj-ph-open-app").onclick = () => {
    chrome.runtime.sendMessage({ action: "openApp" }).catch(() => {});
  };

  panel.appendChild(header);
  panel.appendChild(content);
  document.body.appendChild(panel);

  // Toggle button (shown when panel is hidden)
  const toggleBtn = document.createElement("button");
  toggleBtn.id = "cj-ph-toggle";
  toggleBtn.textContent = "🔥 CJ Product Hunter";
  toggleBtn.style.cssText = `
    position: fixed;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    z-index: 2147483648;
    background: #ff7700;
    color: #fff;
    border: none;
    padding: 8px 12px;
    border-radius: 8px 0 0 8px;
    font-weight: 700;
    cursor: pointer;
    writing-mode: vertical-rl;
    text-orientation: mixed;
    display: none;
  `;
  toggleBtn.onclick = () => { panel.style.display = "flex"; toggleBtn.style.display = "none"; };
  document.body.appendChild(toggleBtn);

  // Listen for messages from background (e.g., after login)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "showPanel") {
      panel.style.display = "flex";
      toggleBtn.style.display = "none";
    }
  });

  console.log("CJ Product Hunter panel injected");
}

// ── Wait for page to load then inject ──────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", injectPanel);
} else {
  injectPanel();
}
