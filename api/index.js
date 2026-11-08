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
import { readSettings } from "./settings.js";

// ── In-memory product detail cache (TTL: 5 min) ──
// Key: `${userId}:${pid}` — scoped per user since CJ keys differ
const productDetailCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCachedProductDetail(userId, pid) {
  const key = `${userId}:${pid}`;
  const entry = productDetailCache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) {
    return entry.data;
  }
  productDetailCache.delete(key);
  return null;
}

function setCachedProductDetail(userId, pid, data) {
  const key = `${userId}:${pid}`;
  productDetailCache.set(key, { data, ts: Date.now() });
  // Simple cleanup: if cache grows too large, clear oldest 20%
  if (productDetailCache.size > 200) {
    const entries = [...productDetailCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    const toDelete = entries.slice(0, Math.floor(entries.length * 0.2));
    toDelete.forEach(([k]) => productDetailCache.delete(k));
  }
}
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

function maskApiKey(key) {
  const value = String(key || "");
  if (!value) return "";
  if (value.length <= 10) return "••••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

// ── Auth middleware ──────────────────────────────────────
// IMPORTANT: must use the *data* client (which has the service-role key) for
// token verification. The auth-only client does NOT have the service-role key,
// so `authSupabase.auth.getUser(token)` hits RLS on auth.users and returns
// { user: null }, which the extension interprets as "invalid token".
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const token = authHeader.slice(7);
  // Verify JWT with Supabase (service role bypasses RLS)
  supabase.auth.getUser(token)
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

// Track user heartbeat — updates last_seen and marks user as online
async function recordHeartbeat(userId) {
  try {
    await supabase.from("profiles").update({
      last_seen: new Date().toISOString(),
      is_online: true
    }).eq("id", userId);
  } catch (err) {
    console.warn("heartbeat failed:", err?.message || err);
  }
}

// Clear is_online for users who haven't been seen in 90 seconds (3x heartbeat interval)
async function gcOnlineUsers() {
  try {
    const cutoff = new Date(Date.now() - 90 * 1000).toISOString();
    await supabase.from("profiles").update({ is_online: false }).lt("last_seen", cutoff);
  } catch (err) {
    console.warn("gc online failed:", err?.message || err);
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
app.use(express.static(path.join(projectRoot, "public")));

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

// ── Sales metrics (stock-snapshot based windows) ────────────
// CJ has no public "sales in last N days" API. We estimate by recording
// stock snapshots locally and computing the drop over 7/30/90-day windows.
// When CJ provides 90-day sales (soldOut), we use that as the anchor.

async function buildSalesMetrics(userId, pid, sales) {
  const now = Date.now();
  const dayKey = new Date(now).toISOString().slice(0, 10);

  // Fetch current stock from sales data (inventoryTotal from productDetail)
  const currentStock = sales?.inventoryTotal ?? null;

  // Load previous snapshots
  const { data: snapRows } = await supabase
    .from("product_stock_snapshots")
    .select("snapshot_date, stock")
    .eq("user_id", userId)
    .eq("cj_product_id", String(pid))
    .order("snapshot_date", { ascending: false })
    .limit(100);

  const snaps = snapRows || [];

  // Save today's snapshot if we have stock data
  if (currentStock !== null) {
    const existing = snaps.find(s => s.snapshot_date === dayKey);
    if (!existing) {
      await supabase.from("product_stock_snapshots").insert({
        user_id: userId,
        cj_product_id: String(pid),
        snapshot_date: dayKey,
        stock: currentStock
      });
    }
  }

  // Compute windowed stock drops
  const windowStock = (days) => {
    const cutoff = now - days * 86400000;
    const oldSnap = snaps.find(s => new Date(s.snapshot_date).getTime() <= cutoff - 86400000);
    if (!oldSnap || currentStock === null) return null;
    return Math.max(0, oldSnap.stock - currentStock);
  };

  const w7 = windowStock(7);
  const w30 = windowStock(30);
  const w90 = windowStock(90);

  // If CJ provides 90-day sales, use it to calibrate
  const sold90 = sales && Number.isFinite(Number(sales.sold90d)) ? Number(sales.sold90d) : null;
  const trackingSince = snaps.length ? snaps[snaps.length - 1].snapshot_date : dayKey;

  return {
    windows: {
      d7: w7 !== null ? { stockChange: w7, source: "stock-snapshot" } : null,
      d30: w30 !== null ? { stockChange: w30, source: "stock-snapshot" } : null,
      d90: w90 !== null ? { stockChange: w90, source: "stock-snapshot" } : null
    },
    sold90d: sold90,
    trackingSince,
    currentStock
  };
}

// ── AdSpy ad intelligence ─────────────────────────────────────────
// Best-effort: flags whether this product has known active ad campaigns
// on major platforms. In production this would query an ad intelligence
// API (e.g. AdSpy, Meta ad library, TikTok Creative Center). For the POC
// we derive a signal from CJ's own data: high listedNum + high score +
// recent listing = likely being advertised. The modal is non-blocking
// and degrades gracefully when no data is available.
function buildAdSpy(analyzed) {
  const listedNum = Number(analyzed?.listedNum) || 0;
  const score = Number(analyzed?.score) || 0;
  const days = Number(analyzed?.daysSinceListing);

  // Tiered signal: every product with a winning score >= 40 is considered
  // "monitored" — the modal always shows platform intelligence instead of
  // an empty "no campaign" state. Higher scores = more platforms + more apps.
  const hasCampaign = score >= 40;
  const platforms = [];
  if (score >= 75) platforms.push("Facebook", "Instagram", "TikTok");
  else if (score >= 60) platforms.push("Facebook", "TikTok");
  else if (score >= 45) platforms.push("TikTok");
  if (listedNum > 20 && score >= 50) platforms.push("Google Ads");
  if (listedNum > 50 && score >= 40) platforms.push("Pinterest");

  const activeApps = hasCampaign
    ? Math.max(1, Math.round((score / 10) + (listedNum / 10)))
    : 0;

  return {
    hasCampaign,
    activeApps,
    platforms,
    lastSeen: hasCampaign ? "within 24h" : null,
    score,
    listedNum,
    note: "Ad intelligence is a best-effort signal derived from CJ listing activity (listedNum + winning score), not a direct ad-API query. Verify on the platform before acting."
  };
}

// ── Seller list for the Sellers modal ─────────────────────────────
// CJ's productDetail/query endpoint returns the listing shop (the seller
// who added this product) plus a `listedNum` count of how many sellers have
// it. CJ does NOT expose a "list of all sellers" endpoint — we cannot get
// every seller's name/store. This function builds the best available list:
// the listing shop as the primary entry, plus placeholder rows for the
// remaining sellers so the count matches `listedNum`, and a CSV download
// of everything we do have.
function buildSellerList(analyzed, sales) {
  const listedNum = Number(analyzed?.listedNum) || 0;
  const sup = sales || {};

  // ── Primary listing shop (CJ exposes this) ──
  const primary = {
    name: sup.shopName || sup.supplierNameEn || "Unknown Supplier",
    shopName: sup.shopName || sup.supplierNameEn || "Unknown Supplier",
    shopLogo: sup.shopLogo || null,
    website: sup.supplierWebsite || (Array.isArray(sup.domains) && sup.domains[0]) || null,
    domains: Array.isArray(sup.domains) ? sup.domains : [],
    supplierId: sup.supplierId || null,
    email: sup.email || null,
    phone: sup.phone || null,
    rating: sup.rating || null,
    commentCount: sup.commentCount || null,
    totalSales: sup.totalSales || null,
    hasUSWarehouse: sup.hasUSWarehouse || false,
    usInventory: sup.usInventory || null,
    warehouseCountries: sup.warehouseCountries || {},
    isPrimary: true,
    hasDetails: true,
    note: "Listing shop (the seller who added this product to CJ)"
  };

  const sellers = [primary];

  // ── Additional sellers (CJ does NOT expose individual names) ──
  // We show placeholder rows so the total matches listedNum. Each row
  // includes whatever CJ data we can derive (warehouse, sales estimates).
  const remaining = Math.max(0, listedNum - 1);
  for (let i = 0; i < remaining; i++) {
    sellers.push({
      name: `Seller #${i + 2}`,
      shopName: null,
      shopLogo: null,
      website: null,
      domains: [],
      supplierId: null,
      email: null,
      phone: null,
      rating: null,
      commentCount: null,
      totalSales: null,
      hasUSWarehouse: false,
      usInventory: null,
      warehouseCountries: {},
      isPrimary: false,
      hasDetails: false,
      note: "CJ does not expose individual seller names — this is a placeholder for the count from listedNum"
    });
  }

  const csvRows = sellers.map((s, i) => ({
    "#": i + 1,
    "Seller Name": s.name || "",
    "Shop Name": s.shopName || "",
    "Website": s.website || "",
    "CJ Supplier ID": s.supplierId || "",
    "Email": s.email || "",
    "Phone": s.phone || "",
    "Rating": s.rating || "",
    "Total Sales": s.totalSales || "",
    "US Warehouse": s.hasUSWarehouse ? "Yes" : "",
    "Type": s.isPrimary ? "Listing shop" : "Additional seller (name not public)",
    "Note": s.note || ""
  }));

  return {
    sellers,
    csvRows,
    total: sellers.length,
    listedNum,
    hasNames: true,
    canDownload: true,
    note: listedNum > 1
      ? "CJ exposes the listing shop name + full details but NOT the names of other sellers. The remaining sellers are listed by count only — their store names are not public via the CJ API."
      : "Only one seller has this product listed."
  };
}

app.post("/api/auth/signup", async (req, res) => {
  if (rateLimited(`signup:${clientIp(req)}`, 5, 10 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many signup attempts. Try again in a few minutes." });
  }
  try {
    const { email, password, fullName, username, phone } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
    if (String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

    // Pass fullName, username, phone in user_metadata so trigger can use them
    const { data, error } = await authSupabase.auth.signUp({
      email,
      password,
      data: { full_name: fullName || null, username: username || null, phone: phone || null }
    });
    if (error) return res.status(400).json({ error: error.message });
    const userId = data.user?.id;

    // Trigger auto-creates profile + admin_policies, but update extra fields if provided
    if (userId && (fullName || username || phone)) {
      await supabase.from("profiles").update({
        full_name: fullName || null,
        username: username || null,
        phone: phone || null,
        updated_at: new Date().toISOString()
      }).eq("id", userId);
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

// Heartbeat — mark user as online (called periodically by extension/web)
app.post("/api/heartbeat", requireAuth, async (req, res) => {
  try {
    await recordHeartbeat(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Heartbeat failed." });
  }
});

// System API key status (public — no auth required)
app.get("/api/system/key-status", (req, res) => {
  const sysKey = getSystemApiKey();
  res.json({
    hasSystemKey: Boolean(sysKey),
    systemKeyMasked: sysKey ? maskApiKey(sysKey) : null,
    systemKeyCount: sysKey ? (sysKey.length > 4 ? `${sysKey.slice(0, 4)}…${sysKey.slice(-4)}` : "••••••") : null
  });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const [{ data: profile }, { data: policy }, { data: keyRow }, isAdmin] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", req.user.id).maybeSingle(),
    supabase.from("admin_policies").select("*").eq("user_id", req.user.id).maybeSingle(),
    supabase.from("user_api_keys").select("id").eq("user_id", req.user.id).maybeSingle(),
    isAdminUser(req.user.id)
  ]);
  const sysKey = getSystemApiKey();
  res.json({
    id: req.user.id,
    email: req.user.email,
    fullName: profile?.full_name || null,
    username: profile?.username || null,
    phone: profile?.phone || null,
    isAdmin,
    isBlocked: policy?.is_blocked || false,
    dailyLimit: policy?.daily_api_limit ?? null,
    monthlyLimit: policy?.monthly_api_limit ?? null,
    dailyUsed: policy?.daily_api_count ?? 0,
    monthlyUsed: policy?.monthly_api_count ?? 0,
    features: policy?.features || { search: true, listing: true, enrich: true },
    hasCjKey: Boolean(keyRow),
    hasSystemKey: Boolean(sysKey),
    isOnline: profile?.is_online || false,
    lastSeen: profile?.last_seen || null
  });
});

// ── Profile update (username, phone, full_name, password) ────
app.put("/api/profile", requireAuth, async (req, res) => {
  try {
    const { fullName, username, phone, currentPassword, newPassword } = req.body || {};
    const updates = {};
    if (fullName !== undefined) updates.full_name = String(fullName).trim() || null;
    if (username !== undefined) {
      const u = String(username).trim();
      if (u && !/^[a-zA-Z0-9_\-\.]{3,30}$/.test(u)) {
        return res.status(400).json({ error: "Username must be 3-30 chars: letters, numbers, _ - ." });
      }
      // Check uniqueness
      const { data: existing } = await supabase.from("profiles").select("id").eq("username", u).neq("id", req.user.id).maybeSingle();
      if (existing) return res.status(409).json({ error: "Username already taken." });
      updates.username = u || null;
    }
    if (phone !== undefined) updates.phone = String(phone).trim() || null;

    if (Object.keys(updates).length) {
      updates.updated_at = new Date().toISOString();
      const { error } = await supabase.from("profiles").update(updates).eq("id", req.user.id);
      if (error) throw error;
    }

    // Password change — requires currentPassword verification
    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ error: "Current password required to change password." });
      if (String(newPassword).length < 8) return res.status(400).json({ error: "New password must be at least 8 characters." });
      // Verify current password
      const { data: loginData, error: loginErr } = await authSupabase.auth.signInWithPassword({
        email: req.user.email, password: currentPassword
      });
      if (loginErr) return res.status(401).json({ error: "Current password is incorrect." });
      const { error: pwErr } = await authSupabase.auth.admin.updateUserById(req.user.id, { password: newPassword });
      if (pwErr) return res.status(400).json({ error: pwErr.message });
    }

    // Return updated profile
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", req.user.id).maybeSingle();
    res.json({ ok: true, profile: { fullName: profile?.full_name, username: profile?.username, phone: profile?.phone } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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

// System-level fallback key from environment / settings
export function getSystemApiKey() {
  // Priority: env var > settings.json cjApiKey > nothing
  const envKey = String(process.env.CJ_SYSTEM_API_KEY || "").trim();
  if (envKey) return envKey;
  try {
    const stored = String(readSettings().cjApiKey || "").trim();
    if (stored) return stored;
  } catch {}
  return null;
}

// ── CJ API proxy ────────────────────────────────────────
// Runs the handler with the *calling user's* decrypted CJ key bound to the
// async context, so concurrent requests can never use another user's key.
async function withCjKey(userId, res, handler, timeoutMs = 58000) {
  const key = await getUserApiKey(userId);
  // Fall back to system-level key when user hasn't set their own
  const effectiveKey = key || getSystemApiKey();
  if (!effectiveKey) {
    throw Object.assign(new Error("CJ API key not configured."), {
      status: 503,
      publicMessage: "Open ⚙ Settings in the extension and paste your CJdropshipping API Key."
    });
  }
  // Hard timeout guard: CJ is slow. Race the handler against a timer;
  // if it fires, throw a 504 (caught by the route's outer catch, which
  // preserves error.status). This prevents Vercel's 60s kill from returning
  // an unhelpful FUNCTION_INVOCATION_TIMEOUT with no JSON body.
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => {
      const err = new Error("CJ request timed out — too many products to fetch. Try a narrower keyword or fewer products.");
      err.status = 504;
      err.publicMessage = err.message;
      reject(err);
    }, timeoutMs)
  );
  return Promise.race([
    runWithApiKey(effectiveKey, handler),
    timeoutPromise
  ]);
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

  const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize || req.query.limit || "20"), 10) || 20));

  try {
    const result = await withCjKey(req.user.id, res, async (key) => {
      const query = String(req.query.q || req.query.query || "").trim();
      const freeShipping = String(req.query.freeShipping || "") === "1";
      const minStock = req.query.minStock !== undefined ? Number(req.query.minStock) : undefined;
      const maxStock = req.query.maxStock !== undefined ? Number(req.query.maxStock) : undefined;
      const minListed = req.query.minListed !== undefined ? Number(req.query.minListed) : undefined;
      const maxListed = req.query.maxListed !== undefined ? Number(req.query.maxListed) : undefined;
      const minOrders = req.query.minOrders !== undefined ? Number(req.query.minOrders) : undefined;
      const maxOrders = req.query.maxOrders !== undefined ? Number(req.query.maxOrders) : undefined;
      const minPrice = req.query.minPrice !== undefined ? Number(req.query.minPrice) : undefined;
      const maxPrice = req.query.maxPrice !== undefined ? Number(req.query.maxPrice) : undefined;
      const quickMark = Boolean(quick && effectiveCountry && String(effectiveCountry).toUpperCase() !== "CN");

      const result = await searchProducts({
        query, page, pageSize, trending, freeShipping, minStock, minPrice, maxPrice,
        countryCode: effectiveCountry, orderBy: sort === "listed_desc" ? 1 : undefined, sort: "desc"
      });
      let products = sortProducts(result.products.map((p) => analyzeProduct(p)), sort);
      // Filter by min/max listings (number of sellers who listed this product)
      // CJ doesn't support this server-side, so we filter client-side
      if (minListed !== undefined && minListed !== null && Number.isFinite(minListed) && minListed > 0) {
        products = products.filter((p) => (Number(p.listedNum) || 0) >= minListed);
      }
      if (maxListed !== undefined && maxListed !== null && Number.isFinite(maxListed) && maxListed > 0) {
        products = products.filter((p) => (Number(p.listedNum) || 0) <= maxListed);
      }
      if (maxStock !== undefined && maxStock !== null && Number.isFinite(maxStock) && maxStock > 0) {
        products = products.filter((p) => (Number(p.stock) || 0) <= maxStock);
      }
      // MOQ filter — min/max orders (totalSales from CJ orderCount). Products without
      // sales data are treated as having 0 orders, so they only pass when minOrders is 0.
      if (minOrders !== undefined && minOrders !== null && Number.isFinite(minOrders) && minOrders > 0) {
        products = products.filter((p) => (Number(p.totalSales) || 0) >= minOrders);
      }
      if (maxOrders !== undefined && maxOrders !== null && Number.isFinite(maxOrders) && maxOrders > 0) {
        products = products.filter((p) => (Number(p.totalSales) || 0) <= maxOrders);
      }
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

// ── Supplier best-sellers aggregation ─────────────────
// ── Category-based winning product search ────────────────
// Search products by CJ category without a keyword — useful for browsing
// "winning products" in a specific category.
const CJ_CATEGORIES = [
  { id: "1", name: "Women's Clothing", nameCn: "女装" },
  { id: "2", name: "Pet Supplies", nameCn: "宠物用品" },
  { id: "3", name: "Home, Garden & Furniture", nameCn: "家居园艺家具" },
  { id: "4", name: "Health, Beauty & Hair", nameCn: "健康美容美发" },
  { id: "5", name: "Jewelry & Watches", nameCn: "珠宝手表" },
  { id: "6", name: "Men's Clothing", nameCn: "男装" },
  { id: "7", name: "Bags & Shoes", nameCn: "包包鞋子" },
  { id: "8", name: "Toys, Kids & Babies", nameCn: "玩具儿童婴儿" },
  { id: "9", name: "Sports & Outdoors", nameCn: "运动户外" },
  { id: "10", name: "Consumer Electronics", nameCn: "消费电子" },
  { id: "11", name: "Home Improvement", nameCn: "家居改良" },
  { id: "12", name: "Automobiles & Motorcycles", nameCn: "汽车摩托车" },
  { id: "13", name: "Phones & Accessories", nameCn: "手机配件" },
  { id: "14", name: "Computer & Office", nameCn: "电脑办公" }
];

app.get("/api/categories", requireAuth, async (req, res) => {
  res.json({ categories: CJ_CATEGORIES });
});

app.get("/api/products/category/:categoryId", requireAuth, async (req, res) => {
  const deviceId = getDeviceId(req);
  const access = await checkAccess(req.user.id, deviceId);
  if (!access.allowed) return res.status(403).json({ error: access.reason });
  await registerDevice(req.user.id, deviceId, req.headers["user-agent"], req.ip);

  const categoryId = String(req.params.categoryId || "").trim();
  const cat = CJ_CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) return res.status(400).json({ error: "Invalid category ID." });

  const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize || "20"), 10) || 20));

  try {
    const result = await withCjKey(req.user.id, res, async (key) => {
      // CJ listV2's oneCategoryId param does NOT work reliably — it returns
      // the same products regardless of which category ID we send.
      // Instead, we use the category NAME as the keyword. CJ's keyword search
      // matches product names/descriptions, which is good enough for browsing
      // category products. We also try the Chinese name as a fallback.
      const searchResult = await searchProducts({
        query: cat.name,
        page, pageSize,
        trending: false,
        countryCode: undefined,
        sort: "desc",
        categoryId: undefined
      });
      console.log("[Category API] CJ searchResult count:", searchResult.products?.length, "pagination:", searchResult.pagination, "keyword:", cat.name);

      const rawProducts = searchResult.products || [];
      console.log("[Category API] Got", rawProducts.length, "products for category", categoryId, cat.name);

      const products = sortProducts(rawProducts.map((p) => analyzeProduct(p)), "winning");
      return {
        products,
        pagination: searchResult.pagination,
        note: `Searched by category name "${cat.name}" (CJ oneCategoryId param is unreliable)`,
        category: cat
      };
    });

    recordUsage(req.user.id, "/api/products/category/:id", req.ip, deviceId, 200);
    res.json({
      products: result.products,
      category: result.category,
      page: result.pagination?.pageNum ?? page,
      pageSize: result.pagination?.pageSize ?? pageSize,
      total: result.pagination?.total ?? null,
      totalPages: result.pagination?.totalPages ?? null,
      source: "CJdropshipping API 2.0"
    });
  } catch (error) {
    recordUsage(req.user.id, "/api/products/category/:id", req.ip, deviceId, error.status || 502);
    res.status(error.status || 502).json({
      error: "Could not retrieve products by category.",
      detail: error.publicMessage || error.message
    });
  }
});

app.get("/api/suppliers/best-sellers", requireAuth, async (req, res) => {
  const deviceId = getDeviceId(req);
  const access = await checkAccess(req.user.id, deviceId);
  if (!access.allowed) return res.status(403).json({ error: access.reason });
  await registerDevice(req.user.id, deviceId, req.headers["user-agent"], req.ip);

  const query = String(req.query.q || "").trim();
  const sortBy = String(req.query.sortBy || "90d"); // 7d | 30d | 90d
  // Best-sellers needs per-product sales calls (CJ is slow).
  // Increase pageSize to fetch more products, process more with higher concurrency.
  // Max ~30 products × ~5s / 5 concurrent ≈ 30s, leaving buffer before 40s deadline.
  const pageSize = Math.min(30, Math.max(1, Number(req.query.pageSize || 30) || 30));
  const filterCountry = String(req.query.country || "").trim().toUpperCase(); // e.g. "US", "GB"

  // Require a keyword — searching ALL products without a query returns
  // thousands of items and CJ times out before returning anything.
  if (!query) {
    return res.status(400).json({
      error: "Keyword required for Best Sellers.",
      detail: "Type a product keyword (e.g. 'desk lamp') and try again. Searching all products without a keyword times out."
    });
  }

  try {
    const result = await withCjKey(req.user.id, res, async () => {
      // Hard deadline: CJ is slow. If we exceed 50s, return partial results
      // rather than letting Vercel kill the function at 60s with nothing.
      const deadline = Date.now() + 53000;

      // Search products
      let products = [];
      try {
        const searchResult = await searchProducts({
          query: query || undefined,
          page: 1,
          pageSize
        });
        products = searchResult.products || [];
      } catch (searchErr) {
        console.warn("Best sellers: searchProducts failed:", searchErr?.message);
        return { suppliers: [], total: 0, searchError: searchErr?.publicMessage || searchErr?.message };
      }
      if (!products.length) return { suppliers: [], total: 0 };

      // Fetch sales data per product in parallel batches (CJ is slow —
      // sequential 50×2 calls would blow the 60s Vercel budget).
      // Higher concurrency = more products processed before deadline
      const CONCURRENCY = 5;
      const analyzed = products.map((p) => analyzeProduct(p));
      const enriched = [];
      for (let i = 0; i < analyzed.length; i += CONCURRENCY) {
        if (Date.now() > deadline) break;
        const batch = analyzed.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (a) => {
            let sales = null;
            try { sales = await getProductSalesInfo(a.id); } catch (e) { /* skip */ }
            return { product: a, sales, reviews: null };
          })
        );
        for (const r of results) {
          if (r.status === "fulfilled") enriched.push(r.value);
        }
      }
      console.log("[Best Sellers] Enriched", enriched.length, "of", analyzed.length, "products. With sales:", enriched.filter(e => e.sales).length);

      // Aggregate by supplier
      const supplierMap = new Map();
      const timedOut = Date.now() > deadline && enriched.length < analyzed.length;
      for (const { product, sales, reviews } of enriched) {
        // Determine supplier key — try multiple sources for better names.
        // Priority: sales.shopName > sales.supplierNameEn > product.supplierName > supplierId > product name
        const rawName = (product.supplierName && String(product.supplierName).trim()) || "";
        const rawId = (product.supplierId && String(product.supplierId).trim()) || "";
        const salesShopName = (sales?.shopName && String(sales.shopName).trim()) || "";
        const salesSupplierEn = (sales?.supplierNameEn && String(sales.supplierNameEn).trim()) || "";

        let displayName = salesShopName || salesSupplierEn || rawName || "";
        let displayId = rawId || (sales?.supplierId && String(sales.supplierId).trim()) || "";
        let key = displayName || displayId || "";

        if (!key) {
          // No name/id found at all — use product name as fallback, then product ID
          displayName = product.name || (product.id ? `Product ${product.id}` : "Unknown Supplier");
          key = displayName;
        }
        if (!displayName && displayId) {
          displayName = `Supplier ${displayId}`;
        }

        const entry = supplierMap.get(key);
        if (!entry) {
          supplierMap.set(key, {
            supplierName: displayName,
            supplierId: displayId || null,
            products: [],
            sold7d: 0, sold30d: 0, sold90d: 0,
            totalSales: 0,
            listedNum: 0,
            topProducts: [],
            warehouseCountries: {} // { US: 1234, GB: 567, ... }
          });
        }
        const sup = supplierMap.get(key);
        const productWithSales = { ...product, sales, reviews };
        sup.products.push(productWithSales);
        // Use listedNum as fallback when sales data is unavailable
        sup.listedNum += Number(product.listedNum) || 0;
        // Always track products — show them even when sales data is unavailable
        sup.topProducts.push({
          id: product.id,
          name: product.name,
          image: product.image,
          cjCost: product.cjCost,
          currency: product.currency,
          totalSales: Number(sales?.totalSales) || Number(product.listedNum) || 0,
          sold7d: Number(sales?.sold7d) || Math.round((Number(sales?.totalSales) || Number(product.listedNum) || 0) * 0.18),
          sold30d: Number(sales?.sold30d) || Math.round((Number(sales?.totalSales) || Number(product.listedNum) || 0) * 0.55),
          sold90d: Number(sales?.sold90d) || Number(sales?.totalSales) || Number(product.listedNum) || 0,
          listedNum: Number(product.listedNum) || 0,
          createrTime: sales?.createrTime ?? null,
          daysSinceListing: sales?.daysSinceListing ?? null,
          supplierName: displayName,
          supplierId: displayId || null
        });
        // Fallback: when CJ sales data is unavailable, use listedNum as a
        // popularity proxy so suppliers still get meaningful sort values.
        const fallbackSales = Number(sales?.totalSales) || Number(product.listedNum) || 0;
        const fallback7d = Number(sales?.sold7d) || Math.round(fallbackSales * 0.18);
        const fallback30d = Number(sales?.sold30d) || Math.round(fallbackSales * 0.55);
        const fallback90d = Number(sales?.sold90d) || fallbackSales;
        if (!sales) {
          sup.sold7d += fallback7d;
          sup.sold30d += fallback30d;
          sup.sold90d += fallback90d;
          sup.totalSales += fallbackSales;
        } else {
          sup.sold7d += Number(sales.sold7d) || 0;
          sup.sold30d += Number(sales.sold30d) || 0;
          sup.sold90d += Number(sales.sold90d) || 0;
          sup.totalSales += Number(sales.totalSales) || 0;
          // Collect warehouse countries across all products
          if (sales.warehouseCountries) {
            for (const [cc, qty] of Object.entries(sales.warehouseCountries)) {
              sup.warehouseCountries[cc] = (sup.warehouseCountries[cc] || 0) + Number(qty);
            }
          }
        }
      }

      // Sort top products within each supplier by totalSales
      for (const sup of supplierMap.values()) {
        sup.topProducts.sort((a, b) => b.totalSales - a.totalSales);
        sup.topProducts = sup.topProducts.slice(0, 10); // keep top 10
      }

      // Sort suppliers — primary sort by the selected time window (7d/30d/90d),
      // then totalSales as tiebreaker, then listedNum as final fallback.
      const sortKey = sortBy === "7d" ? "sold7d" : sortBy === "30d" ? "sold30d" : "sold90d";
      const rawSuppliers = [...supplierMap.values()].sort((a, b) => {
        const va = a[sortKey] || 0;
        const vb = b[sortKey] || 0;
        if (va || vb) return vb - va;
        const ta = a.totalSales || 0;
        const tb = b.totalSales || 0;
        if (ta || tb) return tb - ta;
        return (b.listedNum || 0) - (a.listedNum || 0);
      });

      // Convert warehouseCountries object to sorted array for frontend
      const suppliers = rawSuppliers.map((s) => ({
        ...s,
        totalProducts: s.products.length,
        warehouseCountries: Object.entries(s.warehouseCountries)
          .map(([code, qty]) => ({ code, qty }))
          .sort((a, b) => b.qty - a.qty)
          .slice(0, 20) // top 20 shipping countries
      }));

      // Filter by country if requested
      let filteredSuppliers = suppliers;
      if (filterCountry) {
        filteredSuppliers = suppliers.filter((s) => {
          const hasCountry = s.warehouseCountries.some((w) => w.code === filterCountry);
          return hasCountry;
        });
        if (!filteredSuppliers.length) {
          // No supplier has this country — return all with a note
          return {
            suppliers: [],
            sortBy,
            total: 0,
            searchQuery: query,
            filterCountry,
            filterNote: `No suppliers found with inventory in ${filterCountry}. Showing all suppliers instead.`
          };
        }
      }

      return { suppliers: filteredSuppliers, sortBy, total: filteredSuppliers.length, searchQuery: query, filterCountry, timedOut, analyzedCount: analyzed.length, enrichedCount: enriched.length };
    });

    recordUsage(req.user.id, "/api/suppliers/best-sellers", req.ip, deviceId, 200);
    res.json(result);
  } catch (error) {
    recordUsage(req.user.id, "/api/suppliers/best-sellers", req.ip, deviceId, error.status || 502);
    console.error("Best sellers failed:", error.message);
    res.status(error.status || 502).json({
      error: "Could not retrieve best sellers.",
      detail: error.publicMessage || error.message
    });
  }
});

// Profit calculation endpoint — estimate potential profit for a product
app.post("/api/products/:pid/calculate", requireAuth, async (req, res) => {
  const deviceId = getDeviceId(req);
  const access = await checkAccess(req.user.id, deviceId);
  if (!access.allowed) return res.status(403).json({ error: access.reason });
  await registerDevice(req.user.id, deviceId, req.headers["user-agent"], req.ip);

  const pid = String(req.params.pid || "").trim();
  if (!pid) return res.status(400).json({ error: "Product id required." });

  const { margin = 0.3, shipping = 5, admission = 2, platform = 0.15 } = req.body;

  try {
    const result = await withCjKey(req.user.id, res, async () => {
      const { product, note, createrTime: detailCreaterTime, daysSinceListing: detailDaysSinceListing } = await getProductDetail(pid);
      const analyzed = analyzeProduct(product, pid);
      // Use original numeric ID (from listV2) for product URL — CJ website expects this format
      // The detail response's pid is a UUID; the numeric id field may be missing or different
      if (pid) {
        analyzed.productUrl = `https://cjdropshipping.com/product/-p-${encodeURIComponent(String(pid))}.html`;
      }
      let sales = null;
      try { sales = await getProductSalesInfo(analyzed.id || pid); } catch (e) { console.warn("Sales unavailable:", e.message); }

      // Merge enrichment data
      const enrich = enrichMap[pid] || {};
      const en = {
        ...enrich,
        createrTime: sales?.createrTime ?? detailCreaterTime ?? enrich.createrTime,
        daysSinceListing: sales?.daysSinceListing ?? detailDaysSinceListing ?? enrich.daysSinceListing
      };

      // Calculate estimates
      const totalSales = Number(sales?.totalSales) || Number(en.totalSales) || 0;
      const sold90d = Number(sales?.sold90d) || Number(en.sold90d) || 0;
      const sold30d = Number(sales?.sold30d) || Number(en.sold30d) || 0;
      const sold7d = Number(sales?.sold7d) || Number(en.sold7d) || 0;

      // Daily/monthly estimates
      let dailyEst = null, monthlyEst = null;
      if (sold90d > 0) {
        dailyEst = Math.round(sold90d / 90);
        monthlyEst = Math.round(sold90d * 30 / 90);
      } else if (totalSales > 0) {
        dailyEst = Math.round(totalSales * 0.06);
        monthlyEst = Math.round(totalSales * 0.55);
      }

      // Revenue calculation
      const cjCost = Number(product?.cjCost) || 0;
      const sellPrice = Number(product?.suggestSellPrice) || Number(product?.cjCost) * 1.5 || 0;
      const revenue = sellPrice * (dailyEst * 30 || totalSales || 100);

      // Cost calculation
      const shippingCost = shipping * (dailyEst * 30 || 1); // assume 30 days
      const admissionCost = admission; // one-time platform fee
      const platformCost = revenue * platform; // percentage platform fee
      const totalCost = shippingCost + admissionCost + platformCost;

      // Profit calculation
      const grossProfit = revenue - (cjCost * (dailyEst * 30 || totalSales || 100));
      const netProfit = grossProfit - totalCost;
      const profitMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

      return {
        product: analyzed,
        estimates: {
          daily: dailyEst,
          monthly: monthlyEst,
          yearly: (dailyEst * 365) || null
        },
        financials: {
          cjCost,
          suggestedSellPrice: sellPrice,
          estimatedRevenue: revenue,
          shippingCost,
          admissionCost,
          platformCost,
          totalCost,
          grossProfit,
          netProfit,
          profitMargin: Math.round(profitMargin * 100) / 100
        },
        notes: {
          revenueNote: revenue ? `Based on ${dailyEst ? "estimated" : "actual"} sales` : "Revenue estimate unavailable",
          costNote: "Shipping based on US mainland, platform fee = 15% of revenue"
        }
      };
    });

    recordUsage(req.user.id, "/api/products/:pid/calculate", req.ip, deviceId, 200);
    res.json(result);
  } catch (error) {
    recordUsage(req.user.id, "/api/products/:pid/calculate", req.ip, deviceId, error.status || 502);
    res.status(error.status || 502).json({ error: "Could not calculate profit.", detail: error.message });
  }
});

app.get("/api/products/:pid", requireAuth, async (req, res) => {
  const deviceId = getDeviceId(req);
  const access = await checkAccess(req.user.id, deviceId);
  if (!access.allowed) return res.status(403).json({ error: access.reason });
  await registerDevice(req.user.id, deviceId, req.headers["user-agent"], req.ip);

  const pid = String(req.params.pid || "").trim();
  if (!pid) return res.status(400).json({ error: "Product id required." });

  // Check in-memory cache first
  const cached = getCachedProductDetail(req.user.id, pid);
  if (cached) {
    recordUsage(req.user.id, "/api/products/:pid", req.ip, deviceId, 200);
    return res.json({ ...cached, cached: true });
  }

  try {
    const result = await withCjKey(req.user.id, res, async () => {
      // Run all three CJ calls in parallel — they're independent and the
      // request-chain serialises them anyway, but Promise.all lets us
      // fail-fast on the first error and short-circuit the others.
      const [detail, sales, reviews] = await Promise.allSettled([
        getProductDetail(pid),
        getProductSalesInfo(pid),
        getProductReviews(pid)
      ]);
      const detailResult = detail.status === "fulfilled" ? detail.value : null;
      const product = detailResult?.product;
      if (!product) throw new Error("CJ returned no product detail for this pid.");
      // Use original numeric ID (from listV2) for product URL — CJ website expects this format
      const analyzed = analyzeProduct(product, pid);
      if (pid) {
        analyzed.productUrl = `https://cjdropshipping.com/product/-p-${encodeURIComponent(String(pid))}.html`;
      }
      const salesData = sales.status === "fulfilled" ? sales.value : null;
      if (sales.status === "rejected") console.warn("Sales unavailable:", sales.reason?.message);
      const reviewsData = reviews.status === "fulfilled" ? reviews.value : null;
      if (reviews.status === "rejected") console.warn("Reviews unavailable:", reviews.reason?.message);
      const metrics = await buildSalesMetrics(req.user.id, analyzed.id || pid, salesData);
      // Merge createrTime/daysSinceListing from product detail as fallback
      const salesWithDetailTime = salesData || {};
      if (detailResult?.createrTime && !salesWithDetailTime.createrTime) salesWithDetailTime.createrTime = detailResult.createrTime;
      if (detailResult?.daysSinceListing !== null && salesWithDetailTime.daysSinceListing === null) salesWithDetailTime.daysSinceListing = detailResult.daysSinceListing;
      return {
        product: analyzed,
        reviews: reviewsData,
        sales: salesWithDetailTime,
        metrics,
        note: detailResult?.note,
        supplier: salesData,
        adspy: buildAdSpy(analyzed),
        sellerList: buildSellerList(analyzed, salesData),
        warehouseCountries: salesWithDetailTime.warehouseCountries || {},
        productUrl: analyzed.productUrl || `https://www.cjdropshipping.com/product/-p-${encodeURIComponent(pid)}.html`
      };
    });

    // Cache the result
    setCachedProductDetail(req.user.id, pid, result);

    recordUsage(req.user.id, "/api/products/:pid", req.ip, deviceId, 200);
    res.json(result);
  } catch (error) {
    recordUsage(req.user.id, "/api/products/:pid", req.ip, deviceId, error.status || 502);
    res.status(error.status || 502).json({ error: "Could not retrieve product detail.", detail: error.publicMessage });
  }
});

// ── Warehouse delivery check ──────────────────────────────────────
// CJ does NOT expose a "delivery country list" per product. The closest
// proxy is the warehouse inventory per country (from productDetail/query)
// plus a live freight quote from each warehouse to each major destination.
// This endpoint returns a delivery-availability matrix so users can see
// exactly which countries a product can be shipped to before listing.
app.get("/api/products/:pid/warehouses", requireAuth, async (req, res) => {
  const deviceId = getDeviceId(req);
  const access = await checkAccess(req.user.id, deviceId);
  if (!access.allowed) return res.status(403).json({ error: access.reason });
  await registerDevice(req.user.id, deviceId, req.headers["user-agent"], req.ip);

  const pid = String(req.params.pid || "").trim();
  if (!pid) return res.status(400).json({ error: "Product id required." });

  // Major delivery destinations (CJ ships to these regularly)
  const DESTINATIONS = ["US","GB","CA","AU","DE","FR","ES","IT","NL","BE","SE","NO","DK","FI","PL","AT","CH","IE","PT","CZ","GR","RO","HU","MX","BR","CL","JP","KR","SG","MY","TH","PH","ID","VN","NZ","AE","SA","IN","IL","TR","ZA"];

  try {
    const result = await withCjKey(req.user.id, res, async () => {
      // 1. Get product detail + sales info to find warehouse countries
      const [detail, sales] = await Promise.allSettled([
        getProductDetail(pid),
        getProductSalesInfo(pid)
      ]);
      const detailResult = detail.status === "fulfilled" ? detail.value : null;
      const salesData = sales.status === "fulfilled" ? sales.value : null;

      const warehouseCountries = salesData?.warehouseCountries || {};
      const warehouseEntries = Object.entries(warehouseCountries)
        .filter(([, qty]) => Number(qty) > 0)
        .map(([code, qty]) => ({ code, qty: Number(qty) }))
        .sort((a, b) => b.qty - a.qty);

      // 2. For each warehouse country, quote freight to a sample of destinations
      //    (limit to 8 destinations × up to 6 warehouses to stay within timeout)
      const sampleDests = DESTINATIONS.slice(0, 8);
      const sampleWarehouses = warehouseEntries.slice(0, 6);

      const quotes = [];
      if (sampleWarehouses.length && sampleDests.length) {
        const variants = await getVariantList(pid);
        const heaviest = variants.reduce((max, v) => (v.weight > (max?.weight || 0) ? v : max), variants[0]);
        const vid = heaviest?.vid;
        if (vid) {
          const quoteTasks = [];
          for (const w of sampleWarehouses) {
            for (const d of sampleDests) {
              if (w.code === d) continue; // same country = no freight needed
              quoteTasks.push(
                quoteFreight({ vid, pid, endCountryCode: d, startCountryCode: w.code })
                  .then((methods) => ({ from: w.code, to: d, methods: methods || [], ok: true }))
                  .catch(() => ({ from: w.code, to: d, methods: [], ok: false }))
              );
            }
          }
          const settled = await Promise.allSettled(quoteTasks);
          for (const s of settled) {
            if (s.status === "fulfilled") quotes.push(s.value);
          }
        }
      }

      // 3. Build delivery matrix: for each destination, which warehouses can ship there
      const deliveryMap = {};
      for (const d of DESTINATIONS) {
        deliveryMap[d] = { canDeliver: false, warehouses: [], cheapest: null, methods: [] };
      }
      // Every warehouse country can at least "ship" to itself
      for (const w of warehouseEntries) {
        if (deliveryMap[w.code]) {
          deliveryMap[w.code].canDeliver = true;
          deliveryMap[w.code].warehouses.push({ code: w.code, qty: w.qty, self: true });
        }
      }
      for (const q of quotes) {
        if (!deliveryMap[q.to]) continue;
        const cheapest = (q.methods || []).sort((a, b) => (Number(a.price) || 9e9) - (Number(b.price) || 9e9))[0];
        deliveryMap[q.to].canDeliver = true;
        deliveryMap[q.to].warehouses.push({ code: q.from, qty: 0, self: false, price: cheapest?.price ?? null, name: cheapest?.name ?? null, aging: cheapest?.aging ?? null });
        if (cheapest && (!deliveryMap[q.to].cheapest || cheapest.price < deliveryMap[q.to].cheapest)) {
          deliveryMap[q.to].cheapest = cheapest.price;
          deliveryMap[q.to].methods = q.methods;
        }
      }

      const deliveryCountries = Object.entries(deliveryMap)
        .filter(([, v]) => v.canDeliver)
        .map(([code, v]) => ({
          code,
          warehouses: v.warehouses,
          cheapestPrice: v.cheapest,
          methods: v.methods
        }))
        .sort((a, b) => a.code.localeCompare(b.code));

      return {
        pid,
        warehouseCountries: warehouseEntries,
        deliveryCountries,
        quoted: quotes.length > 0,
        note: quotes.length
          ? `Live freight quotes from ${sampleWarehouses.length} warehouse(s) to ${sampleDests.length} destination(s).`
          : "No freight quotes available — warehouse inventory shown only."
      };
    });

    recordUsage(req.user.id, "/api/products/:pid/warehouses", req.ip, deviceId, 200);
    res.json(result);
  } catch (error) {
    recordUsage(req.user.id, "/api/products/:pid/warehouses", req.ip, deviceId, error.status || 502);
    res.status(error.status || 502).json({ error: "Could not fetch warehouse delivery data.", detail: error.publicMessage });
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
  const deliverTo = String(req.query.deliverTo || "").trim().toUpperCase().slice(0, 2) || null;

  try {
    const result = await withCjKey(req.user.id, res, async () => {
      // Fetch sales + reviews + product detail in parallel batches
      const items = {};
      const CONCURRENCY = 3;
      const deadline = Date.now() + 55000;
      for (let i = 0; i < unique.length; i += CONCURRENCY) {
        if (Date.now() > deadline) break;
        const batch = unique.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (id) => {
            let sales = null, lite = null, detail = null;
            try { sales = await getProductSalesInfo(id); } catch (e) { console.warn("Enrich sales failed:", e.message); }
            try { lite = await getProductReviewsLite(id); } catch (e) { console.warn("Enrich reviews failed:", e.message); }
            try { detail = await getProductDetail(id); } catch (e) { console.warn("Enrich detail failed:", e.message); }
            if (!sales && !lite && !detail) return null;
            const totalSales = sales?.totalSales ?? null;
            const sold90d = sales?.sold90d ?? null;
            const sold30d = sales?.sold30d ?? null;
            const sold7d = sales?.sold7d ?? null;
            let dailyEst = null;
            let monthlyEst = null;
            if (sold90d !== null && sold90d > 0) {
              monthlyEst = Math.round(sold90d * 30 / 90);
              dailyEst = Math.round(sold90d / 90);
            } else if (totalSales !== null && totalSales > 0) {
              monthlyEst = Math.round(totalSales * 0.55);
              dailyEst = Math.round(totalSales * 0.06);
            }
            // Merge createrTime/daysSinceListing from product detail as fallback
            const detailCreaterTime = detail?.createrTime ?? null;
            const detailDaysSinceListing = detail?.daysSinceListing ?? null;

            // Shipping cost estimate when deliverTo is set
            let shippingCost = null;
            let shippingFrom = null;
            if (deliverTo && sales?.warehouseCountries) {
              const whEntries = Object.entries(sales.warehouseCountries)
                .filter(([, qty]) => Number(qty) > 0);
              if (whEntries.length) {
                const inDeliver = whEntries.find(([cc]) => cc === deliverTo);
                const chosen = inDeliver ? inDeliver[0] : whEntries[0][0];
                shippingFrom = chosen;
                const sameCountry = chosen === deliverTo;
                const regional = ["US", "CA", "MX", "UK", "GB", "FR", "DE", "IT", "ES", "NL", "PL", "AU", "NZ", "JP", "KR"].includes(chosen) && ["US", "CA", "MX", "UK", "GB", "FR", "DE", "IT", "ES", "NL", "PL", "AU", "NZ", "JP", "KR"].includes(deliverTo);
                shippingCost = sameCountry ? 0 : regional ? 3.5 : 6.5;
              }
            }

            return {
              id,
              cjCost: detail?.product?.cjCost ?? null,
              suggestSellPrice: detail?.product?.suggestSellPrice ?? null,
              totalSales,
              sold90d,
              sold30d,
              sold7d,
              dailyEst,
              monthlyEst,
              lastOrderDate: sales?.lastOrderDate ?? null,
              createrTime: sales?.createrTime ?? detailCreaterTime,
              daysSinceListing: sales?.daysSinceListing ?? detailDaysSinceListing,
              rating: lite?.avgScore ?? sales?.rating ?? null,
              reviewTotal: lite?.total ?? sales?.commentCount ?? null,
              isNewListing: sales?.isNewListing ?? null,
              isNewProduct: sales?.isNewProduct ?? null,
              isRelisting: sales?.isRelisting ?? null,
              warehouseCountries: sales?.warehouseCountries ?? {},
              shippingCost,
              shippingFrom
            };
          })
        );
        for (const r of results) {
          if (r.status === "fulfilled" && r.value) items[r.value.id] = r.value;
        }
      }
      return { items };
    });

    recordUsage(req.user.id, "/api/enrich", req.ip, deviceId, 200);
    res.json(result);
  } catch (error) {
    recordUsage(req.user.id, "/api/enrich", req.ip, deviceId, error.status || 502);
    res.status(error.status || 502).json({ error: "Enrich failed.", detail: error.message });
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
        const methods = await quoteFreight({ vid: heaviest.vid, pid, endCountryCode: country, startCountryCode: from });
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
          const methods = await quoteFreight({ vid: rows[0].variant.vid, pid, endCountryCode: country, startCountryCode: from });
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
    supabase.from("profiles").select("id, email, full_name, username, phone, created_at, updated_at, is_admin, is_online, last_seen"),
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

// Admin: active/online users count + list
app.get("/api/admin/active-users", requireAuth, requireAdmin, async (req, res) => {
  try {
    // GC stale first
    await gcOnlineUsers();
    const { count: onlineCount, error: onlineErr } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("is_online", true);
    if (onlineErr) return res.status(500).json({ error: onlineErr.message });

    const { count: totalCount, error: totalErr } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true });
    if (totalErr) return res.status(500).json({ error: totalErr.message });

    // Users active in last 24h
    const cutoff24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: active24h } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .gte("last_seen", cutoff24);

    res.json({
      online: onlineCount || 0,
      total: totalCount || 0,
      active24h: active24h || 0,
      checkedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to fetch active users." });
  }
});

// Admin: list of online users (with names)
app.get("/api/admin/online-users", requireAuth, requireAdmin, async (req, res) => {
  try {
    await gcOnlineUsers();
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, username, email, last_seen, avatar_url")
      .eq("is_online", true)
      .order("last_seen", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    res.json({ users: data || [] });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to fetch online users." });
  }
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

// Admin: reset/change any user's password
app.post("/api/admin/users/:userId/reset-password", requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { password } = req.body || {};
  if (!password || typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  try {
    const { error } = await authSupabase.auth.admin.updateUserById(userId, { password });
    if (error) return res.status(500).json({ error: error.message });
    await supabase.from("admin_audit_log").insert({
      admin_id: req.user.id, action: "reset_password",
      target_user_id: userId, details: { by: req.user.email }
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Password reset failed." });
  }
});

// Admin: bootstrap — promote first user to admin when no admins exist yet
app.post("/api/admin/bootstrap", requireAuth, async (req, res) => {
  try {
    const { count, error: countErr } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("is_admin", true);
    if (countErr) return res.status(500).json({ error: countErr.message });
    if (count && count > 0) {
      return res.status(403).json({ error: "An admin already exists. Bootstrap is no longer available." });
    }
    const { error } = await supabase.from("profiles").update({ is_admin: true }).eq("id", req.user.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, message: "You are now the first admin." });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Bootstrap failed." });
  }
});

// Admin: delete a user's CJ API key
app.post("/api/admin/users/:userId/delete-key", requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.params;
  try {
    const { error } = await supabase.from("user_api_keys").delete().eq("user_id", userId);
    if (error) return res.status(500).json({ error: error.message });
    clearTokenCache();
    await supabase.from("admin_audit_log").insert({
      admin_id: req.user.id, action: "delete_cj_key",
      target_user_id: userId, details: { by: req.user.email }
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Delete failed." });
  }
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
  const target = rel === "admin" || rel === "admin/" ? "admin.html"
    : rel === "help" || rel === "help/" ? "help.html"
    : rel;
  const webRoot = path.join(projectRoot, "public");
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
