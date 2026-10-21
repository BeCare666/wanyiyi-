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
  email text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb,
  created_at timestamptz not null default now(),
  -- Colonnes de Supabase remplies par supabase/demo/membres-demo.sql
  instance_id uuid,
  aud varchar(255),
  role varchar(255),
  encrypted_password varchar(255),
  raw_app_meta_data jsonb,
  updated_at timestamptz,
  confirmation_token varchar(255),
  recovery_token varchar(255),
  email_change_token_new varchar(255),
  email_change varchar(255)
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

-- Supabase Storage : compartiments et objets (fichiers), avec la RLS activée comme sur Supabase.
-- Le contenu des fichiers n'est pas simulé : seules les lignes de métadonnées comptent ici.
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets (id),
  name text not null,
  owner uuid default auth.uid(),
  metadata jsonb,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select on storage.buckets to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant all on storage.buckets, storage.objects to service_role;

-- Même définition que Supabase : dossiers du chemin, sans le nom du fichier
create function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
