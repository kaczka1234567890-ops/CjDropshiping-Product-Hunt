const API_BASE = "http://localhost:3000";
const statusEl = document.querySelector("#status");
const messageEl = document.querySelector("#message");
const resultsEl = document.querySelector("#results");
const form = document.querySelector("#searchForm");
const queryInput = document.querySelector("#query");
const searchButton = document.querySelector("#searchButton");
const trendingButton = document.querySelector("#trendingButton");
const bestSellingButton = document.querySelector("#bestSellingButton");
const resetFiltersButton = document.querySelector("#resetFilters");
const modal = document.querySelector("#detailModal");
const modalBody = document.querySelector("#modalBody");
const modalClose = document.querySelector("#modalClose");

let enrichMap = {};
let pendingEnrich = new Set();
let shownProducts = [];
let bestSellingMode = false;
let searchGen = 0;

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
  return products.filter((p) => {
    if (f.neverListed && !(Number(p.listedNum) === 0)) return false;
    if (f.quickDelivery && p.quickDelivery !== true) return false;
    if (!needsMeta) return true;
    const en = enrichMap[p.id];
    const daysOld = en && en.daysOld !== null && en.daysOld !== undefined && Number.isFinite(Number(en.daysOld))
      ? Number(en.daysOld)
      : null;
    if (daysOld === null) return false;
    if (f.newListing && !(daysOld <= 7)) return false;
    if (f.newProduct && !(daysOld <= 30)) return false;
    if (f.reListing && en.isRelisting !== true) return false;
    return true;
  });
}

function buildParams(extra = {}) {
  const params = new URLSearchParams({
    q: queryInput.value.trim(),
    page: "1",
    pageSize: "12",
    sort: "winning",
    ...extra
  });
  const f = readFilters();
  if (f.minPrice) params.set("minPrice", f.minPrice);
  if (f.maxPrice) params.set("maxPrice", f.maxPrice);
  if (f.minStock) params.set("minStock", f.minStock);
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
    if (en.isNewListing === true) flags.push("🆕 listing ≤7d");
    if (en.isNewProduct === true && en.isNewListing !== true) flags.push("✨ new ≤30d");
    if (en.isRelisting === true) flags.push("♻ re-listing");
    return `
      <div class="row tags"><span>🛒 Sold ${sold}</span>${bits.length ? `<span>${bits.join(" · ")}</span>` : ""}</div>
      ${est.length ? `<div class="row tags">${est.join("")}<span>estimate</span></div>` : ""}
      ${flags.length ? `<div class="row tags">${flags.map((f) => `<span>${f}</span>`).join("")}</div>` : ""}`;
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
    const listed = p.listedNum === null || p.listedNum === undefined ? "listed ?" : `listed ${p.listedNum}×`;
    const tags = [
      listed,
      `stock ${stock}`,
      p.deliveryDays !== null && p.deliveryDays !== undefined
        ? `<span class="qbadge">🚀 ~${p.deliveryDays}d delivery</span>`
        : p.quickDelivery ? `<span class="qbadge">🚀 quick delivery</span>` : null,
      p.isFreeShipping ? "free ship" : null,
      p.hasVideo ? "video" : null,
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
          <button type="button" class="info-btn">Supplier info</button>
        </div>
      </div>`;
    const imgEl = item.querySelector("img");
    if (imgEl) imgEl.addEventListener("error", () => { imgEl.style.display = "none"; });
    item.addEventListener("click", (event) => {
      if (event.target.closest(".info-btn")) {
        event.stopPropagation();
        if (event.target.closest(".list-btn")) openListing(p.id, p.name);
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
      const code = inv?.countryCode || " ?";
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
    <div class="mrow"><span>Sales (Last 30 Days)</span><strong>${escapeHtml(windowEstimate(w30, 30))}</strong></div>
    <div class="mrow"><span>Sales (Last 7 Days)</span><strong>${escapeHtml(windowEstimate(w7, 7))}</strong></div>
    <p class="mnote">Total Sales = CJ's real order count for this product (productDetail API). Window sales have no public CJ API — they are estimates from daily stock snapshots this app records (or CJ 90-day sales when available). Restocks can hide sales; signal, not proof.</p>`;
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
    ${raw.createrTime ? `<div class="mrow"><span>Listed on CJ since</span><strong>${escapeHtml(String(raw.createrTime).slice(0, 10))}</strong></div>` : ""}
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
    const res = await fetch(`${API_BASE}/api/products/${encodeURIComponent(id)}`);
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

if (modalClose) modalClose.addEventListener("click", closeModal);
if (modal) {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
}

// ---------------- Variant Pricing / List to CJ store ----------------
const listingModal = document.querySelector("#listingModal");
const listingBody = document.querySelector("#listingBody");
const listingCloseBtn = document.querySelector("#listingClose");
const LISTING_COUNTRIES = ["US", "GB", "CA", "AU", "DE", "FR", "ES", "IT", "NL", "BE", "SE", "NO", "DK", "FI", "PL", "AT", "CH", "IE", "PT", "CZ", "GR", "RO", "HU", "MX", "BR", "CL", "JP", "KR", "SG", "MY", "TH", "PH", "ID", "VN", "NZ", "AE", "SA", "IN", "IL", "TR", "ZA"];
const LISTING_ORIGINS = [
  ["CN", "China (CN)"], ["US", "United States (US)"], ["TH", "Thailand (TH)"], ["DE", "Germany (DE)"],
  ["ES", "Spain (ES)"], ["GB", "United Kingdom (GB)"], ["FR", "France (FR)"], ["MY", "Malaysia (MY)"],
  ["VN", "Vietnam (VN)"], ["JP", "Japan (JP)"], ["KR", "South Korea (KR)"], ["HK", "Hong Kong (HK)"],
  ["TW", "Taiwan (TW)"], ["IN", "India (IN)"], ["AU", "Australia (AU)"], ["CA", "Canada (CA)"],
  ["NL", "Netherlands (NL)"], ["IT", "Italy (IT)"]
];
let listing = null;

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : "—";
}

function round2(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function closeListing() {
  if (!listingModal) return;
  listingModal.hidden = true;
  listingBody.innerHTML = "";
  listing = null;
}

async function openListing(pid, fallbackTitle) {
  if (!listingModal || !pid) return;
  listingModal.hidden = false;
  listingBody.innerHTML = "<p class='message'>Loading variant pricing from CJ…</p>";
  listing = null;
  try {
    const res = await fetch(`${API_BASE}/api/listing/preview?pid=${encodeURIComponent(pid)}&country=US`);
    const data = await res.json();
    if (!res.ok) throw new Error([data.error, data.detail].filter(Boolean).join(" ") || "Preview failed.");
    listing = {
      pid,
      title: data.product?.title || fallbackTitle || pid,
      image: data.product?.image || null,
      store: data.store,
      country: data.shipping?.country || data.country || "US",
      margin: Number.isFinite(Number(data.margin)) ? Number(data.margin) : 0.3,
      methods: Array.isArray(data.shipping?.methods) ? data.shipping.methods : [],
      shipIdx: 0,
      shipping: Number(data.shipping?.price) || 0,
      shipName: data.shipping?.name || "",
      shipAging: data.shipping?.aging || "",
      from: data.shipFrom || "CN",
      shipNote: data.shipping?.note || "",
      quoted: Boolean(data.shipping?.quoted ?? data.shipping?.price),
      rows: (Array.isArray(data.variants) ? data.variants : []).map((v) => ({
        vid: v.vid,
        sku: v.sku || v.variantSku || "",
        color: v.color || "—",
        size: v.size || "—",
        image: v.image || "",
        cjPrice: Number(v.cjPrice) || 0,
        ship: data.shipping?.quoted ? Number(v.shipping) || 0 : null,
        total: Number(v.total) || 0,
        rrp: Number(v.rrp) || 0,
        price: Number.isFinite(Number(v.recommended)) ? Number(v.recommended) : 0,
        selected: true
      })),
      saving: false
    };
    renderListing();
  } catch (err) {
    listingBody.innerHTML = `<p class="error">${escapeHtml(err.message || "Could not load variant pricing.")}</p>
      <div class="mactions"><button type="button" id="lpCloseErr" class="lp-btn">Close</button></div>`;
    const btn = document.querySelector("#lpCloseErr");
    if (btn) btn.addEventListener("click", closeListing);
  }
}

function listingRecommended(row) {
  if (!listing) return 0;
  return round2((row.cjPrice + (Number(row.ship) || 0)) * (1 + listing.margin));
}

function listingCount() {
  return listing ? listing.rows.filter((r) => r.selected).length : 0;
}

function updateListingCount() {
  const el = document.querySelector("#lpSelected");
  if (el) el.textContent = `${listingCount()} variants selected`;
}

function recomputeTotals() {
  if (!listing) return;
  listing.rows.forEach((row) => {
    row.ship = listing.quoted ? listing.shipping : null;
    row.total = round2(row.cjPrice + (listing.quoted ? listing.shipping : 0));
    row.rrp = round2(row.cjPrice * (1 + listing.margin));
  });
}

function renderListing() {
  if (!listing) return;
  const { rows } = listing;
  const methodOptions = listing.methods.length
    ? listing.methods.map((m, i) => `<option value="${i}"${i === listing.shipIdx ? " selected" : ""}>${escapeHtml(m.name)} — ${money(m.price)}${m.aging ? ` (${escapeHtml(m.aging)})` : ""}</option>`).join("")
    : `<option value="">No route ${listing.from} → ${listing.country} — shipping not quoted</option>`;

  const body = rows.map((row) => `
    <tr data-vid="${escapeHtml(String(row.vid))}">
      <td><input type="checkbox" class="lp-check" ${row.selected ? "checked" : ""}></td>
      <td>${row.image ? `<img class="lp-thumb" src="${escapeHtml(row.image)}" alt="">` : "<span class='lp-noimg'>—</span>"}</td>
      <td class="lp-sku">${escapeHtml(row.sku)}</td>
      <td>${escapeHtml(row.color)}</td>
      <td>${escapeHtml(row.size)}</td>
      <td class="lp-rrp" title="Suggested retail = CJ price × (1 + margin)">${money(row.rrp)}</td>
      <td class="lp-cj">${money(row.cjPrice)}</td>
      <td class="lp-shipcost">${money(row.ship)}</td>
      <td class="lp-total">${money(row.total)}</td>
      <td><input type="number" class="lp-price" step="0.01" min="0" value="${row.price}"></td>
    </tr>`).join("");

  listingBody.innerHTML = `
    <div class="lp">
      <div class="lp-head">
        <div>
          <h3>Variant Pricing</h3>
          <small class="lp-product" title="${escapeHtml(listing.title)}">${escapeHtml(listing.title)}</small>
        </div>
        <span class="lp-store">🏪 ${escapeHtml(listing.store?.name || "CJ store")} <small>(${escapeHtml(listing.store?.type || "")})</small></span>
      </div>

      <div class="lp-tools">
        <span class="lp-tool">Bulk Revise:
          <select id="lpMode">
            <option value="set">Price Change</option>
            <option value="percent">Percent + %</option>
            <option value="add">Add $</option>
          </select>
          <input type="number" id="lpBulk" step="0.01" placeholder="e.g. 29.99" aria-label="Bulk value">
          <button type="button" class="lp-btn" id="lpBulkOk">OK</button>
        </span>
        <button type="button" class="lp-btn lp-btn-primary" id="lpRecommended">Recommended Listing Price ⓘ</button>
        <button type="button" class="lp-btn" id="lpAllOk">All OK</button>
        <span class="lp-tool">Margin <input type="number" id="lpMargin" step="1" min="0" max="500" value="${Math.round(listing.margin * 100)}">%</span>
        <span class="lp-tool">Ship From:
          <select id="lpFrom">${LISTING_ORIGINS.map(([code, label]) => `<option value="${code}"${code === listing.from ? " selected" : ""}>${label}</option>`).join("")}</select>
        </span>
        <span class="lp-tool">Deliver to:
          <select id="lpCountry">${LISTING_COUNTRIES.map((c) => `<option value="${c}"${c === listing.country ? " selected" : ""}>${c}</option>`).join("")}</select>
        </span>
        <span class="lp-count" id="lpSelected">0 variants selected</span>
      </div>

      <div class="lp-shipbar">
        <label>Shipping Cost:
          <select id="lpMethods">${methodOptions}</select>
        </label>
        <span class="lp-aging">${listing.shipAging ? `Est. delivery: ${escapeHtml(listing.shipAging)} days` : ""}</span>
        <small class="lp-note">${escapeHtml(listing.shipNote || `Shipping auto-calculated from ${listing.from} to ${listing.country} for the heaviest variant.`)} Applied to every row (CJ quotes per order).</small>
      </div>

      <div class="lp-wrap">
        <table class="lp-table">
          <thead>
            <tr>
              <th><input type="checkbox" id="lpAll" ${rows.every((r) => r.selected) ? "checked" : ""}></th>
              <th>Images</th><th>SKU</th><th>Color</th><th>Size</th>
              <th>RRP ⓘ</th><th>CJ Price</th><th>Shipping Cost</th><th>Total Dropshipping</th><th>* Your Price (USD)</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>

      <div class="lp-status" id="lpStatus"></div>

      <div class="mactions lp-foot">
        <button type="button" class="lp-btn" id="lpCancel">Cancel</button>
        <button type="button" class="lp-btn lp-btn-primary" id="lpPublish">List It Now</button>
      </div>
    </div>`;

  wireListingEvents();
  updateListingCount();
}

function wireListingEvents() {
  const rowsEl = listingBody.querySelector(".lp-table tbody");
  const allEl = listingBody.querySelector("#lpAll");

  if (allEl) allEl.addEventListener("change", () => {
    listing.rows.forEach((r) => { r.selected = allEl.checked; });
    listingBody.querySelectorAll(".lp-check").forEach((cb) => { cb.checked = allEl.checked; });
    updateListingCount();
  });

  if (rowsEl) rowsEl.addEventListener("change", (event) => {
    const tr = event.target.closest("tr");
    if (!tr) return;
    const row = listing.rows.find((r) => String(r.vid) === tr.dataset.vid);
    if (!row) return;
    if (event.target.classList.contains("lp-check")) {
      row.selected = event.target.checked;
      updateListingCount();
    }
    if (event.target.classList.contains("lp-price")) {
      row.price = round2(event.target.value);
      event.target.value = row.price;
    }
  });

  const recommendedBtn = listingBody.querySelector("#lpRecommended");
  if (recommendedBtn) recommendedBtn.addEventListener("click", () => {
    listing.rows.filter((r) => r.selected).forEach((r) => { r.price = listingRecommended(r); });
    syncPricesToInputs();
    setListingStatus(`Recommended prices applied to ${listingCount()} variant(s).`);
  });

  const allOkBtn = listingBody.querySelector("#lpAllOk");
  if (allOkBtn) allOkBtn.addEventListener("click", () => {
    listing.rows.forEach((r) => { r.selected = true; if (!r.price) r.price = listingRecommended(r); });
    listingBody.querySelectorAll(".lp-check").forEach((cb) => { cb.checked = true; });
    const all = listingBody.querySelector("#lpAll");
    if (all) all.checked = true;
    syncPricesToInputs();
    updateListingCount();
    setListingStatus("All variants selected and priced.");
  });

  const bulkOk = listingBody.querySelector("#lpBulkOk");
  if (bulkOk) bulkOk.addEventListener("click", () => {
    const mode = listingBody.querySelector("#lpMode").value;
    const value = Number(listingBody.querySelector("#lpBulk").value);
    if (!Number.isFinite(value)) { setListingStatus("Enter a value for Bulk Revise first.", true); return; }
    const selected = listing.rows.filter((r) => r.selected);
    if (!selected.length) { setListingStatus("Select at least one variant.", true); return; }
    selected.forEach((r) => {
      if (mode === "set") r.price = round2(value);
      else if (mode === "percent") r.price = round2(r.total * (1 + value / 100));
      else r.price = round2(r.total + value);
    });
    syncPricesToInputs();
    setListingStatus(`Bulk revise applied to ${selected.length} variant(s).`);
  });

  const marginEl = listingBody.querySelector("#lpMargin");
  if (marginEl) marginEl.addEventListener("change", () => {
    const prevMargin = listing.margin;
    const oldRec = listing.rows.map((r) => round2((r.cjPrice + (Number(r.ship) || 0)) * (1 + prevMargin)));
    const pct = Number(marginEl.value);
    listing.margin = Number.isFinite(pct) && pct >= 0 ? pct / 100 : 0.3;
    listing.rows.forEach((r, i) => { if (Number(r.price) && Number(r.price) === oldRec[i]) r.price = listingRecommended(r); });
    recomputeTotals();
    refreshTotalsDom();
    syncPricesToInputs();
  });

  const methodsEl = listingBody.querySelector("#lpMethods");
  if (methodsEl) methodsEl.addEventListener("change", () => {
    const oldRec = listing.rows.map((r) => round2((r.cjPrice + (Number(r.ship) || 0)) * (1 + listing.margin)));
    const idx = Number(methodsEl.value);
    const method = listing.methods[idx];
    if (!method) return;
    listing.shipIdx = idx;
    listing.shipping = Number(method.price) || 0;
    listing.shipName = method.name;
    listing.shipAging = method.aging || "";
    listing.rows.forEach((r, i) => { if (Number(r.price) && Number(r.price) === oldRec[i]) r.price = listingRecommended(r); });
    recomputeTotals();
    refreshTotalsDom();
    syncPricesToInputs();
    const aging = listingBody.querySelector(".lp-aging");
    if (aging) aging.textContent = listing.shipAging ? `Est. delivery: ${listing.shipAging} days` : "";
  });

  const countryEl = listingBody.querySelector("#lpCountry");
  if (countryEl) countryEl.addEventListener("change", () => reloadListing(countryEl.value, listing.from));
  const fromEl = listingBody.querySelector("#lpFrom");
  if (fromEl) fromEl.addEventListener("change", () => reloadListing(listing.country, fromEl.value));

  const publishBtn = listingBody.querySelector("#lpPublish");
  if (publishBtn) publishBtn.addEventListener("click", publishListing);

  const cancelBtn = listingBody.querySelector("#lpCancel");
  if (cancelBtn) cancelBtn.addEventListener("click", closeListing);
}

function setListingStatus(text, isError) {
  const el = listingBody.querySelector("#lpStatus");
  if (!el) return;
  el.classList.toggle("is-error", Boolean(isError));
  el.textContent = text || "";
}

function syncPricesToInputs() {
  listingBody.querySelectorAll("tr[data-vid]").forEach((tr) => {
    const row = listing.rows.find((r) => String(r.vid) === tr.dataset.vid);
    if (!row) return;
    const input = tr.querySelector(".lp-price");
    if (input) input.value = row.price;
  });
}

function refreshTotalsDom() {
  listingBody.querySelectorAll("tr[data-vid]").forEach((tr) => {
    const row = listing.rows.find((r) => String(r.vid) === tr.dataset.vid);
    if (!row) return;
    const rrp = tr.querySelector(".lp-rrp");
    const ship = tr.querySelector(".lp-shipcost");
    const total = tr.querySelector(".lp-total");
    if (rrp) rrp.textContent = money(row.rrp);
    if (ship) ship.textContent = money(row.ship);
    if (total) total.textContent = money(row.total);
  });
  setListingStatus(`Totals updated for ${listing.country} · margin ${Math.round(listing.margin * 100)}%.`);
}

async function reloadListing(country, from = listing.from) {
  const { pid, rows } = listing;
  const prices = Object.fromEntries(rows.map((r) => [String(r.vid), r.price]));
  const oldRows = new Map(rows.map((r) => [String(r.vid), r]));
  const oldMargin = listing.margin;
  const selected = rows.filter((r) => r.selected).map((r) => String(r.vid));
  const title = listing.title;
  try {
    const res = await fetch(`${API_BASE}/api/listing/preview?pid=${encodeURIComponent(pid)}&country=${encodeURIComponent(country)}&from=${encodeURIComponent(from)}&margin=${encodeURIComponent(listing.margin)}`);
    const data = await res.json();
    if (!res.ok) throw new Error([data.error, data.detail].filter(Boolean).join(" ") || "Preview failed.");
    listing = {
      pid, title,
      image: data.product?.image || listing.image,
      store: data.store,
      country,
      margin: Number.isFinite(Number(data.margin)) ? Number(data.margin) : listing.margin,
      methods: Array.isArray(data.shipping?.methods) ? data.shipping.methods : [],
      shipIdx: 0,
      shipping: Number(data.shipping?.price) || 0,
      shipName: data.shipping?.name || "",
      shipAging: data.shipping?.aging || "",
      from: data.shipFrom || "CN",
      shipNote: data.shipping?.note || "",
      quoted: Boolean(data.shipping?.quoted ?? data.shipping?.price),
      rows: (Array.isArray(data.variants) ? data.variants : []).map((v) => ({
        vid: v.vid,
        sku: v.sku || v.variantSku || "",
        color: v.color || "—",
        size: v.size || "—",
        image: v.image || "",
        cjPrice: Number(v.cjPrice) || 0,
        ship: data.shipping?.quoted ? Number(v.shipping) || 0 : null,
        total: Number(v.total) || 0,
        rrp: Number(v.rrp) || 0,
        price: (() => {
          const rec = Number.isFinite(Number(v.recommended)) ? Number(v.recommended) : 0;
          const prev = prices[String(v.vid)];
          if (prev === undefined) return rec;
          const prevNum = Number(prev);
          const old = oldRows.get(String(v.vid));
          if (!prevNum || !old) return prevNum;
          const oldRec = round2((old.cjPrice + (Number(old.ship) || 0)) * (1 + oldMargin));
          return prevNum === oldRec ? rec : prevNum;
        })(),
        selected: selected.includes(String(v.vid))
      })),
      saving: false
    };
    renderListing();
    setListingStatus(`Shipping re-quoted: ${from} → ${country}.`);
  } catch (err) {
    setListingStatus(err.message || "Country re-quote failed.", true);
    const countryEl = listingBody.querySelector("#lpCountry");
    if (countryEl) countryEl.value = listing.country;
  }
}

async function publishListing() {
  if (!listing || listing.saving) return;
  const selectedRows = listing.rows.filter((r) => r.selected);
  if (!selectedRows.length) { setListingStatus("Select at least one variant to list.", true); return; }
  if (!listing.quoted) {
    setListingStatus(`No shipping route from ${listing.from} to ${listing.country} for this product — totals would exclude shipping. Choose another Ship From / Deliver to first.`, true);
    return;
  }
  const missing = selectedRows.filter((r) => !Number.isFinite(Number(r.price)) || Number(r.price) <= 0);
  if (missing.length) { setListingStatus(`Enter "Your Price" for ${missing.length} variant(s) (use Recommended Listing Price).`, true); return; }

  listing.saving = true;
  const publishBtn = listingBody.querySelector("#lpPublish");
  const cancelBtn = listingBody.querySelector("#lpCancel");
  if (publishBtn) { publishBtn.disabled = true; publishBtn.textContent = "Listing…"; }
  if (cancelBtn) cancelBtn.disabled = true;
  setListingStatus(`Listing ${selectedRows.length} variant(s) to ${listing.store?.name || "CJ store"}…`);

  try {
    const res = await fetch(`${API_BASE}/api/listing/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pid: listing.pid,
        country: listing.country,
        from: listing.from,
        logistics: listing.shipName,
        title: listing.title,
        selected: selectedRows.map((r) => String(r.vid)),
        prices: Object.fromEntries(listing.rows.map((r) => [String(r.vid), Number(r.price) || 0]))
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error([data.error, data.detail].filter(Boolean).join(" ") || "Listing failed.");
    if (data.ok === false && !data.variantsSaved && !data.existingVariants) throw new Error((Array.isArray(data.warnings) && data.warnings[0]) || "CJ did not save this product.");
    renderListingDone(data);
  } catch (err) {
    listing.saving = false;
    if (publishBtn) { publishBtn.disabled = false; publishBtn.textContent = "List It Now"; }
    if (cancelBtn) cancelBtn.disabled = false;
    setListingStatus(err.message || "Could not list the product.", true);
  }
}

function renderListingDone(data) {
  const warnings = Array.isArray(data.warnings) && data.warnings.length
    ? `<div class="lp-warn">${data.warnings.map((w) => `<div>⚠ ${escapeHtml(w)}</div>`).join("")}</div>`
    : "";
  listingBody.innerHTML = `
    <div class="lp lp-done">
      <div class="lp-head">
        <div>
          <h3>✅ Listed to ${escapeHtml(data.store?.name || "your CJ store")}</h3>
          <small class="lp-product">${escapeHtml(data.title || listing.title || "")}</small>
        </div>
      </div>
      <div class="mrow"><span>Store product ID</span><strong>${escapeHtml(data.storeProductId || "—")}</strong></div>
      <div class="mrow"><span>Product record</span><strong>${data.productExisted ? "Existing (already listed)" : "Created"}</strong></div>
      <div class="mrow"><span>Variants saved</span><strong>${escapeHtml(String(data.variantsSaved ?? 0))} / ${escapeHtml(String(data.variantsRequested ?? 0))}</strong></div>
      <div class="mrow"><span>Already in store (price unchanged)</span><strong>${escapeHtml(String(data.existingVariants ?? 0))}</strong></div>
      <div class="mrow"><span>Shipping method</span><strong>${escapeHtml(data.logistics || listing.shipName || "—")}</strong></div>
      <div class="mrow"><span>Product connection</span><strong>${data.connected ? "Created" : "Skipped"}</strong></div>
      ${warnings}
      <div class="mactions lp-foot">
        <a class="lp-btn" href="https://cjdropshipping.com/mycj" target="_blank" rel="noopener">Open My CJ</a>
        <button type="button" class="lp-btn lp-btn-primary" id="lpDone">Close</button>
      </div>
    </div>`;
  const done = listingBody.querySelector("#lpDone");
  if (done) done.addEventListener("click", closeListing);
}

if (listingCloseBtn) listingCloseBtn.addEventListener("click", closeListing);
if (listingModal) {
  listingModal.addEventListener("click", (event) => {
    if (event.target === listingModal) closeListing();
  });
}
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (listingModal && !listingModal.hidden) closeListing();
  else if (modal && !modal.hidden) closeModal();
});

function finalizeBestSelling() {
  shownProducts = [...shownProducts].sort((a, b) => {
    const av = enrichMap[a.id]?.totalSales;
    const bv = enrichMap[b.id]?.totalSales;
    const an = av !== null && av !== undefined && Number.isFinite(Number(av)) ? Number(av) : -1;
    const bn = bv !== null && bv !== undefined && Number.isFinite(Number(bv)) ? Number(bv) : -1;
    return bn - an;
  });
  renderProducts(shownProducts);
  setMessage(`Best-selling view: ${shownProducts.length} product(s) sorted by CJ total orders. Estimates are daily/monthly sales signals.`, false);
}

async function enrichShown(gen, isBestSelling, products, { filterFirst = false } = {}) {
  const base = products || shownProducts;
  const ids = base.map((p) => p.id).filter(Boolean).filter((id) => !enrichMap[id]);
  const finish = () => {
    if (gen !== searchGen) return;
    const filtered = applyListingFilters(base);
    renderProducts(filtered);
    if (isBestSelling) {
      finalizeBestSelling();
      if (filterFirst) setMessage(`Best-selling + listing filters: ${shownProducts.length} of ${base.length} product(s).`, false);
      return;
    }
    if (filterFirst) {
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
    else renderProducts(applyListingFilters(base));
  }
  for (let i = 0; i < ids.length; i += 3) {
    const chunk = ids.slice(i, i + 3);
    try {
      const res = await fetch(`${API_BASE}/api/enrich?ids=${chunk.map(encodeURIComponent).join(",")}`);
      const data = await res.json();
      if (res.ok && data.items) Object.assign(enrichMap, data.items);
    } catch {
      // enrich is optional; cards keep base data
    }
    chunk.forEach((id) => pendingEnrich.delete(id));
    if (gen !== searchGen) return;
    if (filterFirst) {
      const filtered = applyListingFilters(base);
      renderProducts(filtered);
      const checked = base.length - (ids.length - i - chunk.length);
      setMessage(`Checking CJ listing age… ${checked}/${base.length} checked · ${filtered.length} match so far`, false);
    } else {
      renderProducts(applyListingFilters(base));
    }
  }
  finish();
}

async function runSearch({ trending = false, bestSelling = false } = {}) {
  searchButton.disabled = true;
  trendingButton.disabled = true;
  if (bestSellingButton) bestSellingButton.disabled = true;
  searchButton.textContent = "Hunting…";
  const gen = ++searchGen;
  bestSellingMode = bestSelling;
  pendingEnrich = new Set();
  setMessage(
    bestSelling
      ? "Best-selling hunt: loading CJ products, then counting real orders…"
      : trending
        ? "Loading CJ trending winning products…"
        : "Requesting product data from CJ via local backend…",
    false
  );
  resultsEl.innerHTML = "";
  try {
    const useTrending = trending || (bestSelling && !queryInput.value.trim());
    const params = buildParams(useTrending ? { trending: "1", q: "" } : {});
    const res = await fetch(`${API_BASE}/api/products?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error([data.error, data.detail].filter(Boolean).join(" "));
    const products = data.products || [];
    if (!products.length) {
      setMessage("No products matched. Loosen the filters or try another keyword.", false);
      setStatus("Backend ready · 0 products", "warn");
      return;
    }
    setStatus("Backend ready · CJ data loaded", "ok");
    try {
      await chrome.storage.local.set({ lastQuery: queryInput.value.trim() });
    } catch {
      /* local storage is optional */
    }
    shownProducts = products;
    const lf = readListingFilters();
    const needsMeta = lf.newListing || lf.newProduct || lf.reListing;
    if (needsMeta) {
      renderProducts([]);
      setMessage(`Checking CJ listing age…0/${products.length}`, false);
      enrichShown(gen, bestSelling, products, { filterFirst: true });
    } else {
      const filtered = applyListingFilters(products);
      renderProducts(filtered);
      if (lf.neverListed && !filtered.length) {
        setMessage("0 products match 'never listed' (listedNum = 0) on this page. Try another page or trending mode.", false);
      }
      enrichShown(gen, bestSelling, filtered);
    }
  } catch (err) {
    const text = err.message || "Request failed.";
    if (/Failed to fetch|NetworkError|load failed/i.test(text)) {
      setStatus("Backend not reachable", "error");
      setMessage("Local backend is not running. Open the project folder and run: npm start", true);
    } else {
      setStatus("Backend ready · CJ error", "error");
      setMessage(text, true);
    }
  } finally {
    searchButton.disabled = false;
    trendingButton.disabled = false;
    if (bestSellingButton) bestSellingButton.disabled = false;
    searchButton.textContent = "Hunt";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch();
});

trendingButton.addEventListener("click", () => {
  runSearch({ trending: true });
});

if (bestSellingButton) {
  bestSellingButton.addEventListener("click", () => {
    runSearch({ bestSelling: true });
  });
}

if (resetFiltersButton) {
  resetFiltersButton.addEventListener("click", () => {
    ["#fMinPrice", "#fMaxPrice", "#fMinStock"].forEach((id) => {
      const el = document.querySelector(id);
      if (el) el.value = "";
    });
    const country = document.querySelector("#fCountry");
    if (country) country.value = "";
    const freeShip = document.querySelector("#fFreeShip");
    if (freeShip) freeShip.checked = false;
    ["#fNewListing", "#fNewProduct", "#fRelisting", "#fNeverListed"].forEach((id) => {
      const el = document.querySelector(id);
      if (el) el.checked = false;
    });
    setMessage("Filters reset.", false);
  });
}

const isWindowMode = new URLSearchParams(window.location.search).get("mode") === "window";
const openWindowButton = document.querySelector("#openWindow");
if (openWindowButton) {
  if (isWindowMode) {
    openWindowButton.style.display = "none";
  } else {
    openWindowButton.addEventListener("click", () => {
      chrome.windows.create({
        url: chrome.runtime.getURL("sidepanel.html?mode=window"),
        type: "popup",
        width: 560,
        height: 840
      });
    });
  }
}

async function init() {
  try {
    const data = await (await fetch(`${API_BASE}/api/health`)).json();
    setStatus(
      data.cjConfigured
        ? "Backend ready · CJ data loaded"
        : "Backend up · add CJ API Key (⚙ Settings)",
      data.cjConfigured ? "ok" : "warn"
    );
  } catch {
    setStatus("Backend not reachable", "error");
    setMessage("Start the backend with npm start, then search here.", true);
  }
  const stored = await chrome.storage.local.get(["lastQuery"]);
  if (stored.lastQuery) queryInput.value = stored.lastQuery;
}

init();

const settingsModal = document.querySelector("#settingsModal");
const settingsBtn = document.querySelector("#settingsBtn");
const cjKeyInput = document.querySelector("#cjKeyInput");
const cjKeyMeta = document.querySelector("#cjKeyMeta");
const cjKeyStatus = document.querySelector("#cjKeyStatus");
const cjKeySaveBtn = document.querySelector("#cjKeySave");
const cjKeyRemoveBtn = document.querySelector("#cjKeyRemove");
const cjKeyToggleBtn = document.querySelector("#cjKeyToggle");
const settingsCloseBtn = document.querySelector("#settingsClose");

function setSettingsStatus(text, isError) {
  if (!cjKeyStatus) return;
  cjKeyStatus.textContent = text || "";
  cjKeyStatus.classList.toggle("is-error", Boolean(isError));
}

async function refreshStatusFromHealth() {
  try {
    const data = await (await fetch(`${API_BASE}/api/health`)).json();
    setStatus(
      data.cjConfigured
        ? "Backend ready · CJ data loaded"
        : "Backend up · add CJ API Key (⚙ Settings)",
      data.cjConfigured ? "ok" : "warn"
    );
  } catch {
    setStatus("Backend not reachable", "error");
  }
}

async function loadSettingsMeta() {
  if (!cjKeyMeta) return;
  try {
    const data = await (await fetch(`${API_BASE}/api/settings`)).json();
    cjKeyMeta.classList.remove("is-warn");
    if (!data.cjKeySet) {
      cjKeyMeta.classList.add("is-warn");
      cjKeyMeta.textContent = "No API key yet — paste your CJdropshipping API Key below.";
    } else {
      cjKeyMeta.textContent = data.cjKeySource === "settings"
        ? `Using saved key (Settings): ${data.cjKeyMasked}`
        : `Using key from .env: ${data.cjKeyMasked}`;
    }
  } catch {
    cjKeyMeta.classList.add("is-warn");
    cjKeyMeta.textContent = "Could not reach the local backend to read settings.";
  }
}

function openSettings() {
  if (!settingsModal) return;
  settingsModal.hidden = false;
  if (cjKeyInput) cjKeyInput.value = "";
  setSettingsStatus("");
  loadSettingsMeta();
  if (cjKeyInput) cjKeyInput.focus();
}

if (settingsBtn) settingsBtn.addEventListener("click", openSettings);
if (settingsCloseBtn) settingsCloseBtn.addEventListener("click", () => { settingsModal.hidden = true; });
if (settingsModal) settingsModal.addEventListener("click", (event) => { if (event.target === settingsModal) settingsModal.hidden = true; });

if (cjKeyToggleBtn) cjKeyToggleBtn.addEventListener("click", () => {
  const showing = cjKeyInput.type === "text";
  cjKeyInput.type = showing ? "password" : "text";
  cjKeyToggleBtn.textContent = showing ? "Show" : "Hide";
});

async function postCjKey(apiKey, busyLabel, okLabel) {
  cjKeySaveBtn.disabled = true;
  cjKeyRemoveBtn.disabled = true;
  setSettingsStatus(busyLabel);
  try {
    const res = await fetch(`${API_BASE}/api/settings/cj-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not save the API Key.");
    if (cjKeyInput) cjKeyInput.value = "";
    setSettingsStatus(`${okLabel} ${data.cjKeySet ? `Key: ${data.cjKeyMasked} (${data.cjKeySource}).` : "Falling back to .env."}`);
    await loadSettingsMeta();
    refreshStatusFromHealth();
  } catch (error) {
    setSettingsStatus(error.message || "Request failed.", true);
  } finally {
    cjKeySaveBtn.disabled = false;
    cjKeyRemoveBtn.disabled = false;
  }
}

if (cjKeySaveBtn) cjKeySaveBtn.addEventListener("click", () => {
  const apiKey = cjKeyInput.value.trim();
  if (!apiKey) { setSettingsStatus("Paste your CJdropshipping API Key first.", true); return; }
  postCjKey(apiKey, "Validating the key with CJ…", "Saved ✓");
});

if (cjKeyRemoveBtn) cjKeyRemoveBtn.addEventListener("click", () => {
  postCjKey("", "Removing the saved key…", "Saved key removed ✓");
});
