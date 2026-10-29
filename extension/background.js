chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.warn("Side panel behavior not set:", error));

// Heartbeat — report active user to admin panel (every 60s)
setInterval(() => {
  const token = localStorage.getItem("cjToken");
  if (!token) return;
  fetch("https://cj-winning-product-hunter-poc.vercel.app/api/heartbeat", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  }).catch(() => {});
}, 60000);
