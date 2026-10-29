import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import {
  searchProducts,
  getProductDetail,
  getProductReviews,
  getProductSalesInfo,
  getProductReviewsLite,
  getCjStores,
  getVariantList,
  quoteFreight,
  saveStoreProduct,
  saveStoreVariants,
  createProductConnection,
  getStoreProductVariants,
  validateApiKey,
  clearTokenCache,
  primeTokenCache,
  runWithApiKey
} from "./cjClient.js";
import { analyzeProduct, sortProducts, estimateProfit } from "./scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(projectRoot, ".env") });

// ── Supabase client (service role — server-side only) ────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ENCRYPTION_KEY) {
  const missing = [
    !SUPABASE_URL && "SUPABASE_URL",
    !SUPABASE_SERVICE_KEY && "SUPABASE_SERVICE_ROLE_KEY",
    !ENCRYPTION_KEY && "ENCRYPTION_KEY"
  ].filter(Boolean);
  console.error(`
✗ Missing required environment variable(s) in .env: ${missing.join(", ")}

  Setup:
    1. Create a free project at https://supabase.com
    2. In Supabase: SQL Editor → paste supabase-schema.sql → Run
    3. In Supabase: Settings → API → copy "Project URL" and the service_role key
    4. Generate an encryption key:
         node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    5. Put all three values in .env (see .env.example), then run npm start
`);
  process.exit(1);
}

if (!/^[0-9a-fA-F]{64}$/.test(ENCRYPTION_KEY)) {
  console.error("✗ ENCRYPTION_KEY must be 64 hex characters (32 bytes). Generate one with:\n" +
    '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

// The data client ALWAYS talks to PostgREST as the service role:
//  · the Authorization header is pinned explicitly, so supabase-js can never
//    replace it with an in-memory user session token (which would silently
//    turn on RLS for backend queries).
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
});

// Separate client for Supabase *Auth* calls (signUp / signIn / getUser / signOut).
// Keeping it separate means a session created by a login can never leak into
// the data client's requests.
const authSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

// A stray rejection must never take the whole server down (Node 26 exits on
// unhandled rejections; one failed background log would otherwise kill it).
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason?.stack || reason?.message || reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err?.stack || err);
});

// ── Encryption helpers ───────────────────────────────────
const ALGORITHM = "aes-256-gcm";

function encrypt(plaintext, keyHex) {
  const key = Buffer.from(keyHex, "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag().toString("base64");
  return { encrypted, iv: iv.toString("base64"), authTag };
}

function decrypt(encrypted, iv, authTag, keyHex) {
  const key = Buffer.from(keyHex, "hex");
  const ivBuf = Buffer.from(iv, "base64");
  const tagBuf = Buffer.from(authTag, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuf);
  decipher.setAuthTag(tagBuf);
  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function fingerprint(key) {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 12);
}

// ── Auth middleware ──────────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const token = authHeader.slice(7);
  // Verify JWT with Supabase
  authSupabase.auth.getUser(token)
    .then(({ data }) => {
      if (!data?.user) return res.status(401).json({ error: "Invalid token" });
      req.user = data.user;
      next();
    })
    .catch(() => res.status(401).json({ error: "Token verification failed" }));
}

async function isAdminUser(userId) {
  const configured = String(process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (configured.includes(userId)) return true;
  try {
    const { data } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", userId)
      .maybeSingle();
    return Boolean(data?.is_admin);
  } catch {
    return false;
  }
}

async function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  const allowed = await isAdminUser(req.user.id);
  if (!allowed) return res.status(403).json({ error: "Admin access required" });
  next();
}

// ── User access check ───────────────────────────────────
async function checkAccess(userId, deviceId) {
  const fallback = {
    allowed: true, is_blocked: false, daily_limit: null, monthly_limit: null,
    daily_used: 0, monthly_used: 0,
    features: { search: true, listing: true, enrich: true }, reason: null
  };
  try {
    const { data, error } = await supabase.rpc("check_user_access", {
      p_user_id: userId,
      p_device_id: deviceId
    });
    if (error) {
      console.error("check_user_access error:", error.message);
      return fallback;
    }
    return data || fallback;
  } catch (err) {
    console.error("check_user_access failed:", err?.message || err);
    return fallback;
  }
}

// Fire-and-forget: logs usage + bumps counters. Must NEVER throw — a supabase
// query builder is a thenable (no .catch), so wrap it in async/try.
async function recordUsage(userId, endpoint, ipAddress, deviceId, responseCode) {
  try {
    await supabase.from("usage_logs").insert({
      user_id: userId,
      endpoint,
      ip_address: ipAddress,
      device_id: deviceId,
      response_code: responseCode
    });
  } catch (err) {
    console.warn("usage log failed:", err?.message || err);
  }
  try {
    await supabase.rpc("increment_usage_counts", { p_user_id: userId });
  } catch (err) {
    console.warn("usage counter failed:", err?.message || err);
  }
}

function getDeviceId(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = forwarded ? forwarded.split(",")[0].trim() : req.socket.remoteAddress || "unknown";
  const ua = req.headers["user-agent"] || "unknown";
  return crypto.createHash("sha256").update(`${ip}:${ua}`).digest("hex").slice(0, 16);
}

async function registerDevice(userId, deviceId, userAgent, ipAddress) {
  try {
    const { error } = await supabase.from("user_devices").upsert({
      user_id: userId,
      device_id: deviceId,
      user_agent: userAgent,
      ip_address: ipAddress,
      last_seen: new Date().toISOString()
    }, { onConflict: "user_id,device_id" });
    if (error) console.warn("device register failed:", error.message);
  } catch (err) {
    console.warn("device register failed:", err?.message || err);
  }
}

// ── App setup ───────────────────────────────────────────
const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());
app.use(express.static(path.join(projectRoot, "web")));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── Auth endpoints ──────────────────────────────────────
// Very small in-memory limiter: stops brute-force / signup spam per IP.
const authHits = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const bucket = authHits.get(key) || { count: 0, start: now };
  if (now - bucket.start > windowMs) {
    bucket.count = 0;
    bucket.start = now;
  }
  bucket.count += 1;
  authHits.set(key, bucket);
  if (authHits.size > 5000) authHits.clear();
  return bucket.count > max;
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return forwarded ? forwarded.split(",")[0].trim() : req.socket.remoteAddress || "unknown";
}

app.post("/api/auth/signup", async (req, res) => {
  if (rateLimited(`signup:${clientIp(req)}`, 5, 10 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many signup attempts. Try again in a few minutes." });
  }
  try {
    const { email, password, fullName } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
    if (String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    const { data, error } = await authSupabase.auth.signUp({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    const userId = data.user?.id;
    if (userId) {
      await supabase.from("profiles").upsert({ id: userId, email, full_name: fullName || null });
      await supabase.from("admin_policies").upsert({ user_id: userId });
    }
    res.json({
      ok: true,
      userId: userId || null,
      needsEmailConfirmation: !data.session,
      token: data.session?.access_token || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  if (rateLimited(`login:${clientIp(req)}`, 10, 5 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many login attempts. Try again in a few minutes." });
  }
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
    const { data, error } = await authSupabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: error.message });
    res.json({ ok: true, token: data.session.access_token, userId: data.user.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  await authSupabase.auth.signOut();
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const [{ data: profile }, { data: policy }, { data: keyRow }, isAdmin] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", req.user.id).maybeSingle(),
    supabase.from("admin_policies").select("*").eq("user_id", req.user.id).maybeSingle(),
    supabase.from("user_api_keys").select("id").eq("user_id", req.user.id).maybeSingle(),
    isAdminUser(req.user.id)
  ]);
  res.json({
    id: req.user.id,
    email: req.user.email,
    fullName: profile?.full_name || null,
    isAdmin,
    isBlocked: policy?.is_blocked || false,
    dailyLimit: policy?.daily_api_limit ?? null,
    monthlyLimit: policy?.monthly_api_limit ?? null,
    dailyUsed: policy?.daily_api_count ?? 0,
    monthlyUsed: policy?.monthly_api_count ?? 0,
    features: policy?.features || { search: true, listing: true, enrich: true },
    hasCjKey: Boolean(keyRow)
  });
});

// ── CJ API Key management ───────────────────────────────
app.post("/api/keys", requireAuth, async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: "API key required" });
  try {
    const validated = await validateApiKey(apiKey);
    const fp = fingerprint(apiKey);
    const { encrypted, iv, authTag } = encrypt(apiKey, ENCRYPTION_KEY);
    // delete + insert instead of upsert: works whether or not the table has
    // a unique(user_id) constraint (older databases may not).
    const { error: delError } = await supabase
      .from("user_api_keys")
      .delete()
      .eq("user_id", req.user.id);
    if (delError) throw delError;
    const { error } = await supabase.from("user_api_keys").insert({
      user_id: req.user.id,
      key_encrypted: encrypted,
      key_iv: iv,
      key_auth_tag: authTag,
      key_fingerprint: fp
    });
    if (error) throw error;
    if (validated.direct) clearTokenCache();
    else primeTokenCache(apiKey, validated);
    res.json({ ok: true, fingerprint: fp });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.publicMessage || error.message });
  }
});

app.get("/api/keys", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("user_api_keys")
    .select("key_fingerprint")
    .eq("user_id", req.user.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ? { exists: true, fingerprint: data.key_fingerprint } : { exists: false });
});

app.delete("/api/keys", requireAuth, async (req, res) => {
  await supabase.from("user_api_keys").delete().eq("user_id", req.user.id);
  clearTokenCache();
  res.json({ ok: true });
});

// Get decrypted key for server-side use
async function getUserApiKey(userId) {
  const { data, error } = await supabase
    .from("user_api_keys")
    .select("key_encrypted, key_iv, key_auth_tag")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return decrypt(data.key_encrypted, data.key_iv, data.key_auth_tag, ENCRYPTION_KEY);
}

// ── CJ API proxy ────────────────────────────────────────
// Runs the handler with the *calling user's* decrypted CJ key bound to the
// async context, so concurrent requests can never use another user's key.
async function withCjKey(userId, res, handler) {
  const key = await getUserApiKey(userId);
  if (!key) {
    return res.status(503).json({
      error: "CJ API key not configured.",
      detail: "Open ⚙ Settings in the extension and paste your CJdropshipping API Key."
    });
  }
  return runWithApiKey(key, handler);
}

app.get("/api/products", requireAuth, async (req, res) => {
  const deviceId = getDeviceId(req);
  const access = await checkAccess(req.user.id, deviceId);
  if (!access.allowed) {
    return res.status(403).json({ error: access.reason, access });
  }
  await registerDevice(req.user.id, deviceId, req.headers["user-agent"], req.ip);

  // NOTE: these are read at route scope because the response below (outside the
  // CJ callback) echoes them back — declaring them inside the callback would
  // make res.json() throw "sort is not defined".
  const sort = String(req.query.sort || "winning");
  const trending = String(req.query.trending || "") === "1";
  const quick = String(req.query.quick || "") === "1";
  const deliverTo = String(req.query.deliverTo || "").trim().toUpperCase() || undefined;
  const countryCode = String(req.query.country || "").trim() || undefined;
  const effectiveCountry = countryCode || (quick ? (deliverTo || "US") : undefined);

  try {
    const result = await withCjKey(req.user.id, res, async (key) => {
      const query = String(req.query.q || req.query.query || "").trim();
      const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize || req.query.limit || "20"), 10) || 20));
      const freeShipping = String(req.query.freeShipping || "") === "1";
      const minStock = req.query.minStock !== undefined ? Number(req.query.minStock) : undefined;
      const minPrice = req.query.minPrice !== undefined ? Number(req.query.minPrice) : undefined;
      const maxPrice = req.query.maxPrice !== undefined ? Number(req.query.maxPrice) : undefined;
      const quickMark = Boolean(quick && effectiveCountry && String(effectiveCountry).toUpperCase() !== "CN");

      const result = await searchProducts({
        query, page, pageSize, trending, freeShipping, minStock, minPrice, maxPrice,
        countryCode: effectiveCountry, orderBy: sort === "listed_desc" ? 1 : undefined, sort: "desc"
      });
      const products = sortProducts(result.products.map(analyzeProduct), sort);
      if (quickMark) {
        products.forEach((p) => {
          if (!p.quickDelivery) { p.quickDelivery = true; }
        });
      }
      return { products, pagination: result.pagination, note: result.note };
    });

    recordUsage(req.user.id, "/api/products", req.ip, deviceId, 200);
    res.json({
      products: result.products,
      page: result.pagination?.pageNum ?? page,
      pageSize: result.pagination?.pageSize ?? pageSize,
      total: result.pagination?.total ?? null,
      totalPages: result.pagination?.totalPages ?? null,
      sort, trending, quick,
      shipFrom: effectiveCountry || null,
      deliverTo: deliverTo || null,
      source: "CJdropshipping API 2.0",
      note: result.note || null
    });
  } catch (error) {
    recordUsage(req.user.id, "/api/products", req.ip, deviceId, error.status || 502);
    console.error("CJ request failed:", error.message);
    res.status(error.status || 502).json({
      error: "Could not retrieve products from CJdropshipping.",
      detail: error.publicMessage || "Check connection.",
      upstreamStatus: error.upstreamStatus || null
    });
  }
});

app.get("/api/products/:pid", requireAuth, async (req, res) => {
  const deviceId = getDeviceId(req);
  const access = await checkAccess(req.user.id, deviceId);
  if (!access.allowed) return res.status(403).json({ error: access.reason });
  await registerDevice(req.user.id, deviceId, req.headers["user-agent"], req.ip);
  
  const pid = String(req.params.pid || "").trim();
  if (!pid) return res.status(400).json({ error: "Product id required." });

  try {
    const result = await withCjKey(req.user.id, res, async () => {
      const { product, note } = await getProductDetail(pid);
      const analyzed = analyzeProduct(product);
      let reviews = null;
      try { reviews = await getProductReviews(analyzed.id || pid); } catch (e) { console.warn("Reviews unavailable:", e.message); }
      let sales = null;
      try { sales = await getProductSalesInfo(analyzed.id || pid); } catch (e) { console.warn("Sales unavailable:", e.message); }
      return { product: analyzed, reviews, sales, note };
    });

    recordUsage(req.user.id, "/api/products/:pid", req.ip, deviceId, 200);
    res.json(result);
  } catch (error) {
    recordUsage(req.user.id, "/api/products/:pid", req.ip, deviceId, error.status || 502);
    res.status(error.status || 502).json({ error: "Could not retrieve product detail.", detail: error.publicMessage });
  }
});

app.get("/api/enrich", requireAuth, async (req, res) => {
  const deviceId = getDeviceId(req);
  const access = await checkAccess(req.user.id, deviceId);
  if (!access.allowed) return res.status(403).json({ error: access.reason });
  await registerDevice(req.user.id, deviceId, req.headers["user-agent"], req.ip);
  
  const ids = String(req.query.ids || "").split(",").map(s => s.trim()).filter(Boolean);
  const unique = [...new Set(ids)].slice(0, 10);
  if (!unique.length) return res.status(400).json({ error: "Provide ids (comma-separated, max 10)." });

  try {
    const result = await withCjKey(req.user.id, res, async () => {
      const items = {};
      for (const id of unique) {
        let sales = null, lite = null;
        try { sales = await getProductSalesInfo(id); } catch (e) { console.warn("Enrich sales failed:", e.message); }
        try { lite = await getProductReviewsLite(id); } catch (e) { console.warn("Enrich reviews failed:", e.message); }
        if (sales || lite) {
          items[id] = {
            totalSales: sales?.totalSales ?? null,
            sold90d: sales?.sold90d ?? null,
            lastOrderDate: sales?.lastOrderDate ?? null,
            rating: lite?.avgScore ?? sales?.rating ?? null,
            reviewTotal: lite?.total ?? sales?.commentCount ?? null,
            createrTime: null
          };
        }
      }
      return { items };
    });

    recordUsage(req.user.id, "/api/enrich", req.ip, deviceId, 200);
    res.json(result);
  } catch (error) {
    recordUsage(req.user.id, "/api/enrich", req.ip, deviceId, error.status || 502);
    res.status(502).json({ error: "Enrich failed.", detail: error.message });
  }
});

app.get("/api/listing/preview", requireAuth, async (req, res) => {
  const deviceId = getDeviceId(req);
  const access = await checkAccess(req.user.id, deviceId);
  if (!access.allowed) return res.status(403).json({ error: "Listing feature disabled." });
  await registerDevice(req.user.id, deviceId, req.headers["user-agent"], req.ip);
  
  const pid = String(req.query.pid || "").trim();
  if (!pid) return res.status(400).json({ error: "pid required." });
  const country = String(req.query.country || "US").trim().toUpperCase().slice(0, 2) || "US";
  const from = String(req.query.from || "CN").trim().toUpperCase().slice(0, 2) || "CN";
  const margin = Math.max(0, Number(req.query.margin));
  const marginRate = Number.isFinite(margin) && req.query.margin !== undefined ? margin : 0.3;

  try {
    const result = await withCjKey(req.user.id, res, async () => {
      const stores = await getCjStores();
      const store = stores.find(s => s.type === "api") || stores.find(s => s.type && s.type !== "api") || null;
      if (!store) throw Object.assign(new Error("No store connected"), { status: 409, publicMessage: "No enabled store connected to this CJ account." });
      
      const variants = await getVariantList(pid);
      if (!variants.length) throw Object.assign(new Error("No variants"), { status: 404, publicMessage: "No variants returned by CJ." });

      let title = null, image = null;
      try {
        const { product } = await getProductDetail(pid);
        title = product?.productNameEn || product?.nameEn || pid;
        image = product?.bigImage || product?.image || variants.find(v => v.image)?.image || null;
      } catch (e) { console.warn("Detail skipped:", e.message); }

      const heaviest = variants.reduce((max, v) => (v.weight > (max?.weight || 0) ? v : max), variants[0]);
      let shipping = { price: null, methods: [], note: null, from, to: country, quoted: false };
      try {
        const methods = await quoteFreight({ vid: heaviest.vid, endCountryCode: country, startCountryCode: from });
        const cheapest = methods[0] || null;
        shipping = { price: cheapest?.price ?? null, name: cheapest?.name ?? null, aging: cheapest?.aging ?? null, from, to: country, quoted: Boolean(cheapest?.price), methods, note: methods.length ? `Shipping quoted ${from} → ${country}` : `No route ${from} → ${country}` };
      } catch (e) { console.warn("Freight failed:", e.message); }

      const rows = variants.map(v => ({
        ...v,
        shipping: shipping.price ?? 0,
        total: Math.round((v.cjPrice + (shipping.price ?? 0)) * 100) / 100,
        rrp: Math.round(v.cjPrice * (1 + marginRate) * 100) / 100,
        recommended: shipping.price !== null ? Math.round((v.cjPrice + shipping.price) * (1 + marginRate) * 100) / 100 : null
      }));

      return { store, country, shipFrom: from, margin: marginRate, product: { id: pid, title, image }, shipping, variants: rows };
    });

    recordUsage(req.user.id, "/api/listing/preview", req.ip, deviceId, 200);
    res.json(result);
  } catch (error) {
    recordUsage(req.user.id, "/api/listing/preview", req.ip, deviceId, error.status || 502);
    res.status(error.status || 502).json({ error: error.publicMessage || error.message, cjCode: error.cjCode });
  }
});

app.post("/api/listing/publish", requireAuth, async (req, res) => {
  const deviceId = getDeviceId(req);
  const access = await checkAccess(req.user.id, deviceId);
  if (!access.allowed) return res.status(403).json({ error: "Listing feature disabled." });
  await registerDevice(req.user.id, deviceId, req.headers["user-agent"], req.ip);
  
  const body = req.body || {};
  const pid = String(body.pid || "").trim();
  if (!pid) return res.status(400).json({ error: "pid required." });
  const country = String(body.country || "US").trim().toUpperCase().slice(0, 2) || "US";
  const from = String(body.from || "CN").trim().toUpperCase().slice(0, 2) || "CN";
  const prices = body.prices && typeof body.prices === "object" ? body.prices : {};
  const selected = Array.isArray(body.selected) ? body.selected.map(String) : Object.keys(prices);
  const chosenVids = [...new Set(selected)].filter(vid => Number(prices[vid]) > 0);
  if (!chosenVids.length) return res.status(400).json({ error: "Select at least one variant with price > 0." });

  try {
    const result = await withCjKey(req.user.id, res, async () => {
      const stores = await getCjStores();
      const store = stores.find(s => s.type === "api") || null;
      if (!store) throw Object.assign(new Error("No store"), { status: 409, publicMessage: "No CJ store connected." });

      const variants = await getVariantList(pid);
      const byVid = new Map(variants.map(v => [v.vid, v]));
      const rows = chosenVids.map(vid => ({ variant: byVid.get(vid), price: Math.round(Number(prices[vid]) * 100) / 100 }))
        .filter(r => r.variant && r.price !== null);
      if (!rows.length) return res.status(400).json({ error: "No matching variants." });

      let title = rows[0]?.variant?.name || pid;
      let image = rows[0]?.variant?.image || null;
      title = String(body.title || title).slice(0, 480);
      const storeProductId = `cjwin-${pid}`;
      const pricesOnly = rows.map(r => r.price);

      let savedProduct = false, productExisted = false;
      try {
        savedProduct = await saveStoreProduct({ id: storeProductId, shopId: store.id, title, image, description: `Listed from CJ Product Hunter on ${new Date().toISOString().slice(0,10)}.`, priceMin: Math.min(...pricesOnly), priceMax: Math.max(...pricesOnly), currency: store.currency || "USD" });
      } catch (e) {
        if (/already exist/i.test(String(e.publicMessage || e.message || ""))) { productExisted = true; savedProduct = true; }
        else throw e;
      }

      let existingVids = new Set();
      try {
        const existing = await getStoreProductVariants(store.id, storeProductId);
        existingVids = new Set(existing.variants.map(v => v.platformVariantId).filter(Boolean));
      } catch (e) { console.warn("Preflight skipped:", e.message); }
      const newRows = rows.filter(r => !existingVids.has(String(r.variant.vid)));
      const existingCount = rows.length - newRows.length;
      const warnings = [];
      if (!savedProduct) warnings.push("CJ did not confirm product save.");
      if (existingCount) warnings.push(`${existingCount} variant(s) already exist — price cannot be changed via API.`);

      let variantResult = { saved: 0, failed: [], rows: [] };
      if (newRows.length) {
        variantResult = await saveStoreVariants({
          shopId: store.id,
          variants: newRows.map(r => ({
            id: r.variant.vid, productId: storeProductId,
            title: r.variant.name || `${r.variant.color || ""} ${r.variant.size || ""}`.trim() || r.variant.sku,
            sku: r.variant.sku, image: r.variant.image || image || "",
            shopPrice: r.price, shopPriceCurrency: store.currency || "USD",
            ...(r.variant.weight ? { weight: Math.round(r.variant.weight), weightUnit: "g" } : {})
          }))
        });
      }
      if (variantResult.failed.length) warnings.push(`Some variants failed: ${variantResult.failed.join(", ")}`);

      let connected = false;
      let logistics = String(body.logistics || "").trim();
      if (!logistics) {
        try {
          const methods = await quoteFreight({ vid: rows[0].variant.vid, endCountryCode: country, startCountryCode: from });
          logistics = methods[0]?.name || "";
        } catch (e) { console.warn("Freight skipped:", e.message); }
      }
      if (logistics && (variantResult.saved > 0 || existingCount > 0)) {
        try {
          connected = await createProductConnection({ shopId: store.id, cjProductId: pid, platformProductId: storeProductId, logistics, sourceCountryCode: from, targetCountryCode: country, variantList: rows.map(r => ({ cjVariantId: r.variant.vid, platformVariantId: r.variant.vid })) });
        } catch (e) {
          if (/already exist|duplicate/i.test(String(e.publicMessage || e.message || ""))) connected = true;
          else warnings.push(`Connection not created: ${e.publicMessage || e.message}`);
        }
      }

      return { ok: savedProduct && (variantResult.saved > 0 || existingCount === rows.length), store: { id: store.id, name: store.name, type: store.type }, storeProductId, productExisted, existingVariants: existingCount, title, shipFrom: from, logistics: logistics || null, variantsSaved: variantResult.saved, variantsRequested: rows.length, connected, warnings };
    });

    recordUsage(req.user.id, "/api/listing/publish", req.ip, deviceId, 200);
    res.json(result);
  } catch (error) {
    recordUsage(req.user.id, "/api/listing/publish", req.ip, deviceId, error.status || 502);
    res.status(error.status || 502).json({ error: error.publicMessage || error.message, cjCode: error.cjCode });
  }
});

app.post("/api/profit", requireAuth, (req, res) => {
  try {
    res.json(estimateProfit(req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ── Admin endpoints ─────────────────────────────────────
app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  const [{ data: profiles }, { data: policies }, { data: deviceRows }, { data: keyRows }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, created_at, updated_at, is_admin"),
    supabase.from("admin_policies").select("*"),
    supabase.from("user_devices").select("user_id, device_id, user_agent, ip_address, is_blocked, last_seen"),
    supabase.from("user_api_keys").select("user_id, key_fingerprint")
  ]);
  const deviceMap = {};
  (deviceRows || []).forEach((d) => {
    if (!deviceMap[d.user_id]) deviceMap[d.user_id] = [];
    deviceMap[d.user_id].push(d);
  });
  const keyMap = new Map((keyRows || []).map((k) => [k.user_id, k]));
  const configuredAdmins = String(process.env.ADMIN_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const users = (profiles || []).map((p) => ({
    ...p,
    isAdmin: Boolean(p.is_admin) || configuredAdmins.includes(p.id),
    hasCjKey: keyMap.has(p.id),
    keyFingerprint: keyMap.get(p.id)?.key_fingerprint || null,
    policy: (policies || []).find((pol) => pol.user_id === p.id) || null,
    devices: deviceMap[p.id] || []
  }));
  res.json({ users });
});

app.post("/api/admin/users/:userId/block", requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { blocked, notes } = req.body || {};
  const isBlocked = blocked !== false;
  const { error } = await supabase.from("admin_policies").upsert({
    user_id: userId, is_blocked: isBlocked, updated_by: req.user.id, updated_at: new Date().toISOString()
  });
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from("admin_audit_log").insert({ admin_id: req.user.id, target_user_id: userId, action: isBlocked ? "block" : "unblock", details: { notes: notes || null } });
  res.json({ ok: true });
});

app.post("/api/admin/users/:userId/limits", requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { dailyLimit, monthlyLimit } = req.body || {};
  const { error } = await supabase.from("admin_policies").upsert({
    user_id: userId,
    daily_api_limit: dailyLimit === undefined ? null : dailyLimit,
    monthly_api_limit: monthlyLimit === undefined ? null : monthlyLimit,
    updated_by: req.user.id,
    updated_at: new Date().toISOString()
  });
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from("admin_audit_log").insert({ admin_id: req.user.id, target_user_id: userId, action: "update_limits", details: { dailyLimit, monthlyLimit } });
  res.json({ ok: true });
});

app.post("/api/admin/users/:userId/devices/:deviceId/block", requireAuth, requireAdmin, async (req, res) => {
  const { userId, deviceId } = req.params;
  const blocked = (req.body || {}).blocked !== false;
  const { error } = await supabase
    .from("user_devices")
    .update({ is_blocked: blocked })
    .eq("device_id", deviceId)
    .eq("user_id", userId);
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from("admin_audit_log").insert({ admin_id: req.user.id, target_user_id: userId, action: blocked ? "block_device" : "unblock_device", details: { deviceId } });
  res.json({ ok: true });
});

app.post("/api/admin/users/:userId/features", requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { features } = req.body || {};
  const { error } = await supabase.from("admin_policies").upsert({
    user_id: userId,
    features: features || { search: true, listing: true, enrich: true },
    updated_by: req.user.id,
    updated_at: new Date().toISOString()
  });
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from("admin_audit_log").insert({ admin_id: req.user.id, target_user_id: userId, action: "update_features", details: { features } });
  res.json({ ok: true });
});

app.get("/api/admin/usage", requireAuth, requireAdmin, async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const [{ data: logs, count }, { data: policies }] = await Promise.all([
    supabase.from("usage_logs").select("*", { count: "exact" })
      .order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1),
    supabase.from("admin_policies").select("*")
  ]);
  res.json({ logs: logs || [], total: count || 0, policies: policies || [], page, limit });
});

app.get("/api/admin/audit", requireAuth, requireAdmin, async (req, res) => {
  const { data } = await supabase.from("admin_audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  res.json({ entries: data || [] });
});

// Reset every user's daily counter (admin panel → Settings).
app.post("/api/admin/reset-daily", requireAuth, requireAdmin, async (req, res) => {
  const { error } = await supabase.rpc("reset_daily_counts");
  if (error) {
    // Fallback if the RPC is missing: update rows directly with service role.
    const { error: updateError } = await supabase
      .from("admin_policies")
      .update({ daily_api_count: 0, updated_at: new Date().toISOString() })
      .neq("user_id", "00000000-0000-0000-0000-000000000000");
    if (updateError) return res.status(500).json({ error: updateError.message });
  }
  await supabase.from("admin_audit_log").insert({ admin_id: req.user.id, action: "reset_daily_counts", details: {} });
  res.json({ ok: true });
});

// ── Health ──────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, auth: "supabase", timestamp: new Date().toISOString() });
});

// Unknown API routes → JSON 404 (never fall through to the static SPA).
app.use("/api", (req, res) => {
  res.status(404).json({ error: `Unknown endpoint: ${req.method} ${req.originalUrl}` });
});

// ── SPA fallback (local dev; Vercel serves web/ directly) ─
app.get("*", (req, res) => {
  const rel = req.path === "/" ? "index.html" : req.path.replace(/^\/+/, "");
  const target = rel === "admin" || rel === "admin/" ? "admin.html" : rel;
  const webRoot = path.join(projectRoot, "web");
  const full = path.resolve(webRoot, target);
  if (!full.startsWith(webRoot)) return res.status(404).send("Not found");
  res.sendFile(full, (err) => {
    if (err && !res.headersSent) res.status(404).send("Not found");
  });
});

// ── Start (Vercel imports the app; it never calls listen) ─
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`CJ Product Hunter (Cloud) running at http://localhost:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin`);
  });
}

export default app;
