// extension/popup.js - Chrome extension popup logic

/* ── Backend + account session ─────────────────────────────────────
   DEFAULT_API_BASE must point at your deployed backend before you
   publish (your Vercel URL, e.g. https://cj-product-hunter.vercel.app).
   While testing locally it stays http://localhost:3000 — a one-off
   override without editing this file:
     chrome.storage.local.set({ apiBase: "https://your-app.vercel.app" })
*/

const DEFAULT_API_BASE = "https://cj-winning-product-hunter-poc.vercel.app";
let API_BASE = DEFAULT_API_BASE;

const TOKEN_STORAGE_KEY = "cjToken";
let token = "";
let session = null;
let authMode = "signin";

const statusEl = document.querySelector("#status");
const messageEl = document.querySelector("#message");
const resultsEl = document.querySelector("#results");
const form = document.querySelector("#searchForm");
const queryInput = document.querySelector("#query");
const searchButton = document.querySelector("#searchButton");
const trendingButton = document.querySelector("#trendingButton");
const bestSellingButton = document.querySelector("#bestSellingButton");
const bestSellerSupplierButton = document.querySelector("#bestSellerSupplierButton");
const bestSellerCountrySelect = document.querySelector("#bestSellerCountry");
const countryFilterBar = document.querySelector("#countryFilterBar");
const resetFiltersButton = document.querySelector("#resetFilters");
const themeToggle = document.querySelector("#themeToggle");

// Modal elements
const modal = document.querySelector("#detailModal");
const modalBody = document.querySelector("#modalBody");
const modalClose = document.querySelector("#modalClose");
const listingModal = document.querySelector("#listingModal");
const listingBody = document.querySelector("#listingBody");
const listingCloseBtn = document.querySelector("#listingClose");

// Auth overlay elements
const authOverlay = document.querySelector("#authOverlay");
const appEl = document.querySelector("#app");
const authMsg = document.querySelector("#authMsg");
const authBtn = document.querySelector("#authBtn");
const toggleAuthBtn = document.querySelector("#toggleAuth");
const authSwitchText = document.querySelector("#authSwitchText");
const nameWrap = document.querySelector("#nameWrap");
const blockedMsgEl = document.querySelector("#blockedMsg");
const userEmailEl = document.querySelector("#userEmail");
const logoutBtn = document.querySelector("#logoutBtn");

// Sellers modal elements
const sellersModal = document.querySelector("#sellersModal");
const sellersBody = document.querySelector("#sellersBody");
const sellersClose = document.querySelector("#sellersClose");

// ── Backend + account session ─────────────────────────────────────

// Every backend call goes through api(): it injects the session token and
// sends the user back to the sign-in screen when the session dies.
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    console.log(`[api] ${options.method || 'GET'} ${API_BASE}${path}`, headers.Authorization ? 'with token' : 'no token');
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    console.log(`[api] response:`, res.status, res.statusText);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[api] error body:`, text);
      throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
    }
  } catch (err) {
    console.error(`[api] fetch failed:`, err && err.message ? err.message : String(err));
    throw new Error(`Network error: ${err && err.message ? err.message : String(err)}. Check console.`);
  }
  if (res.status === 401) {
    await forgetSession();
    showAuth("Your session expired. Please sign in again.");
    throw new Error("Session expired — please sign in again.");
  }
  return res;
}

let enrichMap = {};
let pendingEnrich = new Set();
let shownProducts = [];
let bestSellingMode = false;
let searchGen = 0;
let currentPage = 1;
let totalPages = 1;
let lastSearchParams = {};

// ── Account / sign-in UI ────────────────────────────────────────
function setAuthMessage(text, ok) {
  if (!authMsg) return;
  authMsg.textContent = text || "";
  authMsg.className = "auth-msg" + (ok ? " ok" : "");
}

function setAuthMode(next) {
  authMode = next;
  const signingUp = authMode === "signup";
  if (authBtn) authBtn.textContent = signingUp ? "Create account" : "Sign in";
  if (authSwitchText) authSwitchText.textContent = signingUp ? "Already have an account?" : "Don't have an account?";
  if (toggleAuthBtn) toggleAuthBtn.textContent = signingUp ? "Sign in" : "Sign up";
  if (nameWrap) nameWrap.hidden = !signingUp;
  const pwd = document.querySelector("#authPassword");
  if (pwd) pwd.autocomplete = signingUp ? "new-password" : "current-password";
  setAuthMessage("");
}

function showAuth(message) {
  if (authOverlay) authOverlay.hidden = false;
  if (appEl) appEl.classList.add("hidden");
  if (resultsEl) resultsEl.innerHTML = "";
  if (message) setAuthMessage(message, false);
}

function hideAuth() {
  if (authOverlay) authOverlay.hidden = true;
  if (appEl) appEl.classList.remove("hidden");
}

async function forgetSession() {
  token = "";
  session = null;
  try {
    await chrome.storage.local.remove([TOKEN_STORAGE_KEY]);
  } catch {
    /* storage unavailable */
  }
}

async function saveSession(value) {
  token = value;
  try {
    await chrome.storage.local.set({ [TOKEN_STORAGE_KEY]: value });
  } catch {
    /* storage unavailable */
  }
}

async function fetchMe() {
  try {
    console.log('[fetchMe] calling /api/auth/me with token:', token ? token.substring(0, 30) + '...' : 'NONE');
    const res = await api("/api/auth/me");
    console.log('[fetchMe] response ok:', res.ok, res.status);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[fetchMe] non-ok response:", res.status, text);
      return null;
    }
    const data = await res.json();
    console.log('[fetchMe] success:', data);
    return data;
  } catch (err) {
    console.warn("[fetchMe] caught error:", err && err.message ? err.message : String(err));
    return null;
  }
}

function applyAccessState(me) {
  const blocked = Boolean(me.isBlocked);
  const features = me.features || {};
  const canSearch = !blocked && features.search !== false;
  if (blockedMsgEl) {
    blockedMsgEl.classList.toggle("hidden", !blocked);
    blockedMsgEl.textContent = blocked
      ? "🚫 Your account has been suspended. Contact support to restore access."
      : "";
  }
  [searchButton, trendingButton, bestSellingButton, bestSellerSupplierButton].forEach((el) => {
    if (el) el.disabled = !canSearch;
  });
  if (me.dailyLimit && me.dailyUsed >= me.dailyLimit) {
    setStatus("Daily API limit reached", "warn");
    setMessage(`Daily limit reached (${me.dailyUsed}/${me.dailyLimit}). It resets at 00:00 UTC.`, true);
  }
}

function usageSummary() {
  if (!session) return "";
  const bits = [];
  if (session.dailyLimit) bits.push(`today ${session.dailyUsed}/${session.dailyLimit}`);
  if (session.monthlyLimit) bits.push(`month ${session.monthlyUsed}/${session.monthlyLimit}`);
  return bits.length ? ` · ${bits.join(" · ")}` : "";
}

function enterApp(me) {
  session = me;
  hideAuth();
  if (userEmailEl) {
    userEmailEl.textContent = me.email || "";
    userEmailEl.title = `${me.email || ""}\nUser: ${me.id || ""}`;
  }
  applyAccessState(me);
  if (me.isBlocked) return;
  if (me.hasCjKey) {
    setStatus(`Ready · CJ key connected${usageSummary()}`, "ok");
    const stored = chrome.storage.local.get(["lastQuery"]);
    Promise.resolve(stored).then((data) => {
      if (data && data.lastQuery && queryInput && !queryInput.value) queryInput.value = data.lastQuery;
    });
  } else {
    setStatus("Add your CJ API key", "warn");
    setMessage("One-time setup: paste your CJdropshipping API key below.", false);
    openSettings();
  }
}

async function submitAuth() {
  const emailInput = document.querySelector("#authEmail");
  const passwordInput = document.querySelector("#authPassword");
  const email = emailInput ? emailInput.value.trim() : "";
  const password = passwordInput ? passwordInput.value : "";
  if (!email || !password) { setAuthMessage("Enter your email and password."); return; }
  if (authMode === "signup" && password.length < 8) {
    setAuthMessage("Password must be at least 8 characters.");
    return;
  }

  const authBtnEl = document.querySelector("#authBtn");
  if (authBtnEl) authBtnEl.disabled = true;
  setAuthMessage(authMode === "signup" ? "Creating your account…" : "Signing in…");
  try {
    const nameInput = document.querySelector("#authName");
    const res = await fetch(`${API_BASE}/api/auth/${authMode === "signup" ? "signup" : "login"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        fullName: nameInput && !nameWrap?.hidden ? nameInput.value.trim() : undefined
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not sign in.");

    if (authMode === "signup" && !data.token) {
      setAuthMessage("Account created ✓ — confirm your email, then sign in.", true);
      setAuthMode("signin");
      return;
    }

    await saveSession(data.token);
    const me = await fetchMe();
    if (!me) {
      const detail = `API returned no profile data (status: ${data.token ? 'unknown' : 'none'}). Check console in chrome://extensions/ → Inspect for details.`;
      throw new Error("Signed in, but the account could not be loaded.\n" + detail);
    }
    enterApp(me);
  } catch (error) {
    setAuthMessage(error.message || "Could not sign in.");
  } finally {
    const btn = document.querySelector("#authBtn");
    if (btn) btn.disabled = false;
  }
}

// Event delegation for auth buttons — robust against DOM timing issues
function attachAuthListeners() {
  document.addEventListener("click", (event) => {
    const target = event.target;

    // Sign in / Create account button
    if (target.closest("#authBtn")) {
      event.preventDefault();
      submitAuth();
      return;
    }

    // Toggle between sign in and sign up
    if (target.closest("#toggleAuth")) {
      event.preventDefault();
      setAuthMode(authMode === "signin" ? "signup" : "signin");
      return;
    }

    // Logout button
    if (target.closest("#logoutBtn")) {
      event.preventDefault();
      (async () => {
        try { await api("/api/auth/logout", { method: "POST" }); } catch { /* already dead */ }
        await forgetSession();
        showAuth();
        setStatus("Signed out", "warn");
        setMessage("", false);
      })();
      return;
    }
  });

  // Enter key submits the auth form
  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && document.querySelector("#authOverlay") && !document.querySelector("#authOverlay").hidden) {
      event.preventDefault();
      submitAuth();
    }
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function setStatus(text, tone) {
  statusEl.textContent = text;
  statusEl.className = "status" + (tone ? ` ${tone}` : "");
}

function setMessage(text, isError) {
  messageEl.textContent = text || "";
  messageEl.className = "message" + (isError ? " error" : "");
}

function formatListingAge(days, createrTime) {
  const d = Number(days) || 0;
  const months = Math.floor(d / 30);
  const years = Math.floor(d / 365);
  if (years > 0) return `${years} year(s) ago`;
  if (months > 0) return `${months} month(s) ago`;
  return `${d} day(s) ago`;
}

function scoreClass(score) {
  if (score >= 70) return "high";
  if (score >= 45) return "mid";
  return "low";
}

function inputValue(id) {
  const el = document.querySelector(id);
  return el ? String(el.value || "").trim() : "";
}

function readFilters() {
  const freeShip = document.querySelector("#fFreeShip");
  const quick = document.querySelector("#fQuickDelivery");
  return {
    minPrice: inputValue("#fMinPrice"),
    maxPrice: inputValue("#fMaxPrice"),
    minStock: inputValue("#fMinStock"),
    maxStock: inputValue("#fMaxStock"),
    minListed: inputValue("#fMinListed"),
    maxListed: inputValue("#fMaxListed"),
    country: inputValue("#fCountry"),
    deliverTo: inputValue("#fDeliverTo"),
    freeShipping: freeShip && freeShip.checked ? "1" : "",
    quick: quick && quick.checked ? "1" : ""
  };
}

function readListingFilters() {
  const ck = (id) => {
    const el = document.querySelector(id);
    return Boolean(el && el.checked);
  };
  return {
    newListing: ck("#fNewListing"),
    newProduct: ck("#fNewProduct"),
    reListing: ck("#fRelisting"),
    neverListed: ck("#fNeverListed"),
    quickDelivery: ck("#fQuickDelivery")
  };
}

function applyListingFilters(products) {
  const f = readListingFilters();
  const needsMeta = f.newListing || f.newProduct || f.reListing;
  // Max days since listed — read from the DOM directly (not part of readListingFilters)
  const maxDaysInput = document.querySelector("#fMaxDays");
  const maxDays = maxDaysInput ? Number(maxDaysInput.value) || 0 : 0;
  return products.filter((p) => {
    if (f.neverListed && !(Number(p.listedNum) === 0)) return false;
    if (f.quickDelivery && p.quickDelivery !== true) return false;
    const en = enrichMap[p.id];
    const daysOld = en && en.daysSinceListing !== null && en.daysSinceListing !== undefined && Number.isFinite(Number(en.daysSinceListing))
      ? Number(en.daysSinceListing)
      : null;
    // Max days since listed (requires enrichment data)
    if (maxDays && daysOld !== null && daysOld > maxDays) return false;
    if (maxDays && daysOld === null) return false; // can't verify age — exclude
    if (!needsMeta && !maxDays) return true;
    if (daysOld === null) return false;
    if (f.newListing && !(daysOld <= 7)) return false;
    if (f.newProduct && !(daysOld <= 30)) return false;
    if (f.reListing && en.isRelisting !== true) return false;
    return true;
  });
}

function applyRangeFilters(products) {
  const f = readFilters();
  const minS = Number(f.minStock) || 0;
  const maxS = Number(f.maxStock) || 0;
  const minL = Number(f.minListed) || 0;
  const maxL = Number(f.maxListed) || 0;
  return products.filter((p) => {
    const stock = Number(p.stock) || 0;
    const listed = Number(p.listedNum) || 0;
    if (minS && stock < minS) return false;
    if (maxS && stock > maxS) return false;
    if (minL && listed < minL) return false;
    if (maxL && listed > maxL) return false;
    return true;
  });
}

function buildParams(extra = {}) {
  const params = new URLSearchParams({
    q: queryInput.value.trim(),
    page: String(currentPage),
    pageSize: "50",
    sort: "winning",
    ...extra
  });
  const f = readFilters();
  if (f.minPrice) params.set("minPrice", f.minPrice);
  if (f.maxPrice) params.set("maxPrice", f.maxPrice);
  if (f.minStock) params.set("minStock", f.minStock);
  if (f.minListed) params.set("minListed", f.minListed);
  if (f.maxListed) params.set("maxListed", f.maxListed);
  if (f.country) params.set("country", f.country);
  if (f.deliverTo) params.set("deliverTo", f.deliverTo);
  if (f.quick) {
    params.set("quick", "1");
    params.set("deliverTo", f.deliverTo || "US");
  }
  if (f.freeShipping) params.set("freeShipping", f.freeShipping);
  return params;
}

function formatCost(p) {
  if (p.cjCost === null || p.cjCost === undefined) return "n/a";
  const promo = p.promoPrice !== null && p.promoPrice !== undefined && p.promoPrice < p.cjCost;
  const base = `${escapeHtml(p.currency)} ${Number(p.cjCost).toFixed(2)}`;
  return promo ? `${base} → ${Number(p.promoPrice).toFixed(2)}` : base;
}

function calculateProfit(p, en) {
  const cjCost = Number(p?.cjCost) || 0;
  const sellPrice = Number(p?.suggestSellPrice) || Number(p?.cjCost) * 1.5 || 0;
  const totalSales = Number(en?.totalSales) || 0;
  const dailyEst = Number(en?.dailyEst) || 0;
  const revenue = sellPrice * (dailyEst * 30 || totalSales || 100);
  const grossProfit = revenue - (cjCost * (dailyEst * 30 || totalSales || 100));
  const netProfit = grossProfit - 5;
  const margin = revenue > 0 ? Math.round(((netProfit / revenue) * 100) * 100) / 100 : 0;
  return { revenue, grossProfit, netProfit, margin };
}

function profitRowsHtml(p, en) {
  const calc = calculateProfit(p, en);
  if (!calc || !calc.margin) return "";
  const revenue = "$" + calc.revenue.toFixed(2);
  const profit = "$" + calc.netProfit.toFixed(2);
  const margin = calc.margin;
  const marginClass = margin > 30 ? "profit-good" : margin > 15 ? "profit-moderate" : "profit-low";
  return `<div class="row tags profit-section"><span>💰 Est. revenue ${revenue}</span><span>✅ Est. profit ${profit}</span><span class="profit-margin ${marginClass}">📈 ${margin}% margin</span></div>`;
}

function salesRowsHtml(p) {
  const en = enrichMap[p.id];
  if (en) {
    const sold = en.totalSales !== null && en.totalSales !== undefined
      ? Number(en.totalSales).toLocaleString() : "—";
    const bits = [];
    if (en.rating !== null && en.rating !== undefined) bits.push(`⭐ ${escapeHtml(en.rating)}/5`);
    if (en.reviewTotal !== null && en.reviewTotal !== undefined) bits.push(`${Number(en.reviewTotal).toLocaleString()} reviews`);
    const est = [];
    if (en.dailyEst !== null && en.dailyEst !== undefined) est.push(`📈 ~${Number(en.dailyEst).toLocaleString()}/day`);
    if (en.monthlyEst !== null && en.monthlyEst !== undefined) est.push(`📊 ~${Number(en.monthlyEst).toLocaleString()}/mo`);
    const flags = [];
    if (en.daysSinceListing !== null && en.daysSinceListing !== undefined) {
      const d = Number(en.daysSinceListing);
      flags.push(`📅 listed ${d.toLocaleString()}d ago${d <= 7 ? " 🆕" : d <= 30 ? " ✨" : ""}`);
    }
    if (en.isNewListing === true) flags.push("🆕 listing ≤7d");
    if (en.isNewProduct === true && en.isNewListing !== true) flags.push("✨ new ≤30d");
    if (en.isRelisting === true) flags.push("♻ re-listing");
    return `
      <div class="row tags"><span>🛒 Sold ${sold}</span>${bits.length ? `<span>${bits.join(" · ")}</span>` : ""}</div>
      ${est.length ? `<div class="row tags">${est.join("\n      ")}<span>estimate</span></div>` : ""}
      ${flags.length ? `<div class="row tags">${flags.map((f) => `<span>${f}</span>`).join("\n      ")}</div>` : ""}
      ${en && calculateProfit(p, en)?.margin > 0 ? profitRowsHtml(p, en) : ""}
      ${en.daysSinceListing !== null && en.daysSinceListing !== undefined ? `<div class="row tags"><span>📅 First listed: ${formatListingAge(en.daysSinceListing, en.createrTime)}</span><button type="button" class="view-analysis-btn" title="View listing details">📅 Listing age →</button></div>` : ""}`;
  }
  if (pendingEnrich.has(p.id)) return `<div class="row tags"><span>⏳ sales & ratings…</span></div>`;
  return "";
}

function renderProducts(products) {
  shownProducts = products;
  resultsEl.innerHTML = "";
  if (!products.length) {
    setMessage("No products found. Try a broader keyword, Trending mode, or looser filters.", false);
    return;
  }
  const sortLabel = bestSellingMode ? "sorted by total sold (CJ orders)" : "sorted by winning score";
  setMessage(`${products.length} product(s), ${sortLabel}. Click a product to open it on CJ.`, false);
  products.forEach((p) => {
    const item = document.createElement("article");
    item.className = "item";
    const stock = p.stock === null || p.stock === undefined ? "?" : String(p.stock);
    const listed = p.listedNum === null || p.listedNum === undefined ? "listing ?" : `🏪 ${Number(p.listedNum).toLocaleString()} sellers`;
    const en = enrichMap[p.id] || {};
    const tags = [
      listed,
      `stock ${stock}`,
      p.deliveryDays !== null && p.deliveryDays !== undefined
        ? `<span class="qbadge">🚀 ~${p.deliveryDays}d delivery</span>`
        : p.quickDelivery ? `<span class="qbadge">🚀 quick delivery</span>` : null,
      p.isFreeShipping ? "free ship" : null,
      p.hasVideo ? "video" : null,
      en.daysSinceListing !== null && en.daysSinceListing !== undefined
        ? `<span class="qbadge">📅 listed ${Number(en.daysSinceListing).toLocaleString()}d ago</span>`
        : null,
      p.supplierName ? `supplier: ${escapeHtml(p.supplierName)}` : null,
      p.category ? escapeHtml(p.category) : null
    ].filter(Boolean).map(t => t.startsWith("<span") ? t : `<span>${t}</span>`).join("");
    const img = p.image
      ? `<img src="${escapeHtml(p.image)}" alt="" loading="lazy">`
      : `<div class="noimg">No img</div>`;
    item.innerHTML = `
      ${img}
      <div class="body">
        <h3 title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</h3>
        <div class="row cost"><strong>CJ cost ${formatCost(p)}</strong></div>
        <div class="row tags">${tags}</div>
        ${salesRowsHtml(p)}
        <div class="row">
          <span class="score ${scoreClass(Number(p.score) || 0)}">${escapeHtml(p.score)}/100</span>
          <span class="label">${escapeHtml(p.scoreLabel)}</span>
          <button type="button" class="info-btn list-btn" title="List this product to your CJ store">🏪 List to CJ</button>
          <button type="button" class="info-btn" title="View supplier & product details">Supplier info</button>
          <button type="button" class="info-btn sellers-btn" title="View sellers list">📋 Sellers →</button>
          <button type="button" class="info-btn adspy-btn" title="AdSpy — live ad intelligence">📊 AdSpy</button>
        </div>
      </div>`;
    const imgEl = item.querySelector("img");
    if (imgEl) imgEl.addEventListener("error", () => { imgEl.style.display = "none"; });
    // "📅 Listing age" button inside salesRowsHtml → open listing age modal
    const analysisBtn = item.querySelector(".view-analysis-btn");
    if (analysisBtn) {
      analysisBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        openListingAgeModal(p.id);
      });
    }
    // "📊 AdSpy" button → open ad intelligence modal
    const adspyBtn = item.querySelector(".adspy-btn");
    if (adspyBtn) {
      adspyBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        openAdSpyModal(p.id);
      });
    }
    item.addEventListener("click", (event) => {
      if (event.target.closest(".info-btn")) {
        event.stopPropagation();
        if (event.target.closest(".list-btn")) openListing(p.id, p.name);
        else if (event.target.closest(".sellers-btn")) openSellersModal(p.id);
        else if (event.target.closest(".adspy-btn")) openAdSpyModal(p.id);
        else openDetail(p.id);
        return;
      }
      if (p.productUrl) {
        chrome.tabs.create({ url: p.productUrl });
      } else if (p.id) {
        openDetail(p.id);
      }
    });
    resultsEl.appendChild(item);
  });
  // Show pagination if more than 1 page
  const paginationEl = document.getElementById("pagination");
  const prevBtn = document.getElementById("prevPage");
  const nextBtn = document.getElementById("nextPage");
  const pageInfo = document.getElementById("pageInfo");
  if (paginationEl && prevBtn && nextBtn && pageInfo) {
    if (totalPages > 1) {
      paginationEl.hidden = false;
      prevBtn.disabled = currentPage <= 1;
      nextBtn.disabled = currentPage >= totalPages;
      pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    } else {
      paginationEl.hidden = true;
    }
  }
}

function parseRange(value) {
  if (value === null || value === undefined || value === "") return null;
  const nums = (String(value).match(/\d+(\.\d+)?/g) || []).map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: Math.max(...nums), display: String(value).trim() };
}

function stripHtml(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function stockByCountry(raw) {
  const map = {};
  const variants = Array.isArray(raw?.variants) ? raw.variants : [];
  variants.forEach((v) => {
    const invs = Array.isArray(v?.inventories) ? v.inventories : [];
    invs.forEach((inv) => {
      const code = inv?.countryCode || "?";
      map[code] = (map[code] || 0) + (Number(inv?.totalInventory) || 0);
    });
  });
  return Object.entries(map).filter(([, total]) => total > 0).sort((a, b) => b[1] - a[1]);
}

function stars(score) {
  if (score === null || score === undefined) return "";
  const n = Math.max(0, Math.min(5, Math.round(Number(score))));
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function reviewsSectionHtml(reviews) {
  if (!reviews) {
    return `<div class="msection">Reviews</div>
      <div class="mrow"><span>Review count</span><strong>Unavailable (CJ call failed or rate-limited)</strong></div>`;
  }
  const recent = Array.isArray(reviews.recent) ? reviews.recent : [];
  const items = recent.map((r) => `
    <div class="review-item">
      <div class="review-top">
        <span class="review-stars">${stars(r.score)}</span>
        <span class="review-meta">${escapeHtml(r.user || "Buyer")}${r.country ? ` · ${escapeHtml(r.country)}` : ""}${r.date ? ` · ${escapeHtml(r.date)}` : ""}</span>
      </div>
      ${r.text ? `<p class="review-text">${escapeHtml(r.text)}</p>` : ""}
    </div>`).join("");
  return `
    <div class="msection">Reviews</div>
    <div class="mrow"><span>Total reviews</span><strong>${Number(reviews.total ?? 0).toLocaleString()}</strong></div>
    ${reviews.avgScoreRecent !== null && reviews.avgScoreRecent !== undefined
      ? `<div class="mrow"><span>Average (recent)</span><strong>${stars(reviews.avgScoreRecent)} ${escapeHtml(reviews.avgScoreRecent)}/5</strong></div>` : ""}
    ${reviews.last7d !== undefined && reviews.last7d !== null
      ? `<div class="mrow"><span>Reviews · last 7 days</span><strong>${escapeHtml(reviews.last7d)}</strong></div>` : ""}
    ${reviews.last30d !== undefined && reviews.last30d !== null
      ? `<div class="mrow"><span>Reviews · last 30 days</span><strong>${escapeHtml(reviews.last30d)}</strong></div>` : ""}
    ${items || `<div class="mrow"><span>Recent</span><strong>No reviews yet</strong></div>`}`;
}

function salesSectionHtml(metrics, sales) {
  const w30 = metrics?.windows?.d30 || null;
  const w7 = metrics?.windows?.d7 || null;
  const w90 = metrics?.windows?.d90 || null;
  const since = metrics?.trackingSince || "today";
  const sold90 = sales && Number.isFinite(Number(sales.sold90d)) ? Number(sales.sold90d) : null;
  const totalSales = sales && Number.isFinite(Number(sales.totalSales)) ? Number(sales.totalSales) : null;

  const windowEstimate = (win, days) => {
    if (win && Number(win.stockChange) > 0) return `~${Number(win.stockChange).toLocaleString()} (from stock drop)`;
    if (sold90 !== null) return `~${Math.max(0, Math.round((sold90 * days) / 90))} (from CJ 90-day sales)`;
    if (win) return "~0 (no net stock drop)";
    return `Collecting data (since ${since})`;
  };

  let totalText;
  if (totalSales !== null) {
    totalText = `${totalSales.toLocaleString()} CJ orders`;
    if (sales.lastOrderDate) totalText += ` · last ${sales.lastOrderDate}`;
  } else {
    totalText = "Not provided by CJ";
  }

  return `
    <div class="msection">Sales Count</div>
    <div class="mrow"><span>Total Sales</span><strong>${escapeHtml(totalText)}</strong></div>
    <div class="mrow"><span>Sales (Last 7 Days)</span><strong>${escapeHtml(windowEstimate(w7, 7))}</strong></div>
    <div class="mrow"><span>Sales (Last 30 Days)</span><strong>${escapeHtml(windowEstimate(w30, 30))}</strong></div>
    <div class="mrow"><span>Sales (Last 90 Days)</span><strong>${sold90 !== null ? `${sold90.toLocaleString()} (CJ actual)` : escapeHtml(windowEstimate(w90, 90))}</strong></div>
    <p class="mnote">Total Sales = CJ's real order count for this product (productDetail API). 7/30-day sales are estimated from CJ 90-day sales or daily stock snapshots this app records. 90-day sales are actual CJ data when available. Restocks can hide sales; signal, not proof.</p>`;
}

function sellingSitesHtml(p) {
  const sites = Array.isArray(p.sellingSites) ? p.sellingSites : [];
  if (!sites.length) return "";
  return `
    <div class="msection">Recommended Selling Site</div>
    ${sites.map((s) => `<div class="mrow mrow-sites"><span>🛍 ${escapeHtml(s.site)}</span><strong>${escapeHtml(s.why)}</strong></div>`).join("")}
    <p class="mnote">Category-based suggestion (heuristic, not a guarantee). CJ can push products and orders to Shopify, WooCommerce, eBay, Amazon and more via CJ → Integration.</p>`;
}

function detailHtml(p, reviews, metrics, sales, sup) {
  const raw = p.raw || {};
  const cost = parseRange(p.cjCostDisplay ?? raw.sellPrice);
  const suggest = parseRange(p.suggestSellPriceDisplay ?? raw.suggestSellPrice);
  let marginLine = "Not available";
  if (suggest && cost && suggest.min > cost.max) {
    const pct = (((suggest.min - cost.max) / suggest.min) * 100).toFixed(1);
    marginLine = `~${pct}% (suggested retail vs top variant cost)`;
  }
  const supplier = p.supplierName
    ? escapeHtml(p.supplierName) + (p.supplierId ? ` (id: ${escapeHtml(p.supplierId)})` : "")
    : "Not provided by CJ API (CJ-stocked product)";
  const sourceFrom = p.sourceFrom !== null && p.sourceFrom !== undefined ? String(p.sourceFrom) : "—";
  const countryStock = stockByCountry(raw);
  const description = stripHtml(raw.description).slice(0, 500);
  const weight = raw.productWeight ? `${escapeHtml(raw.productWeight)} g` : "—";
  const variants = Array.isArray(raw.variants) ? raw.variants.length : 0;

  return `
    ${p.image ? `<img class="modal-body-img" src="${escapeHtml(p.image)}" alt="">` : ""}
    <h3>${escapeHtml(p.name)}</h3>
    <div class="mrow"><span>SKU</span><strong>${escapeHtml(p.sku || raw.productSku || "—")}</strong></div>
    <div class="mrow"><span>CJ cost</span><strong>${cost ? escapeHtml(cost.display) : "—"}</strong></div>
    <div class="mrow"><span>CJ suggested retail</span><strong>${suggest ? escapeHtml(suggest.display) : "—"}</strong></div>
    <div class="mrow"><span>Suggested margin</span><strong>${marginLine}</strong></div>
    <div class="mrow"><span>Winning score</span><strong>${escapeHtml(p.score)}/100</strong></div>
    <div class="msection">Vendor / supplier</div>
    <div class="mrow"><span>Vendor name</span><strong>${supplier}</strong></div>
    <div class="mrow"><span>Source flag</span><strong>${escapeHtml(sourceFrom)}</strong></div>
    <div class="mrow"><span>Category</span><strong>${escapeHtml(p.category || raw.categoryName || "—")}</strong></div>
    ${raw.createrTime ? `<div class="mrow"><span>First listed on CJ</span><strong>${escapeHtml(String(raw.createrTime).slice(0, 10))}</strong></div>` : ""}
      ${raw.daysSinceListing !== null && raw.daysSinceListing !== undefined ? `<div class="mrow"><span>Days since first listed</span><strong>${Number(raw.daysSinceListing).toLocaleString()} day(s)${raw.daysSinceListing <= 7 ? " 🆕" : raw.daysSinceListing <= 30 ? " ✨" : ""}</strong></div>` : ""}
    <div class="mrow"><span>Website</span><strong>${sup?.website ? `<a class="mlink" href="${escapeHtml(/^https?:\/\//i.test(sup.website) ? sup.website : `https://${sup.website}`)}" target="_blank" rel="noopener">${escapeHtml(sup.website)}</a>` : "Not provided by CJ API"}</strong></div>
    <div class="mrow"><span>Email</span><strong>${sup?.email ? `<a class="mlink" href="mailto:${escapeHtml(sup.email)}">${escapeHtml(sup.email)}</a>` : "Not provided by CJ API"}</strong></div>
    <div class="mrow"><span>Phone</span><strong>${sup?.phone ? escapeHtml(sup.phone) : "Not provided by CJ API"}</strong></div>
    <div class="mrow"><span>US warehouse</span><strong>${sup?.hasUSWarehouse ? `✅ Yes — ${Number(sup.usInventory).toLocaleString()} in stock` : sup?.warehouseCountries && Object.keys(sup.warehouseCountries).length ? "No US stock" : "Not detected"}</strong></div>
    ${reviewsSectionHtml(reviews)}
    ${salesSectionHtml(metrics, sales)}
    ${sellingSitesHtml(p)}
    <div class="msection">Logistics</div>
    <div class="mrow"><span>Listed by sellers</span><strong>${p.listedNum ?? "—"}</strong></div>
    <div class="mrow"><span>Free shipping</span><strong>${p.isFreeShipping ? "Yes" : "No"}</strong></div>
    <div class="mrow"><span>Weight</span><strong>${weight}</strong></div>
    <div class="mrow"><span>Variants</span><strong>${variants}</strong></div>
    ${countryStock.length ? `<div class="msection">Stock by country</div>
    <div class="stock-chips">${countryStock.map(([c, n]) => `<span>${escapeHtml(c)}: ${n.toLocaleString()}</span>`).join("")}</div>` : ""}
    ${description ? `<div class="msection">Description</div><div class="mdesc">${escapeHtml(description)}…</div>` : ""}
    <div class="mactions">
      ${p.productUrl ? `<button type="button" id="modalOpenCj">Open on CJ</button>` : ""}
      <button type="button" id="modalListBtn" class="lp-btn-inline">🏪 List to CJ Store</button>
      <button type="button" id="modalCloseBtn" class="info-btn" style="flex:0 0 auto;padding:11px 14px">Close</button>
    </div>`;
}

function closeModal() {
  if (!modal) return;
  modal.hidden = true;
  modalBody.innerHTML = "";
}

async function openDetail(id) {
  if (!modal || !id) return;
  modal.hidden = false;
  modalBody.innerHTML = "<p class='message'>Loading product & supplier info…</p>";
  try {
    const res = await api(`/api/products/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error([data.error, data.detail].filter(Boolean).join(" "));
    modalBody.innerHTML = detailHtml(data.product, data.reviews, data.metrics, data.sales, data.supplier);
    const openCj = document.querySelector("#modalOpenCj");
    if (openCj && data.product?.productUrl) {
      openCj.addEventListener("click", () => chrome.tabs.create({ url: data.product.productUrl }));
    }
    const closeBtn = document.querySelector("#modalCloseBtn");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    const listBtn = document.querySelector("#modalListBtn");
    if (listBtn) listBtn.addEventListener("click", () => {
      closeModal();
      openListing(data.product?.id || id, data.product?.name || "");
    });
  } catch (err) {
    modalBody.innerHTML = `<p class="error">${escapeHtml(err.message || "Request failed.")}</p>`;
  }
}

async function openListingAgeModal(id) {
  if (!id) return;
  modal.hidden = false;
  modalBody.innerHTML = "<p class='message'>Loading listing age…</p>";
  try {
    const res = await api(`/api/products/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error([data.error, data.detail].filter(Boolean).join(" "));
    const p = data.product;
    const sales = data.sales || {};
    const en = enrichMap[id] || {};
    const days = sales.daysSinceListing ?? en.daysSinceListing ?? null;
    const createrTime = sales.createrTime ?? en.createrTime ?? null;
    const name = p?.name || "Untitled product";

    let dateStr = "Unknown";
    if (createrTime) {
      const parsed = Number.isFinite(Number(createrTime)) ? Number(createrTime) : Date.parse(createrTime);
      if (Number.isFinite(parsed) && parsed > 0) dateStr = new Date(parsed).toISOString().slice(0, 10);
    }

    modalBody.innerHTML = `
      <h3 style="margin:0 36px 12px 0;font-size:15px;line-height:1.3">${escapeHtml(name)}</h3>
      <div class="msection">Listing Age</div>
      <div class="mrow"><span>First listed on CJ</span><strong>${escapeHtml(dateStr)}</strong></div>
      ${days !== null && days !== undefined ? `
        <div class="mrow"><span>Days since first listed</span><strong>${Number(days).toLocaleString()} day(s)</strong></div>
        <div class="mrow"><span>Months since listed</span><strong>${Math.floor(Number(days) / 30)} month(s)</strong></div>
        <div class="mrow"><span>Years since listed</span><strong>${Math.floor(Number(days) / 365)} year(s)</strong></div>
        ${Number(days) <= 7 ? `<div class="mrow"><span>Status</span><strong>🆕 New listing (≤7 days)</strong></div>` : ""}
        ${Number(days) <= 30 && Number(days) > 7 ? `<div class="mrow"><span>Status</span><strong>✨ New product (≤30 days)</strong></div>` : ""}
      ` : `<div class="mrow"><span>Days since first listed</span><strong>Not available from CJ API</strong></div>`}
      <div class="mactions">
        <button type="button" id="modalListBtn" class="lp-btn-inline">🏪 List to CJ Store</button>
        <button type="button" id="modalCloseBtn" class="button-secondary">Close</button>
      </div>`;
    const listBtn = document.querySelector("#modalListBtn");
    if (listBtn) listBtn.addEventListener("click", () => { closeModal(); openListing(id, name); });
    const closeBtn = document.querySelector("#modalCloseBtn");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
  } catch (err) {
    modalBody.innerHTML = `<p class="error">${escapeHtml(err.message || "Request failed.")}</p>`;
  }
}

// Sellers modal function (added for the Sellers feature)
// Uses the existing /api/products/:pid endpoint — the `supplier` field
// returned by getProductSalesInfo carries shop name, logo, warehouse
// countries, US inventory and website. There is no separate "list of all
// sellers" endpoint on CJ; we show the listing shop + warehouse breakdown.
async function openSellersModal(id) {
  if (!id) return;
  modal.hidden = false;
  modalBody.innerHTML = "<p class='message'>Loading seller info…</p>";
  try {
    const res = await api(`/api/products/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error([data.error, data.detail].filter(Boolean).join(" "));
    const p = data.product || {};
    const sup = data.supplier || {};
    const sl = data.sellerList || {};
    const sellers = Array.isArray(sl.sellers) ? sl.sellers : [];
    const csvRows = Array.isArray(sl.csvRows) ? sl.csvRows : [];
    const name = p.name || "Untitled product";

    const shopName = sup.shopName || sup.supplierNameEn || "Unknown Supplier";
    const shopLogo = sup.shopLogo || null;
    const supplierWebsite = sup.supplierWebsite || null;
    const warehouseCountries = sup.warehouseCountries || {};
    const hasUSWarehouse = Boolean(sup.hasUSWarehouse);
    const usInventory = sup.usInventory !== null && sup.usInventory !== undefined ? Number(sup.usInventory) : null;
    const listedNum = p.listedNum !== null && p.listedNum !== undefined ? Number(p.listedNum) : null;

    const warehouseRows = Object.entries(warehouseCountries)
      .map(([code, qty]) => ({ code, qty: Number(qty) || 0 }))
      .sort((a, b) => b.qty - a.qty);

    // Build CSV string
    const csvHeaders = csvRows.length ? Object.keys(csvRows[0]).join(",") : "";
    const csvBody = csvRows.map(r => Object.values(r).map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const csvString = csvHeaders + "\n" + csvBody;
    const csvBlob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const csvUrl = URL.createObjectURL(csvBlob);

    // Build seller rows HTML with full detail
    const sellerRowsHtml = sellers.map(function(s) {
      const detailFields = [];
      if (s.supplierId) detailFields.push('<span class="qbadge" style="margin:2px">ID: ' + escapeHtml(s.supplierId) + '</span>');
      if (s.rating !== null && s.rating !== undefined) detailFields.push('<span class="qbadge" style="margin:2px">★ ' + Number(s.rating).toFixed(1) + '/5</span>');
      if (s.commentCount !== null && s.commentCount !== undefined) detailFields.push('<span class="qbadge" style="margin:2px">💬 ' + Number(s.commentCount).toLocaleString() + ' reviews</span>');
      if (s.totalSales !== null && s.totalSales !== undefined) detailFields.push('<span class="qbadge" style="margin:2px">📦 ' + Number(s.totalSales).toLocaleString() + ' sold</span>');
      if (s.hasUSWarehouse) detailFields.push('<span class="qbadge" style="margin:2px;background:#dcfce7;color:#16a34a">🇺🇸 US warehouse</span>');
      if (s.usInventory !== null && s.usInventory !== undefined) detailFields.push('<span class="qbadge" style="margin:2px"> Stock: ' + Number(s.usInventory).toLocaleString() + '</span>');
      if (s.email) detailFields.push('<span class="qbadge" style="margin:2px">✉ ' + escapeHtml(s.email) + '</span>');
      if (s.phone) detailFields.push('<span class="qbadge" style="margin:2px">📞 ' + escapeHtml(s.phone) + '</span>');
      if (s.domains && s.domains.length) detailFields.push('<span class="qbadge" style="margin:2px">🌐 ' + s.domains.length + ' domain(s)</span>');

      const warehouseEntries = s.warehouseCountries ? Object.entries(s.warehouseCountries) : [];
      const warehouseBadges = warehouseEntries.length
        ? warehouseEntries.map(function(cn) {
            return '<span style="background:#e0f2fe20;color:#0369a1;padding:1px 6px;border-radius:10px;font-size:10px;margin:2px">' + escapeHtml(cn[0]) + ': ' + Number(cn[1]).toLocaleString() + '</span>';
          }).join('')
        : '';

      const websiteUrl = s.website ? (s.website.match(/^https?:\/\//i) ? s.website : 'https://' + s.website) : null;

      return '<div class="seller-row" style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px dashed var(--border)">'
        + (s.shopLogo ? '<img src="' + escapeHtml(s.shopLogo) + '" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;">' : '<div style="width:36px;height:36px;border-radius:50%;background:#e5e7eb;display:grid;place-items:center;font-weight:bold;color:#6b7280;font-size:14px;flex-shrink:0;">' + ((s.name || '?').charAt(0)) + '</div>')
        + '<div style="flex:1;min-width:0">'
          + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
            + '<strong style="font-size:13px">' + escapeHtml(s.name) + '</strong>'
            + (s.isPrimary ? '<span class="qbadge" style="margin-left:6px">⭐ Listing shop</span>' : '<span class="qbadge" style="margin-left:6px;background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0">Additional seller</span>')
          + '</div>'
          + (websiteUrl ? '<div style="font-size:11px;margin-top:2px"><a href="' + escapeHtml(websiteUrl) + '" target="_blank" rel="noopener" style="color:var(--primary)">' + escapeHtml(s.website) + '</a></div>' : '<div style="font-size:11px;color:var(--text3)">' + (s.isPrimary ? 'No website provided by CJ' : 'Name not public on CJ') + '</div>')
          + (detailFields.length ? '<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px">' + detailFields.join('') + '</div>' : '')
          + (warehouseBadges ? '<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px">' + warehouseBadges + '</div>' : '')
          + (!s.hasDetails ? '<div style="font-size:10px;color:var(--text3);margin-top:4px;font-style:italic">' + escapeHtml(s.note) + '</div>' : '')
        + '</div>'
      + '</div>';
    }).join('');

`
      <h3 style="margin:0 36px 12px 0;font-size:15px;line-height:1.3">${escapeHtml(name)}</h3>
      <div class="msection">Seller / Supplier</div>
      <div class="mrow" style="align-items:flex-start">
        <div style="display:flex;gap:12px;align-items:center">
          ${shopLogo ? `<img src="${escapeHtml(shopLogo)}" alt="${escapeHtml(shopName)}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">` : `<div style="width:40px;height:40px;border-radius:50%;background:#e5e7eb;display:flex;align-items:center;justify-content:center;font-weight:bold;color:#6b7280;">${shopName.charAt(0)}</div>`}
          <div style="flex:1">
            <strong>${escapeHtml(shopName)}</strong>
            ${supplierWebsite ? `<div><a href="${escapeHtml(/^https?:\/\//i.test(supplierWebsite) ? supplierWebsite : `https://${supplierWebsite}`)}" target="_blank" rel="noopener" style="font-size:13px;">${escapeHtml(supplierWebsite)}</a></div>` : `<div class="muted" style="font-size:13px;">No website provided by CJ</div>`}
          </div>
        </div>
      </div>
      ${listedNum !== null ? `<div class="mrow"><span>Number of sellers who listed this</span><strong>${listedNum.toLocaleString()}</strong></div>` : ''}
      ${hasUSWarehouse ? `<div class="mrow"><span>US warehouse</span><strong>✅ Yes — ${usInventory !== null ? usInventory.toLocaleString() + ' in stock' : 'stock available'}</strong></div>` : `<div class="mrow"><span>US warehouse</span><strong>No US stock detected</strong></div>`}
      <div class="msection">Warehouse locations</div>
      ${warehouseRows.length ? `
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${warehouseRows.map(w => `
            <span style="background:#e0f2fe20;color:#0369a1;padding:2px 8px;border-radius:12px;font-size:12px;border:1px solid #bae6fd20;">
              ${escapeHtml(w.code)}: ${w.qty.toLocaleString()}
            </span>
          `).join('')}
        </div>
      ` : `<div class="muted">No warehouse data from CJ.</div>`}
      <div class="msection">All sellers (${sellers.length})</div>
      ${sellerRowsHtml}
      <p class="mnote">${escapeHtml(sl.note || "CJ provides the listing shop and warehouse inventory per country via the productDetail/query endpoint. The \"listed by\" count is CJ's own number of sellers who have this product in their store.")}</p>

      <div class="mactions">
        <a id="sellersDownloadLink" href="${csvUrl}" download="sellers_${id}.csv" class="lp-btn-inline" style="text-decoration:none">⬇ Download CSV</a>
        <button type="button" id="sellersListBtn" class="lp-btn-inline">🏪 List to CJ Store</button>
        <button type="button" id="sellersCloseBtn2" class="button-secondary">Close</button>
      </div>
    `;
    const listBtn = modalBody.querySelector("#sellersListBtn");
    if (listBtn) listBtn.addEventListener("click", () => { closeModal(); openListing(id, name); });
    const closeBtn2 = modalBody.querySelector("#sellersCloseBtn2");
    if (closeBtn2) closeBtn2.addEventListener("click", closeModal);
  } catch (err) {
    modalBody.innerHTML = `<p class="message error">${escapeHtml(err.message || "Request failed.")}</p>`;
  }
}

// ── AdSpy modal ───────────────────────────────────────────────────
// Shows live ad intelligence: which platforms have active ads for this
// product and how many apps are currently running campaigns. Data is
// sourced from the AdSpy / ad intelligence API (best-effort, non-blocking).
async function openAdSpyModal(id) {
  if (!id) return;
  modal.hidden = false;
  modalBody.innerHTML = "<p class='message'>Loading ad intelligence…</p>";
  try {
    const res = await api(`/api/products/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error([data.error, data.detail].filter(Boolean).join(" "));
    const p = data.product || {};
    const adspy = data.adspy || {};
    const name = p.name || "Untitled product";
    const platforms = Array.isArray(adspy.platforms) ? adspy.platforms : [];
    const activeApps = Number(adspy.activeApps) || 0;
    const hasCampaign = Boolean(adspy.hasCampaign);
    const lastSeen = adspy.lastSeen || null;
    const note = adspy.note || "Ad intelligence is best-effort — real-time ad counts change constantly.";

    if (!hasCampaign && !platforms.length) {
      modalBody.innerHTML = `
        <h3 style="margin:0 36px 12px 0;font-size:15px;line-height:1.3">${escapeHtml(name)}</h3>
        <div class="msection">AdSpy</div>
        <div class="mrow"><span>Status</span><strong>⚠ No active ad campaign detected</strong></div>
        ${adspy.score !== undefined ? `<div class="mrow"><span>Winning score</span><strong>${adspy.score}/100</strong></div>` : ""}
        ${adspy.listedNum !== undefined ? `<div class="mrow"><span>Listed by</span><strong>${Number(adspy.listedNum).toLocaleString()} sellers</strong></div>` : ""}
        <p class="mnote">No ad intelligence available for this product yet. Check back later or verify manually on Facebook Ad Library, TikTok Creative Center, and Google Ads.</p>
        <div class="mactions">
          <button type="button" id="adspyCloseBtn" class="button-secondary">Close</button>
        </div>`;
      const closeBtn = modalBody.querySelector("#adspyCloseBtn");
      if (closeBtn) closeBtn.addEventListener("click", closeModal);
      return;
    }

    modalBody.innerHTML = `
      <h3 style="margin:0 36px 12px 0;font-size:15px;line-height:1.3">${escapeHtml(name)}</h3>
      <div class="msection">AdSpy — Live Ad Intelligence</div>
      ${hasCampaign ? `<div class="mrow"><span>Campaign status</span><strong>✅ Active campaign running</strong></div>` : ""}
      ${activeApps > 0 ? `<div class="mrow"><span>Active ad apps</span><strong>${activeApps.toLocaleString()} app(s) running ads</strong></div>` : ""}
      ${lastSeen ? `<div class="mrow"><span>Last seen</span><strong>${escapeHtml(lastSeen)}</strong></div>` : ""}
      <div class="msection">Platforms with live ads</div>
      ${platforms.length ? `
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${platforms.map(pl => `
            <span style="background:#fef3c720;color:#92400e;padding:4px 12px;border-radius:14px;font-size:12px;font-weight:700;border:1px solid #fcd34d40;">
              📢 ${escapeHtml(pl)}
            </span>
          `).join('')}
        </div>
      ` : `<div class="muted">No platform data available.</div>`}
      <p class="mnote">${escapeHtml(note)}</p>
      <div class="mactions">
        <button type="button" id="adspyListBtn" class="lp-btn-inline">🏪 List to CJ Store</button>
        <button type="button" id="adspyCloseBtn2" class="button-secondary">Close</button>
      </div>`;
    const listBtn = modalBody.querySelector("#adspyListBtn");
    if (listBtn) listBtn.addEventListener("click", () => { closeModal(); openListing(id, name); });
    const closeBtn2 = modalBody.querySelector("#adspyCloseBtn2");
    if (closeBtn2) closeBtn2.addEventListener("click", closeModal);
  } catch (err) {
    modalBody.innerHTML = `<p class="message error">${escapeHtml(err.message || "Request failed.")}</p>`;
  }
}

// ... (rest of the existing code for listing, settings, etc.)

if (modalClose) modalClose.addEventListener("click", closeModal);
if (modal) {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
}

// Sellers modal event listeners
if (sellersClose) {
  sellersClose.addEventListener("click", () => {
    modal.hidden = true;
    modalBody.innerHTML = "";
  });
}

if (sellersModal) {
  sellersModal.addEventListener("click", (event) => {
    if (event.target === sellersModal) {
      modal.hidden = true;
      modalBody.innerHTML = "";
    }
  });
}

// ... rest of existing event listeners

function finalizeBestSelling() {
  const hasAnySales = shownProducts.some((p) => {
    const av = enrichMap[p.id]?.totalSales;
    return av !== null && av !== undefined && Number.isFinite(Number(av)) && Number(av) > 0;
  });
  shownProducts = [...shownProducts].sort((a, b) => {
    const av = enrichMap[a.id]?.totalSales;
    const bv = enrichMap[b.id]?.totalSales;
    const an = av !== null && av !== undefined && Number.isFinite(Number(av)) ? Number(av) : null;
    const bn = bv !== null && bv !== undefined && Number.isFinite(Number(bv)) ? Number(bv) : null;
    if (an !== null && bn !== null) return bn - an;
    if (an !== null) return -1;
    if (bn !== null) return 1;
    // Fallback: sort by listedNum (CJ listing count = demand signal)
    const la = Number(a.listedNum) || 0;
    const lb = Number(b.listedNum) || 0;
    return lb - la;
  });
  renderProducts(shownProducts);
  const note = hasAnySales
    ? "sorted by CJ total orders"
    : "CJ sales data unavailable — sorted by listing count instead";
  setMessage(`Best-selling view: ${shownProducts.length} product(s) ${note}. Estimates are daily/monthly sales signals.`, false);
}

async function enrichShown(gen, isBestSelling, products, { filterFirst = false } = {}) {
  const base = products || shownProducts;
  const ids = base.map((p) => p.id).filter(Boolean).filter((id) => !enrichMap[id]);
  const finish = () => {
    if (gen !== searchGen) return;
    const filtered = applyRangeFilters(applyListingFilters(base));
    renderProducts(filtered);
    if (isBestSelling) {
      finalizeBestSelling();
      if (filterFirst) setMessage(`Best-selling + listing filters: ${shownProducts.length} of ${base.length} product(s).`, false);
      return;
    }
    if (filterFirst) {
      const filtered = applyRangeFilters(applyListingFilters(base));
      setMessage(filtered.length
        ? `${filtered.length} of ${base.length} product(s) match the listing-age filters (CJ age data loaded).`
        : `0 of ${base.length} product(s) match. Loosen filters or try trending mode.`, false);
    } else if (ids.length) {
      setMessage(`${filtered.length} product(s) · sales, ratings & estimates loaded.`, false);
    }
  };
  if (!ids.length) {
    finish();
    return;
  }
  ids.forEach((id) => pendingEnrich.add(id));
  if (gen === searchGen) {
    if (filterFirst) setMessage(`Checking CJ listing age…0/${base.length}`, false);
    else renderProducts(applyRangeFilters(applyListingFilters(base)));
  }
  for (let i = 0; i < ids.length; i += 3) {
    const chunk = ids.slice(i, i + 3);
    try {
      const res = await api(`/api/enrich?ids=${chunk.map(encodeURIComponent).join(",")}`);
      const data = await res.json();
      if (res.ok && data.items) Object.assign(enrichMap, data.items);
    } catch {
      // enrich is optional; cards keep base data
    }
    chunk.forEach((id) => pendingEnrich.delete(id));
    if (gen !== searchGen) return;
    if (filterFirst) {
      const filtered = applyRangeFilters(applyListingFilters(base));
      renderProducts(filtered);
      const checked = base.length - (ids.length - i - chunk.length);
      setMessage(`Checking CJ listing age… ${checked}/${base.length} checked · ${filtered.length} match so far`, false);
    } else {
      renderProducts(applyRangeFilters(applyListingFilters(base)));
    }
  }
  finish();
}

async function runSearch({ trending = false, bestSelling = false } = {}) {
  lastSearchParams = { trending, bestSelling };
  currentPage = 1;
  totalPages = 1;
  searchButton.disabled = true;
  trendingButton.disabled = true;
  if (bestSellingButton) bestSellingButton.disabled = true;
  const gen = ++searchGen;
  bestSellingMode = bestSelling;
  pendingEnrich = new Set();

  setMessage(
    bestSelling
      ? "Best-selling hunt: loading CJ products, then counting real orders…"
      : trending
        ? "Loading CJ trending winning products…"
        : "Requesting product data from CJdropshipping…",
    false
  );
  resultsEl.innerHTML = "";

  try {
    const params = new URLSearchParams({
      q: trending ? "" : queryInput.value.trim(),
      page: String(currentPage),
      pageSize: "50",
      sort: bestSelling ? "winning" : "winning"
    });
    if (trending) params.set("trending", "1");
    const f = readFilters();
    if (f.minPrice) params.set("minPrice", f.minPrice);
    if (f.maxPrice) params.set("maxPrice", f.maxPrice);
    if (f.minStock) params.set("minStock", f.minStock);
    if (f.minListed) params.set("minListed", f.minListed);
    if (f.maxListed) params.set("maxListed", f.maxListed);
    if (f.country) params.set("country", f.country);
    if (f.deliverTo) params.set("deliverTo", f.deliverTo);
    if (f.quick) { params.set("quick", "1"); params.set("deliverTo", f.deliverTo || "US"); }
    if (f.freeShipping) params.set("freeShipping", f.freeShipping);

    const res = await api(`/api/products?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error([data.error, data.detail].filter(Boolean).join(" "));

    let products = data.products || [];
    // Client-side filter by min/max listings (CJ doesn't support it natively)
    const minL = Number(f.minListed) || 0;
    const maxL = Number(f.maxListed) || 0;
    if (minL) products = products.filter((p) => (Number(p.listedNum) || 0) >= minL);
    if (maxL) products = products.filter((p) => (Number(p.listedNum) || 0) <= maxL);

    currentPage = data.page || currentPage;
    totalPages = data.totalPages || (products.length >= 50 ? currentPage + 1 : currentPage);

    const needsMeta = false; // listing-age filters handled after enrich
    if (products.length) {
      renderProducts(products);
      setMessage(`${products.length} product(s), ${bestSelling ? "sorted by total sold" : "sorted by winning score"}. Click a product to open it on CJ.`, false);
    } else {
      setMessage("No products found. Try a broader keyword, Trending mode, or looser filters.", false);
    }

    // Enrich with sales data (async, non-blocking)
    enrichShown(gen, bestSelling, products);
  } catch (err) {
    setMessage(err.message || "Request failed.", true);
    resultsEl.innerHTML = "";
  } finally {
    searchButton.disabled = false;
    trendingButton.disabled = false;
    if (bestSellingButton) bestSellingButton.disabled = false;
  }
}

// ... rest of existing functions (applyAccessState, setMessage, etc.)

// Initialize everything when DOM is ready
function init() {
  console.log("[init] OpenCode extension popup loaded");

  // Re-query elements in case DOM wasn't ready at top-level
  attachAuthListeners();

  // Load saved API base
  chrome.storage.local.get(["apiBase"]).then((data) => {
    if (data.apiBase) API_BASE = data.apiBase;
    loadAndRender();
  }).catch(() => {
    loadAndRender();
  });

  function loadAndRender() {
    chrome.storage.local.get([TOKEN_STORAGE_KEY]).then((data) => {
      if (data[TOKEN_STORAGE_KEY]) {
        token = data[TOKEN_STORAGE_KEY];
        fetchMe().then((me) => {
          if (me) enterApp(me);
          else showAuth();
        });
      } else {
        showAuth();
      }
    }).catch(() => {
      showAuth();
    });

    // Theme toggle — uses [data-theme="dark"] selector (see popup.css)
    if (themeToggle) {
      const storedTheme = localStorage.getItem("theme");
      if (storedTheme === "dark") document.body.setAttribute("data-theme", "dark");

      themeToggle.addEventListener("click", () => {
        const isDark = document.body.getAttribute("data-theme") === "dark";
        if (isDark) {
          document.body.removeAttribute("data-theme");
          localStorage.setItem("theme", "light");
        } else {
          document.body.setAttribute("data-theme", "dark");
          localStorage.setItem("theme", "dark");
        }
      });
    }

    // Reset filters button
    if (resetFiltersButton) {
      resetFiltersButton.addEventListener("click", () => {
        document.querySelectorAll("#fNewListing, #fNewProduct, #fRelisting, #fNeverListed").forEach((cb) => {
          if (cb) cb.checked = false;
        });
        document.querySelectorAll("#fMinPrice, #fMaxPrice, #fMinStock, #fMaxStock, #fMinListed, #fMaxListed, #fMaxDays").forEach((input) => {
          if (input) input.value = "";
        });
        document.querySelectorAll("select").forEach((select) => {
          if (select) select.value = select.dataset.defaultValue || select.options[0].value;
        });
        if (countryFilterBar) countryFilterBar.hidden = true;
        if (queryInput) queryInput.value = "";
        if (searchButton) searchButton.disabled = false;
        if (trendingButton) trendingButton.disabled = false;
        if (bestSellingButton) bestSellingButton.disabled = false;
        runSearch();
      });
    }

    // Search form
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (searchButton) searchButton.disabled = true;
        runSearch();
      });
    }

    // Trending button
    if (trendingButton) {
      trendingButton.addEventListener("click", () => {
        runSearch({ trending: true });
      });
    }

    // Best-selling button
    if (bestSellingButton) {
      bestSellingButton.addEventListener("click", () => {
        runSearch({ bestSelling: true });
      });
    }

    // Best sellers button (supplier level)
    if (bestSellerSupplierButton) {
      bestSellerSupplierButton.addEventListener("click", () => {
        showBestSellersInterface();
      });
    }

    // Country filter for best sellers
    if (bestSellerCountrySelect) {
      bestSellerCountrySelect.addEventListener("change", () => {
        if (lastSearchParams.bestSelling) {
          runSearch({ bestSelling: true });
        }
      });
    }

    // Settings button
    if (settingsBtn) {
      settingsBtn.addEventListener("click", openSettings);
    }
  }
}

// Settings modal function
async function openSettings() {
  if (!settingsModal) return;
  settingsModal.hidden = false;
  const currentKey = await getCurrentCjKey();
  const keyDisplay = document.querySelector("#cjKeyInput");
  const statusEl = document.querySelector("#cjKeyMeta");
  if (keyDisplay) keyDisplay.value = currentKey || "";
  if (statusEl) statusEl.textContent = currentKey ? "Key configured" : "No key";

  const saveBtn = document.querySelector("#cjKeySave");
  const removeBtn = document.querySelector("#cjKeyRemove");
  const toggleBtn = document.querySelector("#cjKeyToggle");

  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const keyInput = document.querySelector("#cjKeyInput");
      if (!keyInput) return;
      const keyValue = keyInput.value.trim();
      if (!keyValue) {
        setMessage("Please enter a CJ API key.", true);
        return;
      }

      saveBtn.disabled = true;
      setMessage("Validating key with CJ…", false);

      try {
        const res = await api("/api/keys", {
          method: "POST",
          body: JSON.stringify({ apiKey: keyValue })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not save key.");

        setMessage("✅ CJ API key saved successfully!", false);
        if (statusEl) statusEl.textContent = "Key configured";
        if (keyDisplay) keyDisplay.value = "";

        // Refresh session to get new key
        const me = await fetchMe();
        if (me) enterApp(me);

      } catch (error) {
        setMessage(`Failed to save key: ${error.message}`, true);
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  if (removeBtn) {
    removeBtn.addEventListener("click", async () => {
      if (!confirm("Remove your CJ API key? This will disable listing and searching until a new key is added.")) return;

      try {
        await api("/api/keys", { method: "DELETE" });
        setMessage("✅ CJ API key removed.", false);
        if (statusEl) statusEl.textContent = "No key";
        await forgetSession();
        if (session?.hasCjKey) {
          session.hasCjKey = false;
          setStatus("CJ key removed", "warn");
          setMessage("One-time setup: paste your CJdropshipping API key below.", false);
        }
      } catch (error) {
        setMessage(`Failed to remove key: ${error.message}`, true);
      }
    });
  }

  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const input = document.querySelector("#cjKeyInput");
      if (input) {
        input.type = input.type === "password" ? "text" : "password";
        toggleBtn.textContent = input.type === "password" ? "Show" : "Hide";
      }
    });
  }

  const closeBtn = document.querySelector("#settingsClose");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      settingsModal.hidden = true;
    });
  }

  if (settingsModal) {
    settingsModal.addEventListener("click", (event) => {
      if (event.target === settingsModal) {
        settingsModal.hidden = true;
      }
    });
  }
}

async function getCurrentCjKey() {
  try {
    const res = await api("/api/keys");
    const data = await res.json();
    return data.exists ? "*** configured ***" : null;
  } catch {
    return null;
  }
}

function showBestSellersInterface() {
  if (!countryFilterBar) return;
  countryFilterBar.hidden = false;
  if (queryInput) queryInput.value = "";
  runSearch({ bestSelling: true });
}

// Initialize everything when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}