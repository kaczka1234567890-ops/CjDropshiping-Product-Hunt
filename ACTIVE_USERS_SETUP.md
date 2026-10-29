# Active Users Tracking Setup

## Supabase SQL (run once in SQL Editor)

```sql
-- 1. Add online tracking columns
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;
UPDATE profiles SET last_seen = COALESCE(last_seen, created_at) WHERE last_seen IS NULL;
```

## What was changed

### Server (`api/index.js`)
- Added `/api/heartbeat` endpoint — marks user as online on every call
- Added `buildSalesMetrics()` — tracks product stock snapshots for 7/30/90-day sales estimates
- `/api/admin/users` now includes `is_online` and `last_seen` per user
- New `/api/admin/active-users` endpoint returns online/total/24h counts
- Auth/me now returns `isOnline` and `lastSeen` fields

### Extension (`extension/background.js`)
- Heartbeat runs every 60 seconds to keep user status current

### Web App (`public/index.html`)
- Heartbeat runs every 60 seconds for web users
- CJ API key creation instructions added with clear steps

### Admin Panel (`public/admin.js`, `admin.html`, `admin.css`)
- Active users widget in Users tab header: shows online count, total users, 24h active
- Each user row shows a green dot indicator if currently online
- User detail modal shows last seen time and online status
- Widget auto-refreshes every 30 seconds

### CJ API Key Instructions
- Added clear step-by-step guide in both web app and extension popup
- Shows exactly where to find the key in CJdropshipping dashboard