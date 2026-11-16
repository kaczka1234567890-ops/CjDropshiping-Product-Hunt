// content.js — CJ Product Hunter split-screen panel on CJdropshipping.com
// Uses document-level event delegation so CJ's React SPA can't break our handlers.
console.log("[CJ-PH] Content script loaded");

const IS_CJ = /cjdropshipping\.com/.test(window.location.hostname);
if (!IS_CJ) { console.log("[CJ-PH] Not a CJ page, skipping."); }

let phPanelOpen = false;
let authMode = "signin";
let token = "";
const PH_API = "https://cj-winning-product-hunter-poc.vercel.app";

/* ── helpers ─────────────────────────────────────────────────── */
function getAuthToken()      { try { return localStorage.getItem("cjToken") || ""; } catch { return ""; } }
function setAuthToken(t)     { try { if (t) localStorage.setItem("cjToken", t); else localStorage.removeItem("cjToken"); } catch {} }
function esc(s)              { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" })[c]); }

async function apiFetch(path, opts = {}) {
  const url = PH_API + path;
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  console.log(`[CJ-PH][api] ${opts.method||'GET'} ${url}`, token ? `tok=${token.slice(0,20)}...` : 'no tok');
  let res;
  try { res = await fetch(url, { method: opts.method||"GET", headers, ...(opts.body ? { body: JSON.stringify(opts.body) } : {}) }); }
  catch(e) { throw new Error("Network error — check connection."); }
  console.log(`[CJ-PH][api] status: ${res.status}`);
  let data;
  try {
    const ct = res.headers.get("content-type") || "";
    data = ct.includes("json") ? await res.json() : await res.text();
  } catch { data = await res.text().catch(()=> ""); }
  console.log(`[CJ-PH][api] body:`, typeof data==="object"?JSON.stringify(data).slice(0,200):data);
  if (res.status===401) { token=""; setAuthToken(""); throw new Error("Session expired — please sign in again."); }
  if (!res.ok) {
    const msg = (typeof data==="object"&&data&&data.error)||data||`HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return typeof data==="object" ? data : {};
}

/* ── buildHTML ───────────────────────────────────────────────── */
function buildAuthHtml() {
  const label = `<label style="display:block;text-align:left;font-size:12px;font-weight:600;color:#666;margin-bottom:4px">Email</label>`;
  const emailIn = `<input id="ph-a-email" type="email" placeholder="you@example.com" autocomplete="email" style="width:100%;padding:11px 12px;border:1px solid #e5e5ea;border-radius:9px;font-size:14px;margin-bottom:10px;outline:none;background:#fff;color:#333">`;
  const pwdRow = `<div style="display:flex;gap:6px;margin-bottom:12px"><input id="ph-a-pass" type="password" placeholder="••••••••" autocomplete="current-password" style="flex:1;padding:11px 12px;border:1px solid #e5e5ea;border-radius:9px;font-size:14px;outline:none;background:#fff;color:#333"><button type="button" id="ph-a-eye" style="padding:0 12px;border:1px solid #e5e5ea;border-radius:9px;background:#fff;cursor:pointer;font-size:14px">👁</button></div>`;
  const btn = `<button type="button" id="ph-a-btn" style="width:100%;padding:12px;border:none;border-radius:9px;background:#ff7700;color:#fff;font-weight:700;font-size:15px;cursor:pointer">Sign In</button>`;
  const switchP = `<p id="ph-a-switch" style="font-size:12px;color:#888;margin-top:14px">Don't have an account? <a href="#" id="ph-a-toggle" style="color:#ff7700;text-decoration:underline">Sign up</a></p>`;
  return `<div style="text-align:center;padding:36px 24px;flex:1;display:flex;flex-direction:column;justify-content:center">
    <div style="display:grid;place-items:center;width:52px;height:52px;border-radius:14px;background:#ff7700;color:#fff;font-weight:900;font-size:20px;margin:0 auto 14px">PH</div>
    <h2 style="margin:0 0 6px;font-size:18px">CJ Product Hunter</h2>
    <p style="margin:0 0 20px;color:#888;font-size:13px">Sign in to hunt winning products.</p>
    <div id="ph-auth-msg" style="font-size:12px;color:#888;margin-bottom:12px;min-height:18px"></div>
    ${label}${emailIn}
    <label style="display:block;text-align:left;font-size:12px;font-weight:600;color:#666;margin-bottom:4px">Password</label>${pwdRow}
    <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#888;margin-bottom:14px;cursor:pointer"><input type="checkbox" id="ph-a-savepwd" checked style="accent-color:#ff7700"> Save password locally</label>
    ${btn}${switchP}
  </div>`;
}

function buildAppHtml() {
  const deliverOpts = ["US","GB","CA","AU","DE","FR","JP","KR","SG","IN","BR","MX","AE","ZA","NL","IT","ES","SE","NO"].map(c=>`<option value="${c}">${c}</option>`).join("");
  const trendOpts   = ["US","GB","CA","AU","DE","FR","ES","IT","NL","JP","KR","SG","MY","TH","VN","PH","IN","BR","MX","AE","SA","IL","ZA","NZ","SE","NO","CH","PL","BE","AT"].map(c=>`<option value="${c}">${c}</option>`).join("");
  const bsCountryOpts = "<option value=\"\">All countries</option>"+["US","GB","CA","AU","DE","FR","JP","KR","SG","IN","BR","MX","AE","ZA","NL","IT","ES","SE","NO"].map(c=>`<option value="${c}">${c}</option>`).join("");
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
        <label>Deliver to:<select id="ph-f-deliver" style="border:1px solid #e5e5ea;border-radius:7px;padding:7px 8px;font-size:12px;width:100%;outline:none;background:#fff;color:#333">${deliverOpts}</select></label>
      </div>
      <div style="display:flex;gap:16px;margin-top:10px;font-size:12px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="ph-f-free" style="accent-color:#ff7700"> Free shipping</label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="ph-f-quick" style="accent-color:#ff7700"> 🚀 Quick delivery</label>
      </div>
    </details>
    <!-- Search -->
    <div style="padding:12px 16px;border-bottom:1px solid #e5e5ea;background:#fff;display:flex;gap:8px;flex-shrink:0">
      <input id="ph-query" placeholder="e.g. winter jacket — or pick a category below" autocomplete="off" style="flex:1;padding:11px 13px;border:1px solid #e5e5ea;border-radius:9px;font-size:14px;outline:none;background:#fff;color:#333">
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
      <select id="ph-trend-country" style="display:none;padding:5px 8px;border-radius:999px;border:1px solid #e5e5ea;font-size:11px;font-weight:600;background:#fff;color:#333;outline:none;max-width:130px"><option value="">🌍 Country...</option>${trendOpts}</select>
      <button type="button" id="ph-bestsell-chip" style="background:#fff;border:1px solid #e5e5ea;padding:6px 14px;border-radius:999px;font-size:12px;cursor:pointer;font-weight:600">🛒 Best-Selling</button>
      <button type="button" id="ph-supplier-chip" style="background:#fff;border:1px solid #e5e5ea;padding:6px 14px;border-radius:999px;font-size:12px;cursor:pointer;font-weight:600">🏆 Best Supplier</button>
      <button type="button" id="ph-reset-chip" style="background:#fff;border:1px solid #e5e5ea;padding:6px 14px;border-radius:999px;font-size:12px;cursor:pointer;font-weight:600;display:none">↺ Reset</button>
    </div>
    <!-- BS bar -->
    <div id="ph-bs-bar" style="display:none;padding:10px 16px;border-bottom:1px solid #e5e5ea;background:#fff;font-size:12px;flex-shrink:0">
      <label for="ph-bs-country" style="font-weight:600;color:#666;margin-right:6px">🌍 Ship to:</label>
      <select id="ph-bs-country" style="padding:6px 10px;border:1px solid #e5e5ea;border-radius:8px;font-size:12px;margin-right:12px;background:#fff;color:#333;outline:none">${bsCountryOpts}</select>
      <label for="ph-bs-sort" style="font-weight:600;color:#666;margin-right:6px">📊 Sort by:</label>
      <select id="ph-bs-sort" style="padding:6px 10px;border:1px solid #e5e5ea;border-radius:8px;font-size:12px;background:#fff;color:#333;outline:none"><option value="90d">90-day sales</option><option value="30d">30-day sales</option><option value="7d">7-day sales</option></select>
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

/* ── injectPanel (one-shot) ──────────────────────────────────── */
function injectPanel() {
  if (document.getElementById("cj-ph-root")) return;
  token = getAuthToken();

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
    #cj-ph-close-btn{position:absolute;top:12px;right:12px;z-index:5;background:#fff;border:1px solid #e5e5ea;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:16px;color:#666;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.1)}
    #cj-ph-close-btn:hover{background:#f5f5f5;color:#333}
    [data-cjph-theme="dark"]#cj-ph-close-btn{background:#1a1b26;border-color:#2e3040;color:#e2e4f0}
    @media print{#cj-ph-root{display:none!important}}
  `;
  document.head.appendChild(styleEl);

  const root = document.createElement("div");
  root.id = "cj-ph-root";
  root.innerHTML = `<button type="button" id="cj-ph-tog" title="Toggle CJ Product Hunter">⌘</button>
    <div id="cj-ph-inner"><div id="cj-ph-page"></div><div id="cj-ph-panel" style="position:relative"><button type="button" id="cj-ph-close-btn" title="Close panel">×</button></div></div>`;
  document.body.appendChild(root);

  const panelEl = document.getElementById("cj-ph-panel");
  const togBtn  = document.getElementById("cj-ph-tog");
  const closeBtn= document.getElementById("cj-ph-close-btn");

  /* theme */
  let curTheme = "";
  try { curTheme = localStorage.getItem("cjphTheme")||""; } catch {}
  if (curTheme==="dark") root.setAttribute("data-cjph-theme","dark");

  /* toggle panel */
  function togglePanel(open) {
    phPanelOpen = open;
    root.style.display = open?"flex":"none";
    togBtn.style.display = open?"none":"flex";
  }

  /* show / refresh UI */
  function showAuthUI()  { panelEl.innerHTML = buildAuthHtml();  restoreSavedCreds(); }
  function showAppUI()   { panelEl.innerHTML = buildAppHtml();   loadUserInfo();         }

  async function loadUserInfo() {
    try {
      const u = await apiFetch("/api/auth/me");
      if (u && u.email) {
        const el = document.getElementById("ph-user-email");
        if (el) el.textContent = u.full_name||u.email.split("@")[0];
        setStatus(`Welcome, ${esc(u.full_name||u.email.split("@")[0])} · Ready`, "ok");
      }
    } catch {}
  }

  function setStatus(msg, tone) {
    const el = document.getElementById("ph-status");
    if (!el) return;
    el.innerHTML = msg;
    el.style.color = tone==="error"?"#dc2626":tone==="ok"?"#16a34a":"#888";
    el.style.background = tone==="error"?"#fdecea":tone==="ok"?"#dcfce7":"#f2f2f2";
  }

  /* ── Document-level event delegation (immune to CJ DOM mutations) ── */
  // NOTE: delegated handler fires AFTER any direct listener on the same element.
  // We use capture:false (bubble phase) which naturally handles clicks after CJ's own handlers.

  document.addEventListener("click", async (evt) => {
    const t = evt.target;
    if (!t) return;

    /* ── Toggle button ── */
    if (t.id === "cj-ph-tog") { togglePanel(!phPanelOpen); return; }

    /* ── Close button ── */
    if (t.id === "cj-ph-close-btn" || t.closest("#cj-ph-close-btn")) { togglePanel(false); return; }

    /* skip when panel is closed */
    if (!phPanelOpen) return;

    /* ── Auth: eye toggle ── */
    if (t.id === "ph-a-eye") {
      const pw = document.getElementById("ph-a-pass");
      if (pw) pw.type = pw.type==="password" ? "text" : "password";
      return;
    }

    /* ── Auth: Sign In / Create Account ── */
    if (t.id === "ph-a-btn" || t.closest("#ph-a-btn")) {
      evt.preventDefault(); evt.stopPropagation();
      const emailIn = document.getElementById("ph-a-email");
      const passIn  = document.getElementById("ph-a-pass");
      const authBtn = document.getElementById("ph-a-btn");
      const msgEl   = document.getElementById("ph-auth-msg");
      const saveChk = document.getElementById("ph-a-savepwd");
      const email   = emailIn ? emailIn.value.trim() : "";
      const pwd     = passIn  ? passIn.value : "";
      console.log(`[CJ-PH][auth] click mode=${authMode} email=${email?email.slice(0,4)+'…':'EMPTY'} pwdLen=${pwd.length}`);
      if (!email || !pwd) { msgEl.textContent="Please fill in all fields."; msgEl.style.color="#dc2626"; return; }
      if (authMode==="signup" && pwd.length<8) { msgEl.textContent="Password must be at least 8 characters."; msgEl.style.color="#dc2626"; return; }
      authBtn.disabled = true;  authBtn.textContent = "Loading…";
      msgEl.textContent = ""; msgEl.style.color = "#888";
      try {
        const path = authMode==="signup" ? "/api/auth/signup" : "/api/auth/login";
        const data = await apiFetch(path, { method:"POST", body:{ email, password:pwd } });
        console.log("[CJ-PH][auth] API OK:", data);
        if (authMode==="signup") {
          if (data.token) {
            token = data.token; setAuthToken(token);
            const me = await apiFetch("/api/auth/me");
            console.log("[CJ-PH][auth] /me:", me);
            if (me&&me.email) { if(saveChk&&saveChk.checked) try{localStorage.setItem("cjphSavedPwd",JSON.stringify({email,pwd}))}catch{}; showAppUI(); }
            else throw new Error(me?.error||"Could not load profile after signup.");
          } else {
            // Signup succeeded but email confirmation required — reset mode to signin so the button actually works as login
            msgEl.textContent="✅ Account created! Check your email and click the confirmation link, then sign in.";
            msgEl.style.color="#16a34a"; authBtn.disabled=false; authBtn.textContent="Sign In";
            authMode = "signin";
          }
        } else {
          if (!data.token) throw new Error(data.error||"Invalid email or password.");
          token = data.token; setAuthToken(token);
          const me = await apiFetch("/api/auth/me");
          console.log("[CJ-PH][auth] /me:", me);
          if (me&&me.email) { if(saveChk&&saveChk.checked) try{localStorage.setItem("cjphSavedPwd",JSON.stringify({email,pwd}))}catch{}; showAppUI(); }
          else throw new Error(me?.error||"Signed in but could not load profile.");
        }
      } catch(err) {
        console.error("[CJ-PH][auth] FAILED:", err?.message||err);
        const m = err?.message||"Authentication failed";
        msgEl.textContent = m.toLowerCase().includes("already")?"This email is already registered. Please sign in instead.":m;
        msgEl.style.color = "#dc2626";
        authBtn.disabled = false; authBtn.textContent = authMode==="signup"?"Create Account":"Sign In";
      }
      return;
    }

    /* ── Auth: toggle signin ↔ signup ── */
    if (t.id==="ph-a-toggle" || t.closest("#ph-a-toggle")) {
      evt.preventDefault();
      authMode = authMode==="signin"?"signup":"signin";
      showAuthUI();
      return;
    }

    /* ── App: theme toggle ── */
    if (t.id==="ph-theme-btn"||t.closest("#ph-theme-btn")) {
      const isDark = root.hasAttribute("data-cjph-theme");
      if(isDark) root.removeAttribute("data-cjph-theme"); else root.setAttribute("data-cjph-theme","dark");
      try { localStorage.setItem("cjphTheme", isDark?"":"dark"); } catch {}
      const btn = document.getElementById("ph-theme-btn");
      if(btn) btn.textContent = isDark?"🌙":"☀️";
      return;
    }

    /* ── App: logout ── */
    if (t.id==="ph-logout-btn"||t.closest("#ph-logout-btn")) {
      evt.preventDefault();
      try { await apiFetch("/api/auth/logout",{method:"POST"}); } catch {}
      token=""; setAuthToken(""); showAuthUI();
      return;
    }

    /* ── App: always-on window ── */
    if (t.id==="ph-always-btn"||t.closest("#ph-always-btn")) {
      evt.preventDefault();
      chrome.runtime.sendMessage({action:"showOverlay"}).catch(()=>{});
      return;
    }

    /* ── App: search (Hunt button + Enter key) ── */
    if (t.id==="ph-hunt-btn"||t.closest("#ph-hunt-btn")) {
      evt.preventDefault();
      runSearch(document.getElementById("ph-query")?.value.trim()||"", document.getElementById("ph-f-deliver")?.value||"");
      return;
    }
    if (t.id==="ph-query"&&evt.key==="Enter") {
      evt.preventDefault();
      runSearch(t.value.trim(), document.getElementById("ph-f-deliver")?.value||"");
      return;
    }

    /* ── App: category hunt ── */
    if (t.id==="ph-cat-hunt"||t.closest("#ph-cat-hunt")) {
      evt.preventDefault();
      const cat = document.getElementById("ph-cat")?.value;
      if(!cat){alert("Please select a category first.");return;}
      setMode("category"); doCategorySearch(cat);
      return;
    }

    /* ── App: mode chips ── */
    if (t.id==="ph-trend-chip"||t.closest("#ph-trend-chip")) {
      evt.preventDefault();
      if(mode==="trending"){setMode("search");resultsEl.innerHTML="";setStatus("Reset · Enter a keyword and click Hunt","");return;}
      setMode("trending"); doTrending(document.getElementById("ph-bs-country")?.value||"");
      return;
    }
    if (t.id==="ph-bestsell-chip"||t.closest("#ph-bestsell-chip")) {
      evt.preventDefault(); setMode("bestsell"); doBestSellers(document.getElementById("ph-bs-country")?.value||"", document.getElementById("ph-bs-sort")?.value||"90d");
      return;
    }
    if (t.id==="ph-supplier-chip"||t.closest("#ph-supplier-chip")) {
      evt.preventDefault(); setMode("supplier"); doSupplierSearch("");
      return;
    }
    if (t.id==="ph-reset-chip"||t.closest("#ph-reset-chip")) {
      evt.preventDefault(); setMode("search"); resultsEl.innerHTML=""; setStatus("Reset · Enter a keyword and click Hunt","");
      return;
    }

    /* ── App: pagination ── */
    if (t.id==="ph-prev"||t.closest("#ph-prev")) { evt.preventDefault(); if(page>1){page--;renderPag();runCurrent();} return; }
    if (t.id==="ph-next"||t.closest("#ph-next")) { evt.preventDefault(); page++; renderPag(); runCurrent(); return; }

    /* ── App: product / supplier info buttons ── */
    const item = t.closest(".ph-item");
    if (item) { const id=item.dataset.id; if(id) window.openPhProduct(id); return; }
    const detailBtn = t.closest(".ph-btn-detail");
    if (detailBtn) { evt.stopPropagation(); const id=detailBtn.dataset.id; if(id) window.openPhProduct(id); return; }
    const listBtn = t.closest(".ph-btn-list");
    if (listBtn) { evt.stopPropagation(); alert("Listing requires CJ API key connection. Go to ⚙ Key settings to connect after logging into the popup."); return; }
  }, false);

  /* ── Best-seller country/sort change listeners (these just update state) ── */
  function attachBSListeners() {
    const bc = document.getElementById("ph-bs-country");
    const bs = document.getElementById("ph-bs-sort");
    if(bc){bc.onchange=()=>{if(mode==="bestsell")doBestSellers(bc.value,document.getElementById("ph-bs-sort")?.value||"90d");};}
    if(bs){bs.onchange=()=>{if(mode==="bestsell")doBestSellers(document.getElementById("ph-bs-country")?.value||"",bs.value);};}
  }

  /* ── State ── */
  let mode="search", page=1;
  const PS=15;
  let lastQuery="", lastCountry="";

  function setMode(m) {
    mode=m; page=1;
    const tc=document.getElementById("ph-trend-chip"), tcr=document.getElementById("ph-trend-country");
    const bc=document.getElementById("ph-bestsell-chip"), sc=document.getElementById("ph-supplier-chip");
    const rc=document.getElementById("ph-reset-chip"), q=document.getElementById("ph-query");
    const bsBar=document.getElementById("ph-bs-bar");
    if(tc) tc.classList.toggle("active", m==="trending");
    if(tcr) tcr.style.display = m==="trending"?"":"none";
    if(bsBar) bsBar.style.display = m==="bestsell"?"":"none";
    if(rc) rc.style.display = (m!=="search"&&m!=="category")?"":"none";
    if((m==="search"||m==="category")&&q) q.value="";
    renderPag();
    if(m==="search"||m==="category"){lastQuery="";lastCountry="";}
  }

  function renderPag() {
    const pi=document.getElementById("ph-page-info"), pv=document.getElementById("ph-prev"), nx=document.getElementById("ph-next");
    if(pi) pi.textContent=`Page ${page}`;
    if(pv) pv.disabled = page<=1;
    if(nx) nx.disabled = false;
    const pagDiv=document.getElementById("ph-pag");
    if(pagDiv) pagDiv.style.display=(mode==="search"||mode==="trending"||mode==="bestsell"||mode==="category")?"flex":"";
  }

  function runCurrent() {
    if(mode==="search") runSearch(lastQuery, lastCountry);
    else if(mode==="trending") doTrending(document.getElementById("ph-bs-country")?.value||"");
    else if(mode==="bestsell") doBestSellers(document.getElementById("ph-bs-country")?.value||"",document.getElementById("ph-bs-sort")?.value||"90d");
    else if(mode==="supplier") doSupplierSearch("");
    else if(mode==="category") doCategorySearch("");
  }

  /* ── API queries ── */
  async function runSearch(q, country) {
    lastQuery=q; lastCountry=country||""; setMode("search");
    const r=document.getElementById("ph-results"); if(!r)return;
    r.innerHTML='<div style="padding:20px;text-align:center;color:#888">Searching…</div>'; setStatus("Searching…","");
    try {
      const d=await apiFetch(`/api/public/products?page=${page}&pageSize=${PS}&q=${encodeURIComponent(q)}&country=${encodeURIComponent(country||"")}`);
      const items=d?.products||[];
      r.innerHTML=items.length?items.map(renderProduct).join(""):'<div style="padding:20px;text-align:center;color:#888;font-size:13px">No products found · Try a different keyword</div>';
      setStatus(`${items.length} result(s) · Click a product or "Supplier info"`,"ok");
    } catch(e) { r.innerHTML=`<div style="padding:20px;text-align:center;color:#dc2626;font-size:13px">Error: ${esc(e.message)}</div>`; setStatus("Search failed","error"); }
  }
  async function doTrending(country) {
    const r=document.getElementById("ph-results"); if(!r)return;
    r.innerHTML='<div style="padding:20px;text-align:center;color:#888">Loading trending…</div>'; setStatus("Loading trending winners…","");
    try {
      const d=await apiFetch(`/api/public/products?trending=true&page=${page}&pageSize=${PS}&country=${encodeURIComponent(country||"")}`);
      const items=d?.products||[];
      r.innerHTML=items.length?items.map(renderProduct).join(""):'<div style="padding:20px;text-align:center;color:#888;font-size:13px">No trending products found for this country</div>';
      setStatus(`${items.length} trending winner(s) found`,"ok");
    } catch(e) { r.innerHTML=`<div style="padding:20px;text-align:center;color:#dc2626;font-size:13px">Error: ${esc(e.message)}</div>`; setStatus("Failed to load trending","error"); }
  }
  async function doBestSellers(country, sort) {
    const r=document.getElementById("ph-results"); if(!r)return;
    r.innerHTML='<div style="padding:20px;text-align:center;color:#888">Loading best-sellers…</div>'; setStatus("Loading best-sellers…","");
    try {
      const d=await apiFetch(`/api/public/products?bestseller=true&page=${page}&pageSize=${PS}&country=${encodeURIComponent(country||"")}&sort=${sort}`);
      const items=d?.products||[];
      r.innerHTML=items.length?items.map(renderProduct).join(""):'<div style="padding:20px;text-align:center;color:#888;font-size:13px">No best-seller products found</div>';
      setStatus(`${items.length} best-seller(s) found`,"ok");
    } catch(e) { r.innerHTML=`<div style="padding:20px;text-align:center;color:#dc2626;font-size:13px">Error: ${esc(e.message)}</div>`; setStatus("Failed to load best-sellers","error"); }
  }
  async function doSupplierSearch(_q) {
    const r=document.getElementById("ph-results"); if(!r)return;
    r.innerHTML='<div style="padding:20px;text-align:center;color:#888">Loading suppliers…</div>'; setStatus("Loading top suppliers…","");
    try {
      const d=await apiFetch(`/api/public/suppliers?page=${page}&pageSize=10`);
      const items=d?.suppliers||[];
      r.innerHTML=items.length?items.map(s=>`<div style="padding:12px;border:1px solid #e5e5ea;border-radius:10px;margin-bottom:8px;background:#fff"><div style="font-size:13px;font-weight:700">${esc(s.name)}</div><div style="font-size:11px;color:#999;margin-top:2px">ID: ${esc(String(s.id))} · ${Number(s.listedNum||0).toLocaleString()} listed</div></div>`).join(""):'<div style="padding:20px;text-align:center;color:#888;font-size:13px">No suppliers found</div>';
      setStatus(`${items.length} supplier(s) found`,"ok");
    } catch(e) { r.innerHTML=`<div style="padding:20px;text-align:center;color:#dc2626;font-size:13px">Error: ${esc(e.message)}</div>`; setStatus("Failed to load suppliers","error"); }
  }
  async function doCategorySearch(catId) {
    const cid=catId||document.getElementById("ph-cat")?.value||"";
    if(!cid){alert("Please select a category first.");return;}
    const r=document.getElementById("ph-results");
    r.innerHTML='<div style="padding:20px;text-align:center;color:#888">Searching category…</div>'; setStatus("Loading category products…","");
    try {
      const d=await apiFetch(`/api/public/products?page=${page}&pageSize=${PS}&category=${encodeURIComponent(cid)}`);
      const items=d?.products||[];
      r.innerHTML=items.length?items.map(renderProduct).join(""):'<div style="padding:20px;text-align:center;color:#888;font-size:13px">No products in this category</div>';
      setStatus(`${items.length} product(s) found`,"ok");
    } catch(e) { r.innerHTML=`<div style="padding:20px;text-align:center;color:#dc2626;font-size:13px">Error: ${esc(e.message)}</div>`; setStatus("Failed to load category","error"); }
  }

  /* ── renderProduct ── */
  function scoreCls(score)  { score=Number(score)||0; return score>=70?"high":score>=45?"mid":"low"; }
  function scoreBg(cls)    { return cls==="high"?"#e6f4f0":cls==="mid"?"#fdf3e3":"#fdecea"; }
  function scoreColor(cls) { return cls==="high"?"#007f60":cls==="mid"?"#b07c1a":"#f24724"; }
  function renderProduct(p) {
    const sold=Number(p.totalSales||0), score=Number(p.score||0), sc=scoreCls(score);
    const imgSrc=p.image||"";
    return `<div class="ph-item" data-id="${esc(String(p.id))}" style="display:flex;gap:10px;padding:10px;border:1px solid #e5e5ea;border-radius:11px;cursor:pointer;transition:border-color .15s,box-shadow .15s;background:#fff">
      <img src="${esc(imgSrc)}" style="width:64px;height:64px;border-radius:8px;object-fit:cover;background:#f5f5f5;flex-shrink:0" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23f5f5f5%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%23bbb%22 font-size=%2212%22>No Img</text></svg>'">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(p.name||"Untitled")}</div>
        <div style="font-size:14px;font-weight:700;color:#ff7700;margin-top:4px">$${Number(p.cjCost||0).toFixed(2)}</div>
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

  window.openPhProduct = (id) => {
    chrome.runtime.sendMessage({action:"openProduct",productId:String(id)}).catch(()=>{
      window.open(`https://www.cjdropshipping.com/product/-p-${encodeURIComponent(String(id))}.html`,"_blank");
    });
  };

  /* ── Restore saved credentials after showing auth form ── */
  function restoreSavedCreds() {
    try {
      const s=JSON.parse(localStorage.getItem("cjphSavedPwd")||"{}");
      const ei=document.getElementById("ph-a-email"), pi=document.getElementById("ph-a-pass");
      if(ei&&s.email) ei.value=s.email;
      if(pi&&s.pwd)   pi.value=s.pwd;
    } catch{}
  }

  /* ── Re-wire best-seller onchange after panel HTML is injected ── */
  function refreshOnchange() { attachBSListeners(); }

  /* ── MutationObserver — detect if CJ swaps our panel content ── */
  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      // If CJ replaces children inside our panel (innerHTML swap), re-inject.
      if (m.type==="childList" && m.target===panelEl) {
        console.warn("[CJ-PH] Panel content mutated by page — restoring.", m.addedNodes.length, "nodes added");
        // Check if our structural elements still exist
        if (!document.getElementById("ph-a-btn") && !document.getElementById("ph-hunt-btn")) {
          console.log("[CJ-PH] Restoring panel UI…");
          if (token) showAppUI(); else showAuthUI();
          refreshOnchange();
        }
      }
    }
  });
  mo.observe(panelEl, { childList:true, subtree:true, attributes:true, characterData:true });
  // Also watch the whole root in case CJ removes our container entirely
  mo.observe(root, { childList:true, subtree:true });

  /* ── Initial state ── */
  if (token) {
    apiFetch("/api/auth/me").then(me=>{ if(me&&me.email) showAppUI(); else showAuthUI(); }).catch(()=>showAuthUI());
  } else {
    showAuthUI();
  }

  /* ── Extension message handler ── */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action==="showOverlay") { if(!phPanelOpen) togglePanel(true); sendResponse({ok:true}); }
    if (msg.action==="hideOverlay") { if(phPanelOpen)  togglePanel(false); sendResponse({ok:true}); }
    if (msg.action==="openSidePanel"){ if(!phPanelOpen) togglePanel(true); sendResponse({ok:true}); }
  });

  window.CJPH_toggle = () => togglePanel(!phPanelOpen);
  console.log("[CJ-PH] Panel injected (hidden). Click ⌘ to open. Doc delegation active.");
}

/* ── Init ── */
if (IS_CJ) {
  if (document.readyState==="loading") document.addEventListener("DOMContentLoaded", injectPanel);
  else injectPanel();
}
