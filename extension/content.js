// content.js — CJ Product Hunter split-screen panel on CJdropshipping.com
// When active, pushes the main page to the left and shows the full app on the right
console.log("[CJ-PH] Content script loaded");

const IS_CJ = /cjdropshipping\.com/.test(window.location.hostname);
if (!IS_CJ) { console.log("[CJ-PH] Not a CJ page, skipping."); }

let phPanelOpen = false;
let authMode = "signin"; // local to this script instance
let token = "";

function getAuthToken() {
  try { return localStorage.getItem("cjToken") || ""; } catch { return ""; }
}
function setAuthToken(t) {
  try { if (t) localStorage.setItem("cjToken", t); else localStorage.removeItem("cjToken"); } catch {}
}

const PH_API = "https://cj-winning-product-hunter-poc.vercel.app";
const TKN_KEY = "cjToken";

function injectPanel() {
  if (document.getElementById("cj-ph-root")) return;

  token = getAuthToken();

  // ── Styles ─────────────────────────────────────────────────
  const styleEl = document.createElement("style");
  styleEl.textContent = `
    #cj-ph-root{display:none;position:fixed;inset:0;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif;color:#333;background:#f5f5f5;overflow:hidden}
    [data-cjph-theme="dark"]#cj-ph-root{background:#0f1117;color:#e2e4f0}
    #cj-ph-inner{display:flex;width:100%;height:100%}
    #cj-ph-page{flex:1;min-width:0;height:100%;overflow:auto;position:relative}
    #cj-ph-panel{width:500px;max-width:65vw;height:100%;overflow-y:auto;overflow-x:hidden;background:#f5f5f5;border-left:1px solid #e5e5ea;flex-shrink:0;display:flex;flex-direction:column}
    [data-cjph-theme="dark"]#cj-ph-panel{background:#0f1117;border-left-color:#2e3040}
    #cj-ph-tog{position:fixed;top:12px;right:12px;z-index:2147483648;width:46px;height:46px;border-radius:50%;background:#ff7700;color:#fff;border:none;cursor:pointer;font-size:20px;box-shadow:0 2px 12px rgba(0,0,0,.25);display:none;align-items:center;justify-content:center;transition:transform .15s,background .15s;line-height:1}
    #cj-ph-tog:hover{background:#ef6d00;transform:scale(1.05)}
    /* Close button inside panel header */
    #cj-ph-close-btn{position:absolute;top:12px;right:12px;z-index:5;background:#fff;border:1px solid #e5e5ea;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:16px;color:#666;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.1)}
    #cj-ph-close-btn:hover{background:#f5f5f5;color:#333}
    [data-cjph-theme="dark"]#cj-ph-close-btn{background:#1a1b26;border-color:#2e3040;color:#e2e4f0}
    @media print{#cj-ph-root{display:none!important}}
  `;
  document.head.appendChild(styleEl);

  // ── Root container ───────────────────────────────────────────
  const root = document.createElement("div");
  root.id = "cj-ph-root";
  root.innerHTML = `
    <button type="button" id="cj-ph-tog" title="Toggle CJ Product Hunter">⌘</button>
    <div id="cj-ph-inner">
      <div id="cj-ph-page"></div>
      <div id="cj-ph-panel" style="position:relative">
        <button type="button" id="cj-ph-close-btn" title="Close panel">×</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  // Theme
  let curTheme = "";
  try { curTheme = localStorage.getItem("cjphTheme") || ""; } catch {}
  if (curTheme === "dark") root.setAttribute("data-cjph-theme", "dark");

  const panelEl = document.getElementById("cj-ph-panel");
  const togBtn  = document.getElementById("cj-ph-tog");
  const closeBtn = document.getElementById("cj-ph-close-btn");

  // ── Toggle ───────────────────────────────────────────────────
  function togglePanel(open) {
    phPanelOpen = open;
    root.style.display = open ? "flex" : "none";
    togBtn.style.display = open ? "none" : "flex";
  }

  if (togBtn) togBtn.addEventListener("click", () => togglePanel(!phPanelOpen));
  if (closeBtn) closeBtn.addEventListener("click", () => togglePanel(false));

  // ── Build panel HTML ─────────────────────────────────────────
  function buildAuthHtml() {
    return `<div style="text-align:center;padding:36px 24px;flex:1;display:flex;flex-direction:column;justify-content:center">
      <div style="display:grid;place-items:center;width:52px;height:52px;border-radius:14px;background:#ff7700;color:#fff;font-weight:900;font-size:20px;margin:0 auto 14px">PH</div>
      <h2 style="margin:0 0 6px;font-size:18px">CJ Product Hunter</h2>
      <p style="margin:0 0 20px;color:#888;font-size:13px">Sign in to hunt winning products.</p>
      <div id="ph-auth-msg" style="font-size:12px;color:#888;margin-bottom:12px;min-height:18px"></div>
      <label style="display:block;text-align:left;font-size:12px;font-weight:600;color:#666;margin-bottom:4px">Email</label>
      <input id="ph-a-email" type="email" placeholder="you@example.com" autocomplete="email"
        style="width:100%;padding:11px 12px;border:1px solid #e5e5ea;border-radius:9px;font-size:14px;margin-bottom:10px;outline:none;background:#fff;color:#333">
      <label style="display:block;text-align:left;font-size:12px;font-weight:600;color:#666;margin-bottom:4px">Password</label>
      <div style="display:flex;gap:6px;margin-bottom:12px">
        <input id="ph-a-pass" type="password" placeholder="••••••••" autocomplete="current-password"
          style="flex:1;padding:11px 12px;border:1px solid #e5e5ea;border-radius:9px;font-size:14px;outline:none;background:#fff;color:#333">
        <button type="button" id="ph-a-eye" style="padding:0 12px;border:1px solid #e5e5ea;border-radius:9px;background:#fff;cursor:pointer;font-size:14px">👁</button>
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#888;margin-bottom:14px;cursor:pointer">
        <input type="checkbox" id="ph-a-savepwd" checked style="accent-color:#ff7700"> Save password locally
      </label>
      <button type="button" id="ph-a-btn" style="width:100%;padding:12px;border:none;border-radius:9px;background:#ff7700;color:#fff;font-weight:700;font-size:15px;cursor:pointer">Sign In</button>
      <p id="ph-a-switch" style="font-size:12px;color:#888;margin-top:14px">Don't have an account? <a href="#" id="ph-a-toggle" style="color:#ff7700;text-decoration:underline">Sign up</a></p>
    </div>`;
  }

  function buildAppHtml() {
    return `<div style="display:flex;flex-direction:column;height:100%">
      <!-- Header -->
      <div style="display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #e5e5ea;background:#fff;flex-shrink:0">
        <div style="display:grid;place-items:center;width:38px;height:38px;border-radius:11px;background:#ff7700;color:#fff;font-weight:800;font-size:14px;flex-shrink:0">PH</div>
        <div style="flex:1"><strong style="font-size:14px">Product Hunter</strong><br><small style="color:#999;font-size:11px">CJdropshipping · Pinned panel</small></div>
        <span id="ph-user-email" style="font-size:11px;color:#999;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
        <button type="button" id="ph-theme-btn" title="Toggle dark/light" style="padding:6px 8px;border:1px solid #e5e5ea;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;flex-shrink:0">🌙</button>
        <button type="button" id="ph-logout-btn" title="Logout" style="padding:6px 10px;border:1px solid #e5e5ea;border-radius:8px;background:#fff;cursor:pointer;font-size:12px;color:#666;flex-shrink:0">Logout</button>
      </div>
      <!-- Filters -->
      <details id="ph-filters" style="background:#fff;border-bottom:1px solid #e5e5ea;padding:10px 16px;flex-shrink:0">
        <summary style="cursor:pointer;font-weight:700;color:#333;font-size:13px;user-select:none;padding:2px 0">⚙ Filters — price, stock, shipping, country</summary>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;font-size:12px">
          <label>Min price ($)<input type="number" id="ph-f-min-price" min="0" step="0.01" placeholder="8" style="border:1px solid #e5e5ea;border-radius:7px;padding:7px 8px;font-size:12px;width:100%;outline:none;background:#fff;color:#333"></label>
          <label>Max price ($)<input type="number" id="ph-f-max-price" min="0" step="0.01" placeholder="60" style="border:1px solid #e5e5ea;border-radius:7px;padding:7px 8px;font-size:12px;width:100%;outline:none;background:#fff;color:#333"></label>
          <label>Min stock<input type="number" id="ph-f-min-stock" min="0" step="1" placeholder="100" style="border:1px solid #e5e5ea;border-radius:7px;padding:7px 8px;font-size:12px;width:100%;outline:none;background:#fff;color:#333"></label>
          <label>Max stock<input type="number" id="ph-f-max-stock" min="0" step="1" placeholder="5000" style="border:1px solid #e5e5ea;border-radius:7px;padding:7px 8px;font-size:12px;width:100%;outline:none;background:#fff;color:#333"></label>
          <label>Deliver to:
            <select id="ph-f-deliver" style="border:1px solid #e5e5ea;border-radius:7px;padding:7px 8px;font-size:12px;width:100%;outline:none;background:#fff;color:#333">
              <option value="US">US</option><option value="GB">GB</option><option value="CA">CA</option>
              <option value="AU">AU</option><option value="DE">DE</option><option value="FR">FR</option>
              <option value="JP">JP</option><option value="KR">KR</option><option value="SG">SG</option>
              <option value="IN">IN</option><option value="BR">BR</option><option value="MX">MX</option>
              <option value="AE">AE</option><option value="ZA">ZA</option><option value="NL">NL</option>
              <option value="IT">IT</option><option value="ES">ES</option><option value="SE">SE</option><option value="NO">NO</option>
            </select>
          </label>
        </div>
        <div style="display:flex;gap:16px;margin-top:10px;font-size:12px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="ph-f-free" style="accent-color:#ff7700"> Free shipping</label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="ph-f-quick" style="accent-color:#ff7700"> 🚀 Quick delivery</label>
        </div>
      </details>
      <!-- Search -->
      <div style="padding:12px 16px;border-bottom:1px solid #e5e5ea;background:#fff;display:flex;gap:8px;flex-shrink:0">
        <input id="ph-query" placeholder="e.g. winter jacket — or pick a category below" autocomplete="off"
          style="flex:1;padding:11px 13px;border:1px solid #e5e5ea;border-radius:9px;font-size:14px;outline:none;background:#fff;color:#333">
        <button type="button" id="ph-hunt-btn" style="background:#ff7700;color:#fff;border:none;padding:11px 20px;border-radius:9px;font-weight:700;cursor:pointer;font-size:14px">Hunt</button>
      </div>
      <!-- Category -->
      <div style="padding:10px 16px;border-bottom:1px solid #e5e5ea;background:#fff;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;flex-shrink:0">
        <label for="ph-cat" style="font-weight:600;color:#666">📂 Browse category:</label>
        <select id="ph-cat" style="padding:7px 10px;border:1px solid #e5e5ea;border-radius:8px;font-size:12px;background:#fff;color:#333;outline:none">
          <option value="">— Select a category —</option>
          <option value="1">👗 Women's Clothing</option><option value="2">🐾 Pet Supplies</option>
          <option value="3">🛋️ Home, Garden & Furniture</option><option value="4">💄 Health, Beauty & Hair</option>
          <option value="5">💍 Jewelry & Watches</option><option value="6">👔 Men's Clothing</option>
          <option value="7">🎒 Bags & Shoes</option><option value="8">🧸 Toys, Kids & Babies</option>
          <option value="9">⚽ Sports & Outdoors</option><option value="10">📱 Consumer Electronics</option>
          <option value="11">🔧 Home Improvement</option><option value="12">🚗 Automobiles</option>
          <option value="13">📞 Phones & Accessories</option><option value="14">💻 Computer & Office</option>
        </select>
        <button type="button" id="ph-cat-hunt" style="background:#fff;border:1px solid #e5e5ea;padding:7px 12px;border-radius:999px;font-size:12px;cursor:pointer;font-weight:600">🎯 Hunt by category</button>
      </div>
      <!-- Mode chips -->
      <div style="padding:10px 16px;border-bottom:1px solid #e5e5ea;background:#fff;display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0">
        <button type="button" id="ph-trend-chip" style="background:#fff;border:1px solid #e5e5ea;padding:6px 14px;border-radius:999px;font-size:12px;cursor:pointer;font-weight:600">🔥 Trending winners</button>
        <select id="ph-trend-country" style="display:none;padding:5px 8px;border-radius:999px;border:1px solid #e5e5ea;font-size:11px;font-weight:600;background:#fff;color:#333;outline:none;max-width:130px">
          <option value="">🌍 Country...</option>
          <option value="US">🇺🇸 US</option><option value="GB">🇬🇧 UK</option><option value="CA">🇨🇦 CA</option>
          <option value="AU">🇦🇺 AU</option><option value="DE">🇩🇪 DE</option><option value="FR">🇫🇷 FR</option>
          <option value="ES">🇪🇸 ES</option><option value="IT">🇮🇹 IT</option><option value="NL">🇳🇱 NL</option>
          <option value="JP">🇯🇵 JP</option><option value="KR">🇰🇷 KR</option><option value="SG">🇸🇬 SG</option>
          <option value="MY">🇲🇾 MY</option><option value="TH">🇹🇭 TH</option><option value="VN">🇻🇳 VN</option>
          <option value="PH">🇵🇭 PH</option><option value="IN">🇮🇳 IN</option><option value="BR">🇧🇷 BR</option>
          <option value="MX">🇲🇽 MX</option><option value="AE">🇦🇪 UAE</option><option value="SA">🇸🇦 SA</option>
          <option value="IL">🇮🇱 IL</option><option value="ZA">🇿🇦 ZA</option><option value="NZ">🇳🇿 NZ</option>
          <option value="SE">🇸🇪 SE</option><option value="NO">🇳🇴 NO</option><option value="CH">🇨🇭 CH</option>
          <option value="PL">🇵🇱 PL</option><option value="BE">🇧🇪 BE</option><option value="AT">🇦🇹 AT</option>
        </select>
        <button type="button" id="ph-bestsell-chip" style="background:#fff;border:1px solid #e5e5ea;padding:6px 14px;border-radius:999px;font-size:12px;cursor:pointer;font-weight:600">🛒 Best-Selling</button>
        <button type="button" id="ph-supplier-chip" style="background:#fff;border:1px solid #e5e5ea;padding:6px 14px;border-radius:999px;font-size:12px;cursor:pointer;font-weight:600">🏆 Best Supplier</button>
        <button type="button" id="ph-reset-chip" style="background:#fff;border:1px solid #e5e5ea;padding:6px 14px;border-radius:999px;font-size:12px;cursor:pointer;font-weight:600;display:none">↺ Reset</button>
      </div>
      <!-- Best-seller country/sort bar -->
      <div id="ph-bs-bar" style="display:none;padding:10px 16px;border-bottom:1px solid #e5e5ea;background:#fff;font-size:12px;flex-shrink:0">
        <label for="ph-bs-country" style="font-weight:600;color:#666;margin-right:6px">🌍 Ship to:</label>
        <select id="ph-bs-country" style="padding:6px 10px;border:1px solid #e5e5ea;border-radius:8px;font-size:12px;margin-right:12px;background:#fff;color:#333;outline:none">
          <option value="">All countries</option>
          <option value="US">US</option><option value="GB">GB</option><option value="CA">CA</option>
          <option value="AU">AU</option><option value="DE">DE</option><option value="FR">FR</option>
          <option value="JP">JP</option><option value="KR">KR</option><option value="SG">SG</option>
          <option value="IN">IN</option><option value="BR">BR</option><option value="MX">MX</option>
          <option value="AE">AE</option><option value="ZA">ZA</option><option value="NL">NL</option>
          <option value="IT">IT</option><option value="ES">ES</option><option value="SE">SE</option><option value="NO">NO</option>
        </select>
        <label for="ph-bs-sort" style="font-weight:600;color:#666;margin-right:6px">📊 Sort by:</label>
        <select id="ph-bs-sort" style="padding:6px 10px;border:1px solid #e5e5ea;border-radius:8px;font-size:12px;background:#fff;color:#333;outline:none">
          <option value="90d">90-day sales</option><option value="30d">30-day sales</option><option value="7d">7-day sales</option>
        </select>
      </div>
      <!-- Status -->
      <div style="padding:8px 16px;border-bottom:1px solid #e5e5ea;background:#fff;flex-shrink:0">
        <span id="ph-status" style="font-size:11px;color:#888;background:#f2f2f2;border-radius:999px;padding:5px 10px;display:inline-block">Ready · Click <strong>Hunt</strong> or <strong>Trending</strong> to begin</span>
      </div>
      <!-- Results -->
      <div id="ph-results" style="padding:12px 16px;display:flex;flex-direction:column;gap:8px;flex:1;min-height:100px;overflow-y:auto"></div>
      <!-- Pagination -->
      <div id="ph-pag" style="display:none;padding:8px 16px;border-top:1px solid #e5e5ea;background:#fff;align-items:center;gap:8px;font-size:12px;flex-shrink:0">
        <button type="button" id="ph-prev" style="padding:6px 14px;border:1px solid #e5e5ea;border-radius:8px;background:#fff;cursor:pointer;font-size:12px;color:#333">← Prev</button>
        <span id="ph-page-info" style="color:#888">Page 1</span>
        <button type="button" id="ph-next" style="padding:6px 14px;border:1px solid #e5e5ea;border-radius:8px;background:#fff;cursor:pointer;font-size:12px;color:#333">Next →</button>
      </div>
      <!-- Always-on + footer -->
      <div style="padding:12px 16px;border-top:1px solid #e5e5ea;background:#fff;flex-shrink:0">
        <button type="button" id="ph-always-btn" style="width:100%;padding:12px;border:none;border-radius:10px;background:#ff7700;color:#fff;font-weight:700;font-size:14px;cursor:pointer">📌 Open as always-on window</button>
        <p style="font-size:10px;color:#bbb;margin-top:6px;line-height:1.4;text-align:center">Click a product to open on CJdropshipping · The panel stays open while you browse.</p>
      </div>
      <div style="padding:10px 16px;border-top:1px solid #e5e5ea;font-size:11px;color:#bbb;text-align:center;background:#fff;flex-shrink:0">
        Need help? WhatsApp: <a href="https://wa.me/8801309524519" target="_blank" rel="noopener" style="color:#16a34a;text-decoration:none;font-weight:600">+880 130 952 4519</a>
      </div>
    </div>`;
  }

  // ── API helpers ──────────────────────────────────────────────
  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" })[c]); }

  async function apiFetch(path, opts = {}) {
    const url = PH_API + path;
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    console.log(`[CJ-PH][api] ${opts.method || 'GET'} ${url}`, token ? `token=${token.substring(0,20)}...` : 'no token');
    let res;
    try {
      res = await fetch(url, { method: opts.method || "GET", headers, ...(opts.body ? { body: JSON.stringify(opts.body) } : {}) });
    } catch (err) {
      console.error("[CJ-PH][api] network error:", err?.message || err);
      throw new Error("Network error — check your internet connection.");
    }
    console.log(`[CJ-PH][api] status: ${res.status} ${res.statusText}`);
    let data;
    try {
      const ct = res.headers.get("content-type") || "";
      data = ct.includes("json") ? await res.json() : await res.text();
    } catch {
      data = await res.text().catch(() => "");
    }
    console.log(`[CJ-PH][api] body:`, typeof data === "object" ? JSON.stringify(data).substring(0, 200) : data);

    if (res.status === 401) {
      token = "";
      setAuthToken("");
      throw new Error("Session expired — please sign in again.");
    }
    if (!res.ok) {
      const errMsg = (typeof data === "object" && data && data.error) || data || `HTTP ${res.status}`;
      console.warn("[CJ-PH][api] non-ok response:", res.status, errMsg);
      throw new Error(String(errMsg));
    }
    return typeof data === "object" ? data : {};
  }

  function setStatus(msg, tone) {
    const el = document.getElementById("ph-status");
    if (!el) return;
    el.innerHTML = msg;
    if (tone === "error") { el.style.color = "#dc2626"; el.style.background = "#fdecea"; }
    else if (tone === "ok") { el.style.color = "#16a34a"; el.style.background = "#dcfce7"; }
    else { el.style.color = "#888"; el.style.background = "#f2f2f2"; }
  }

  // ── Auth UI ──────────────────────────────────────────────────
  function showAuthUI() {
    panelEl.innerHTML = buildAuthHtml();
    wireAuthUI();
  }

  function showAppUI() {
    panelEl.innerHTML = buildAppHtml();
    wireAppUI();
    loadUserInfo();
  }

  function wireAuthUI() {
    const emailIn = document.getElementById("ph-a-email");
    const passIn  = document.getElementById("ph-a-pass");
    const eyeBtn  = document.getElementById("ph-a-eye");
    const authBtn = document.getElementById("ph-a-btn");
    const toggleLnk = document.getElementById("ph-a-toggle");
    const saveChk = document.getElementById("ph-a-savepwd");
    const msgEl   = document.getElementById("ph-auth-msg");

    if (eyeBtn) eyeBtn.addEventListener("click", () => {
      passIn.type = passIn.type === "password" ? "text" : "password";
    });

    if (authBtn) authBtn.addEventListener("click", async () => {
      const email = emailIn.value.trim();
      const pwd = passIn.value;
      console.log(`[CJ-PH][auth] ===== BUTTON CLICKED ===== mode=${authMode} email=${email ? email.substring(0,6)+'...' : 'EMPTY'} pwdLen=${pwd.length}`);
      if (!email || !pwd) {
        console.log("[CJ-PH][auth] VALIDATION FAILED: empty fields");
        msgEl.textContent = "Please fill in all fields.";
        msgEl.style.color = "#dc2626";
        return;
      }
      if (authMode === "signup" && pwd.length < 8) {
        console.log("[CJ-PH][auth] VALIDATION FAILED: password too short");
        msgEl.textContent = "Password must be at least 8 characters.";
        msgEl.style.color = "#dc2626";
        return;
      }

      // ── Step 1: Disable button, show loading ──────────────────
      console.log("[CJ-PH][auth] Step 1: disabling button, showing loading...");
      authBtn.disabled = true;
      authBtn.textContent = "Loading…";
      msgEl.textContent = "";
      msgEl.style.color = "#888";

      // ── Step 2: Call the API ──────────────────────────────────
      const path = authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const body = { email, password: pwd };
      console.log(`[CJ-PH][auth] Step 2: calling POST ${PH_API}${path}`);
      let data;
      try {
        data = await apiFetch(path, { method: "POST", body });
        console.log("[CJ-PH][auth] Step 2 OK — API response:", data);
      } catch (apiErr) {
        // API call failed — show error and re-enable
        console.error("[CJ-PH][auth] Step 2 FAILED:", apiErr?.message || apiErr);
        const msg = apiErr?.message || "Could not connect to server.";
        msgEl.textContent = msg;
        msgEl.style.color = "#dc2626";
        authBtn.disabled = false;
        authBtn.textContent = authMode === "signup" ? "Create Account" : "Sign In";
        return;
      }

      // ── Step 3: Check response ────────────────────────────────
      console.log("[CJ-PH][auth] Step 3: checking response...");
      if (!data) {
        console.error("[CJ-PH][auth] Step 3 FAILED: data is null/undefined");
        msgEl.textContent = "Server returned no data.";
        msgEl.style.color = "#dc2626";
        authBtn.disabled = false;
        authBtn.textContent = authMode === "signup" ? "Create Account" : "Sign In";
        return;
      }

      // ── Step 4: Handle signup ─────────────────────────────────
      if (authMode === "signup") {
        console.log("[CJ-PH][auth] Step 4: handling signup response...");
        if (data.token) {
          // Signup succeeded AND auto-logged in
          console.log("[CJ-PH][auth] Step 4: signup auto-login — token received");
          token = data.token;
          setAuthToken(token);
          console.log("[CJ-PH][auth] Step 4: token saved to localStorage");

          // Verify with /me
          console.log("[CJ-PH][auth] Step 4: verifying with /api/auth/me...");
          let me;
          try {
            me = await apiFetch("/api/auth/me");
            console.log("[CJ-PH][auth] Step 4: /me response:", me);
          } catch (meErr) {
            console.error("[CJ-PH][auth] Step 4: /me failed:", meErr?.message);
            msgEl.textContent = "Signed in but could not load profile. Try signing in again.";
            msgEl.style.color = "#dc2626";
            authBtn.disabled = false;
            authBtn.textContent = "Sign In";
            return;
          }

          if (me && me.email) {
            console.log("[CJ-PH][auth] Step 4: SUCCESS — showing app UI");
            showAppUI();
          } else {
            console.error("[CJ-PH][auth] Step 4: /me returned no email");
            msgEl.textContent = "Account created but profile could not be loaded.";
            msgEl.style.color = "#dc2626";
            authBtn.disabled = false;
            authBtn.textContent = "Sign In";
          }
        } else {
          // Signup succeeded but email confirmation required
          console.log("[CJ-PH][auth] Step 4: signup requires email confirmation");
          msgEl.textContent = "✅ Account created! Check your email and click the confirmation link, then sign in.";
          msgEl.style.color = "#16a34a";
          authBtn.disabled = false;
          authBtn.textContent = "Sign In";
        }
        return;
      }

      // ── Step 5: Handle login ──────────────────────────────────
      console.log("[CJ-PH][auth] Step 5: handling login response...");
      if (!data.token) {
        console.error("[CJ-PH][auth] Step 5 FAILED: no token in response");
        msgEl.textContent = data.error || "Invalid email or password.";
        msgEl.style.color = "#dc2626";
        authBtn.disabled = false;
        authBtn.textContent = "Sign In";
        return;
      }

      // Login succeeded — save token
      console.log("[CJ-PH][auth] Step 5: login OK — saving token...");
      token = data.token;
      setAuthToken(token);
      console.log("[CJ-PH][auth] Step 5: token saved to localStorage");

      // Verify with /me
      console.log("[CJ-PH][auth] Step 5: verifying with /api/auth/me...");
      let me;
      try {
        me = await apiFetch("/api/auth/me");
        console.log("[CJ-PH][auth] Step 5: /me response:", me);
      } catch (meErr) {
        console.error("[CJ-PH][auth] Step 5: /me failed:", meErr?.message);
        msgEl.textContent = "Signed in but could not load profile. Please try again.";
        msgEl.style.color = "#dc2626";
        authBtn.disabled = false;
        authBtn.textContent = "Sign In";
        return;
      }

      if (me && me.email) {
        console.log("[CJ-PH][auth] Step 5: SUCCESS — showing app UI");
        showAppUI();
      } else {
        console.error("[CJ-PH][auth] Step 5: /me returned no email");
        msgEl.textContent = "Signed in but profile could not be loaded.";
        msgEl.style.color = "#dc2626";
        authBtn.disabled = false;
        authBtn.textContent = "Sign In";
      }
    });

    if (toggleLnk) toggleLnk.addEventListener("click", (e) => {
      e.preventDefault();
      authMode = authMode === "signin" ? "signup" : "signin";
      showAuthUI();
    });

    // Restore saved credentials
    try {
      const saved = JSON.parse(localStorage.getItem("cjphSavedPwd") || "{}");
      if (saved.email) emailIn.value = saved.email;
      if (saved.pwd) passIn.value = saved.pwd;
    } catch {}
  }

  async function loadUserInfo() {
    try {
      const u = await apiFetch("/api/auth/me");
      if (u && u.email) {
        const el = document.getElementById("ph-user-email");
        if (el) el.textContent = u.full_name || u.email.split("@")[0];
        setStatus(`Welcome, ${esc(u.full_name || u.email.split("@")[0])} · Ready`, "ok");
      }
    } catch {}
  }

  // ── App UI wiring ────────────────────────────────────────────
  function wireAppUI() {
    const queryIn     = document.getElementById("ph-query");
    const huntBtn     = document.getElementById("ph-hunt-btn");
    const trendChip   = document.getElementById("ph-trend-chip");
    const trendCountry= document.getElementById("ph-trend-country");
    const bestSellChip= document.getElementById("ph-bestsell-chip");
    const supplierChip= document.getElementById("ph-supplier-chip");
    const resetChip   = document.getElementById("ph-reset-chip");
    const catSelect   = document.getElementById("ph-cat");
    const catHuntBtn  = document.getElementById("ph-cat-hunt");
    const bsBar       = document.getElementById("ph-bs-bar");
    const bsCountrySel= document.getElementById("ph-bs-country");
    const bsSortSel   = document.getElementById("ph-bs-sort");
    const logoutBtn   = document.getElementById("ph-logout-btn");
    const themeBtn    = document.getElementById("ph-theme-btn");
    const alwaysBtn   = document.getElementById("ph-always-btn");
    const prevBtn     = document.getElementById("ph-prev");
    const nextBtn     = document.getElementById("ph-next");
    const pageInfo    = document.getElementById("ph-page-info");
    const resultsEl   = document.getElementById("ph-results");
    const pagDiv      = document.getElementById("ph-pag");

    let mode = "search";
    let page = 1;
    const PS = 15;

    // Theme
    if (themeBtn) {
      themeBtn.addEventListener("click", () => {
        const isDark = root.hasAttribute("data-cjph-theme");
        if (isDark) root.removeAttribute("data-cjph-theme");
        else root.setAttribute("data-cjph-theme", "dark");
        try { localStorage.setItem("cjphTheme", isDark ? "" : "dark"); } catch {}
        themeBtn.textContent = isDark ? "🌙" : "☀️";
      });
      themeBtn.textContent = root.hasAttribute("data-cjph-theme") ? "☀️" : "🌙";
    }

    // Logout
    if (logoutBtn) logoutBtn.addEventListener("click", async () => {
      try { await apiFetch("/api/auth/logout", { method: "POST" }); } catch {}
      token = ""; setAuthToken(""); showAuthUI();
    });

    // Always-on button
    if (alwaysBtn) alwaysBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "showOverlay" }).catch(() => {});
    });

    function setMode(m) {
      mode = m; page = 1;
      trendChip.classList.toggle("active", m === "trending");
      trendCountry.style.display = m === "trending" ? "" : "none";
      bsBar.style.display = m === "bestsell" ? "" : "none";
      resetChip.style.display = (m !== "search" && m !== "category") ? "" : "none";
      if (m === "search" || m === "category") { queryIn.value = ""; lastQuery = ""; }
      renderPag();
    }

    function renderPag() {
      if (!pagDiv) return;
      if (pageInfo) pageInfo.textContent = `Page ${page}`;
      if (prevBtn) prevBtn.disabled = page <= 1;
      if (nextBtn) nextBtn.disabled = false;
    }

    if (trendChip) trendChip.addEventListener("click", () => {
      if (mode === "trending") { setMode("search"); resultsEl.innerHTML = ""; setStatus("Reset · Enter a keyword and click Hunt", ""); return; }
      setMode("trending");
      doTrending(bsCountrySel?.value || "");
    });
    if (bestSellChip) bestSellChip.addEventListener("click", () => { setMode("bestsell"); doBestSellers(bsCountrySel.value, bsSortSel.value); });
    if (supplierChip) supplierChip.addEventListener("click", () => { setMode("supplier"); doSupplierSearch(""); });
    if (resetChip) resetChip.addEventListener("click", () => { setMode("search"); resultsEl.innerHTML = ""; setStatus("Reset · Enter a keyword and click Hunt", ""); });
    if (catHuntBtn) catHuntBtn.addEventListener("click", () => {
      const cat = catSelect?.value;
      if (!cat) { alert("Please select a category first."); return; }
      setMode("category");
      doCategorySearch(cat);
    });
    if (bsCountrySel) bsCountrySel.addEventListener("change", () => { if (mode === "bestsell") doBestSellers(bsCountrySel.value, bsSortSel.value); });
    if (bsSortSel) bsSortSel.addEventListener("change", () => { if (mode === "bestsell") doBestSellers(bsCountrySel.value, bsSortSel.value); });

    function doSearch(query, country) {
      lastQuery = query; lastCountry = country || "";
      setMode("search"); runSearch(query, country);
    }
    let lastQuery = "", lastCountry = "";

    if (huntBtn) huntBtn.addEventListener("click", () => {
      const q = queryIn?.value.trim();
      if (!q) { alert("Enter a search keyword"); return; }
      const country = document.getElementById("ph-f-deliver")?.value || "";
      doSearch(q, country);
    });
    if (queryIn) queryIn.addEventListener("keydown", (e) => { if (e.key === "Enter") huntBtn.click(); });

    if (prevBtn) prevBtn.addEventListener("click", () => { if (page > 1) { page--; renderPag(); runCurrent(); } });
    if (nextBtn) nextBtn.addEventListener("click", () => { page++; renderPag(); runCurrent(); });

    function runCurrent() {
      if (mode === "search") runSearch(lastQuery, lastCountry);
      else if (mode === "trending") doTrending(bsCountrySel?.value || "");
      else if (mode === "bestsell") doBestSellers(bsCountrySel.value, bsSortSel.value);
      else if (mode === "supplier") doSupplierSearch("");
      else if (mode === "category") doCategorySearch("");
    }

    // ── Render product item ─────────────────────────────────────
    function scoreCls(score) {
      score = Number(score) || 0;
      return score >= 70 ? "high" : score >= 45 ? "mid" : "low";
    }
    function scoreBg(cls) { return cls === "high" ? "#e6f4f0" : cls === "mid" ? "#fdf3e3" : "#fdecea"; }
    function scoreColor(cls) { return cls === "high" ? "#007f60" : cls === "mid" ? "#b07c1a" : "#f24724"; }

    function renderProduct(p) {
      const sold = Number(p.totalSales || 0);
      const score = Number(p.score || 0);
      const sc = scoreCls(score);
      const imgSrc = p.image || "";
      return `<div class="ph-item" data-id="${esc(String(p.id))}"
        style="display:flex;gap:10px;padding:10px;border:1px solid #e5e5ea;border-radius:11px;cursor:pointer;transition:border-color .15s,box-shadow .15s;background:#fff">
        <img src="${esc(imgSrc)}" style="width:64px;height:64px;border-radius:8px;object-fit:cover;background:#f5f5f5;flex-shrink:0"
          onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23f5f5f5%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%23bbb%22 font-size=%2212%22>No Img</text></svg>'">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(p.name || "Untitled")}</div>
          <div style="font-size:14px;font-weight:700;color:#ff7700;margin-top:4px">$${Number(p.cjCost || 0).toFixed(2)}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
            <span style="display:inline-block;background:${scoreBg(sc)};color:${scoreColor(sc)};border-radius:999px;padding:1px 7px;font-size:10px;font-weight:700">${score}/100</span>
            <span style="font-size:11px;color:#999">${sold.toLocaleString()} sold</span>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
            <button type="button" class="ph-btn-detail" data-id="${esc(String(p.id))}" style="font-size:10px;padding:3px 8px;border-radius:6px;border:1px solid #e5e5ea;background:#f5f5f5;color:#333;cursor:pointer">Supplier info</button>
            <button type="button" class="ph-btn-list" data-id="${esc(String(p.id))}" style="font-size:10px;padding:3px 8px;border-radius:6px;border:none;background:#ff7700;color:#fff;cursor:pointer;font-weight:600">🏪 List</button>
          </div>
        </div>
      </div>`;
    }

    // ── Search ──────────────────────────────────────────────────
    async function runSearch(query, country) {
      if (!resultsEl) return;
      resultsEl.innerHTML = '<div style="padding:20px;text-align:center;color:#888">Searching…</div>';
      setStatus("Searching…", "");
      try {
        const url = `/api/public/products?page=${page}&pageSize=${PS}&q=${encodeURIComponent(query)}&country=${encodeURIComponent(country || "")}`;
        const data = await apiFetch(url);
        const items = data?.products || [];
        resultsEl.innerHTML = items.length
          ? items.map(renderProduct).join("")
          : '<div style="padding:20px;text-align:center;color:#888;font-size:13px">No products found · Try a different keyword</div>';
        setStatus(`${items.length} result(s) · Click a product or "Supplier info"`, "ok");
      } catch (err) {
        resultsEl.innerHTML = `<div style="padding:20px;text-align:center;color:#dc2626;font-size:13px">Error: ${esc(err.message)}</div>`;
        setStatus("Search failed", "error");
      }
    }

    async function doTrending(country) {
      if (!resultsEl) return;
      resultsEl.innerHTML = '<div style="padding:20px;text-align:center;color:#888">Loading trending…</div>';
      setStatus("Loading trending winners…", "");
      try {
        const url = `/api/public/products?trending=true&page=${page}&pageSize=${PS}&country=${encodeURIComponent(country || "")}`;
        const data = await apiFetch(url);
        const items = data?.products || [];
        resultsEl.innerHTML = items.length
          ? items.map(renderProduct).join("")
          : '<div style="padding:20px;text-align:center;color:#888;font-size:13px">No trending products found for this country</div>';
        setStatus(`${items.length} trending winner(s) found`, "ok");
      } catch (err) {
        resultsEl.innerHTML = `<div style="padding:20px;text-align:center;color:#dc2626;font-size:13px">Error: ${esc(err.message)}</div>`;
        setStatus("Failed to load trending", "error");
      }
    }

    async function doBestSellers(country, sort) {
      if (!resultsEl) return;
      resultsEl.innerHTML = '<div style="padding:20px;text-align:center;color:#888">Loading best-sellers…</div>';
      setStatus("Loading best-sellers…", "");
      try {
        const url = `/api/public/products?bestseller=true&page=${page}&pageSize=${PS}&country=${encodeURIComponent(country || "")}&sort=${sort}`;
        const data = await apiFetch(url);
        const items = data?.products || [];
        resultsEl.innerHTML = items.length
          ? items.map(renderProduct).join("")
          : '<div style="padding:20px;text-align:center;color:#888;font-size:13px">No best-seller products found</div>';
        setStatus(`${items.length} best-seller(s) found`, "ok");
      } catch (err) {
        resultsEl.innerHTML = `<div style="padding:20px;text-align:center;color:#dc2626;font-size:13px">Error: ${esc(err.message)}</div>`;
        setStatus("Failed to load best-sellers", "error");
      }
    }

    async function doSupplierSearch(_q) {
      if (!resultsEl) return;
      resultsEl.innerHTML = '<div style="padding:20px;text-align:center;color:#888">Loading suppliers…</div>';
      setStatus("Loading top suppliers…", "");
      try {
        const url = `/api/public/suppliers?page=${page}&pageSize=10`;
        const data = await apiFetch(url);
        const items = data?.suppliers || [];
        resultsEl.innerHTML = items.length
          ? items.map(s => `<div style="padding:12px;border:1px solid #e5e5ea;border-radius:10px;margin-bottom:8px;background:#fff">
              <div style="font-size:13px;font-weight:700">${esc(s.name)}</div>
              <div style="font-size:11px;color:#999;margin-top:2px">ID: ${esc(String(s.id))} · ${Number(s.listedNum || 0).toLocaleString()} listed</div>
            </div>`).join("")
          : '<div style="padding:20px;text-align:center;color:#888;font-size:13px">No suppliers found</div>';
        setStatus(`${items.length} supplier(s) found`, "ok");
      } catch (err) {
        resultsEl.innerHTML = `<div style="padding:20px;text-align:center;color:#dc2626;font-size:13px">Error: ${esc(err.message)}</div>`;
        setStatus("Failed to load suppliers", "error");
      }
    }

    async function doCategorySearch(catId) {
      if (!resultsEl) return;
      const cid = catId || catSelect?.value || "";
      if (!cid) { alert("Please select a category first."); return; }
      resultsEl.innerHTML = '<div style="padding:20px;text-align:center;color:#888">Searching category…</div>';
      setStatus("Loading category products…", "");
      try {
        const url = `/api/public/products?page=${page}&pageSize=${PS}&category=${encodeURIComponent(cid)}`;
        const data = await apiFetch(url);
        const items = data?.products || [];
        resultsEl.innerHTML = items.length
          ? items.map(renderProduct).join("")
          : '<div style="padding:20px;text-align:center;color:#888;font-size:13px">No products in this category</div>';
        setStatus(`${items.length} product(s) found`, "ok");
      } catch (err) {
        resultsEl.innerHTML = `<div style="padding:20px;text-align:center;color:#dc2626;font-size:13px">Error: ${esc(err.message)}</div>`;
        setStatus("Failed to load category", "error");
      }
    }

    // Product click handler via delegation
    panelEl.addEventListener("click", (e) => {
      const item = e.target.closest(".ph-item");
      if (item) {
        const id = item.dataset.id;
        if (id) window.openPhProduct(id);
        return;
      }
      const detailBtn = e.target.closest(".ph-btn-detail");
      if (detailBtn) {
        e.stopPropagation();
        const id = detailBtn.dataset.id;
        if (id) window.openPhProduct(id);
        return;
      }
      const listBtn = e.target.closest(".ph-btn-list");
      if (listBtn) {
        e.stopPropagation();
        alert("Listing requires CJ API key connection. Go to ⚙ Key settings to connect after logging into the popup.");
        return;
      }
    });

    // Expose globally for inline onclick fallback
    window.openPhProduct = (id) => {
      chrome.runtime.sendMessage({ action: "openProduct", productId: String(id) }).catch(() => {
        window.open(`https://www.cjdropshipping.com/product/-p-${encodeURIComponent(String(id))}.html`, "_blank");
      });
    };
  }

  // ── Initial state ────────────────────────────────────────────
  if (token) {
    apiFetch("/api/auth/me").then(me => {
      if (me) showAppUI(); else showAuthUI();
    }).catch(() => showAuthUI());
  } else {
    showAuthUI();
  }

  // ── Message handler ──────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "showOverlay") {
      if (!phPanelOpen) togglePanel(true);
      sendResponse({ ok: true });
    }
    if (msg.action === "hideOverlay") {
      if (phPanelOpen) togglePanel(false);
      sendResponse({ ok: true });
    }
    if (msg.action === "openSidePanel") {
      if (!phPanelOpen) togglePanel(true);
      sendResponse({ ok: true });
    }
  });

  // Global toggle for debugging
  window.CJPH_toggle = () => togglePanel(!phPanelOpen);

  console.log("[CJ-PH] Panel injected (hidden by default). Click ⌘ to open.");
}

// ── Init ───────────────────────────────────────────────────────
if (IS_CJ) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectPanel);
  } else {
    injectPanel();
  }
}
