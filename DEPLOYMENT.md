# DEPLOYMENT — CJ Product Hunter (cloud)

Step-by-step: **Supabase → .env → Vercel → point extension at URL → promote admin → package.**
Total time: ~30 minutes.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com> → **New project** (free tier is fine).
   - Pick a region close to you (e.g. EU West / US East).
   - Save the **database password** somewhere safe.
2. Wait for the project to initialize.

## 2. Run the schema

1. Supabase dashboard → **SQL Editor** → **New query**.
2. Paste the entire contents of [`supabase-schema.sql`](./supabase-schema.sql).
3. Click **Run**. You should see `Success. No rows returned`.

This creates: `profiles`, `admin_policies`, `user_api_keys`, `user_devices`,
`usage_logs`, `admin_audit_log`, the helper RPCs, and RLS policies locked to the
service role (the browser never talks to Supabase directly).

## 3. Collect your credentials

Supabase → **Project Settings → API**:

| Value you need        | Where in Supabase                          |
| --------------------- | ------------------------------------------ |
| `SUPABASE_URL`        | Project URL (`https://xxxx.supabase.co`)   |
| `SUPABASE_SERVICE_ROLE_KEY` | **service_role** secret key (never anon) |

Generate an encryption key for user API keys:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 4. Fill `.env`

Copy `.env.example` → `.env` (it already exists locally) and set:

```env
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...service-role...
ENCRYPTION_KEY=<64 hex chars from step 3>
PORT=3000
```

Optional:

```env
ADMIN_USER_IDS=          # comma-separated Supabase user UUIDs that are admins
CJ_API_BASE_URL=https://developers.cjdropshipping.com/api2.0/v1
```

Verify locally:

```bash
npm start
# → CJ Product Hunter (Cloud) running at http://localhost:3000
# → Admin panel: http://localhost:3000/admin
```

> The server exits with setup instructions if any of the three required variables is
> missing or `ENCRYPTION_KEY` isn't 64 hex chars.

## 5. Deploy to Vercel

```bash
npx vercel login          # log in as kaczka1234567890@gmail.com
npx vercel --prod         # deploy the current directory
```

`vercel.json` already wires it up:

- `/api/*` → Express server (`server/index.js`, built with `@vercel/node`)
- `/admin` → `web/admin.html`
- everything else → static `web/*`

Set the environment variables for the deployment:

```bash
npx vercel env add SUPABASE_URL production
npx vercel env add SUPABASE_SERVICE_ROLE_KEY production
npx vercel env add ENCRYPTION_KEY production
npx vercel env add ADMIN_USER_IDS production   # optional, can come later
```

(or add them in the Vercel dashboard → Project → Settings → Environment Variables),
then redeploy: `npx vercel --prod`.

Smoke test: `https://YOUR-PROJECT.vercel.app/api/health`
→ `{"ok":true,"auth":"supabase",...}`

## 6. Point the extension at the deployed backend

```bash
npm run set-url https://YOUR-PROJECT.vercel.app
```

This patches both places that need the URL:

1. `extension/manifest.json` → `host_permissions` (so Chrome allows the calls)
2. `extension/popup.js` → `DEFAULT_API_BASE`

Then reload the extension in `chrome://extensions`.

> Optional one-off override without editing files:
> `chrome.storage.local.set({ apiBase: "https://your-app.vercel.app" })` from the
> extension's service-worker console.

## 7. Create your admin account

1. Load the extension → **Sign up** with your own email/password (min 8 chars).
   - If Supabase asks for email confirmation, confirm the link first, then sign in.
2. Promote yourself to admin — either way works:

   **Option A (dashboard):** Supabase → SQL Editor →

   ```sql
   update profiles set is_admin = true where email = 'kaczka1234567890@gmail.com';
   ```

   **Option B (env):** get your user id from `profiles`, then set in Vercel →

   ```env
   ADMIN_USER_IDS=<your-user-uuid>
   ```

   and redeploy.

3. Open <https://YOUR-PROJECT.vercel.app/> → sign in → **Open admin panel**.

## 8. Add your CJ API key (one-time)

1. Log in to CJdropshipping → **My CJ → API** → copy your API Key.
2. In the extension click **⚙ Key** → paste → **Save API Key**.
   The server validates it with CJ before storing it encrypted.
3. Search something — you should get results.

Every end user does exactly this: install → sign up → paste key → hunt.

## 9. Package / publish the extension

Build a clean zip (files at the zip root, no wrapper folder):

```powershell
Compress-Archive -Path extension\* -DestinationPath cj-product-hunter-extension.zip -Force
```

Then submit at <https://chrome.google.com/webstore/devconsole>:

- **Privacy policy** URL (required because the extension handles accounts + API keys) —
  `store-assets/privacy-policy.md` contains draft text you can host on the site.
- Screenshots live in `store-assets/screenshots/`.
- Description (105 chars) is already in `extension/manifest.json`.

---

## Admin panel cheat sheet

| Task | Where |
| ---- | ----- |
| Block / unblock a user | Users → **Block** / **Unblock** (or Details) |
| Daily / monthly API limits | Users → **Details** → Limits → **Save changes** |
| Block a specific device | Users → **Details** → Devices → **Block** |
| Turn off features (search/listing/enrich) | Users → **Details** → Features |
| View usage logs (paged) | **Usage** tab |
| Reset all daily counters | **Settings** → Reset all daily counters |
| See what admins did | **Settings** → Recent admin actions |

Daily counters also reset at 00:00 UTC.

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| Server exits: "Missing required environment variable(s)" | Fill `.env` (step 4) |
| Extension: "Server not reachable" | `npm run set-url <url>` then reload the extension |
| "Admin access required" in `/admin` | Promote yourself (step 7) |
| "CJ API key not configured" on search | ⚙ Key → paste your CJ key (step 8) |
| CJ 401/403 | Key invalid or API app disabled in your CJ account — re-copy the key |
| 429 on sign-in | Rate limited — wait a few minutes |
| Vercel 500 on `/api/*` | Check env vars are set for **Production** and redeploy |
