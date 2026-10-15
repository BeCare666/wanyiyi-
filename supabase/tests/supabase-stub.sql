-- =====================================================================
-- Socle Supabase minimal, pour exécuter les migrations avec PGlite.
-- Reproduit ce que fournit un projet Supabase : rôles de l'API,
-- schéma auth, table auth.users et fonctions auth.uid() / auth.role().
-- Utilisé uniquement par les tests, jamais déployé.
-- =====================================================================

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  phone text unique,
  created_at timestamptz not null default now()
);

-- Mêmes définitions que Supabase : l'identité vient des « claims » du jeton JWT
create function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
