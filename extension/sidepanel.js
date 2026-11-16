/* ── CJ Product Hunter Side Panel (CSP-compliant) ────────────────────────────────────────
   This file contains all JavaScript for the side panel.
   - All functions are attached to window.CJPH
   - No inline scripts, no inline onclick handlers
   - All events handled via document-level delegation + direct wiring
   - Version 1.0.9
   - CSP compliant (no inline scripts, no unsafe-inline)
   - Loaded via <script src="sidepanel.js" defer></script> in sidepanel.html
   ─────────────────────────────────────────────────────────────────────────────────────────── */

const API_BASE = "https://cj-winning-product-hunter-poc.vercel.app";
const TOKEN_KEY = "cj_ph_token";
let token = localStorage.getItem(TOKEN_KEY) || "";
let authMode = "signin"; // "signin" | "signup"

const el = id => document.getElementById(id);

/* ═══════════════════════════════════════════════════════════════════
   PUBLIC API — available to any caller
   ═══════════════════════════════════════════════════════════════════ */
window.CJPH = {

  /* ── Submit auth (sign-in / sign-up) ──────────────────────────────────────────────── */
  submitAuth: async function() {
    console.log("[CJ-PH][side] ★ submitAuth called, mode=", authMode);
    const email = (el("authEmail").value || "").trim();
    const password = el("authPassword").value || "";
    const fullname = (el("authName")?.value || "").trim();

    if (!email || !password) {
      console.log("[CJ-PH][side] ✗ missing email or password");
      CJPH.showMsg("Please enter your email and password.", false);
      return;
    }
    if (authMode === "signup" && password.length < 8) {
      console.log("[CJ-PH][side] ✗ password too short");
      CJPH.showMsg("Password must be at least 8 characters.", false);
      return;
    }

    console.log("[CJ-PH][side] → calling API:", authMode === "signup" ? "/api/auth/signup" : "/api/auth/login", "email=" + email.substring(0, 4) + "...");
    el("authBtn").disabled = true;
    CJPH.showMsg(authMode === "signup" ? "Creating your account…" : "Signing in…", false);

    try {
      const path = authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const body = { email, password };
      if (authMode === "signup" && fullname) body.fullName = fullname;

      const data = await CJPH.apiFetch(path, { method: "POST", body });
      console.log("[CJ-PH][side] ← API response:", JSON.stringify(data).substring(0, 200));

      if (!data) {
        console.log("[CJ-PH][side] ✗ no data returned");
        CJPH.showMsg("Network error — check connection.", false);
        el("authBtn").disabled = false;
        return;
      }

      if (authMode === "signup") {
        if (data.token) {
          token = data.token;
          localStorage.setItem(TOKEN_KEY, token);
          console.log("[CJ-PH][side] ✓ signup success, fetching profile…");
          const me = await CJPH.apiFetch("/api/auth/me");
          if (me && me.email) {
            console.log("[CJ-PH][side] ✓ signed in as", me.email);
            CJPH.showAppUI(me);
          } else {
            console.log("[CJ-PH][side] ✗ profile load failed");
            CJPH.showMsg("Account created but profile load failed.", false);
            el("authBtn").disabled = false;
          }
        } else {
          console.log("[CJ-PH][side] ✓ signup requires email confirmation");
          CJPH.showMsg("✅ Account created! Check your email, click the link, then sign in.", true);
          applyMode("signin");
          el("authBtn").disabled = false;
        }
      } else {
        if (!data.token) {
          console.log("[CJ-PH][side] ✗ login failed:", data.error);
          CJPH.showMsg(data.error || "Invalid email or password.", false);
          el("authBtn").disabled = false;
          return;
        }
        token = data.token;
        localStorage.setItem(TOKEN_KEY, token);
        console.log("[CJ-PH][side] ✓ login success, fetching profile…");
        const me = await CJPH.apiFetch("/api/auth/me");
        if (me && me.email) {
          console.log("[CJ-PH][side] ✓ logged in as", me.email);
          CJPH.showAppUI(me);
        } else {
          console.log("[CJ-PH][side] ✗ profile load failed");
          CJPH.showMsg("Signed in but profile could not be loaded.", false);
          el("authBtn").disabled = false;
        }
      }
    } catch (err) {
      console.error("[CJ-PH][side] ✗ submitAuth threw:", err.message, err);
      CJPH.showMsg(err.message || "Authentication failed.", false);
      el("authBtn").disabled = false;
    }
  },

  /* ── Toggle Sign In ↔ Sign Up ────────────────────────────────────────────────── */
  toggleMode: function() {
    console.log("[CJ-PH][side] ★ toggleMode called, current mode =", authMode);
    applyMode(authMode === "signin" ? "signup" : "signin");
    console.log("[CJ-PH][side] ★ now in mode:", authMode);
  },

  /* ── Theme toggle ────────────────────────────────────────────── */
  toggleTheme: function() {
    const root = document.documentElement;
    const isDark = root.getAttribute("data-theme") === "dark";
    if (isDark) { root.removeAttribute("data-theme"); try{localStorage.setItem("cjphTheme","light");}catch{} el("themeBtn").textContent="🌙"; }
    else { root.setAttribute("data-theme","dark");  try{localStorage.setItem("cjphTheme","dark");}catch{} el("themeBtn").textContent="☀️"; }
  },

  /* ── Show app UI after auth ──────────────────────────────────────────────────── */
  showAppUI: function(user) {
    el("authOverlay").classList.add("hidden");
    const app = el("app");
    app.style.display = "flex";
    if (user && user.email) el("userEmail").textContent = user.full_name || user.email;
    console.log("[CJ-PH][side] ✓ showAppUI:", user ? user.email : "none");
  },

  /* ── Show auth UI ────────────────────────────────────────────────────────────── */
  showAuthUI: function() {
    el("authOverlay").classList.remove("hidden");
    el("app").style.display = "none";
    applyMode(authMode);
  },

  /* ── API calls ────────────────────────────────────────────────────────────────── */
  apiFetch: async function(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...opts.headers };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    console.log("[CJ-PH][side] apiFetch:", opts.method||"GET", path, token ? "tok=***" : "no tok");
    let res;
    try { res = await fetch(API_BASE + path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
    catch(e) { console.error("[CJ-PH][side] fetch failed:", e.message); throw new Error("Network error — check connection."); }
    console.log("[CJ-PH][side] status:", res.status);
    if (res.status === 401) {
      token = ""; localStorage.removeItem(TOKEN_KEY); CJPH.showAuthUI();
      throw new Error("Session expired — please sign in again.");
    }
    let data;
    try { data = await res.json(); } catch {
      const txt = await res.text().catch(()=> "");
      console.warn("[CJ-PH][side] non-JSON response:", txt.substring(0,100));
      data = { error: txt || "Unexpected response from server" };
    }
    return data;
  },

  /* ── Load products (search) ────────────────────────────────────────────────────── */
  loadProducts: function() {
    el("content").innerHTML='<div class="loading">Searching…</div>';
    try {
      const q2 = (el("query")?.value||"").trim();
      CJPH._loadProducts(q2);
    } catch(e) { el("content").innerHTML=`<div class="empty-state"><div class="empty-icon">⚠️</div><p>${e.message}</p></div>`; }
  },

  /* ── Switch tab ──────────────────────────────────────────────────────────────── */
  switchTab: function(tabName) {
    console.log("[CJ-PH][side] switchTab:", tabName);
    document.querySelectorAll(".tab").forEach(tb => tb.classList.remove("active"));
    const t = document.querySelector(`[data-tab="${tabName}"]`);
    if (t) t.classList.add("active");
    if (tabName==="products")  CJPH.loadProducts();
    else if (tabName==="trending") CJPH._loadTrending();
    else el("content").innerHTML='<div class="empty-state"><div class="empty-icon">🏭</div><p>Suppliers coming soon</p></div>';
  },

  /* ── Show message ─────────────────────────────────────────────────────────── */
  showMsg: function(msg, ok) {
    const m = el("authMsg");
    if (!m) { console.log("[CJ-PH][side] ✗ authMsg element missing"); return; }
    m.textContent = msg || "";
    m.className = "auth-msg" + (ok ? " ok" : "");
    console.log("[CJ-PH][side] showMsg:", msg || "(clear)", ok ? "✓" : "✗");
  },

  _loadProducts: async function(qry) {
    try {
      const data = await CJPH.apiFetch(`/api/public/products?page=1&pageSize=10&q=${encodeURIComponent(qry)}&sort=winning`);
      const list = data?.products || [];
      el("resultCount").textContent = `${list.length} results`;
      if (!list.length) { el("content").innerHTML='<div class="empty-state"><div class="empty-icon">🔍</div><p>No products found</p></div>'; return; }
      el("content").innerHTML = `<div class="product-grid">${list.map(CJPH.renderCard).join("")}</div>`;
    } catch(e) { el("content").innerHTML=`<div class="empty-state"><div class="empty-icon">⚠️</div><p>${e.message}</p></div>`; }
  },

  _loadTrending: async function() {
    el("content").innerHTML='<div class="loading">Loading trending…</div>';
    try {
      const data = await CJPH.apiFetch("/api/public/products?trending=true&page=1&pageSize=10");
      const list = data?.products || [];
      el("resultCount").textContent = `🔥 ${list.length} trending`;
      if (!list.length) { el("content").innerHTML='<div class="empty-state"><div class="empty-icon">🔥</div><p>No trending products</p></div>'; return; }
      el("content").innerHTML = `<div class="product-grid">${list.map(CJPH.renderCard).join("")}</div>`;
    } catch(e) { el("content").innerHTML=`<div class="empty-state"><div class="empty-icon">⚠️</div><p>${e.message}</p></div>`; }
  },

  renderCard: function(p) {
    const esc = s => String(s||"").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
    return `<div class="product-card" data-id="${p.id}">
      <img class="product-img" src="${p.image||''}" alt="" loading="lazy">
      <div class="product-info">
        <div class="product-name">${esc(p.name||"Untitled")}</div>
        <div class="product-price">$${Number(p.cjCost||0).toFixed(2)}</div>
        <div class="product-meta"><span class="product-sold">${(p.totalSales||0).toLocaleString()} sold</span><span>⭐ ${p.score||0}/100</span></div>
      </div></div>`;
  }
};

/* ── Standalone wrappers for backward compatibility ──────────────────────────────────── */
function showMsg(msg, ok)        { return CJPH.showMsg(msg, ok); }
function applyMode(mode)         { authMode = mode; if(mode==="signup"){el("authBtn").textContent="Create Account";el("toggleAuth").textContent="Sign In";el("switchLabel").textContent="Already have an account? ";el("extraFields").classList.add("show");}else{el("authBtn").textContent="Sign In";el("toggleAuth").textContent="Sign Up";el("switchLabel").textContent="Don't have an account? ";el("extraFields").classList.remove("show");} showMsg(""); }
function showAppUI(user)         { el("authOverlay").classList.add("hidden"); const app=el("app"); app.style.display="flex"; if(user&&user.email) el("userEmail").textContent=user.full_name||user.email; console.log("[CJ-PH][side] ✓ showAppUI:", user ? user.email : "none"); }
function showAuthUI()            { el("authOverlay").classList.remove("hidden"); el("app").style.display="none"; applyMode(authMode); }
function submitAuth()            { return CJPH.submitAuth(); }
function loadProducts()          { return CJPH.loadProducts(); }
function loadTrending()          { return CJPH._loadTrending(); }

/* ── Event Delegation ──────────────────────────────────────────────────────────────── */
document.addEventListener("click", (evt) => {
  const t = evt.target;
  console.log("[CJ-PH][side] delegation click:", t.id || t.className || t.tagName);

  // Auth button — submit auth
  if (t.id === "authBtn" || t.closest("#authBtn")) {
    console.log("[CJ-PH][side] ✓ authBtn clicked via delegation");
    evt.preventDefault();
    submitAuth();
    return;
  }

  // Toggle sign in/up
  if (t.id === "toggleAuth" || t.closest("#toggleAuth")) {
    console.log("[CJ-PH][side] ✓ toggleAuth clicked via delegation");
    evt.preventDefault();
    CJPH.toggleMode();
    return;
  }

  // Close panel
  if (t.id === "closePanel" || t.closest("#closePanel")) { window.close(); return; }

  // Theme toggle
  if (t.id === "themeBtn" || t.closest("#themeBtn")) { CJPH.toggleTheme(); return; }

  // Tabs
  if (t.classList.contains("tab")) {
    document.querySelectorAll(".tab").forEach(tb => tb.classList.remove("active"));
    t.classList.add("active");
    if (t.dataset.tab === "products") loadProducts();
    else if (t.dataset.tab === "trending") loadTrending();
    else el("content").innerHTML='<div class="empty-state"><div class="empty-icon">🏭</div><p>Suppliers coming soon</p></div>';
    return;
  }

  // Product card — open product in new tab
  const card = t.closest(".product-card");
  if (card) { chrome.runtime.sendMessage({action:"openProduct",productId:card.dataset.id}).catch(()=>{}); return; }
});

// Enter key submits auth or search
document.addEventListener("keydown", (evt) => {
  if (evt.key==="Enter" && !el("authOverlay").classList.contains("hidden")) { submitAuth(); return; }
  if (evt.key==="Enter" && el("query")) { loadProducts(); return; }
});

// Tab direct clicks (backup)
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(tb => tb.classList.remove("active"));
    tab.classList.add("active");
    if (tab.dataset.tab === "products") loadProducts();
    else if (tab.dataset.tab === "trending") loadTrending();
    else el("content").innerHTML='<div class="empty-state"><div class="empty-icon">🏭</div><p>Suppliers coming soon</p></div>';
  });
});

/* ── Init ──────────────────────────────────────────────────────────────────────────── */
(function init() {
  console.log("[CJ-PH][side] ★ INIT START — token:", token ? "***" : "none", "mode:", authMode);

  const storedTheme = localStorage.getItem("cjphTheme");
  if (storedTheme==="dark") document.documentElement.setAttribute("data-theme","dark");
  if (el("themeBtn")) el("themeBtn").textContent = storedTheme==="dark"?"☀️":"🌙";

  console.log("[CJ-PH][side] ★ wiring event listeners...");
  console.log("[CJ-PH][side]   authBtn found:", !!el("authBtn"));
  console.log("[CJ-PH][side]   toggleAuth found:", !!el("toggleAuth"));
  console.log("[CJ-PH][side]   authMsg found:", !!el("authMsg"));
  console.log("[CJ-PH][side]   delegation set up above via addEventListener");

  if (!token) { showAuthUI(); console.log("[CJ-PH][side] ★ no token → showing auth UI"); return; }

  console.log("[CJ-PH][side] ★ token found, fetching /api/auth/me…");
  CJPH.apiFetch("/api/auth/me").then(me => {
    if (me && me.email) showAppUI(me);
    else                 showAuthUI();
  }).catch(err => {
    console.error("[CJ-PH][side] ✗ /me fetch failed:", err.message);
    showAuthUI();
  });
})();
