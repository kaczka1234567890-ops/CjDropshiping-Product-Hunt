// Heartbeat — report active user to admin panel (every 30s for real-time online status)
setInterval(async () => {
  try {
    const { cjToken } = await chrome.storage.local.get(["cjToken"]);
    const token = cjToken;
    if (!token) return;
    await fetch("https://cj-winning-product-hunter-poc.vercel.app/api/heartbeat", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch {}
}, 30000);

// ── Open app/side panel from content script ──────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "openApp") {
    // Check if there's an existing side panel tab
    const isCJPage = /cjdropshipping\.com/.test(sender.tab?.url || "");
    if (isCJPage && sender.tab) {
      // Open side panel in current tab
      chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {
        // Fallback: open popup via action click
        chrome.tabs.sendMessage(sender.tab.id, { action: "showPanel" });
      });
    } else {
      // General case: open popup
      chrome.windows.create({ type: "popup", width: 380, height: 580 }).catch(() => {
        // Popup already handled by extension icon
      });
    }
    sendResponse({ ok: true });
  }
});

// ── Redirect safety net ─────────────────────────────────────────────
// CJ product pages sometimes redirect to qksource.com when the product
// ID in the URL is invalid or the product is no longer available.
// This handler intercepts those redirects and rewrites the URL to use
// the canonical cjdropshipping.com domain with the same product ID.
// It only fires for qksource.com → cjdropshipping.com transitions.
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    try {
      const url = new URL(details.url);
      if (url.hostname !== "qksource.com") return {};
      // Extract the product ID from the qksource URL if present
      // qksource URLs look like: https://qksource.com/product/-p-{id}.html
      // or may carry the ID as a query parameter
      const pidMatch = details.url.match(/-p-([0-9A-Za-z_-]+)/);
      const pid = pidMatch ? pidMatch[1] : null;
      if (pid) {
        return {
          redirectUrl: `https://www.cjdropshipping.com/product/-p-${encodeURIComponent(pid)}.html`
        };
      }
    } catch {}
    return {};
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

// ── Side panel setup ──────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  try {
    // Open side panel on CJdropshipping pages when icon is clicked,
    // and keep it open on those pages (behavior: "openpanelonactionclick")
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    console.log("Side panel enabled for CJdropshipping pages");
  } catch (error) {
    console.warn("Side panel setup error:", error);
  }
});

// ── Keep side panel open on CJdropshipping pages ──────────────────
// Listen for tab updates - when user navigates to CJ page, open side panel
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && /cjdropshipping\.com/.test(tab.url)) {
    try {
      // Open side panel and keep it open
      await chrome.sidePanel.open({ tabId: tabId });
      // Set behavior to keep panel open on this page
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      console.log("[BG] Side panel opened for CJ page:", tab.url);
    } catch (error) {
      console.warn("[BG] Failed to open side panel:", error);
    }
  }
});

// ── Handle messages from content script ─────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "openSidePanel") {
    // Open the side panel in the current tab
    chrome.sidePanel.open({ tabId: sender.tab?.id }).catch(() => {});
    sendResponse({ ok: true });
  }
  
  if (msg.action === "openProduct") {
    // Open product in new tab or focus existing tab
    const url = `https://www.cjdropshipping.com/product/-p-${encodeURIComponent(msg.productId)}.html`;
    chrome.tabs.create({ url, active: true }).catch(() => {
      window.open(url, '_blank');
    });
    sendResponse({ ok: true });
  }
});
