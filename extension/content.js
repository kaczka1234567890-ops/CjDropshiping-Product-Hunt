// content.js — Injects CJ Product Hunter side panel on CJdropshipping pages
console.log("CJ Product Hunter content script loaded");

const isCJPage = /cjdropshipping\.com/.test(window.location.hostname);

if (!isCJPage) {
  console.log("Not a CJ page — skipping injection");
}

// ── Create floating toggle button ───────────────────────────────
function createToggleButton() {
  if (document.getElementById("cj-ph-toggle")) return; // Already exists
  
  const btn = document.createElement("button");
  btn.id = "cj-ph-toggle";
  btn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8"></circle>
      <path d="m21 21-4.35-4.35"></path>
    </svg>
    <span>CJ Hunter</span>
  `;
  btn.style.cssText = `
    position: fixed;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    z-index: 2147483648;
    background: #ff7700;
    color: white;
    border: none;
    padding: 12px 8px;
    border-radius: 8px 0 0 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    box-shadow: -2px 0 8px rgba(0,0,0,0.2);
    writing-mode: vertical-rl;
    text-orientation: mixed;
    transition: all 0.2s;
  `;
  
  btn.addEventListener("mouseenter", () => {
    btn.style.paddingRight = "16px";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.paddingRight = "8px";
  });
  
  btn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "openSidePanel" });
  });
  
  document.body.appendChild(btn);
  console.log("CJ Product Hunter toggle button created");
}

// ── Initialize when DOM is ready ──────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", createToggleButton);
} else {
  createToggleButton();
}

// ── Listen for messages from side panel ──────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Forward messages to service worker or other handlers
  return true;
});

console.log("CJ Product Hunter ready");
