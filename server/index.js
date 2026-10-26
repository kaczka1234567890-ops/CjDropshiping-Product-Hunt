import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchProducts, getProductDetail, getProductReviews, getProductSalesInfo, getProductReviewsLite, getCjStores, getVariantList, quoteFreight, saveStoreProduct, saveStoreVariants, createProductConnection, getStoreProductVariants, validateApiKey, clearTokenCache, primeTokenCache } from "./cjClient.js";
import { getCjApiKey, cjKeySource, setCjApiKey, settingsSummary } from "./settings.js";
import { analyzeProduct, sortProducts, estimateProfit } from "./scoring.js";
import { recordSnapshots, getMetrics } from "./metrics.js";
import { getSalesCache, setSalesCache } from "./salesCache.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(projectRoot, ".env") });
const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());
app.use(express.static(path.join(projectRoot, "web")));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function requireCjToken(res) {
  if (getCjApiKey()) return true;
  res.status(503).json({
    error: "CJ API is not configured.",
    detail: "Open Settings (⚙) and paste your CJdropshipping API Key, or set CJ_ACCESS_TOKEN in .env. Never share the key in the extension."
  });
  return false;
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

app.get("/api/health", (_req, res) => {
  const summary = settingsSummary();
  res.json({
    ok: true,
    cjConfigured: summary.cjKeySet,
    cjKeySource: summary.cjKeySource,
    cjKeyMasked: summary.cjKeyMasked,
    port: PORT,
    message: summary.cjKeySet
      ? summary.cjKeySource === "settings"
        ? `CJ API Key is configured (Settings · ${summary.cjKeyMasked}).`
        : "CJ API Key is configured locally."
      : "CJ API Key is not configured. Open Settings (⚙) and paste your key."
  });
});

app.get("/api/settings", (_req, res) => {
  res.json(settingsSummary());
});

app.post("/api/settings/cj-key", async (req, res) => {
  try {
    const apiKey = String(req.body?.apiKey ?? "").trim();
    if (apiKey) {
      const result = await validateApiKey(apiKey);
      setCjApiKey(apiKey);
      if (result.direct) clearTokenCache();
      else primeTokenCache(apiKey, result);
      console.log(`CJ API Key saved via Settings (${settingsSummary().cjKeyMasked}, source: ${cjKeySource()}).`);
    } else {
      setCjApiKey("");
      clearTokenCache();
      console.log("CJ API Key removed via Settings.");
    }
    res.json({ ok: true, ...settingsSummary() });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.publicMessage || error.message });
  }
});

app.get("/api/products", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize || "20"), 10) || 20));
  const sort = String(req.query.sort || "winning");
  const trending = String(req.query.trending || "") === "1";
  const freeShipping = String(req.query.freeShipping || "") === "1";
  const minStock = optionalNumber(req.query.minStock);
  const minPrice = optionalNumber(req.query.minPrice);
  const maxPrice = optionalNumber(req.query.maxPrice);
  const countryCode = String(req.query.country || "").trim() || undefined;
  const quick = String(req.query.quick || "") === "1";
  const deliverTo = String(req.query.deliverTo || "").trim().toUpperCase() || undefined;
  const effectiveCountry = countryCode || (quick ? (deliverTo || "US") : undefined);
  const quickMark = Boolean(quick && effectiveCountry && String(effectiveCountry).toUpperCase() !== "CN");

  if (!requireCjToken(res)) return;

  try {
    const result = await searchProducts({
      query,
      page,
      pageSize,
      trending,
      freeShipping,
      minStock,
      minPrice,
      maxPrice,
      countryCode: effectiveCountry,
      orderBy: sort === "listed_desc" ? 1 : undefined,
      sort: "desc"
    });
    const products = sortProducts(result.products.map((product) => analyzeProduct(product)), sort);
    if (quickMark) {
      products.forEach((p) => {
        if (!p.quickDelivery) p.quickDelivery = true;
      });
    }
    recordSnapshots(products.map((p) => ({ id: p.id, stock: p.stock, listedNum: p.listedNum })));
    res.json({
      products,
      page,
      pageSize,
      total: result.pagination?.total ?? null,
      totalPages: result.pagination?.totalPages ?? null,
      sort,
      trending,
      quick,
      shipFrom: effectiveCountry || null,
      deliverTo: deliverTo || null,
      source: "CJdropshipping API 2.0",
      note: result.note || null
    });
  } catch (error) {
    console.error("CJ request failed:", error.message);
    res.status(error.status || 502).json({
      error: "Could not retrieve products from CJdropshipping.",
      detail: error.publicMessage || "Check the API Key, endpoint, parameters, and CJ API points/quota.",
      upstreamStatus: error.upstreamStatus || null
    });
  }
});

app.get("/api/products/:pid", async (req, res) => {
  if (!requireCjToken(res)) return;
  const pid = String(req.params.pid || "").trim();
  if (!pid) return res.status(400).json({ error: "Product id (pid) is required." });

  try {
    const { product, note } = await getProductDetail(pid);
    const analyzed = analyzeProduct(product);
    let reviews = null;
    try {
      reviews = await getProductReviews(product.id || product.pid || pid);
    } catch (reviewError) {
      console.warn("Reviews unavailable:", reviewError.message);
    }

    let sales = null;
    try {
      sales = await getProductSalesInfo(product.id || product.pid || pid);
    } catch (salesError) {
      console.warn("Sales info unavailable:", salesError.message);
    }

    let stock = analyzed.stock;
    const toNum = (value) => (value === null || value === undefined || value === "" ? NaN : Number(value));
    if (stock === null || stock === undefined) {
      const variants = Array.isArray(product?.variants) ? product.variants : [];
      let sum = 0;
      let seen = false;
      variants.forEach((v) => {
        const invNum = toNum(v?.inventoryNum);
        if (Number.isFinite(invNum)) { sum += invNum; seen = true; }
        const invs = Array.isArray(v?.inventories) ? v.inventories : [];
        invs.forEach((inv) => {
          const n = toNum(inv?.totalInventory);
          if (Number.isFinite(n)) { sum += n; seen = true; }
        });
      });
      if (seen) stock = sum;
    }
    if ((stock === null || stock === undefined) && sales?.inventoryTotal !== null && sales?.inventoryTotal !== undefined) {
      stock = sales.inventoryTotal;
    }
    analyzed.stock = stock;
    recordSnapshots([{ id: analyzed.id, stock, listedNum: analyzed.listedNum }]);
    const metrics = getMetrics(analyzed.id || pid);
    if (sales || reviews) {
      setSalesCache(analyzed.id || pid, {
        totalSales: sales?.totalSales ?? null,
        sold90d: sales?.sold90d ?? null,
        lastOrderDate: sales?.lastOrderDate ?? null,
        rating: reviews?.avgScoreRecent ?? sales?.rating ?? null,
        reviewTotal: reviews?.total ?? sales?.commentCount ?? null
      });
    }
    const supplier = {
      name: analyzed.supplierName || sales?.shopName || sales?.supplierNameEn || null,
      id: analyzed.supplierId || null,
      website: sales?.supplierWebsite || null,
      email: null,
      phone: null,
      shopName: sales?.shopName || null,
      shopLogo: sales?.shopLogo || null,
      hasUSWarehouse: sales?.hasUSWarehouse || false,
      usInventory: sales?.usInventory ?? null,
      warehouseCountries: sales?.warehouseCountries || {}
    };
    res.json({ product: analyzed, reviews, sales, metrics, supplier, note: note || null });
  } catch (error) {
    console.error("CJ detail request failed:", error.message);
    res.status(error.status || 502).json({
      error: "Could not retrieve product detail from CJdropshipping.",
      detail: error.publicMessage || "Check the product detail endpoint in the official CJ API docs.",
      upstreamStatus: error.upstreamStatus || null
    });
  }
});

app.get("/api/enrich", async (req, res) => {
  if (!requireCjToken(res)) return;
  const ids = String(req.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean);
  const unique = [...new Set(ids)].slice(0, 10);
  if (!unique.length) {
    return res.status(400).json({ error: "Provide ids (comma-separated, max 10)." });
  }

  const spanDays = (win) => {
    const days = Math.round((Date.parse(win.to) - Date.parse(win.from)) / 86400000);
    return Number.isFinite(days) && days >= 1 ? days : 1;
  };
  const computeEstimates = (id, entry) => {
    const metrics = getMetrics(id);
    const w7 = metrics?.windows?.d7 || null;
    const w30 = metrics?.windows?.d30 || null;
    let dailyEst = null;
    let monthlyEst = null;
    const sources = [];
    if (w7 && Number(w7.stockChange) > 0) {
      dailyEst = Math.max(1, Math.round(Number(w7.stockChange) / spanDays(w7)));
      sources.push("stock drop 7d");
    }
    if (w30 && Number(w30.stockChange) > 0) {
      monthlyEst = Math.max(1, Math.round((Number(w30.stockChange) / spanDays(w30)) * 30));
      sources.push("stock drop 30d");
    }
    const sold90 = Number(entry.sold90d);
    if (Number.isFinite(sold90) && sold90 > 0) {
      if (dailyEst === null) { dailyEst = Math.max(1, Math.round(sold90 / 90)); sources.push("CJ 90-day avg"); }
      if (monthlyEst === null) { monthlyEst = Math.max(1, Math.round(sold90 / 30)); sources.push("CJ 90-day avg"); }
    }
    return { dailyEst, monthlyEst, estSource: sources.length ? sources.join(" + ") : null };
  };

  const NEW_LISTING_DAYS = 7;
  const NEW_PRODUCT_DAYS = 30;
  const RELISTING_MIN_AGE_DAYS = 60;
  const RELISTING_ACTIVE_DAYS = 30;
  const computeListingFlags = (id, entry) => {
    const createdMs = entry?.createrTime ? Date.parse(entry.createrTime) : NaN;
    const daysOld = Number.isFinite(createdMs) ? Math.max(0, Math.floor((Date.now() - createdMs) / 86400000)) : null;
    const isNewListing = daysOld === null ? null : daysOld <= NEW_LISTING_DAYS;
    const isNewProduct = daysOld === null ? null : daysOld <= NEW_PRODUCT_DAYS;
    const payMs = entry?.lastOrderDate ? Date.parse(entry.lastOrderDate) : NaN;
    const recentPay = Number.isFinite(payMs) && Date.now() - payMs <= RELISTING_ACTIVE_DAYS * 86400000;
    const sold90 = Number(entry?.sold90d);
    const active90 = Number.isFinite(sold90) && sold90 > 0;
    const w7 = getMetrics(id)?.windows?.d7 || null;
    const restocked = Boolean(w7) && Number(w7.stockChange) < 0;
    const activeRecent = recentPay || active90 || restocked;
    const isRelisting = daysOld === null ? null : daysOld >= RELISTING_MIN_AGE_DAYS && activeRecent;
    return {
      createrTime: entry?.createrTime ?? null,
      daysOld,
      isNewListing,
      isNewProduct,
      isRelisting
    };
  };

  const items = {};
  for (const id of unique) {
    let entry = getSalesCache(id);
    if (!entry) {
      let sales = null;
      let lite = null;
      try { sales = await getProductSalesInfo(id); } catch (error) { console.warn("Enrich sales failed:", error.message); }
      try { lite = await getProductReviewsLite(id); } catch (error) { console.warn("Enrich reviews failed:", error.message); }
      if (sales || lite) {
        entry = {
          totalSales: sales?.totalSales ?? null,
          sold90d: sales?.sold90d ?? null,
          lastOrderDate: sales?.lastOrderDate ?? null,
          rating: lite?.avgScore ?? sales?.rating ?? null,
          reviewTotal: lite?.total ?? sales?.commentCount ?? null,
          createrTime: null
        };
        setSalesCache(id, entry);
      }
    }
    if (entry && !entry.createrTime) {
      try {
        const { product } = await getProductDetail(id);
        entry = { ...entry, createrTime: product?.createrTime ?? null };
        setSalesCache(id, entry);
      } catch (error) {
        console.warn("Enrich detail failed:", error.message);
        if (entry.createrTime === undefined) entry = { ...entry, createrTime: null };
      }
    }
    if (entry) items[id] = { ...entry, ...computeEstimates(id, entry), ...computeListingFlags(id, entry) };
  }
  res.json({ items });
});

const LISTING_MARGIN_DEFAULT = 0.3;
const LISTING_STORE_PREFIX = "cjwin-";

function roundMoney(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function parseAgingDays(aging) {
  const text = String(aging || "").trim();
  if (!text) return null;
  const nums = (text.match(/\d+/g) || []).map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

const COUNTRY_NAMES = {
  CN: "China", US: "United States", GB: "United Kingdom", DE: "Germany", FR: "France",
  ES: "Spain", IT: "Italy", NL: "Netherlands", BE: "Belgium", SE: "Sweden", NO: "Norway",
  DK: "Denmark", FI: "Finland", PL: "Poland", AT: "Austria", CH: "Switzerland",
  IE: "Ireland", PT: "Portugal", CZ: "Czechia", GR: "Greece", RO: "Romania", HU: "Hungary",
  SK: "Slovakia", HR: "Croatia", BG: "Bulgaria", SI: "Slovenia", LT: "Lithuania",
  LV: "Latvia", EE: "Estonia", LU: "Luxembourg", MX: "Mexico", BR: "Brazil", CL: "Chile",
  JP: "Japan", KR: "South Korea", SG: "Singapore", MY: "Malaysia", TH: "Thailand",
  PH: "Philippines", ID: "Indonesia", VN: "Vietnam", NZ: "New Zealand",
  AE: "United Arab Emirates", SA: "Saudi Arabia", IN: "India", IL: "Israel",
  TR: "Turkey", ZA: "South Africa", HK: "Hong Kong", TW: "Taiwan", AU: "Australia",
  CA: "Canada", CO: "Colombia", PE: "Peru", AR: "Argentina", QA: "Qatar", KW: "Kuwait"
};

function countryName(code) {
  return COUNTRY_NAMES[String(code || "").toUpperCase()] || String(code || "United States");
}

function pickText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function pickImage(product) {
  return pickText(product?.bigImage, product?.image, product?.productImage, Array.isArray(product?.images) ? product.images[0] : null);
}

function cleanName(value) {
  const text = pickText(value);
  if (!text) return null;
  if (text.startsWith("[")) {
    try {
      const list = JSON.parse(text);
      if (Array.isArray(list)) return pickText(...list.map((item) => String(item ?? "")));
    } catch {
      return text;
    }
  }
  return text;
}

function productTitleFrom(product) {
  return cleanName(product?.productNameEn) || cleanName(product?.nameEn) || cleanName(product?.productName) || cleanName(product?.name) || cleanName(product?.title);
}

function pickCjStore(stores) {
  const apiStore = stores.find((store) => store.type === "api");
  if (apiStore) return { store: apiStore, mode: "cj-store" };
  const platform = stores.find((store) => store.type && store.type !== "api");
  if (platform) return { store: platform, mode: "platform-listing" };
  return { store: null, mode: "none" };
}

function listingErrorResponse(res, error) {
  console.error("Listing request failed:", error.message);
  res.status(error.status || 502).json({
    error: error.publicMessage || error.message || "Listing request failed.",
    cjCode: error.cjCode || null,
    upstreamStatus: error.upstreamStatus || null
  });
}

app.get("/api/stores", async (_req, res) => {
  if (!requireCjToken(res)) return;
  try {
    const stores = await getCjStores();
    const { store, mode } = pickCjStore(stores);
    res.json({ stores, target: store, mode });
  } catch (error) {
    listingErrorResponse(res, error);
  }
});

app.get("/api/listing/preview", async (req, res) => {
  if (!requireCjToken(res)) return;
  const pid = String(req.query.pid || "").trim();
  if (!pid) return res.status(400).json({ error: "pid is required." });
  const country = String(req.query.country || "US").trim().toUpperCase().slice(0, 2) || "US";
  const from = String(req.query.from || "CN").trim().toUpperCase().slice(0, 2) || "CN";
  const margin = Math.max(0, Number(req.query.margin));
  const marginRate = Number.isFinite(margin) && req.query.margin !== undefined ? margin : LISTING_MARGIN_DEFAULT;

  try {
    const stores = await getCjStores();
    const { store, mode } = pickCjStore(stores);
    if (!store) {
      return res.status(409).json({
        error: "No enabled store is connected to this CJ account.",
        detail: "In My CJ → Authorization, add a store (API type) first, then retry."
      });
    }
    if (mode !== "cj-store") {
      return res.status(409).json({
        error: `Store "${store.name}" is a ${store.type} store, not a CJ store.`,
        detail: "This build lists products into a CJ-side (API) store. Connect an API store in My CJ → Authorization."
      });
    }

    const variants = await getVariantList(pid);
    if (!variants.length) {
      return res.status(404).json({ error: "No variants returned by CJ for this product." });
    }

    let title = null;
    let image = variants.find((v) => v.image)?.image || null;
    try {
      const { product } = await getProductDetail(pid);
      title = productTitleFrom(product);
      image = pickImage(product) || image;
    } catch (detailError) {
      console.warn("Listing preview detail skipped:", detailError.message);
    }

    const heaviest = variants.reduce((max, v) => ((v.weight || 0) > (max.weight || 0) ? v : max), variants[0]);
    let shipping = { price: null, methods: [], note: null, from, to: country, estimateDays: null, quoted: false };
    try {
      const methods = await quoteFreight({
        vid: heaviest.vid,
        endCountryCode: country,
        startCountryCode: from
      });
      const cheapest = methods[0] || null;
      shipping = {
        price: cheapest?.price ?? null,
        name: cheapest?.name ?? null,
        aging: cheapest?.aging ?? null,
        estimateDays: parseAgingDays(cheapest?.aging),
        from,
        to: country,
        quoted: Boolean(cheapest?.price),
        methods,
        note: methods.length
          ? `Shipping quoted from ${from} to ${country} for the heaviest variant (${heaviest.weight || "?"}g) — cheapest method selected, auto-calculated.`
          : `CJ returned no shipping route from ${from} to ${country} for this product — try another Ship From.`
      };
    } catch (freightError) {
      console.warn("Freight quote failed:", freightError.message);
      shipping = { price: null, name: null, aging: null, estimateDays: null, from, to: country, quoted: false, methods: [], note: "Shipping quote unavailable: " + freightError.message };
    }

    const shippingPrice = shipping.price ?? 0;
    const rows = variants.map((v) => {
      const cjPrice = v.cjPrice ?? 0;
      const total = roundMoney(cjPrice + shippingPrice);
      return {
        ...v,
        shipping: shippingPrice,
        total,
        rrp: roundMoney(cjPrice * (1 + marginRate)),
        recommended: total ? roundMoney(total * (1 + marginRate)) : null
      };
    });

    res.json({
      store,
      mode,
      country,
      shipFrom: from,
      margin: marginRate,
      product: { id: pid, title, image },
      shipping,
      variants: rows
    });
  } catch (error) {
    listingErrorResponse(res, error);
  }
});

app.post("/api/listing/publish", async (req, res) => {
  if (!requireCjToken(res)) return;
  const body = req.body || {};
  const pid = String(body.pid || "").trim();
  if (!pid) return res.status(400).json({ error: "pid is required." });
  const country = String(body.country || "US").trim().toUpperCase().slice(0, 2) || "US";
  const from = String(body.from || "CN").trim().toUpperCase().slice(0, 2) || "CN";
  const prices = body.prices && typeof body.prices === "object" ? body.prices : {};
  const selected = Array.isArray(body.selected) ? body.selected.map(String) : Object.keys(prices);
  const chosenVids = [...new Set(selected)].filter((vid) => Number(prices[vid]) > 0);
  if (!chosenVids.length) {
    return res.status(400).json({ error: "Select at least one variant with a price greater than 0." });
  }

  try {
    const stores = await getCjStores();
    const { store, mode } = pickCjStore(stores);
    if (!store) {
      return res.status(409).json({
        error: "No enabled store is connected to this CJ account.",
        detail: "In My CJ → Authorization, add a store (API type) first, then retry."
      });
    }
    if (mode !== "cj-store") {
      return res.status(409).json({
        error: `Store "${store.name}" is a ${store.type} store, not a CJ store.`,
        detail: "This build lists products into a CJ-side (API) store."
      });
    }

    const variants = await getVariantList(pid);
    const byVid = new Map(variants.map((v) => [v.vid, v]));
    const rows = chosenVids
      .map((vid) => ({ variant: byVid.get(vid), price: roundMoney(Number(prices[vid])) }))
      .filter((row) => row.variant && row.price !== null);

    if (!rows.length) {
      return res.status(400).json({ error: "None of the selected variants matched this product's variants." });
    }

    let title = null;
    let image = variants.find((v) => v.image)?.image || null;
    try {
      const { product } = await getProductDetail(pid);
      title = productTitleFrom(product);
      image = pickImage(product) || image;
    } catch (detailError) {
      console.warn("Publish detail skipped:", detailError.message);
    }
    title = String(body.title || title || pid).slice(0, 480);

    const pricesOnly = rows.map((r) => r.price);
    const storeProductId = `${LISTING_STORE_PREFIX}${pid}`;

    let savedProduct = false;
    let productExisted = false;
    try {
      savedProduct = await saveStoreProduct({
        id: storeProductId,
        shopId: store.id,
        title,
        image,
        description: `Listed from CJ Product Hunter on ${new Date().toISOString().slice(0, 10)}.`,
        priceMin: Math.min(...pricesOnly),
        priceMax: Math.max(...pricesOnly),
        currency: store.currency || "USD"
      });
    } catch (productError) {
      const alreadyExists = productError.cjCode === 415 || /already exist/i.test(String(productError.publicMessage || productError.message || ""));
      if (!alreadyExists) throw productError;
      productExisted = true;
      savedProduct = true;
    }

    const warnings = [];
    if (!savedProduct) warnings.push("CJ did not confirm the store product save.");

    let existingVids = new Set();
    try {
      const existing = await getStoreProductVariants(store.id, storeProductId);
      existingVids = new Set(existing.variants.map((v) => v.platformVariantId).filter(Boolean));
    } catch (preflightError) {
      console.warn("Existing-variant preflight skipped:", preflightError.message);
    }
    const newRows = rows.filter((r) => !existingVids.has(String(r.variant.vid)));
    const existingCount = rows.length - newRows.length;
    if (existingCount) {
      warnings.push(
        `${existingCount} of ${rows.length} variant(s) already exist in your store. CJ's API cannot change an existing variant's price — edit it in My CJ → Products, or delete it there and list again.`
      );
    }

    const variantResult = newRows.length
      ? await saveStoreVariants({
          shopId: store.id,
          variants: newRows.map((r) => ({
            id: r.variant.vid,
            productId: storeProductId,
            title: r.variant.name || `${r.variant.color || ""} ${r.variant.size || ""}`.trim() || r.variant.sku,
            sku: r.variant.sku,
            image: r.variant.image || image || "",
            shopPrice: r.price,
            shopPriceCurrency: store.currency || "USD",
            ...(r.variant.weight ? { weight: Math.round(r.variant.weight), weightUnit: "g" } : {})
          }))
        })
      : { saved: 0, failed: [], rows: [] };

    if (variantResult.failed.length) warnings.push(`Some variants failed: ${variantResult.failed.join(", ")}`);

    let connected = false;
    let logistics = String(body.logistics || "").trim();
    if (!logistics) {
      try {
        const methods = await quoteFreight({ vid: rows[0].variant.vid, endCountryCode: country, startCountryCode: from });
        logistics = methods[0]?.name || "";
      } catch (freightError) {
        console.warn("Freight quote for connection skipped:", freightError.message);
      }
    }
    if (logistics && (variantResult.saved > 0 || existingCount > 0)) {
      try {
        connected = await createProductConnection({
          shopId: store.id,
          cjProductId: pid,
          platformProductId: storeProductId,
          logistics,
          sourceCountryCode: from,
          sourceCountry: countryName(from),
          targetCountryCode: country,
          targetCountry: countryName(country),
          variantList: rows.map((r) => ({
            cjVariantId: r.variant.vid,
            platformVariantId: r.variant.vid
          }))
        });
      } catch (connectionError) {
        const alreadyConnected = /already exist|duplicate/i.test(String(connectionError.publicMessage || connectionError.message || ""));
        if (alreadyConnected) {
          connected = true;
        } else {
          console.warn("Product connection skipped:", connectionError.message);
          warnings.push(`Product connection not created: ${connectionError.publicMessage || connectionError.message}`);
        }
      }
    } else if (!logistics) {
      warnings.push("Product connection skipped: no shipping method was available.");
    }

    res.json({
      ok: savedProduct && (variantResult.saved > 0 || existingCount === rows.length),
      store: { id: store.id, name: store.name, type: store.type },
      storeProductId,
      productExisted,
      existingVariants: existingCount,
      title,
      shipFrom: from,
      logistics: logistics || null,
      variantsSaved: variantResult.saved,
      variantsRequested: rows.length,
      connected,
      warnings
    });
  } catch (error) {
    listingErrorResponse(res, error);
  }
});

app.post("/api/profit", (req, res) => {
  try {
    const result = estimateProfit(req.body || {});
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("*", (_req, res) => res.sendFile(path.join(projectRoot, "web", "index.html")));

app.listen(PORT, () => {
  console.log(`CJ Product Hunter running at http://localhost:${PORT}`);
  if (!getCjApiKey()) {
    console.warn("Warning: no CJ API Key found. Open Settings (⚙) and paste your key, or set CJ_ACCESS_TOKEN in .env.");
  }
});
