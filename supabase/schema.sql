-- Gifted Brainz EduSpace v12.1.8
-- Canonical Supabase schema for the current server-mediated application.
--
-- The application intentionally uses one PostgreSQL KV table (public.gb_kv)
-- for its serialized application state. This file hardens that existing
-- contract; it does not invent new relational tables that the current API
-- does not read or write.
--
-- IMPORTANT
-- 1. Apply this file to the SAME Supabase project used by Student/Admin APIs.
-- 2. Keep the Supabase Secret/service-role credential server-side only.
-- 3. Browser roles (anon/authenticated) must never have direct access to gb_kv.
-- 4. Do not replace this table with browser storage, filesystem, EdgeOne Blob,
--    or an application-side mock store.

begin;

-- Explicit schema access is included because newer Supabase projects can
-- start with automatic Data API grants disabled. Table-level grants below
-- are the actual Data API allow-list for the server role.
grant usage on schema public to service_role;

create table if not exists public.gb_kv (
  key         text primary key,
  value       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Keep the existing table compatible with the current API without destroying
-- data during a repeat deployment.
alter table public.gb_kv
  alter column key set not null,
  alter column value set not null,
  alter column created_at set default now(),
  alter column updated_at set default now();

create or replace function public.gb_kv_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists gb_kv_set_updated_at on public.gb_kv;

create trigger gb_kv_set_updated_at
before update on public.gb_kv
for each row
execute function public.gb_kv_touch_updated_at();

-- Ensure PostgreSQL evaluates RLS for direct table access.
alter table public.gb_kv enable row level security;
alter table public.gb_kv force row level security;

-- Explicit deny-by-default for browser-facing roles. The application API
-- accesses this table server-side with the Supabase service role.
revoke all on table public.gb_kv from public;
revoke all on table public.gb_kv from anon;
revoke all on table public.gb_kv from authenticated;

grant select, insert, update, delete on table public.gb_kv to service_role;

-- Defense in depth: the only policy for browser roles is an explicit deny.
drop policy if exists deny_anon_authenticated on public.gb_kv;
drop policy if exists gb_kv_no_browser_access on public.gb_kv;

create policy gb_kv_no_browser_access
on public.gb_kv
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

-- Trigger functions inherit PUBLIC EXECUTE by default in PostgreSQL. Remove
-- that privilege so browser roles cannot invoke the helper directly.
revoke all on function public.gb_kv_touch_updated_at() from public;
revoke all on function public.gb_kv_touch_updated_at() from anon;
revoke all on function public.gb_kv_touch_updated_at() from authenticated;
grant execute on function public.gb_kv_touch_updated_at() to service_role;

comment on table public.gb_kv is
  'Gifted Brainz EduSpace server-side serialized application store. Browser roles have no table or function access.';

comment on column public.gb_kv.key is
  'Application storage key; unique per logical record/document.';

comment on column public.gb_kv.value is
  'Serialized application value written and read only by the server-side API.';

comment on column public.gb_kv.created_at is
  'UTC timestamp when the logical storage record was first created.';

comment on column public.gb_kv.updated_at is
  'UTC timestamp maintained by gb_kv_set_updated_at on every update.';

commit;
