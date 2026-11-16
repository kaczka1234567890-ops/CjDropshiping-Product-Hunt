/* ── CJ Product Hunter Side Panel (Full Feature Version) ───────────────────────────────
   CSP-compliant — loaded via <script src="sidepanel.js" defer>
   All logic attached to window.CJPH; events handled via document-level delegation.
   Version 1.1.0
   ─────────────────────────────────────────────────────────────────────────────────────── */

const API_BASE = "https://cj-winning-product-hunter-poc.vercel.app";
const TOKEN_KEY = "cj_ph_token";

let token     = localStorage.getItem(TOKEN_KEY) || "";
let authMode  = "signin";          // "signin" | "signup"
let curPage   = 1;
const PS      = 15;                // products per page
let curMode   = "search";          // search | trending | bestsell | supplier | category
let lastQ     = "";
let lastCountry = "";

const el = id => document.getElementById(id);

/* ══════════════════════════════════════════════════════════════════
   PUBLIC API
   ══════════════════════════════════════════════════════════════════ */
window.CJPH = {

  /* ── helpers ───────────────────────────────────────────────── */
  esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]); },

  showMsg(msg, ok) {
    const m = el("authMsg");
    if (!m) return;
    m.textContent = msg || "";
    m.className = "auth-msg" + (ok ? " ok" : "");
  },

  setStatus(text, tone) {
    const dot = el("statusDot"), txt = el("statusText");
    if (dot) dot.className = "status-dot " + (tone === "err" ? "err" : tone === "ok" ? "ok" : "");
    if (txt) txt.textContent = text || "";
  },

  apiFetch: async function(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...opts.headers };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    console.log("[CJ-PH][side] fetch:", opts.method||"GET", path, token?"tok=***":"no tok");
    let res;
    try { res = await fetch(API_BASE + path, { method: opts.method||"GET", headers, body: opts.body?JSON.stringify(opts.body):undefined }); }
    catch(e) { throw new Error("Network error — check connection."); }
    console.log("[CJ-PH][side] status:", res.status);
    if (res.status===401) { token=""; localStorage.removeItem(TOKEN_KEY); CJPH.showAuthUI(); throw new Error("Session expired — please sign in again."); }
    let data;
    try { data = await res.json(); } catch {
      const txt = await res.text().catch(()=> "");
      data = { error: txt || "Unexpected response" };
    }
    return data;
  },

  /* ── Auth submit ───────────────────────────────────────────── */
  submitAuth: async function() {
    console.log("[CJ-PH][side] ★ submitAuth mode=", authMode);
    const email    = (el("authEmail").value||"").trim();
    const password =  el("authPassword").value||"";
    const fullname = (el("authName")?.value||"").trim();

    if (!email || !password) { CJPH.showMsg("Please enter your email and password.", false); return; }
    if (authMode==="signup" && password.length<8) { CJPH.showMsg("Password must be at least 8 characters.", false); return; }

    el("authBtn").disabled = true;
    CJPH.showMsg(authMode==="signup"?"Creating your account…":"Signing in…", false);

    try {
      const path = authMode==="signup" ? "/api/auth/signup" : "/api/auth/login";
      const body = { email, password };
      if (authMode==="signup" && fullname) body.fullName = fullname;

      const data = await CJPH.apiFetch(path, { method:"POST", body });
      if (!data) { CJPH.showMsg("Network error — check connection.", false); el("authBtn").disabled=false; return; }

      if (authMode==="signup") {
        if (data.token) {
          token = data.token; localStorage.setItem(TOKEN_KEY, token);
          const me = await CJPH.apiFetch("/api/auth/me");
          if (me&&me.email) CJPH.showAppUI(me);
          else { CJPH.showMsg("Account created but profile load failed.", false); el("authBtn").disabled=false; }
        } else {
          CJPH.showMsg("✅ Account created! Check your email, click the link, then sign in.", true);
          applyMode("signin"); el("authBtn").disabled=false;
        }
      } else {
        if (!data.token) { CJPH.showMsg(data.error||"Invalid email or password.", false); el("authBtn").disabled=false; return; }
        token = data.token; localStorage.setItem(TOKEN_KEY, token);
        const me = await CJPH.apiFetch("/api/auth/me");
        if (me&&me.email) CJPH.showAppUI(me);
        else { CJPH.showMsg("Signed in but profile could not be loaded.", false); el("authBtn").disabled=false; }
      }
    } catch(err) {
      console.error("[CJ-PH][side] ✗ submitAuth:", err.message);
      CJPH.showMsg(err.message||"Authentication failed.", false);
      el("authBtn").disabled = false;
    }
  },

  /* ── Toggle sign-in / sign-up ──────────────────────────────── */
  toggleMode: function() {
    applyMode(authMode==="signin"?"signup":"signin");
  },

  /* ── Show authenticated UI ─────────────────────────────────── */
  showAppUI: function(user) {
    el("authOverlay").classList.add("hidden");
    const app = el("app"); app.style.display="flex";
    if (user&&user.email) el("userEmail").textContent = user.full_name||user.email;
    console.log("[CJ-PH][side] ✓ logged in as", user?.email);
  },

  /* ── Show auth UI ──────────────────────────────────────────── */
  showAuthUI: function() {
    el("authOverlay").classList.remove("hidden");
    el("app").style.display="none";
    applyMode(authMode);
  },

  /* ── Load products (search) ────────────────────────────────── */
  loadProducts: async function(qry) {
    const query = qry !== undefined ? qry : (el("query")?.value||"").trim();
    const country = el("f-deliver")?.value||"";
    lastQ = query; lastCountry = country; curMode = "search"; curPage = 1;
    CJPH.setModeUI("search");
    el("resultsArea").innerHTML='<div class="loading">Searching…</div>';
    CJPH.setStatus("Searching…","");
    try {
      const d = await CJPH.apiFetch(`/api/public/products?page=${curPage}&pageSize=${PS}&q=${encodeURIComponent(query)}&country=${encodeURIComponent(country)}`);
      const items = d?.products||[];
      el("resultCount").textContent = `${items.length} result(s)`;
      el("resultsArea").innerHTML = items.length ? items.map(CJPH.renderItem).join("") : '<div class="empty-state"><div class="empty-icon">🔍</div><p>No products found · Try a different keyword</p></div>';
      CJPH.setStatus(`${items.length} result(s) · Click a product for details`,"ok");
    } catch(e) {
      el("resultsArea").innerHTML=`<div class="empty-state"><div class="empty-icon">⚠️</div><p>${CJPH.esc(e.message)}</p></div>`;
      CJPH.setStatus("Search failed","err");
    }
    CJPH.showPag(curMode==="search");
  },

  /* ── Load trending ─────────────────────────────────────────── */
  loadTrending: async function() {
    const country = el("bsCountry")?.value||"";
    lastCountry = country; curMode="trending"; curPage=1;
    CJPH.setModeUI("trending");
    el("resultsArea").innerHTML='<div class="loading">Loading trending…</div>';
    CJPH.setStatus("Loading trending winners…","");
    try {
      const d = await CJPH.apiFetch(`/api/public/products?trending=true&page=${curPage}&pageSize=${PS}&country=${encodeURIComponent(country)}`);
      const items = d?.products||[];
      el("resultCount").textContent = `${items.length} trending`;
      el("resultsArea").innerHTML = items.length ? items.map(CJPH.renderItem).join("") : '<div class="empty-state"><div class="empty-icon">🔥</div><p>No trending products for this country</p></div>';
      CJPH.setStatus(`${items.length} trending winner(s) found`,"ok");
    } catch(e) {
      el("resultsArea").innerHTML=`<div class="empty-state"><div class="empty-icon">⚠️</div><p>${CJPH.esc(e.message)}</p></div>`;
      CJPH.setStatus("Failed to load trending","err");
    }
    CJPH.showPag(curMode==="trending");
  },

  /* ── Load best-sellers ─────────────────────────────────────── */
  loadBestSellers: async function() {
    const country = el("bsCountry")?.value||"";
    const sort = el("bsSort")?.value||"90d";
    lastCountry = country; curMode="bestsell"; curPage=1;
    CJPH.setModeUI("bestsell");
    el("resultsArea").innerHTML='<div class="loading">Loading best-sellers…</div>';
    CJPH.setStatus("Loading best-sellers…","");
    try {
      const d = await CJPH.apiFetch(`/api/public/products?bestseller=true&page=${curPage}&pageSize=${PS}&country=${encodeURIComponent(country)}&sort=${sort}`);
      const items = d?.products||[];
      el("resultCount").textContent = `${items.length} best-seller(s)`;
      el("resultsArea").innerHTML = items.length ? items.map(CJPH.renderItem).join("") : '<div class="empty-state"><div class="empty-icon">🛒</div><p>No best-seller products found</p></div>';
      CJPH.setStatus(`${items.length} best-seller(s) found`,"ok");
    } catch(e) {
      el("resultsArea").innerHTML=`<div class="empty-state"><div class="empty-icon">⚠️</div><p>${CJPH.esc(e.message)}</p></div>`;
      CJPH.setStatus("Failed to load best-sellers","err");
    }
    CJPH.showPag(curMode==="bestsell");
  },

  /* ── Load suppliers ────────────────────────────────────────── */
  loadSuppliers: async function() {
    curMode="supplier"; curPage=1;
    CJPH.setModeUI("supplier");
    el("resultsArea").innerHTML='<div class="loading">Loading suppliers…</div>';
    CJPH.setStatus("Loading top suppliers…","");
    try {
      const d = await CJPH.apiFetch(`/api/public/suppliers?page=${curPage}&pageSize=10`);
      const items = d?.suppliers||[];
      el("resultCount").textContent = `${items.length} supplier(s)`;
      el("resultsArea").innerHTML = items.length ? items.map(s=>`<div style="padding:12px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;background:var(--white)">
        <div style="font-size:13px;font-weight:700">${CJPH.esc(s.name)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">ID: ${CJPH.esc(String(s.id))} · ${Number(s.listedNum||0).toLocaleString()} listed</div>
      </div>`).join("") : '<div class="empty-state"><div class="empty-icon">🏭</div><p>No suppliers found</p></div>';
      CJPH.setStatus(`${items.length} supplier(s) found`,"ok");
    } catch(e) {
      el("resultsArea").innerHTML=`<div class="empty-state"><div class="empty-icon">⚠️</div><p>${CJPH.esc(e.message)}</p></div>`;
      CJPH.setStatus("Failed to load suppliers","err");
    }
  },

  /* ── Category hunt ─────────────────────────────────────────── */
  catHunt: async function(catId) {
    const cid = catId || el("catSelect")?.value||"";
    if(!cid){alert("Please select a category first.");return;}
    lastQ = "#"+cid; curMode="category"; curPage=1;
    CJPH.setModeUI("category");
    el("resultsArea").innerHTML='<div class="loading">Searching category…</div>';
    CJPH.setStatus("Loading category products…","");
    try {
      const d = await CJPH.apiFetch(`/api/public/products?page=${curPage}&pageSize=${PS}&category=${encodeURIComponent(cid)}`);
      const items = d?.products||[];
      el("resultCount").textContent = `${items.length} product(s)`;
      el("resultsArea").innerHTML = items.length ? items.map(CJPH.renderItem).join("") : '<div class="empty-state"><div class="empty-icon">📂</div><p>No products in this category</p></div>';
      CJPH.setStatus(`${items.length} product(s) found`,"ok");
    } catch(e) {
      el("resultsArea").innerHTML=`<div class="empty-state"><div class="empty-icon">⚠️</div><p>${CJPH.esc(e.message)}</p></div>`;
      CJPH.setStatus("Failed to load category","err");
    }
    CJPH.showPag(curMode==="category");
  },

  /* ── Render product item ───────────────────────────────────── */
  renderItem: function(p) {
    const sold  = Number(p.totalSales||0);
    const score = Number(p.score||0);
    const sc    = score>=70?"high":score>=45?"mid":"low";
    const imgSrc = p.image||"";
    return `<div class="product-item" data-id="${p.id}">
      <img class="prod-img" src="${imgSrc}" alt="" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23f5f5f5%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%23bbb%22 font-size=%2212%22>No Img</text></svg>'">
      <div class="prod-info">
        <div class="prod-name">${CJPH.esc(p.name||"Untitled")}</div>
        <div class="prod-price">$${Number(p.cjCost||0).toFixed(2)}</div>
        <div class="prod-meta">
          <span class="score-badge score-${sc}">${score}/100</span>
          <span>${sold.toLocaleString()} sold</span>
        </div>
        <div class="prod-actions">
          <button class="detail-btn" data-id="${p.id}">Supplier info</button>
          <button class="list-btn" data-id="${p.id}">🏪 List</button>
        </div>
      </div>
    </div>`;
  },

  /* ── Open product detail ───────────────────────────────────── */
  openProduct: function(id) {
    chrome.runtime.sendMessage({action:"openProduct",productId:String(id)}).catch(()=>{
      window.open(`https://www.cjdropshipping.com/product/-p-${encodeURIComponent(String(id))}.html`,"_blank");
    });
  },

  /* ── Mode UI switcher ──────────────────────────────────────── */
  setModeUI: function(mode) {
    curMode = mode;
    const chips = ["trendChip","bestsellChip","supplierChip"];
    chips.forEach(id=>{ if(el(id)) el(id).classList.remove("active","chip-primary"); });
    const modeMap = { trending:["trendChip"], bestsell:["bestsellChip"], supplier:["supplierChip"] };
    (modeMap[mode]||[]).forEach(id=>{ if(el(id)){el(id).classList.add("active","chip-primary");} });
    const resetBtn = el("resetChip");
    if(resetBtn) resetBtn.style.display = (mode!=="search"&&mode!=="category")?"":"none";
    const bsBar = el("bsBar");
    if(bsBar) bsBar.style.display = (mode==="bestsell"||mode==="trending")?"flex":"none";
  },

  /* ── Pagination ────────────────────────────────────────────── */
  showPag: function(show) {
    const bar = el("pagBar");
    if(bar) bar.classList.toggle("show", show);
  },

  nextPage: async function() {
    if(curPage>=30) return;
    curPage++;
    CJPH._runCurrent();
  },

  prevPage: async function() {
    if(curPage<=1) return;
    curPage--;
    CJPH._runCurrent();
  },

  _runCurrent: async function() {
    el("pageInfo").textContent = `Page ${curPage}`;
    el("prevBtn").disabled = curPage<=1;
    if(curMode==="search"||curMode==="category") CJPH.loadProducts(lastQ.replace("#",""));
    else if(curMode==="trending") await CJPH.loadTrending();
    else if(curMode==="bestsell") await CJPH.loadBestSellers();
    else if(curMode==="supplier") await CJPH.loadSuppliers();
  },

  /* ── Theme toggle ──────────────────────────────────────────── */
  toggleTheme: function() {
    const root = document.documentElement;
    const isDark = root.getAttribute("data-theme")==="dark";
    if(isDark) { root.removeAttribute("data-theme"); try{localStorage.setItem("cjphTheme","light");}catch{} el("themeBtn").textContent="🌙"; }
    else       { root.setAttribute("data-theme","dark");  try{localStorage.setItem("cjphTheme","dark");}catch{} el("themeBtn").textContent="☀️"; }
  },

  /* ── Profile modal ─────────────────────────────────────────── */
  openProfile: async function() {
    const modal = el("profileModal");
    if(!modal) return;
    el("profileEmail").textContent = token ? "(loading…)" : "—";
    modal.classList.add("show");
    if(token) {
      try {
        const u = await CJPH.apiFetch("/api/auth/me");
        if(u) {
          el("profileEmail").textContent = u.email||"—";
          el("profileFullName").value = u.full_name||"";
          el("profileUsername").value = u.username||"";
          el("profilePhone").value   = u.phone||"";
        }
      } catch(e) { el("profileStatus").textContent=e.message; el("profileStatus").style.color="var(--danger)"; }
    }
  },
  closeProfile: function() { el("profileModal")?.classList.remove("show"); },
  saveProfile: async function() {
    const btn = el("profileSave"), st = el("profileStatus");
    if(!btn||!st) return;
    btn.disabled=true; st.textContent="Saving…"; st.style.color="";
    try {
      const body = {};
      if(el("profileFullName").value.trim()) body.fullName = el("profileFullName").value.trim();
      if(el("profileUsername").value.trim()) body.username = el("profileUsername").value.trim();
      if(el("profilePhone").value.trim())   body.phone    = el("profilePhone").value.trim();
      const curPwd = el("profileCurPwd")?.value||"";
      const newPwd = el("profileNewPwd")?.value||"";
      if(newPwd) { body.currentPassword=curPwd; body.newPassword=newPwd; }
      const res = await CJPH.apiFetch("/api/profile",{method:"PUT",body});
      if(!res.ok) throw new Error(res.error||"Failed to save profile.");
      st.textContent="✓ Profile updated"; st.style.color="var(--success)";
      setTimeout(()=>{ if(st) st.textContent=""; },3000);
      CJPH.closeProfile();
    } catch(err) {
      st.textContent = err.message||"Failed to save.";
      st.style.color = "var(--danger)";
    } finally { btn.disabled=false; }
  },

  /* ── Logout ────────────────────────────────────────────────── */
  logout: async function() {
    try { await CJPH.apiFetch("/api/auth/logout",{method:"POST"}); } catch{}
    token=""; localStorage.removeItem(TOKEN_KEY);
    CJPH.showAuthUI();
  },

  /* ── Always-on overlay ─────────────────────────────────────── */
  openAlwaysOn: function() {
    chrome.runtime.sendMessage({action:"showOverlay"}).catch(()=>{});
  },
};

/* ── Standalone wrappers ─────────────────────────────────────────────────── */
function applyMode(mode) {
  authMode = mode;
  if(mode==="signup"){
    el("authBtn").textContent="Create Account";
    el("toggleAuth").textContent="Sign In";
    el("switchLabel").textContent="Already have an account? ";
    el("extraFields").classList.add("show");
  } else {
    el("authBtn").textContent="Sign In";
    el("toggleAuth").textContent="Sign Up";
    el("switchLabel").textContent="Don't have an account? ";
    el("extraFields").classList.remove("show");
  }
  CJPH.showMsg("");
}

/* ── Event Delegation (clicks) ────────────────────────────────────────────── */
document.addEventListener("click", async (evt) => {
  const t = evt.target;

  // ── Auth buttons ──
  if(t.id==="authBtn"||t.closest("#authBtn")) { evt.preventDefault(); CJPH.submitAuth(); return; }
  if(t.id==="toggleAuth"||t.closest("#toggleAuth")) { evt.preventDefault(); CJPH.toggleMode(); return; }

  // ── Toolbar buttons ──
  if(t.id==="profileBtn"||t.closest("#profileBtn")) { evt.preventDefault(); await CJPH.openProfile(); return; }
  if(t.id==="helpBtn"||t.closest("#profileHelpBtn")) { alert("Support:\n\nWhatsApp: +880 130 952 4519\nVisit: www.smtools.online\n\nFor API key setup go to My CJ → API settings."); return; }
  if(t.id==="keyBtn"||t.closest("#keyBtn")) { alert("API Key Settings:\n\nGo to cjdropshipping.com → My CJ → API → Generate New Key\nThen paste it here when prompted.\n\nYour key is encrypted and stored securely."); return; }
  if(t.id==="logoutBtn"||t.closest("#logoutBtn")) { evt.preventDefault(); CJPH.logout(); return; }
  if(t.id==="themeBtn"||t.closest("#themeBtn")) { CJPH.toggleTheme(); return; }

  // ── Filters toggle ──
  if(t.id==="filtersToggle"||t.closest("#filtersToggle")) {
    const body = el("filtersBody");
    const tog = el("filtersToggle");
    if(body) body.style.display = body.style.display==="none" ? "grid" : "none";
    if(tog) tog.classList.toggle("collapsed", body?.style.display==="none");
    return;
  }

  // ── Search ──
  if(t.id==="huntBtn"||t.closest("#huntBtn")) { evt.preventDefault(); CJPH.loadProducts(); return; }

  // ── Category hunt ──
  if(t.id==="catHuntBtn"||t.closest("#catHuntBtn")) { evt.preventDefault(); CJPH.catHunt(); return; }

  // ── Mode chips ──
  if(t.id==="trendChip"||t.closest("#trendChip")) {
    evt.preventDefault();
    if(curMode==="trending"){CJPH.setModeUI("search");el("resultsArea").innerHTML='<div class="empty-state"><div class="empty-icon">🔍</div><p>Enter a keyword and click Hunt</p></div>';CJPH.setStatus("Reset · Enter a keyword","");return;}
    CJPH.loadTrending(); return;
  }
  if(t.id==="bestsellChip"||t.closest("#bestsellChip")) { evt.preventDefault(); CJPH.loadBestSellers(); return; }
  if(t.id==="supplierChip"||t.closest("#supplierChip")) { evt.preventDefault(); CJPH.loadSuppliers(); return; }
  if(t.id==="resetChip"||t.closest("#resetChip")) {
    evt.preventDefault();
    CJPH.setModeUI("search");
    el("resultsArea").innerHTML='<div class="empty-state"><div class="empty-icon">🔍</div><p>Enter a keyword and click Hunt</p></div>';
    CJPH.setStatus("Reset · Enter a keyword and click Hunt","");
    return;
  }

  // ── Pagination ──
  if(t.id==="nextBtn"||t.closest("#nextBtn")) { evt.preventDefault(); await CJPH.nextPage(); return; }
  if(t.id==="prevBtn"||t.closest("#prevBtn")) { evt.preventDefault(); await CJPH.prevPage(); return; }

  // ── Product card / detail / list buttons ──
  const prodItem = t.closest(".product-item");
  if(prodItem) { const id=prodItem.dataset.id; if(id) CJPH.openProduct(id); return; }
  const detailBtn = t.closest(".detail-btn");
  if(detailBtn) { evt.stopPropagation(); const id=detailBtn.dataset.id; if(id) CJPH.openProduct(id); return; }
  const listBtn = t.closest(".list-btn");
  if(listBtn) { evt.stopPropagation(); alert("Listing requires CJ API key connection.\nGo to Settings → API to connect after logging in."); return; }

  // ── Profile modal close/save ──
  if(t.id==="profileClose"||t.closest("#profileClose")) { evt.preventDefault(); CJPH.closeProfile(); return; }
  if(t.id==="profileSave"||t.closest("#profileSave")) { evt.preventDefault(); await CJPH.saveProfile(); return; }

  // ── Always-on ──
  if(t.id==="alwaysOnBtn"||t.closest("#alwaysOnBtn")) { evt.preventDefault(); CJPH.openAlwaysOn(); return; }
});

/* ── Password eye toggles ── */
document.addEventListener("click", (evt) => {
  const tgt = evt.target;
  if(tgt.classList.contains("pwd-toggle")) {
    const input = document.getElementById(tgt.dataset.target);
    if(input) input.type = input.type==="password" ? "text" : "password";
  }
});

/* ── Enter key: auth form & search ── */
document.addEventListener("keydown", (evt) => {
  if(evt.key==="Enter" && !el("authOverlay").classList.contains("hidden")) { CJPH.submitAuth(); return; }
  if(evt.key==="Enter" && el("query")) { evt.preventDefault(); CJPH.loadProducts(); return; }
});

/* ── Country / sort change listeners ── */
document.addEventListener("change", (evt) => {
  const t = evt.target;
  if(t.id==="bsCountry"&&curMode==="bestsell") CJPH.loadBestSellers();
  if(t.id==="bsSort"&&curMode==="bestsell")    CJPH.loadBestSellers();
});

/* ── Init ─────────────────────────────────────────────────────────────────── */
(function init() {
  console.log("[CJ-PH][side] ★ INIT START — token:", token?"***":"none", "mode:", authMode);

  // Theme
  const storedTheme = localStorage.getItem("cjphTheme");
  if(storedTheme==="dark") document.documentElement.setAttribute("data-theme","dark");
  if(el("themeBtn")) el("themeBtn").textContent = storedTheme==="dark"?"☀️":"🌙";

  // Wire up filters toggle state
  if(el("filtersToggle")) el("filtersToggle").addEventListener("click",()=>{
    const body=el("filtersBody"), tog=el("filtersToggle");
    if(body) body.style.display = body.style.display==="none"?"grid":"none";
    if(tog) tog.classList.toggle("collapsed", body?.style.display==="none");
  });

  console.log("[CJ-PH][side] ★ wireButtons completed");

  if(!token) { CJPH.showAuthUI(); console.log("[CJ-PH][side] ★ no token → showing auth UI"); return; }

  console.log("[CJ-PH][side] ★ token found, fetching /api/auth/me…");
  CJPH.apiFetch("/api/auth/me").then(me=>{
    if(me&&me.email) CJPH.showAppUI(me);
    else             CJPH.showAuthUI();
  }).catch(err=>{
    console.error("[CJ-PH][side] ✗ /me fetch failed:", err.message);
    CJPH.showAuthUI();
  });
})();
