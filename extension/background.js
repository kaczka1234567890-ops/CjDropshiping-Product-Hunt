chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.warn("Side panel behavior not set:", error));

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