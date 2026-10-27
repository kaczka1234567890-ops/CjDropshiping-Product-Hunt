-- ============================================
-- CJ Product Hunter — Supabase Schema v2.1
-- Cloud-first · Multi-user · Admin-managed
--
-- IDEMPOTENT: safe to run on a fresh project AND safe to re-run on a
-- project that already has an older version of these tables.
-- Run it in: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================

-- 1. User Profiles
create table if not exists profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  full_name text,
  avatar_url text,
  is_admin boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Encrypted CJ API Keys (stored per user)
create table if not exists user_api_keys (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  key_encrypted text not null,
  key_iv text not null,
  key_auth_tag text not null,
  key_fingerprint text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

-- 3. Device Registry (for device blocking)
create table if not exists user_devices (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  device_id text not null,
  user_agent text,
  ip_address text,
  last_seen timestamptz default now(),
  is_blocked boolean default false,
  created_at timestamptz default now(),
  unique(user_id, device_id)
);

-- 4. Usage Logs (audit trail)
create table if not exists usage_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  endpoint text not null,
  ip_address text,
  device_id text,
  response_code integer,
  created_at timestamptz default now()
);

-- 5. Admin Policies (block / limits / features)
create table if not exists admin_policies (
  user_id uuid references auth.users(id) on delete cascade primary key,
  is_blocked boolean default false,
  daily_api_limit integer default null,
  monthly_api_limit integer default null,
  daily_api_count integer default 0,
  monthly_api_count integer default 0,
  features jsonb default '{"search":true,"listing":true,"enrich":true}'::jsonb,
  notes text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz default now()
);

-- 6. Audit log for admin actions
create table if not exists admin_audit_log (
  id uuid default gen_random_uuid() primary key,
  admin_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb,
  created_at timestamptz default now()
);

-- ============================================
-- Upgrade an older install in place
-- (adds any columns that did not exist in earlier drafts)
-- ============================================
alter table profiles       add column if not exists is_admin boolean default false;
alter table user_api_keys  add column if not exists key_iv text;
alter table user_api_keys  add column if not exists key_auth_tag text;
alter table user_devices   add column if not exists user_agent text;
alter table user_devices   add column if not exists ip_address text;
alter table usage_logs     add column if not exists response_code integer;
alter table admin_policies add column if not exists daily_api_count integer default 0;
alter table admin_policies add column if not exists monthly_api_count integer default 0;

-- Key columns must be NOT NULL (backfill first in case old rows exist)
update user_api_keys set key_iv = coalesce(key_iv, ''), key_auth_tag = coalesce(key_auth_tag, '');
alter table user_api_keys alter column key_iv set not null;
alter table user_api_keys alter column key_auth_tag set not null;

-- Make sure the uniqueness the app relies on exists
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_api_keys'::regclass and contype = 'u'
  ) then
    alter table user_api_keys add constraint user_api_keys_user_id_key unique (user_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_devices'::regclass and contype = 'u'
  ) then
    alter table user_devices add constraint user_devices_user_device_key unique (user_id, device_id);
  end if;
exception
  when duplicate_table then null;   -- created concurrently, fine
  when others then null;            -- never block the migration on a constraint
end $$;

-- Remove helper functions and event triggers left over from older schema drafts
do $$
declare r record;
begin
  -- drop event triggers that call the legacy function first (they depend on it)
  for r in
    select t.evtname
      from pg_event_trigger t
     where t.evtname = 'ensure_rls'
        or coalesce(pg_get_eventtrigger_function(t.oid), '') = 'rls_auto_enable'
  loop
    execute format('drop event trigger if exists %I', r.evtname);
  end loop;
exception
  when others then null;            -- cleanup must never block the migration
end $$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
exception
  when others then null;            -- cleanup must never block the migration
end $$;

-- ============================================
-- Row Level Security
-- ============================================
alter table profiles enable row level security;
alter table user_api_keys enable row level security;
alter table user_devices enable row level security;
alter table usage_logs enable row level security;
alter table admin_policies enable row level security;
alter table admin_audit_log enable row level security;

-- ============================================
-- Admin check used by every admin policy.
-- SECURITY DEFINER: it reads profiles *without* applying RLS, which is what
-- prevents "infinite recursion detected in policy for relation profiles"
-- (42P17) when a policy on profiles queries profiles again.
-- ============================================
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and p.is_admin = true
  );
$$;
grant execute on function public.is_admin() to anon, authenticated, service_role;

-- Reset policies so a re-run never collides with older/duplicate ones.
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
     where schemaname = 'public'
       and tablename in ('profiles','user_api_keys','user_devices','usage_logs','admin_policies','admin_audit_log')
  loop
    execute format('drop policy %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

-- Profiles: users can read own; admins read all
create policy "profiles_self" on profiles
  for select using (auth.uid() = id);
create policy "profiles_admin" on profiles
  for select using (
    public.is_admin()
  );

-- API Keys: owner can read/write own; admins read metadata only
create policy "keys_owner" on user_api_keys
  for all using (auth.uid() = user_id);
create policy "keys_admin" on user_api_keys
  for select using (
    public.is_admin()
  );

-- Devices: owner sees own; admins see all
create policy "devices_owner" on user_devices
  for all using (auth.uid() = user_id);
create policy "devices_admin" on user_devices
  for select using (
    public.is_admin()
  );

-- Usage logs: owners see own; admins see all
create policy "usage_owner" on usage_logs
  for select using (auth.uid() = user_id);
create policy "usage_admin" on usage_logs
  for select using (
    public.is_admin()
  );
-- NOTE: no insert policy on purpose. The backend uses the service role
-- (which bypasses RLS), so no client ever writes usage rows directly.

-- Admin policies: only admins can read/write
create policy "policies_admin" on admin_policies
  for all using (
    public.is_admin()
  );

-- Audit log: only admins
create policy "audit_admin" on admin_audit_log
  for all using (
    public.is_admin()
  );

-- ============================================
-- Helper Functions
-- ============================================

-- Increment daily/monthly counters
create or replace function increment_usage_counts(p_user_id uuid)
returns void as $$
begin
  update admin_policies
  set daily_api_count = daily_api_count + 1,
      monthly_api_count = monthly_api_count + 1,
      updated_at = now()
  where user_id = p_user_id;
end;
$$ language plpgsql security definer;

-- Check user access (returns JSON with block status, limits, features)
create or replace function check_user_access(p_user_id uuid, p_device_id text)
returns jsonb as $$
declare
  policy record;
  device record;
begin
  select * into policy from admin_policies where user_id = p_user_id;
  select * into device from user_devices where user_id = p_user_id and device_id = p_device_id;

  if policy is null then
    return jsonb_build_object(
      'allowed', true,
      'is_blocked', false,
      'daily_limit', null,
      'monthly_limit', null,
      'daily_used', 0,
      'monthly_used', 0,
      'features', jsonb_build_object('search', true, 'listing', true, 'enrich', true),
      'reason', null
    );
  end if;

  -- Check account block
  if policy.is_blocked then
    return jsonb_build_object(
      'allowed', false,
      'is_blocked', true,
      'daily_limit', policy.daily_api_limit,
      'monthly_limit', policy.monthly_api_limit,
      'daily_used', policy.daily_api_count,
      'monthly_used', policy.monthly_api_count,
      'features', policy.features,
      'reason', 'Your account has been suspended. Contact support.'
    );
  end if;

  -- Check device block
  if device is not null and device.is_blocked then
    return jsonb_build_object(
      'allowed', false,
      'is_blocked', true,
      'daily_limit', policy.daily_api_limit,
      'monthly_limit', policy.monthly_api_limit,
      'daily_used', policy.daily_api_count,
      'monthly_used', policy.monthly_api_count,
      'features', policy.features,
      'reason', 'Your device has been blocked. Contact support.'
    );
  end if;

  -- Check daily limit
  if policy.daily_api_limit is not null and policy.daily_api_count >= policy.daily_api_limit then
    return jsonb_build_object(
      'allowed', false,
      'is_blocked', false,
      'daily_limit', policy.daily_api_limit,
      'monthly_limit', policy.monthly_api_limit,
      'daily_used', policy.daily_api_count,
      'monthly_used', policy.monthly_api_count,
      'features', policy.features,
      'reason', format('Daily API limit reached (%s/%s). Resets at midnight UTC.', policy.daily_api_count, policy.daily_api_limit)
    );
  end if;

  -- Check monthly limit
  if policy.monthly_api_limit is not null and policy.monthly_api_count >= policy.monthly_api_limit then
    return jsonb_build_object(
      'allowed', false,
      'is_blocked', false,
      'daily_limit', policy.daily_api_limit,
      'monthly_limit', policy.monthly_api_limit,
      'daily_used', policy.daily_api_count,
      'monthly_used', policy.monthly_api_count,
      'features', policy.features,
      'reason', format('Monthly API limit reached (%s/%s).', policy.monthly_api_count, policy.monthly_api_limit)
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'is_blocked', false,
    'daily_limit', policy.daily_api_limit,
    'monthly_limit', policy.monthly_api_limit,
    'daily_used', policy.daily_api_count,
    'monthly_used', policy.monthly_api_count,
    'features', policy.features,
    'reason', null
  );
end;
$$ language plpgsql security definer;

-- Reset daily counters (admin panel → Settings)
create or replace function reset_daily_counts()
returns void as $$
begin
  update admin_policies set daily_api_count = 0, updated_at = now();
end;
$$ language plpgsql security definer;

-- ============================================
-- Lock the helper functions down to the backend only.
-- The app never talks to Supabase from the browser, so anon/authenticated
-- must not be able to call these RPCs directly.
-- ============================================
revoke execute on function check_user_access(uuid, text) from public, anon, authenticated;
revoke execute on function increment_usage_counts(uuid) from public, anon, authenticated;
revoke execute on function reset_daily_counts() from public, anon, authenticated;
grant execute on function check_user_access(uuid, text) to service_role;
grant execute on function increment_usage_counts(uuid) to service_role;
grant execute on function reset_daily_counts() to service_role;

-- ============================================
-- Seed: Make your auth user an admin
-- After creating your first user, run:
--   update profiles set is_admin = true where email = 'you@email.com';
-- (or set ADMIN_USER_IDS=<user-uuid> in the backend environment)
-- ============================================
