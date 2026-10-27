# CJ Product Hunter — Cloud Edition

Hunt CJdropshipping winning products from a Chrome side panel: search, score, sales/review
enrichment, supplier info and one-click listing — with **accounts, usage limits and an admin
panel** so you can sell or distribute access.

Each user pastes **their own CJdropshipping API key once**; it is validated against CJ and
stored **encrypted (AES-256-GCM)** on the server. Nothing sensitive lives in the extension.

## How it fits together

```
Chrome extension (side panel)          Web (Vercel)                Supabase
┌──────────────────────────┐   HTTPS   ┌──────────────────┐  SQL   ┌─────────────┐
│ popup.js / sidepanel.html│ ────────► │ Express /api/*   │ ─────► │ auth        │
│ · sign in / sign up      │  Bearer   │ · auth, keys     │        │ profiles    │
│ · paste CJ API key (⚙)   │  token    │ · CJ proxy       │        │ user_api_keys│
│ · search / enrich / list │           │ · admin panel    │        │ policies    │
└──────────────────────────┘           └──────────────────┘        │ usage_logs  │
                                                                   └─────────────┘
```

- **No Supabase client in the browser** — the server uses the service-role key only, and
  every RPC/policy is locked down so only the backend can touch the data.
- Per-user CJ keys are bound per-request (`AsyncLocalStorage`), so concurrent users can
  never use each other's key.
- Admin panel at `/admin`: block/unblock users, daily & monthly API limits, block devices,
  toggle features (search/listing/enrich), view usage logs and admin audit trail.

## Repository

- GitHub: <https://github.com/kaczka1234567890-ops/CjDropshiping-Product-Hunt>
- Full setup guide: **[DEPLOYMENT.md](./DEPLOYMENT.md)** (Supabase → Vercel → extension)

## Features

- 🔍 Product search with filters (price, stock, shipping, country) and trending/best-selling modes
- 📊 Scoring, profit estimation, sales & review enrichment
- 🏷️ One-click listing preview/publish to your CJ store
- 👤 Accounts (sign up / sign in) with session tokens
- 🔑 Per-user CJ API key — encrypted at rest, never shipped to the client
- 🛡️ Admin panel: block users, usage limits, device blocking, usage logs, audit log
- 📱 Chrome MV3 side panel (opens on toolbar click) + optional popup

## Quick start (local development)

```bash
npm install
# fill .env — see .env.example (Supabase URL, service-role key, ENCRYPTION_KEY)
npm start          # http://localhost:3000
```

Point the extension at the backend:

```bash
npm run set-url http://localhost:3000     # or your deployed URL
```

Then load `extension/` via `chrome://extensions` → **Load unpacked**.

The server refuses to start until `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
`ENCRYPTION_KEY` are set — see [DEPLOYMENT.md](./DEPLOYMENT.md).

## Project layout

```
server/          Express backend (auth, CJ proxy, admin API)
web/             Sign-in page + admin panel (static, served by Vercel)
extension/       Chrome MV3 extension (side panel + popup)
supabase-schema.sql   Run once in the Supabase SQL editor
scripts/         set-backend-url.mjs (npm run set-url)
store-assets/    Chrome Web Store screenshots & promo art
```

## Security notes

1. `.env` is gitignored and `.vercelignore`d — never commit API keys.
2. User CJ keys are stored encrypted (`ENCRYPTION_KEY`, 64-hex, AES-256-GCM) in
   `user_api_keys`; only the server can decrypt them.
3. `data/` (local cache + legacy settings) is gitignored and `.vercelignore`d.
4. Auth endpoints are rate-limited per IP (signup 5/10min, login 10/5min).
5. Only use API access and data-collection methods permitted by CJ and each provider.

## License / attribution

Prototype built on CJdropshipping's public API. Verify endpoints and quota rules against
your own CJ API documentation before production use.
