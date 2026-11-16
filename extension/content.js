// content.js — CJ Product Hunter floating panel on CJdropshipping.com
// Restores the old inline floating panel interface (before 1.0.9 changes)
console.log("[CJ-PH] Content script loaded");

const IS_CJ = /cjdropshipping\.com/.test(window.location.hostname);
if (!IS_CJ) { console.log("[CJ-PH] Not a CJ page, skipping."); }

// ── Inject floating panel HTML & wiring ───────────────────────
function injectPanel() {
  if (document.getElementById("cj-ph-overlay")) return;

  // ── Styles ─────────────────────────────────────────────────
  const styleEl = document.createElement("style");
  styleEl.textContent = `
    #cj-ph-overlay *{box-sizing:border-box;margin:0;padding:0}
    #cj-ph-overlay{position:fixed;top:16px;left:16px;width:420px;max-height:calc(100vh - 32px);overflow-y:auto;z-index:2147483647;background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.18);font-family:system-ui,sans-serif;color:#2b2b2b;display:flex;flex-direction:column}
    #cj-ph-overlay::-webkit-scrollbar{width:6px}#cj-ph-overlay::-webkit-scrollbar-thumb{background:#ccc;border-radius:3px}
    #cj-ph-header{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #e5e5ea;background:#fff;border-radius:12px 12px 0 0}
    #cj-ph-logo{width:36px;height:36px;background:#ff7700;border-radius:10px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:14px;flex-shrink:0}
    #cj-ph-title{flex:1;font-size:14px;font-weight:700;line-height:1.3}
    #cj-ph-subtitle{font-size:11px;color:#666}
    #cj-ph-close{background:none;border:none;font-size:22px;cursor:pointer;color:#666;padding:0 4px;line-height:1}
    #cj-ph-close:hover{color:#333}
    #cj-ph-auth{text-align:center;padding:32px 20px}
    #cj-ph-auth h3{margin-bottom:6px;font-size:16px}
    #cj-ph-auth p{font-size:12px;color:#666;margin-bottom:16px}
    #cj-ph-auth input{width:100%;padding:10px 12px;border:1px solid #e5e5ea;border-radius:8px;margin-bottom:8px;font-size:13px;outline:none}
    #cj-ph-auth input:focus{border-color:#ff7700}
    #cj-ph-auth button{width:100%;padding:11px;border:none;border-radius:8px;background:#ff7700;color:#fff;font-weight:700;font-size:14px;cursor:pointer;margin-top:4px}
    #cj-ph-auth button:hover{background:#ef6d00}
    #cj-ph-auth .switch-link{font-size:12px;color:#666;margin-top:12px}
    #cj-ph-auth .switch-link a{color:#ff7700;cursor:pointer;text-decoration:underline}
    #cj-ph-body{padding:14px 16px 16px;display:flex;flex-direction:column;gap:10px}
    #cj-ph-search{display:flex;gap:8px}
    #cj-ph-search input{flex:1;padding:10px 12px;border:1px solid #e5e5ea;border-radius:8px;font-size:13px;outline:none}
    #cj-ph-search input:focus{border-color:#ff7700}
    #cj-ph-hunt-btn{background:#ff7700;color:#fff;border:none;padding:10px 18px;border-radius:8px;font-weight:700;cursor:pointer;font-size:13px;white-space:nowrap}
    #cj-ph-hunt-btn:hover{background:#ef6d00}
    #cj-ph-chips{display:flex;gap:6px;flex-wrap:wrap}
    #cj-ph-chip{background:#f5f5f5;border:1px solid #e5e5ea;padding:6px 12px;border-radius:999px;font-size:12px;cursor:pointer;font-weight:600;color:#333;transition:all .15s}
    #cj-ph-chip:hover{background:#fff4e8;border-color:#ff7700;color:#ff7700}
    #cj-ph-chip.active{background:#ff7700;border-color:#ff7700;color:#fff}
    #cj-ph-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    #cj-ph-row label{font-size:12px;color:#666;font-weight:600}
    #cj-ph-row select{padding:6px 10px;border:1px solid #e5e5ea;border-radius:8px;font-size:12px;outline:none;background:#fff}
    #cj-ph-results{min-height:60px}
    #cj-ph-product{display:flex;gap:10px;padding:10px;border:1px solid #e5e5ea;border-radius:10px;margin-bottom:8px;cursor:pointer;transition:box-shadow .15s,border-color .15s;text-decoration:none;color:inherit}
    #cj-ph-product:hover{border-color:#ff7700;box-shadow:0 2px 8px rgba(255,119,0,.15)}
    #cj-ph-pimg{width:64px;height:64px;border-radius:8px;object-fit:cover;background:#f5f5f5;flex-shrink:0}
    #cj-ph-pinfo{flex:1;min-width:0}
    #cj-ph-pname{font-size:12px;font-weight:600;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    #cj-ph-price{font-size:14px;font-weight:700;color:#ff7700;margin-top:4px}
    #cj-ph-pscore{display:inline-block;background:#ff7700;color:#fff;border-radius:999px;padding:1px 7px;font-size:10px;font-weight:700;margin-top:4px}
    #cj-ph-empty{padding:24px;text-align:center;color:#999;font-size:13px}
    #cj-ph-footer{padding:12px 16px;border-top:1px solid #e5e5ea;font-size:11px;color:#999;text-align:center}
    #cj-ph-status{font-size:11px;color:#666;padding:6px 0}
  `;
  document.head.appendChild(styleEl);

  // ── HTML markup ────────────────────────────────────────────
  const ov = document.createElement("div");
  ov.id = "cj-ph-overlay";
  ov.innerHTML = `
    <div id="cj-ph-header">
      <div id="cj-ph-logo">PH</div>
      <div>
        <div id="cj-ph-title">Product Hunter</div>
        <div id="cj-ph-subtitle">CJdropshipping · Pinned winning-product panel</div>
      </div>
      <button type="button" id="cj-ph-close" title="Close panel">×</button>
    </div>
    <div id="cj-ph-auth" style="display:none">
      <h3>CJ Product Hunter</h3>
      <p>Sign in to hunt winning products.</p>
      <input id="cj-ph-email" type="email" placeholder="Email address" autocomplete="email">
      <input id="cj-ph-pass" type="password" placeholder="Password" autocomplete="current-password">
      <button type="button" id="cj-ph-auth-btn">Sign In</button>
      <p class="switch-link" id="cj-ph-switch">Don't have an account? <a id="cj-ph-toggle-mode">Sign up</a></p>
    </div>
    <div id="cj-ph-body" style="display:none">
      <form id="cj-ph-search">
        <input id="cj-ph-query" placeholder="e.g. winter jacket — or pick a category below" autocomplete="off">
        <button type="submit" id="cj-ph-hunt-btn">Hunt</button>
      </form>
      <div id="cj-ph-chips">
        <div id="cj-ph-trend-chip" class="cj-ph-chip">🔥 Trending winners</div>
        <button type="button" id="cj-ph-reset" class="cj-ph-chip" style="display:none">↺ Reset</button>
      </div>
      <div id="cj-ph-country-bar" style="display:none">
        <div id="cj-ph-row">
          <label>Ship to:</label>
          <select id="cj-ph-country">
            <option value="">All countries</option>
            <option value="US">🇺🇸 United States</option>
            <option value="GB">🇬🇧 United Kingdom</option>
            <option value="CA">🇨🇦 Canada</option>
            <option value="AU">🇦🇺 Australia</option>
            <option value="DE">🇩🇪 Germany</option>
            <option value="FR">🇫🇷 France</option>
            <option value="JP">🇯🇵 Japan</option>
            <option value="KR">🇰🇷 South Korea</option>
            <option value="SG">🇸🇬 Singapore</option>
            <option value="IN">🇮🇳 India</option>
            <option value="BR">🇧🇷 Brazil</option>
            <option value="MX">🇲🇽 Mexico</option>
            <option value="AE">🇦🇪 UAE</option>
            <option value="ZA">🇿🇦 South Africa</option>
            <option value="NL">🇳🇱 Netherlands</option>
            <option value="IT">🇮🇹 Italy</option>
            <option value="ES">🇪🇸 Spain</option>
            <option value="SE">🇸🇪 Sweden</option>
            <option value="NO">🇳🇴 Norway</option>
          </select>
        </div>
      </div>
      <div id="cj-ph-status">Ready · Click <strong>Hunt</strong> or <strong>Trending</strong> to begin</div>
      <div id="cj-ph-results"></div>
    </div>
    <div id="cj-ph-footer">
      Need help? WhatsApp us: <a href="https://wa.me/8801309524519" target="_blank" rel="noopener" style="color:#16a34a;text-decoration:none;font-weight:600">+880 130 952 4519</a>
    </div>
  `;
  document.body.appendChild(ov);
  console.log("[CJ-PH] Overlay injected.");

  // ── State ──────────────────────────────────────────────────
  const API_BASE = "https://cj-winning-product-hunter-poc.vercel.app";
  const TOKEN_KEY = "cjToken";
  let token = "";
  let mode = "search"; // 'search' | 'trending'
  let authMode = "signin";

  // ── DOM refs ───────────────────────────────────────────────
  const $ = (id) => ov.querySelector("#" + id);
  const authDiv     = $("cj-ph-auth");
  const bodyDiv     = $("cj-ph-body");
  const emailIn     = $("cj-ph-email");
  const passIn      = $("cj-ph-pass");
  const authBtn     = $("cj-ph-auth-btn");
  const switchLnk   = $("cj-ph-toggle-mode");
  const switchTxt   = $("cj-ph-switch");
  const queryIn     = $("cj-ph-query");
  const huntBtn     = $("cj-ph-hunt-btn");
  const trendChip   = $("cj-ph-trend-chip");
  const resetBtn    = $("cj-ph-reset");
  const countryBar  = $("cj-ph-country-bar");
  const countrySel  = $("cj-ph-country");
  const statusEl    = $("cj-ph-status");
  const resultsEl   = $("cj-ph-results");
  const closeBtn    = $("cj-ph-close");

  // ── Helpers ────────────────────────────────────────────────
  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" })[c]); }

  async function apiFetch(path, opts = {}) {
    const res = await fetch(API_BASE + path, {
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {})
    });
    if (res.status === 401) { localStorage.removeItem(TOKEN_KEY); token = ""; showAuth(); throw new Error("Session expired"); }
    return res.json().catch(() => null);
  }

  function setStatus(msg, tone) {
    statusEl.innerHTML = msg;
    statusEl.style.color = tone === "error" ? "#dc2626" : tone === "ok" ? "#16a34a" : "#666";
  }

  function showAuth() {
    authDiv.style.display = "block";
    bodyDiv.style.display = "none";
    authBtn.textContent = authMode === "signup" ? "Create Account" : "Sign In";
    switchLnk.textContent = authMode === "signup" ? "Already have an account? Sign in" : "Don't have an account? Sign up";
  }

  function showApp() {
    authDiv.style.display = "none";
    bodyDiv.style.display = "flex";
    loadUserInfo();
  }

  async function loadUserInfo() {
    try {
      const u = await apiFetch("/api/auth/me");
      if (u && u.email) setStatus(`Welcome, ${esc(u.full_name || u.email.split("@")[0])} · Ready`, "ok");
    } catch {}
  }

  function renderProduct(p) {
    const sold  = Number(p.totalSales || 0);
    const score = Number(p.score || 0);
    const label = score >= 70 ? "High" : score >= 45 ? "Mid" : "Low";
    const cls   = score >= 70 ? "high" : score >= 45 ? "mid" : "low";
    const imgSrc = p.image || "";
    return `
      <a id="cj-ph-product" href="#" data-id="${esc(String(p.id))}" onclick="event.preventDefault();openProduct(${JSON.stringify(p.id).replace(/"/g,'&quot;')})">
        <img src="${esc(imgSrc)}" class="cj-ph-pimg" alt="" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23f5f5f5%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%23bbb%22 font-size=%2212%22>No Img</text></svg>'">
        <div class="cj-ph-pinfo">
          <div class="cj-ph-pname">${esc(p.name || "Untitled")}</div>
          <div class="cj-ph-price">$${Number(p.cjCost || 0).toFixed(2)}</div>
          <span class="cj-ph-pscore ${cls}">${score}/100</span>
          <span style="font-size:11px;color:#999;margin-left:6px">${sold.toLocaleString()} sold</span>
        </div>
      </a>`;
  }

  async function doSearch(query, country) {
    resultsEl.innerHTML = '<div style="padding:16px;text-align:center;color:#999">Searching…</div>';
    setStatus("Searching…", "");
    try {
      const url = `/api/public/products?page=1&pageSize=15&q=${encodeURIComponent(query)}&country=${encodeURIComponent(country)}`;
      const data = await apiFetch(url);
      const items = data?.products || [];
      resultsEl.innerHTML = items.length
        ? items.map(renderProduct).join("")
        : '<div id="cj-ph-empty">No products found · Try a different keyword</div>';
      setStatus(`${items.length} result(s) · Click a product to open on CJdropshipping`, "ok");
    } catch (err) {
      resultsEl.innerHTML = `<div id="cj-ph-empty" style="color:#dc2626">Error: ${esc(err.message)}</div>`;
      setStatus("Search failed", "error");
    }
  }

  async function doTrending(country) {
    resultsEl.innerHTML = '<div style="padding:16px;text-align:center;color:#999">Loading trending…</div>';
    setStatus("Loading trending winners…", "");
    try {
      const url = `/api/public/products?trending=true&page=1&pageSize=15&country=${encodeURIComponent(country)}`;
      const data = await apiFetch(url);
      const items = data?.products || [];
      resultsEl.innerHTML = items.length
        ? items.map(renderProduct).join("")
        : '<div id="cj-ph-empty">No trending products found for this country</div>';
      setStatus(`${items.length} trending winner(s) found`, "ok");
    } catch (err) {
      resultsEl.innerHTML = `<div id="cj-ph-empty" style="color:#dc2626">Error: ${esc(err.message)}</div>`;
      setStatus("Failed to load trending", "error");
    }
  }

  // Expose openProduct globally so inline onclick can call it
  window.openProduct = (id) => {
    chrome.runtime.sendMessage({ action: "openProduct", productId: String(id) }).catch(() => {
      window.open(`https://www.cjdropshipping.com/product/-p-${encodeURIComponent(String(id))}.html`, "_blank");
    });
  };

  // ── Event handlers ─────────────────────────────────────────
  authBtn.addEventListener("click", async () => {
    const email    = emailIn.value.trim();
    const password = passIn.value;
    if (!email || !password) { alert("Please fill in all fields."); return; }
    authBtn.disabled = true;
    authBtn.textContent = "Loading…";
    try {
      const path  = authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const data  = await apiFetch(path, { method: "POST", body: { email, password } });
      if (!data || !data.token) {
        authBtn.disabled = false;
        authBtn.textContent = authMode === "signup" ? "Create Account" : "Sign In";
        alert(authMode === "signup" ? "Account created! Check your email and sign in." : "Invalid credentials.");
        return;
      }
      token = data.token;
      localStorage.setItem(TOKEN_KEY, token);
      showApp();
    } catch (err) {
      alert(err.message || "Authentication failed");
    } finally {
      authBtn.disabled = false;
      authBtn.textContent = authMode === "signup" ? "Create Account" : "Sign In";
    }
  });

  switchLnk.addEventListener("click", (e) => {
    e.preventDefault();
    authMode = authMode === "signin" ? "signup" : "signin";
    showAuth();
  });

  huntBtn.addEventListener("click", () => {
    const q = queryIn.value.trim();
    if (!q) { alert("Enter a search keyword"); return; }
    mode = "search";
    trendChip.classList.remove("active");
    resetBtn.style.display = "";
    doSearch(q, countrySel.value);
  });

  trendChip.addEventListener("click", () => {
    mode = mode === "trending" ? "search" : "trending";
    trendChip.classList.toggle("active", mode === "trending");
    resetBtn.style.display = mode === "trending" ? "" : "none";
    countryBar.style.display = mode === "trending" ? "" : "none";
    if (mode === "trending") doTrending(countrySel.value);
  });

  resetBtn.addEventListener("click", () => {
    mode = "search";
    trendChip.classList.remove("active");
    resetBtn.style.display = "none";
    countryBar.style.display = "none";
    resultsEl.innerHTML = "";
    queryIn.value = "";
    setStatus("Reset · Enter a keyword and click Hunt", "");
  });

  countrySel.addEventListener("change", () => {
    if (mode === "trending") doTrending(countrySel.value);
  });

  queryIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter") huntBtn.click();
  });

  closeBtn.addEventListener("click", () => {
    ov.style.display = "none";
  });

  // Open side panel via background script on icon click
  document.addEventListener("click", (e) => {
    if (e.target.id === "cj-ph-toggle-trigger") chrome.runtime.sendMessage({ action: "openSidePanel" });
  });
}

// ── Init ─────────────────────────────────────────────────────
if (IS_CJ) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectPanel);
  } else {
    injectPanel();
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "showOverlay") {
    const ov = document.getElementById("cj-ph-overlay");
    if (ov) { ov.style.display = "flex"; sendResponse({ ok: true }); }
  }
  if (msg.action === "hideOverlay") {
    const ov = document.getElementById("cj-ph-overlay");
    if (ov) { ov.style.display = "none"; sendResponse({ ok: true }); }
  }
});