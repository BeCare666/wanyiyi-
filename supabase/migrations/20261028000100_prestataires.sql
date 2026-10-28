-- Phase 4, étape 3 : prestataires (11.2-10 ; question 2 de
-- propositions/PROPOSITIONS-QUESTIONS-PHASE4.txt, validée le 27 octobre 2026).
--   a) Catégories : traiteurs, couturiers, photographes, lieux de réception (vitrine), décoration
--      et autre ; liste modifiable par l'administration.
--   b) Vitrine publique : nom, catégorie, image, courte description, ville. Coordonnées complètes
--      seulement aux membres en couple (en cours, en pause) ou unis.
--   c) Nom, catégorie, description en 3 langues, image (Cloudinary, contenu public), téléphone,
--      WhatsApp, ville et quartier, fourchette de prix indicative facultative.
--   d) Ni réservation ni paiement par Ifedele : « J'ai contacté ce prestataire » compte seulement
--      l'intérêt (statistique de l'équipe, rien n'est envoyé au prestataire).
--   e) Prestataires de démonstration marqués is_demo (script supabase/demo/prestataires-demo.sql),
--      cachés de la vitrine et de l'espace membre quand SHOW_DEMO_DATA est faux.
-- Nouvelle permission providers.manage (administration et super administration).

insert into app.role_permissions (role, permission) values
  ('admin', 'providers.manage'), ('super_admin', 'providers.manage')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 1. Catégories
-- ---------------------------------------------------------------------
create table app.provider_categories (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name jsonb not null,                 -- {"fr": ..., "en": ..., "yo": ...}
  position smallint not null default 0,
  is_active boolean not null default true
);
alter table app.provider_categories enable row level security;
alter table app.provider_categories force row level security;
create policy provider_categories_select on app.provider_categories for select using (true);
grant select on app.provider_categories to anon, authenticated;

insert into app.provider_categories (key, name, position) values
  ('caterer', '{"fr": "Traiteurs", "en": "Caterers", "yo": "Àwọn olóúnjẹ"}', 1),
  ('tailor', '{"fr": "Couturiers", "en": "Tailors", "yo": "Àwọn télọ̀"}', 2),
  ('photographer', '{"fr": "Photographes", "en": "Photographers", "yo": "Àwọn ayàwòrán"}', 3),
  ('reception_venue', '{"fr": "Lieux de réception", "en": "Reception venues", "yo": "Àwọn ibi àpèjẹ"}', 4),
  ('decoration', '{"fr": "Décoration", "en": "Decoration", "yo": "Ọ̀ṣọ́"}', 5),
  ('other', '{"fr": "Autre", "en": "Other", "yo": "Òmíràn"}', 6);

-- ---------------------------------------------------------------------
-- 2. Prestataires (table du schéma initial, jamais remplie jusqu'ici)
-- ---------------------------------------------------------------------
alter table app.providers
  drop column contact,
  alter column description type jsonb using case when description is null then null else jsonb_build_object('fr', description) end,
  add column phone text,
  add column whatsapp text,
  add column city text not null default 'Cotonou',
  add column district text,
  add column price_range text,
  add column image_url text,
  add column is_demo boolean not null default false,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add constraint providers_category_fk foreign key (category) references app.provider_categories (key);

create table app.provider_contacts (
  provider_id uuid not null references app.providers (id) on delete cascade,
  user_id uuid not null references app.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (provider_id, user_id)
);
alter table app.provider_contacts enable row level security;
alter table app.provider_contacts force row level security;

-- Membre en couple (en cours, en pause) ou uni, non suspendu : coordonnées complètes
create function app.can_see_provider_contacts() returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.couples c
    join app.member_profiles p on p.user_id = auth.uid()
    where auth.uid() in (c.member_a, c.member_b)
      and c.status in ('active', 'paused', 'union_celebrated')
      and p.status not in ('suspended', 'excluded', 'deleted')
  )
$$;

-- Vitrine (sans compte) : prestataires actifs, sans coordonnées
create function app.public_providers(p_include_demo boolean default false)
returns table (id uuid, name text, category text, description jsonb, image_url text, city text)
language sql stable security definer set search_path = app, public as $$
  select pr.id, pr.name, pr.category, pr.description, pr.image_url, pr.city
  from app.providers pr
  join app.provider_categories pc on pc.key = pr.category
  where pr.is_active and pc.is_active and (coalesce(p_include_demo, false) or not pr.is_demo)
  order by pc.position, pr.name, pr.id
$$;

-- Espace membre : coordonnées complètes pour un couple ; « J'ai contacté » de chacun
create function app.member_providers(p_include_demo boolean default false)
returns table (id uuid, name text, category text, description jsonb, image_url text, city text, district text,
               phone text, whatsapp text, price_range text, i_contacted boolean)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.can_see_provider_contacts() then raise exception 'not_in_couple' using errcode = '42501'; end if;
  return query
    select pr.id, pr.name, pr.category, pr.description, pr.image_url, pr.city, pr.district,
           pr.phone, pr.whatsapp, pr.price_range,
           exists (select 1 from app.provider_contacts k where k.provider_id = pr.id and k.user_id = auth.uid())
    from app.providers pr
    join app.provider_categories pc on pc.key = pr.category
    where pr.is_active and pc.is_active and (coalesce(p_include_demo, false) or not pr.is_demo)
    order by pc.position, pr.name, pr.id;
end $$;

-- « J'ai contacté ce prestataire » : compté une fois par membre, rien n'est envoyé au prestataire
create function app.mark_provider_contacted(p_provider uuid) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.can_see_provider_contacts() then raise exception 'not_in_couple' using errcode = '42501'; end if;
  if not exists (select 1 from app.providers where id = p_provider and is_active) then raise exception 'not_found'; end if;
  insert into app.provider_contacts (provider_id, user_id) values (p_provider, auth.uid()) on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------
-- 3. Administration
-- ---------------------------------------------------------------------
-- Création (p_id null) ou modification ; contrôles des champs, journalisé
create function app.admin_save_provider(
  p_id uuid, p_name text, p_category text, p_description jsonb, p_phone text, p_whatsapp text,
  p_city text, p_district text, p_price_range text, p_is_demo boolean
) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_city text := btrim(coalesce(p_city, ''));
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '\s', '', 'g'), '');
  v_whatsapp text := nullif(regexp_replace(coalesce(p_whatsapp, ''), '\s', '', 'g'), '');
  v_description jsonb;
  v_id uuid;
  v_locale text;
begin
  if not app.has_permission('providers.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(v_name) not between 1 and 120 then raise exception 'name_required'; end if;
  if not exists (select 1 from app.provider_categories where key = p_category) then raise exception 'invalid_category'; end if;
  if char_length(v_city) not between 1 and 80 or char_length(coalesce(p_district, '')) > 80 then raise exception 'invalid_place'; end if;
  if char_length(coalesce(p_price_range, '')) > 80 then raise exception 'price_range_too_long'; end if;
  if (v_phone is not null and v_phone !~ '^\+?[0-9]{8,15}$') or (v_whatsapp is not null and v_whatsapp !~ '^\+?[0-9]{8,15}$') then
    raise exception 'invalid_phone';
  end if;
  if v_phone is null and v_whatsapp is null then raise exception 'contact_required'; end if;
  -- Description : français obligatoire, anglais et yoruba facultatifs, 600 caractères chacun
  v_description := jsonb_strip_nulls(jsonb_build_object(
    'fr', nullif(btrim(coalesce(p_description->>'fr', '')), ''),
    'en', nullif(btrim(coalesce(p_description->>'en', '')), ''),
    'yo', nullif(btrim(coalesce(p_description->>'yo', '')), '')));
  if not (v_description ? 'fr') then raise exception 'description_required'; end if;
  foreach v_locale in array array['fr', 'en', 'yo'] loop
    if char_length(coalesce(v_description->>v_locale, '')) > 600 then raise exception 'description_too_long'; end if;
  end loop;

  if p_id is null then
    insert into app.providers (name, category, description, phone, whatsapp, city, district, price_range, is_demo)
    values (v_name, p_category, v_description, v_phone, v_whatsapp, v_city, nullif(btrim(coalesce(p_district, '')), ''),
            nullif(btrim(coalesce(p_price_range, '')), ''), coalesce(p_is_demo, false))
    returning id into v_id;
    perform app.audit('provider.created', 'providers', v_id, jsonb_build_object('category', p_category));
  else
    update app.providers
       set name = v_name, category = p_category, description = v_description, phone = v_phone, whatsapp = v_whatsapp,
           city = v_city, district = nullif(btrim(coalesce(p_district, '')), ''),
           price_range = nullif(btrim(coalesce(p_price_range, '')), ''), is_demo = coalesce(p_is_demo, false), updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
    perform app.audit('provider.updated', 'providers', v_id, '{}'::jsonb);
  end if;
  return v_id;
end $$;

-- Désactivation (masqué partout) ou réactivation
create function app.admin_set_provider_active(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.has_permission('providers.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  update app.providers set is_active = coalesce(p_active, false), updated_at = now() where id = p_id;
  if not found then raise exception 'not_found'; end if;
  perform app.audit(case when p_active then 'provider.activated' else 'provider.deactivated' end, 'providers', p_id, '{}'::jsonb);
end $$;

-- Image déposée sur Cloudinary par l'API (contenu public) ; renvoie l'ancien identifiant à effacer
create function app.admin_set_provider_image(p_id uuid, p_public_id text, p_url text) returns text
language plpgsql security definer set search_path = app, public as $$
declare v_old text;
begin
  if not app.has_permission('providers.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_url is not null and p_url !~ '^https://res\.cloudinary\.com/' then raise exception 'invalid_image'; end if;
  select image_public_id into v_old from app.providers where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  update app.providers set image_public_id = p_public_id, image_url = p_url, updated_at = now() where id = p_id;
  perform app.audit('provider.image', 'providers', p_id, '{}'::jsonb);
  return v_old;
end $$;

-- Fiche complète pour l'équipe
create function app.admin_provider(p_id uuid)
returns table (id uuid, name text, category text, description jsonb, phone text, whatsapp text, city text, district text,
               price_range text, image_url text, is_active boolean, is_demo boolean, contacts integer, created_at timestamptz)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('providers.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select pr.id, pr.name, pr.category, pr.description, pr.phone, pr.whatsapp, pr.city, pr.district, pr.price_range,
           pr.image_url, pr.is_active, pr.is_demo,
           (select count(*)::integer from app.provider_contacts k where k.provider_id = pr.id), pr.created_at
    from app.providers pr where pr.id = p_id;
end $$;

-- Catégories : nom en 3 langues (français obligatoire), ordre, active ou non ; nouvelle clé = création
create function app.admin_save_provider_category(p_key text, p_name jsonb, p_position integer, p_active boolean) returns void
language plpgsql security definer set search_path = app, public as $$
declare v_name jsonb;
begin
  if not app.has_permission('providers.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]{1,39}$' then raise exception 'invalid_key'; end if;
  v_name := jsonb_strip_nulls(jsonb_build_object(
    'fr', nullif(btrim(coalesce(p_name->>'fr', '')), ''),
    'en', nullif(btrim(coalesce(p_name->>'en', '')), ''),
    'yo', nullif(btrim(coalesce(p_name->>'yo', '')), '')));
  if not (v_name ? 'fr') or char_length(v_name->>'fr') > 60 or char_length(coalesce(v_name->>'en', '')) > 60
     or char_length(coalesce(v_name->>'yo', '')) > 60 then
    raise exception 'name_required';
  end if;
  if coalesce(p_position, 0) not between 0 and 1000 then raise exception 'invalid_position'; end if;
  insert into app.provider_categories (key, name, position, is_active) values (p_key, v_name, coalesce(p_position, 0), coalesce(p_active, true))
  on conflict (key) do update set name = excluded.name, position = excluded.position, is_active = excluded.is_active;
  perform app.audit('provider_category.saved', 'provider_categories', null, jsonb_build_object('key', p_key, 'active', coalesce(p_active, true)));
end $$;

-- ---------------------------------------------------------------------
-- 4. Liste filtrable « providers » (moteur des migrations 20261026000200 et 000900)
-- ---------------------------------------------------------------------
alter function app.list_field(text, text) rename to list_field_phase3;
alter function app.list_sort_field(text, text) rename to list_sort_field_phase3;
alter function app.list_columns(text) rename to list_columns_phase3;
alter function app.list_sort_sql(text, jsonb) rename to list_sort_sql_phase3;
alter function app.list_rows_sql(text, jsonb, jsonb) rename to list_rows_sql_phase3;

create function app.list_field(p_list text, p_field text)
returns table (kind text, expr text, options text[])
language sql stable set search_path = app, public as $$
  select * from app.list_field_phase3(p_list, p_field)
  union all
  select f.kind, f.expr, f.options
  from (values
    ('providers', 'name', 'text', 'x.name', null::text[]),
    ('providers', 'category', 'list', 'x.category', (select array_agg(key order by position) from app.provider_categories)),
    ('providers', 'city', 'text', $e$concat_ws(' ', x.city, x.district)$e$, null),
    ('providers', 'is_active', 'boolean', 'x.is_active', null),
    ('providers', 'is_demo', 'boolean', 'x.is_demo', null),
    ('providers', 'has_image', 'boolean', '(x.image_url is not null)', null),
    ('providers', 'contacts', 'number', 'x.contacts', null),
    ('providers', 'created_at', 'date', $e$(x.created_at at time zone 'Africa/Porto-Novo')::date$e$, null)
  ) f(list, field, kind, expr, options)
  where f.list = p_list and f.field = p_field
$$;

create function app.list_sort_field(p_list text, p_field text) returns text
language sql immutable set search_path = app, public as $$
  select coalesce(
    app.list_sort_field_phase3(p_list, p_field),
    (select s.expr from (values
      ('providers', 'name', 'lower(x.name)'),
      ('providers', 'category', 'x.category'),
      ('providers', 'contacts', 'x.contacts'),
      ('providers', 'created_at', 'x.created_at')
    ) s(list, field, expr) where s.list = p_list and s.field = p_field)
  )
$$;

create function app.list_columns(p_list text) returns text[]
language sql immutable set search_path = app, public as $$
  select coalesce(app.list_columns_phase3(p_list), case p_list
    when 'providers' then array['category', 'city', 'contacts', 'status']
  end)
$$;

create function app.list_sort_sql(p_list text, p_sort jsonb) returns text
language plpgsql stable set search_path = app, public as $$
begin
  if (p_sort is null or jsonb_typeof(p_sort) = 'null') and p_list = 'providers' then
    return 'x.category, lower(x.name), x.id';
  end if;
  return app.list_sort_sql_phase3(p_list, p_sort);
end $$;

create function app.list_rows_sql(p_list text, p_filter jsonb, p_sort jsonb) returns text
language plpgsql stable set search_path = app, public as $$
declare
  v_where text := 'true';
  v_rows text;
begin
  if p_list <> 'providers' then return app.list_rows_sql_phase3(p_list, p_filter, p_sort); end if;
  v_rows := $q$
    select pr.id, pr.name, pr.category, pr.city, pr.district, pr.phone, pr.whatsapp, pr.price_range, pr.image_url,
           pr.is_active, pr.is_demo, pr.created_at,
           (select count(*)::integer from app.provider_contacts k where k.provider_id = pr.id) as contacts
    from app.providers pr
  $q$;
  if p_filter is not null and jsonb_typeof(p_filter) <> 'null' then
    if app.filter_condition_count(p_filter) > 20 then raise exception 'invalid_filter'; end if;
    v_where := app.list_filter_sql(p_list, p_filter);
  end if;
  return format('with x as (%s) select x.*, (count(*) over ())::integer as total from x where %s order by %s',
    v_rows, v_where, app.list_sort_sql(p_list, p_sort));
end $$;

create or replace function app.can_use_list(p_list text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select case p_list
    when 'members' then app.has_permission('members.manage')
    when 'payments' then app.has_permission('payments.read')
    when 'verifications' then app.has_permission('verifications.review')
    when 'events' then app.has_permission('events.manage')
    when 'venues' then app.has_permission('events.manage')
    when 'themes' then app.has_permission('events.manage')
    when 'moderation' then app.has_permission('profile_texts.review')
    when 'discoveries' then app.has_permission('events.manage')
    when 'couples' then app.has_permission('couples.read')
    when 'providers' then app.has_permission('providers.manage')
    else false
  end
$$;

alter table app.saved_filters
  drop constraint saved_filters_resource,
  add constraint saved_filters_resource
    check (resource in ('members', 'payments', 'verifications', 'events', 'venues', 'themes', 'moderation', 'discoveries', 'couples', 'providers'));

-- Vitrine sans compte : le rôle anonyme n'obtient que l'usage du schéma, la lecture des
-- catégories et app.public_providers (aucune autre table ni fonction ne lui est accordée)
grant usage on schema app to anon;
grant execute on function
  app.public_providers(boolean)
to anon, authenticated, service_role;
grant execute on function
  app.list_field(text, text),
  app.list_sort_field(text, text),
  app.list_columns(text),
  app.list_sort_sql(text, jsonb),
  app.list_rows_sql(text, jsonb, jsonb)
to authenticated, service_role;
grant execute on function
  app.can_see_provider_contacts(),
  app.member_providers(boolean),
  app.mark_provider_contacted(uuid),
  app.admin_save_provider(uuid, text, text, jsonb, text, text, text, text, text, boolean),
  app.admin_set_provider_active(uuid, boolean),
  app.admin_set_provider_image(uuid, text, text),
  app.admin_provider(uuid),
  app.admin_save_provider_category(text, jsonb, integer, boolean)
to authenticated, service_role;
