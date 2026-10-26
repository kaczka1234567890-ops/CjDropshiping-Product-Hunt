import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCjApiKey, apiKeyFingerprint } from "./settings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const TOKEN_CACHE_PATH = path.join(projectRoot, ".cj-token-cache.json");

const BASE_URL = (process.env.CJ_API_BASE_URL || "https://developers.cjdropshipping.com/api2.0/v1").replace(/\/+$/, "");
const PRODUCT_LIST_PATH = process.env.CJ_PRODUCT_LIST_PATH || "/product/listV2";
const PRODUCT_DETAIL_PATH = process.env.CJ_PRODUCT_DETAIL_PATH || "/product/query";
const AUTH_PATH = "/authentication/getAccessToken";
const PRODUCT_COMMENTS_PATH = "/product/productComments";
const PRODUCT_SALES_PATH = "/product/productDetail/query";
const SHOPS_PATH = "/shop/getShops";
const VARIANT_QUERY_PATH = "/product/variant/query";
const FREIGHT_PATH = "/logistic/freightCalculate";
const STORE_PRODUCT_SAVE_PATH = "/store/product/saveProduct";
const STORE_VARIANT_SAVE_PATH = "/store/product/saveVariantBatch";
const SHOP_PRODUCT_DETAIL_PATH = "/shop/product/queryDetail";
const PRODUCT_CONNECTION_PATH = "/product/conn/connection";
const MIN_REQUEST_GAP_MS = 1100;

let requestChain = Promise.resolve();
let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readTokenCache() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_CACHE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeTokenCache(cache) {
  try {
    fs.writeFileSync(TOKEN_CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.warn("Could not cache CJ access token:", error.message);
  }
}

export function clearTokenCache() {
  try {
    fs.rmSync(TOKEN_CACHE_PATH, { force: true });
  } catch {
    /* ignore */
  }
}

export function primeTokenCache(apiKey, { accessToken, expiresAt = null }) {
  writeTokenCache({
    accessToken,
    expiresAt,
    obtainedAt: new Date().toISOString(),
    keyFp: apiKeyFingerprint(apiKey)
  });
}

function isApiKey(token) {
  return token.includes("@api@");
}

async function exchangeApiKey(apiKey) {
  const run = async () => {
    const wait = Math.max(0, MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fetch(`${BASE_URL}${AUTH_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ apiKey }),
      signal: AbortSignal.timeout(20000)
    });
  };
  const task = requestChain.then(run, run);
  requestChain = task.catch(() => {});
  const response = await task;

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.data?.accessToken) {
    const error = new Error("CJ token exchange failed");
    error.status = 502;
    error.publicMessage = body?.message
      ? `CJ rejected the API Key: ${body.message}`
      : "CJ did not return an access token. Verify your API Key in the CJ dashboard (My CJ → API).";
    throw error;
  }

  return {
    accessToken: body.data.accessToken,
    expiresAt: body.data.accessTokenExpiryDate || null
  };
}

export async function validateApiKey(apiKey) {
  const key = String(apiKey || "").trim();
  if (!key) {
    const error = new Error("Empty API key");
    error.status = 400;
    error.publicMessage = "Paste your CJdropshipping API Key first.";
    throw error;
  }

  if (isApiKey(key)) {
    try {
      const exchanged = await exchangeApiKey(key);
      return { ...exchanged, direct: false };
    } catch (error) {
      error.status = 400;
      if (!error.publicMessage) error.publicMessage = "CJ rejected the API Key.";
      throw error;
    }
  }

  // No "@api@": maybe a CJ access token — verify it with a light authenticated call.
  try {
    const probe = await fetch(`${BASE_URL}${SHOPS_PATH}`, {
      headers: { "CJ-Access-Token": key, "Accept": "application/json" },
      signal: AbortSignal.timeout(20000)
    });
    const body = await probe.json().catch(() => null);
    if (probe.ok && body && (body.code === 200 || Array.isArray(body?.data))) {
      return { accessToken: key, expiresAt: null, direct: true };
    }
  } catch {
    /* fall through to rejection */
  }

  const error = new Error("Invalid CJ API Key");
  error.status = 400;
  error.publicMessage = "CJ rejected this value. Paste the API Key from your CJ account (My CJ → API) — keys usually contain @api@. Access tokens expire, so prefer the API Key.";
  throw error;
}

async function fetchAccessToken({ force = false } = {}) {
  const apiKey = getCjApiKey();
  if (!apiKey) {
    const error = new Error("Missing CJ API Key");
    error.status = 503;
    error.publicMessage = "CJ API Key is not configured. Open Settings (⚙) and paste your CJ API Key, or set CJ_ACCESS_TOKEN in .env.";
    throw error;
  }

  if (!isApiKey(apiKey)) return apiKey;

  const keyFp = apiKeyFingerprint(apiKey);
  if (!force) {
    const cache = readTokenCache();
    if (cache?.accessToken && cache?.expiresAt && cache?.keyFp === keyFp) {
      const expiresAt = Date.parse(cache.expiresAt);
      if (Number.isFinite(expiresAt) && Date.now() < expiresAt - 60_000) {
        return cache.accessToken;
      }
    }
  }

  const exchanged = await exchangeApiKey(apiKey);
  writeTokenCache({
    accessToken: exchanged.accessToken,
    expiresAt: exchanged.expiresAt,
    obtainedAt: new Date().toISOString(),
    keyFp
  });
  return exchanged.accessToken;
}

async function throttledFetch(url, token, { method = "GET", body = undefined } = {}) {
  const run = async () => {
    const wait = Math.max(0, MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fetch(url, {
      method,
      headers: {
        "CJ-Access-Token": token,
        "Accept": "application/json",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(20000)
    });
  };
  const task = requestChain.then(run, run);
  requestChain = task.catch(() => {});
  return task;
}

async function callCj(path, params = {}, { method = "GET" } = {}) {
  const isPost = method === "POST";
  const postBody = isPost ? JSON.stringify(params) : undefined;
  const buildUrl = (token) => {
    const url = new URL(`${BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`);
    if (!isPost) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url;
  };

  const send = (token) => throttledFetch(buildUrl(token), token, { method, body: postBody });

  let token = await fetchAccessToken();
  let response = await send(token);

  if (response.status === 429) {
    await sleep(1600);
    response = await send(token);
  }

  if (response.status === 401 && isApiKey(getCjApiKey())) {
    token = await fetchAccessToken({ force: true });
    response = await send(token);
  }

  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); } catch { body = { rawText: raw.slice(0, 500) }; }

  if (!response.ok) {
    const error = new Error(`CJ API HTTP ${response.status}`);
    error.status = 502;
    error.upstreamStatus = response.status;
    error.publicMessage = response.status === 401 || response.status === 403
      ? "CJ rejected authentication. Check the API Key in Settings (⚙) or .env and the API app status in your CJ account."
      : "CJ returned an error. Verify endpoint, parameters, API points/quota, and account access.";
    throw error;
  }

  if (body && body.result === false && body.code !== 200) {
    const error = new Error(`CJ business error ${body.code}`);
    error.status = 502;
    error.upstreamStatus = response.status;
    error.publicMessage = `CJ error ${body.code}: ${body.message || "unknown error"}`;
    throw error;
  }

  return { body, note: body?.message || null };
}

function flattenListV2(body) {
  const content = body?.data?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((entry) => Array.isArray(entry?.productList) ? entry.productList : []);
}

export async function searchProducts({
  query,
  page,
  pageSize,
  trending = false,
  minPrice,
  maxPrice,
  countryCode,
  freeShipping,
  minStock,
  orderBy,
  sort
}) {
  const params = {
    page,
    size: Math.min(100, Math.max(1, pageSize))
  };
  if (query) params.keyWord = query;
  if (trending) params.productFlag = 0;
  if (minPrice !== undefined && minPrice !== null && minPrice !== "") params.startSellPrice = minPrice;
  if (maxPrice !== undefined && maxPrice !== null && maxPrice !== "") params.endSellPrice = maxPrice;
  if (countryCode) params.countryCode = String(countryCode).toUpperCase();
  if (freeShipping === true || freeShipping === "1") params.addMarkStatus = 1;
  if (minStock !== undefined && minStock !== null && minStock !== "") params.startWarehouseInventory = minStock;
  if (orderBy !== undefined && orderBy !== null && orderBy !== "") params.orderBy = String(orderBy);
  if (sort === "asc" || sort === "desc") params.sort = sort;

  const { body, note } = await callCj(PRODUCT_LIST_PATH, params);
  const products = flattenListV2(body);

  if (!products.length && !query && !trending) {
    const error = new Error("Empty CJ listV2 response");
    error.status = 502;
    error.publicMessage = "CJ returned no products for this request. Try trending mode or a keyword search.";
    throw error;
  }

  return {
    products,
    note,
    pagination: {
      total: body?.data?.totalRecords ?? null,
      totalPages: body?.data?.totalPages ?? null,
      pageNum: body?.data?.pageNumber ?? page,
      pageSize: body?.data?.pageSize ?? pageSize
    }
  };
}

export async function getProductDetail(pid) {
  const { body, note } = await callCj(PRODUCT_DETAIL_PATH, { pid });
  const data = body?.data;
  const product = Array.isArray(data) ? data[0] : data;
  if (!product || typeof product !== "object") {
    const error = new Error("Product detail not found in CJ response");
    error.status = 404;
    error.publicMessage = "CJ responded, but no product detail was found for this pid.";
    throw error;
  }
  return { product, note };
}

function numberOrNullLocal(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getProductReviews(pid) {
  const { body } = await callCj(PRODUCT_COMMENTS_PATH, { pid, pageNum: 1, pageSize: 50 });
  const data = body?.data;
  let list = Array.isArray(data?.list) ? data.list : [];
  const total = numberOrNullLocal(data?.total);

  const now = Date.now();
  const withinMs = (ms) =>
    list.filter((c) => c?.commentDate && Number.isFinite(Date.parse(c.commentDate)) && now - Date.parse(c.commentDate) <= ms).length;
  const oldestDateMs = () => {
    const dates = list.map((c) => Date.parse(c?.commentDate)).filter(Number.isFinite);
    return dates.length ? Math.min(...dates) : NaN;
  };

  let pages = 1;
  const windowMs = 30 * 86400000;
  while (pages < 3 && total !== null && list.length < total && Number.isFinite(oldestDateMs()) && now - oldestDateMs() <= windowMs) {
    const nextPage = pages + 1;
    const next = await callCj(PRODUCT_COMMENTS_PATH, { pid, pageNum: nextPage, pageSize: 50 });
    const nextList = Array.isArray(next.body?.data?.list) ? next.body.data.list : [];
    if (!nextList.length) break;
    list = list.concat(nextList);
    pages = nextPage;
  }

  const last7d = withinMs(7 * 86400000);
  const last30d = withinMs(windowMs);
  const scores = list.slice(0, 10).map((c) => numberOrNullLocal(c?.score)).filter((v) => v !== null);
  const avgScoreRecent = scores.length
    ? Number((scores.reduce((sum, v) => sum + v, 0) / scores.length).toFixed(1))
    : null;

  return {
    total: total !== null ? total : list.length,
    avgScoreRecent,
    last7d,
    last30d,
    recent: list.slice(0, 3).map((c) => ({
      score: numberOrNullLocal(c?.score),
      user: c?.commentUser ? String(c.commentUser) : null,
      country: c?.countryCode ? String(c.countryCode) : null,
      date: c?.commentDate ? String(c.commentDate).slice(0, 10) : null,
      text: c?.comment ? String(c.comment).slice(0, 220) : null
    }))
  };
}

export async function getProductSalesInfo(pid) {
  const { body } = await callCj(PRODUCT_SALES_PATH, { id: pid }, { method: "POST" });
  const data = body?.data;
  if (!data || typeof data !== "object") return null;
  const lastPayment = numberOrNullLocal(data.latestPaymentDate);
  const lastOrderDate =
    lastPayment !== null && lastPayment > 0 && lastPayment <= Date.now() + 86400000
      ? new Date(lastPayment).toISOString().slice(0, 10)
      : null;
  let inventoryTotal = null;
  const warehouseCountries = {};
  if (Array.isArray(data.variantInventory)) {
    let sum = 0;
    let seen = false;
    for (const variant of data.variantInventory) {
      const inventories = Array.isArray(variant?.inventory) ? variant.inventory : [];
      for (const inv of inventories) {
        const n = numberOrNullLocal(inv?.totalInventory);
        if (n !== null) { sum += n; seen = true; }
        const cc = typeof inv?.countryCode === "string" ? inv.countryCode.trim().toUpperCase() : null;
        if (cc && n !== null) warehouseCountries[cc] = (warehouseCountries[cc] || 0) + n;
      }
    }
    if (seen) inventoryTotal = sum;
  }

  const clean = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const supplierlink = clean(data.supplierlink);
  const domainName = clean(data.domainName);
  const domains = Array.isArray(data.domain) ? data.domain.map(clean).filter(Boolean) : [];
  const thirdUrl = clean(data.thirdProductUrl);
  const supplierWebsite = supplierlink || domainName || domains[0] || thirdUrl || null;
  const hasUSWarehouse = Number.isFinite(warehouseCountries.US) && warehouseCountries.US > 0;

  return {
    totalSales: numberOrNullLocal(data.orderCount),
    sold90d: numberOrNullLocal(data.soldOut),
    lastOrderDate,
    disputeRate: numberOrNullLocal(data.qualityDisputeRate),
    inventoryTotal,
    rating: numberOrNullLocal(data.score),
    commentCount: numberOrNullLocal(data.commentCount),
    supplierWebsite,
    shopName: clean(data.shop_name),
    shopLogo: clean(data.shop_logo),
    supplierNameEn: clean(data.supplierNameEn),
    warehouseCountries,
    hasUSWarehouse,
    usInventory: warehouseCountries.US ?? null
  };
}

export async function getProductReviewsLite(pid) {
  const { body } = await callCj(PRODUCT_COMMENTS_PATH, { pid, pageNum: 1, pageSize: 10 });
  const data = body?.data;
  const list = Array.isArray(data?.list) ? data.list : [];
  const total = numberOrNullLocal(data?.total);
  const scores = list.map((c) => numberOrNullLocal(c?.score)).filter((v) => v !== null);
  const avgScore = scores.length
    ? Number((scores.reduce((sum, v) => sum + v, 0) / scores.length).toFixed(1))
    : null;
  const latestDate = list[0]?.commentDate ? String(list[0].commentDate).slice(0, 10) : null;
  return {
    total: total !== null ? total : list.length,
    avgScore,
    latestDate
  };
}

function strict(body, label) {
  if (body && (body.success === false || (body.result === false && body.code !== 200))) {
    const error = new Error(`${label}: ${body.message || body.code}`);
    error.status = 502;
    error.publicMessage = `CJ error ${body.code}: ${body.message || "unknown error"}`;
    error.cjCode = body.code;
    throw error;
  }
  return body;
}

export async function getCjStores() {
  const { body } = await callCj(SHOPS_PATH);
  const list = Array.isArray(body?.data) ? body.data : [];
  return list
    .map((s) => ({
      id: String(s.id ?? ""),
      name: String(s.name || s.aliasName || s.id || ""),
      type: String(s.type || "").toLowerCase(),
      status: Number(s.status),
      currency: s.currencyCode || null,
      logo: s.platformLogoUrl || null
    }))
    .filter((s) => s.id && s.status === 1);
}

export async function getVariantList(pid) {
  const { body } = await callCj(VARIANT_QUERY_PATH, { pid });
  const list = Array.isArray(body?.data) ? body.data : [];
  return list.map((v) => {
    const key = typeof v.variantKey === "string" && v.variantKey ? v.variantKey : null;
    let color = null;
    let size = null;
    if (key) {
      const parts = key.split("-");
      color = parts.length > 1 ? parts.slice(0, -1).join("-") : parts[0];
      size = parts.length > 1 ? parts[parts.length - 1] : null;
    }
    return {
      vid: String(v.vid || ""),
      sku: v.variantSku || "",
      name: v.variantNameEn || v.variantName || key || "",
      image: v.variantImage || null,
      color,
      size,
      weight: numberOrNullLocal(v.variantWeight),
      length: numberOrNullLocal(v.variantLength),
      width: numberOrNullLocal(v.variantWidth),
      height: numberOrNullLocal(v.variantHeight),
      cjPrice: numberOrNullLocal(v.variantSellPrice),
      suggestedPrice: numberOrNullLocal(v.variantSugSellPrice)
    };
  }).filter((v) => v.vid);
}

export async function quoteFreight({ vid, quantity = 1, startCountryCode = "CN", endCountryCode = "US" } = {}) {
  const { body } = await callCj(
    FREIGHT_PATH,
    { startCountryCode, endCountryCode, products: [{ vid, quantity }] },
    { method: "POST" }
  );
  const list = Array.isArray(body?.data) ? body.data : [];
  return list
    .map((m) => ({
      name: m.logisticName || m.option?.enName || null,
      price: numberOrNullLocal(m.logisticPrice),
      aging: m.logisticAging ? String(m.logisticAging) : null
    }))
    .filter((m) => m.name && m.price !== null)
    .sort((a, b) => a.price - b.price);
}

export async function saveStoreProduct({ id, shopId, title, image, description, priceMin, priceMax, currency = "USD" }) {
  const body = strict(
    (await callCj(STORE_PRODUCT_SAVE_PATH, {
      id,
      ...(shopId ? { shopId } : {}),
      title,
      ...(image ? { image } : {}),
      ...(description ? { description } : {}),
      priceMin,
      priceMax,
      priceCurrency: currency
    }, { method: "POST" })).body,
    "saveStoreProduct"
  );
  return body?.data === true;
}

export async function getStoreProductVariants(shopId, platformProductId) {
  const { body } = await callCj(SHOP_PRODUCT_DETAIL_PATH, { shopId, platformProductIds: platformProductId });
  const list = Array.isArray(body?.data) ? body.data : [];
  const product = list.find((p) => String(p.platformProductId) === String(platformProductId)) || list[0] || null;
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return {
    product,
    variants: variants.map((v) => ({
      platformVariantId: String(v?.platformVariantId ?? ""),
      sku: v?.platformVariantSku ? String(v.platformVariantSku) : null,
      price: v?.price === undefined || v?.price === null ? null : Number(v.price)
    }))
  };
}

export async function saveStoreVariants({ shopId, variants }) {
  const body = strict(
    (await callCj(STORE_VARIANT_SAVE_PATH, { shopId, variants }, { method: "POST" })).body,
    "saveStoreVariants"
  );
  const rows = Array.isArray(body?.data) ? body.data : [];
  return {
    saved: rows.filter((r) => r?.saveSuccess).length,
    failed: rows.filter((r) => r && r.saveSuccess === false).map((r) => r.saveFailMessage || r.id),
    rows
  };
}

export async function createProductConnection({
  shopId,
  cjProductId,
  platformProductId,
  defaultArea = 1,
  logistics,
  sourceCountryCode = "CN",
  sourceCountry = "China",
  targetCountryCode = "US",
  targetCountry = "United States",
  variantList
}) {
  const body = strict(
    (await callCj(PRODUCT_CONNECTION_PATH, {
      shopId,
      defaultArea,
      logistics,
      cjProductId,
      platformProductId,
      sourceCountryCode,
      sourceCountry,
      targetCountryCode,
      targetCountry,
      variantList
    }, { method: "POST" })).body,
    "createProductConnection"
  );
  return body?.data === true;
}
