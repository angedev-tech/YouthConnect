-- =====================================================================
-- Imitation LOCALE du schéma auth de Supabase, pour exécuter les tests
-- sur un PostgreSQL ordinaire.
--
-- ⚠️ NE JAMAIS exécuter ce fichier sur ton projet Supabase : le schéma
--    auth y existe déjà et est géré par Supabase.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  phone              text unique,
  email_confirmed_at timestamptz,
  phone_confirmed_at timestamptz,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Comme dans Supabase : l'identifiant vient du jeton (claim « sub »).
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    ((nullif(current_setting('request.jwt.claims', true), ''))::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    ((nullif(current_setting('request.jwt.claims', true), ''))::jsonb ->> 'role')
  )::text
$$;

grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
