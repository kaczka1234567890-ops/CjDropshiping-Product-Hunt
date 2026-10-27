const API = "/api";
const TOKEN_KEY = "cj_ph_token";

let token = localStorage.getItem(TOKEN_KEY) || "";
let currentUser = null;
let usagePage = 1;
let emailCache = new Map();

// ── Helpers ──────────────────────────────────────────────
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

// Every request carries the session token; a 401 sends the visitor to sign in.
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = "/";
    throw new Error("Session expired");
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

function userName(id) {
  if (!id) return "—";
  return emailCache.get(id) || `${String(id).slice(0, 8)}…`;
}

// ── Auth ─────────────────────────────────────────────────
async function checkAuth() {
  if (!token) { window.location.href = "/"; return null; }
  try {
    const user = await api("/auth/me");
    currentUser = user;
    if (!user.isAdmin) throw new Error("Admin access required");
    const statusEl = document.getElementById("status");
    statusEl.textContent = user.email;
    statusEl.style.color = "#16a34a";
    return user;
  } catch {
    document.getElementById("status").textContent = "Access denied";
    document.getElementById("status").style.color = "#dc2626";
    setTimeout(() => { window.location.href = "/"; }, 1200);
    return null;
  }
}

document.getElementById("logoutBtn").addEventListener("click", async () => {
  try { await api("/auth/logout", { method: "POST" }); } catch { /* ignore */ }
  localStorage.removeItem(TOKEN_KEY);
  window.location.href = "/";
});

// ── Tabs ─────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.add("hidden"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.remove("hidden");
    if (tab.dataset.tab === "users") loadUsers();
    if (tab.dataset.tab === "usage") loadUsage();
    if (tab.dataset.tab === "settings") loadSettings();
  });
});

// ── Users ────────────────────────────────────────────────
async function loadUsers() {
  const list = document.getElementById("userList");
  try {
    const { users } = await api("/admin/users");
    emailCache = new Map((users || []).map((u) => [u.id, u.email]));
    if (!users.length) {
      list.innerHTML = '<p class="message">No users yet. Users appear here after they sign up in the extension.</p>';
      return;
    }
    list.innerHTML = users.map((u) => {
      const p = u.policy || {};
      const daily = p.daily_api_limit ?? null;
      const monthly = p.monthly_api_limit ?? null;
      return `
        <div class="user-row">
          <div class="user-avatar">${esc(((u.full_name || u.email || "?")[0] || "?").toUpperCase())}</div>
          <div class="user-info">
            <div class="user-email">${esc(u.email)}${u.full_name ? ` — ${esc(u.full_name)}` : ""}</div>
            <div class="user-meta">
              ${p.is_blocked ? '<span class="user-badge badge-blocked">Blocked</span> ' : '<span class="user-badge badge-ok">Active</span> '}
              ${u.isAdmin ? '<span class="user-badge badge-admin">Admin</span> ' : ""}
              ${u.hasCjKey ? "" : '<span class="user-badge badge-blocked">No API key</span> '}
              · Joined ${new Date(u.created_at).toLocaleDateString()}
              ${daily !== null ? ` · Daily ${p.daily_api_count ?? 0}/${daily}` : ""}
              ${monthly !== null ? ` · Monthly ${p.monthly_api_count ?? 0}/${monthly}` : ""}
              ${u.devices && u.devices.length ? ` · ${u.devices.length} device(s)` : ""}
            </div>
          </div>
          <div class="user-actions">
            <button class="btn-sm ${p.is_blocked ? "btn-success" : "btn-danger"}" data-action="block" data-id="${esc(u.id)}">${p.is_blocked ? "Unblock" : "Block"}</button>
            <button class="btn-sm btn-secondary" data-action="detail" data-id="${esc(u.id)}">Details</button>
          </div>
        </div>`;
    }).join("");

    list.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.action === "block") toggleBlock(btn.dataset.id);
        else openUserDetail(btn.dataset.id);
      });
    });
  } catch (error) {
    list.innerHTML = `<p class="message error">${esc(error.message)}</p>`;
  }
}

async function toggleBlock(userId) {
  try {
    const { users } = await api("/admin/users");
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    const blocked = !(user.policy && user.policy.is_blocked);
    await api(`/admin/users/${userId}/block`, { method: "POST", body: { blocked } });
    await loadUsers();
  } catch (error) {
    alert(error.message);
  }
}

document.getElementById("refreshUsers").addEventListener("click", loadUsers);

// ── User detail modal ────────────────────────────────────
async function openUserDetail(userId) {
  let user;
  try {
    const { users } = await api("/admin/users");
    user = users.find((u) => u.id === userId);
  } catch (error) {
    alert(error.message);
    return;
  }
  if (!user) return;
  const p = user.policy || {};
  const devices = user.devices || [];
  const body = document.getElementById("modalBody");

  body.innerHTML = `
    <h3>${esc(user.email)}</h3>
    <div class="mrow"><span>Full name</span><strong>${esc(user.full_name || "—")}</strong></div>
    <div class="mrow"><span>User ID</span><strong style="word-break:break-all">${esc(user.id)}</strong></div>
    <div class="mrow"><span>Joined</span><strong>${new Date(user.created_at).toLocaleString()}</strong></div>
    <div class="mrow"><span>Account status</span><strong>${p.is_blocked ? '<span class="user-badge badge-blocked">Blocked</span>' : '<span class="user-badge badge-ok">Active</span>'}</strong></div>
    <div class="mrow"><span>CJ API key</span><strong>${user.hasCjKey ? `Saved (${esc(user.keyFingerprint || "")}…)` : "Not set"}</strong></div>
    <div class="mrow"><span>Daily limit / used</span><strong>${p.daily_api_limit ?? "Unlimited"} / ${p.daily_api_count ?? 0}</strong></div>
    <div class="mrow"><span>Monthly limit / used</span><strong>${p.monthly_api_limit ?? "Unlimited"} / ${p.monthly_api_count ?? 0}</strong></div>
    <div class="mrow"><span>Features</span><strong>${esc(JSON.stringify(p.features || { search: true, listing: true, enrich: true }))}</strong></div>
    <div class="mrow"><span>Notes</span><strong>${esc(p.notes || "—")}</strong></div>

    <div class="msection">Devices (${devices.length})</div>
    ${devices.length ? devices.map((d) => `
      <div class="mrow">
        <span title="${esc(d.user_agent || "")}">${esc(d.device_id)} · ${esc(d.ip_address || "—")} · ${esc(d.last_seen ? new Date(d.last_seen).toLocaleString() : "?")}</span>
        <span>
          ${d.is_blocked ? '<span class="user-badge badge-blocked">Blocked</span>' : '<span class="user-badge badge-ok">OK</span>'}
          <button class="btn-sm ${d.is_blocked ? "btn-success" : "btn-danger"}" style="margin-left:6px" data-device="${esc(d.device_id)}" data-blocked="${d.is_blocked ? "1" : "0"}">${d.is_blocked ? "Unblock" : "Block"}</button>
        </span>
      </div>`).join("") : '<div class="mnote">No devices registered yet. Devices appear the first time the user opens the extension.</div>'}

    <div class="msection">Limits &amp; features</div>
    <div class="mrow"><span>Daily API limit</span><strong><input type="number" id="editDaily" min="0" value="${p.daily_api_limit ?? ""}" placeholder="unlimited" style="width:120px"></strong></div>
    <div class="mrow"><span>Monthly API limit</span><strong><input type="number" id="editMonthly" min="0" value="${p.monthly_api_limit ?? ""}" placeholder="unlimited" style="width:120px"></strong></div>
    <div class="mrow"><span>Features</span><strong>
      <label><input type="checkbox" id="featSearch" ${p.features?.search !== false ? "checked" : ""}> Search</label>
      <label><input type="checkbox" id="featListing" ${p.features?.listing !== false ? "checked" : ""}> Listing</label>
      <label><input type="checkbox" id="featEnrich" ${p.features?.enrich !== false ? "checked" : ""}> Enrich</label>
    </strong></div>
    <div class="mrow"><span>Admin note</span><strong><input type="text" id="editNotes" value="${esc(p.notes || "")}" placeholder="Why blocked / limited…" style="width:260px"></strong></div>

    <div class="mactions">
      <button class="btn-primary" id="savePolicy">Save changes</button>
      <button class="btn-danger" id="toggleBlockBtn">${p.is_blocked ? "Unblock account" : "Block account"}</button>
    </div>
    <p class="mnote">Leave a limit empty for unlimited. Limits reset daily at 00:00 UTC (admin can also reset them manually).</p>`;

  body.querySelectorAll("[data-device]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/admin/users/${user.id}/devices/${encodeURIComponent(btn.dataset.device)}/block`, {
          method: "POST",
          body: { blocked: btn.dataset.blocked !== "1" }
        });
        await openUserDetail(userId);
        loadUsers();
      } catch (error) {
        alert(error.message);
      }
    });
  });

  body.querySelector("#savePolicy").addEventListener("click", async () => {
    const dailyValue = body.querySelector("#editDaily").value;
    const monthlyValue = body.querySelector("#editMonthly").value;
    try {
      await api(`/admin/users/${userId}/limits`, {
        method: "POST",
        body: {
          dailyLimit: dailyValue === "" ? null : Number(dailyValue),
          monthlyLimit: monthlyValue === "" ? null : Number(monthlyValue)
        }
      });
      await api(`/admin/users/${userId}/features`, {
        method: "POST",
        body: {
          features: {
            search: body.querySelector("#featSearch").checked,
            listing: body.querySelector("#featListing").checked,
            enrich: body.querySelector("#featEnrich").checked
          },
          notes: body.querySelector("#editNotes").value
        }
      });
      await openUserDetail(userId);
      await loadUsers();
      alert("Saved.");
    } catch (error) {
      alert(error.message);
    }
  });

  body.querySelector("#toggleBlockBtn").addEventListener("click", async () => {
    try {
      await api(`/admin/users/${userId}/block`, { method: "POST", body: { blocked: !(p.is_blocked) } });
      await openUserDetail(userId);
      await loadUsers();
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById("userModal").hidden = false;
}

document.getElementById("modalClose").addEventListener("click", () => {
  document.getElementById("userModal").hidden = true;
});
document.getElementById("userModal").addEventListener("click", (event) => {
  if (event.target.id === "userModal") event.target.hidden = true;
});

// ── Usage logs ───────────────────────────────────────────
async function loadUsage() {
  const limit = Number(document.getElementById("usageLimit").value || 50);
  try {
    const [usage, usersPayload] = await Promise.all([
      api(`/admin/usage?page=${usagePage}&limit=${limit}`),
      emailCache.size ? Promise.resolve(null) : api("/admin/users")
    ]);
    if (usersPayload) {
      emailCache = new Map((usersPayload.users || []).map((u) => [u.id, u.email]));
    }

    const blocked = (usage.policies || []).filter((p) => p.is_blocked).length;
    const activeToday = (usage.policies || []).filter((p) => (p.daily_api_count ?? 0) > 0).length;
    document.getElementById("usageSummary").innerHTML = `
      <div class="usage-stat"><div class="label">Log entries</div><div class="value">${usage.total}</div></div>
      <div class="usage-stat"><div class="label">Used the API today</div><div class="value">${activeToday}</div></div>
      <div class="usage-stat"><div class="label">Blocked accounts</div><div class="value">${blocked}</div></div>
      <div class="usage-stat"><div class="label">Page</div><div class="value">${usage.page}/${Math.max(1, Math.ceil(usage.total / usage.limit))}</div></div>`;

    const rows = (usage.logs || []).map((log) => `
      <tr>
        <td>${new Date(log.created_at).toLocaleString()}</td>
        <td>${esc(userName(log.user_id))}</td>
        <td>${esc(log.endpoint)}</td>
        <td>${esc(log.ip_address || "—")}</td>
        <td title="${esc(log.device_id || "")}">${esc((log.device_id || "—").slice(0, 10))}</td>
        <td>${log.response_code ?? "—"}</td>
      </tr>`).join("");
    document.getElementById("usageBody").innerHTML =
      rows || '<tr><td colspan="6" class="message">No usage recorded yet.</td></tr>';

    const totalPages = Math.max(1, Math.ceil(usage.total / usage.limit));
    const pager = document.getElementById("usagePager");
    pager.innerHTML = "";
    const mk = (label, target, disabled) => {
      const b = document.createElement("button");
      b.className = "btn-sm btn-secondary";
      b.textContent = label;
      b.disabled = disabled;
      b.addEventListener("click", () => { usagePage = target; loadUsage(); });
      pager.appendChild(b);
    };
    mk("First", 1, usagePage <= 1);
    mk("Prev", Math.max(1, usagePage - 1), usagePage <= 1);
    const info = document.createElement("span");
    info.textContent = `Page ${usagePage} of ${totalPages}`;
    pager.appendChild(info);
    mk("Next", usagePage + 1, usagePage >= totalPages);
    mk("Last", totalPages, usagePage >= totalPages);
  } catch (error) {
    document.getElementById("usageBody").innerHTML =
      `<tr><td colspan="6" class="message error">${esc(error.message)}</td></tr>`;
  }
}

document.getElementById("refreshUsage").addEventListener("click", () => { usagePage = 1; loadUsage(); });
document.getElementById("usageLimit").addEventListener("change", () => { usagePage = 1; loadUsage(); });

// ── Settings ─────────────────────────────────────────────
async function loadSettings() {
  const info = document.getElementById("systemInfo");
  info.innerHTML = `
    <div>App: CJ Product Hunter (cloud)</div>
    <div>Signed in as: ${esc(currentUser ? currentUser.email : "—")}</div>
    <div>Server time: ${new Date().toLocaleString()}</div>`;
  await loadAudit();
}

async function loadAudit() {
  const el = document.getElementById("auditList");
  if (!el) return;
  try {
    const { entries } = await api("/admin/audit");
    el.innerHTML = entries.length
      ? entries.map((e) => `
          <div class="mrow">
            <span>${new Date(e.created_at).toLocaleString()} · ${esc(e.action)}</span>
            <strong>${esc(userName(e.target_user_id))} ${e.details && Object.keys(e.details).length ? esc(JSON.stringify(e.details)) : ""}</strong>
          </div>`).join("")
      : '<p class="message">No admin actions recorded yet.</p>';
  } catch (error) {
    el.innerHTML = `<p class="message error">${esc(error.message)}</p>`;
  }
}

document.getElementById("resetAllDaily").addEventListener("click", async () => {
  if (!confirm("Reset every user's daily API counter to 0?")) return;
  try {
    await api("/admin/reset-daily", { method: "POST" });
    alert("Daily counters reset.");
    loadSettings();
  } catch (error) {
    alert(error.message);
  }
});

// ── Init ─────────────────────────────────────────────────
(async () => {
  const user = await checkAuth();
  if (!user) return;
  loadUsers();
})();
