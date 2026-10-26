-- Phase 2, étape 5 : filtres avancés des listes Lieux, Thèmes et Modération (section 11.3,
-- question 32, réponse du 26 octobre 2026), sur le moteur de la migration 20261026000200.
--   - Lieux (events.manage) : nom, adresse, ville, partenaire, nombre de soirées, date d'ajout.
--   - Thèmes (events.manage) : nom (trois langues), âges, confessions et secteurs exigés ou non,
--     nombre de soirées, date de création.
--   - Modération (profile_texts.review) : textes en attente de relecture seulement, comme la file.
-- Les fonctions du moteur sont remplacées avec les trois nouvelles listes ; une liste est
-- reconnue par ses colonnes (app.list_columns), la liste des membres garde son moteur.

-- ---------------------------------------------------------------------
-- 1. Catalogue des champs, des tris et des colonnes
-- ---------------------------------------------------------------------
create or replace function app.list_field(p_list text, p_field text)
returns table (kind text, expr text, options text[])
language sql stable set search_path = app, public as $$
  select f.kind, f.expr, f.options
  from (values
    -- Paiements
    ('payments', 'member', 'text', $e$(coalesce(x.first_name, '') || ' ' || coalesce(x.last_name, ''))$e$, null::text[]),
    ('payments', 'member_number', 'text', 'x.member_number', null),
    ('payments', 'reference', 'text', 'x.provider_transaction_id', null),
    ('payments', 'status', 'list', 'x.status::text', enum_range(null::app.payment_status)::text[]),
    ('payments', 'purpose', 'list', 'x.purpose::text', enum_range(null::app.payment_purpose)::text[]),
    ('payments', 'provider', 'list', 'x.provider::text', enum_range(null::app.payment_provider)::text[]),
    ('payments', 'refund', 'list', 'x.refund', array['requested', 'refunded', 'none']),
    ('payments', 'amount', 'number', 'x.amount_xof', null),
    ('payments', 'refunded_amount', 'number', 'x.refunded_amount_xof', null),
    ('payments', 'created_at', 'date', $e$(x.created_at at time zone 'Africa/Porto-Novo')::date$e$, null),
    ('payments', 'event_date', 'date', $e$(x.event_starts_at at time zone 'Africa/Porto-Novo')::date$e$, null),
    ('payments', 'reconciled', 'boolean', '(x.reconciled_at is not null)', null),
    -- Vérifications (tous les dossiers, traités compris)
    ('verifications', 'member', 'text', $e$(coalesce(x.first_name, '') || ' ' || coalesce(x.last_name, ''))$e$, null),
    ('verifications', 'member_number', 'text', 'x.member_number', null),
    ('verifications', 'status', 'list', 'x.status::text', enum_range(null::app.verification_status)::text[]),
    ('verifications', 'document_kind', 'list', 'x.document_kind::text', array['id_card', 'passport', 'driving_licence', 'other']),
    ('verifications', 'declared_status', 'list', 'x.declared_status', array['single', 'divorced', 'widowed', 'other']),
    ('verifications', 'sex', 'list', 'x.sex::text', enum_range(null::app.sex)::text[]),
    ('verifications', 'age', 'number', 'x.age', null),
    ('verifications', 'submitted_at', 'date', $e$(x.submitted_at at time zone 'Africa/Porto-Novo')::date$e$, null),
    ('verifications', 'created_at', 'date', $e$(x.created_at at time zone 'Africa/Porto-Novo')::date$e$, null),
    ('verifications', 'ready', 'boolean', 'x.ready', null),
    ('verifications', 'has_selfie', 'boolean', 'x.has_selfie', null),
    -- Soirées
    ('events', 'venue', 'text', 'x.venue_name', null),
    ('events', 'theme', 'text', 'x.theme_key', null),
    ('events', 'status', 'list', 'x.status::text', enum_range(null::app.event_status)::text[]),
    ('events', 'starts_at', 'date', $e$(x.starts_at at time zone 'Africa/Porto-Novo')::date$e$, null),
    ('events', 'price', 'number', 'x.price_xof', null),
    ('events', 'taken_women', 'number', 'x.taken_women', null),
    ('events', 'taken_men', 'number', 'x.taken_men', null),
    ('events', 'waiting', 'number', '(x.waiting_women + x.waiting_men)', null),
    ('events', 'matches', 'number', 'x.matches', null),
    ('events', 'has_venue', 'boolean', '(x.venue_name is not null)', null),
    -- Lieux
    ('venues', 'name', 'text', 'x.name', null),
    ('venues', 'address', 'text', 'x.address', null),
    ('venues', 'city', 'text', 'x.city', null),
    ('venues', 'is_partner', 'boolean', 'x.is_partner', null),
    ('venues', 'events', 'number', 'x.events', null),
    ('venues', 'created_at', 'date', $e$(x.created_at at time zone 'Africa/Porto-Novo')::date$e$, null),
    -- Thèmes
    ('themes', 'name', 'text', 'x.name_text', null),
    ('themes', 'min_age', 'number', 'x.min_age', null),
    ('themes', 'max_age', 'number', 'x.max_age', null),
    ('themes', 'has_religions', 'boolean', '(coalesce(cardinality(x.required_religions), 0) > 0)', null),
    ('themes', 'has_sectors', 'boolean', '(coalesce(cardinality(x.sectors), 0) > 0)', null),
    ('themes', 'events', 'number', 'x.events', null),
    ('themes', 'created_at', 'date', $e$(x.created_at at time zone 'Africa/Porto-Novo')::date$e$, null),
    -- Modération des textes (en attente)
    ('moderation', 'member', 'text', 'x.first_name', null),
    ('moderation', 'member_number', 'text', 'x.member_number', null),
    ('moderation', 'field', 'list', 'x.field', array['who_i_am', 'what_matters', 'evening_topic']),
    ('moderation', 'body', 'text', 'x.body', null),
    ('moderation', 'created_at', 'date', $e$(x.created_at at time zone 'Africa/Porto-Novo')::date$e$, null)
  ) f(list, field, kind, expr, options)
  where f.list = p_list and f.field = p_field
$$;

create or replace function app.list_sort_field(p_list text, p_field text) returns text
language sql immutable set search_path = app, public as $$
  select s.expr
  from (values
    ('payments', 'created_at', 'x.created_at'),
    ('payments', 'member', $e$lower(coalesce(x.first_name, '') || ' ' || coalesce(x.last_name, ''))$e$),
    ('payments', 'amount', 'x.amount_xof'),
    ('payments', 'status', 'x.status::text'),
    ('payments', 'event_date', 'x.event_starts_at'),
    ('verifications', 'submitted_at', 'x.submitted_at'),
    ('verifications', 'created_at', 'x.created_at'),
    ('verifications', 'member', $e$lower(coalesce(x.first_name, '') || ' ' || coalesce(x.last_name, ''))$e$),
    ('verifications', 'status', 'x.status::text'),
    ('verifications', 'age', 'x.age'),
    ('events', 'starts_at', 'x.starts_at'),
    ('events', 'status', 'x.status::text'),
    ('events', 'price', 'x.price_xof'),
    ('events', 'matches', 'x.matches'),
    ('venues', 'name', 'lower(x.name)'),
    ('venues', 'city', 'lower(x.city)'),
    ('venues', 'events', 'x.events'),
    ('venues', 'created_at', 'x.created_at'),
    ('themes', 'name', $e$lower(coalesce(x.name->>'fr', x.key))$e$),
    ('themes', 'events', 'x.events'),
    ('themes', 'created_at', 'x.created_at'),
    ('moderation', 'created_at', 'x.created_at'),
    ('moderation', 'member', 'lower(x.first_name)'),
    ('moderation', 'field', 'x.field')
  ) s(list, field, expr)
  where s.list = p_list and s.field = p_field
$$;

-- Colonnes affichables ; null : liste inconnue de ce moteur (les membres ont le leur)
create or replace function app.list_columns(p_list text) returns text[]
language sql immutable set search_path = app, public as $$
  select case p_list
    when 'payments' then array['date', 'purpose', 'status', 'provider', 'amount']
    when 'verifications' then array['status', 'dossier', 'declared', 'age', 'submitted']
    when 'events' then array['status', 'women', 'men', 'price', 'matches']
    when 'venues' then array['address', 'city', 'events']
    when 'themes' then array['criteria', 'events']
    when 'moderation' then array['field', 'date']
  end
$$;

-- ---------------------------------------------------------------------
-- 2. Tri par défaut et requête de chaque liste
-- ---------------------------------------------------------------------
create or replace function app.list_sort_sql(p_list text, p_sort jsonb) returns text
language plpgsql stable set search_path = app, public as $$
declare
  v_item jsonb;
  v_parts text[] := '{}';
  v_seen text[] := '{}';
  v_expr text;
  v_dir text;
  v_id text := case p_list when 'payments' then 'x.payment_id' when 'verifications' then 'x.verification_id' when 'moderation' then 'x.text_id' else 'x.id' end;
begin
  if p_sort is null or jsonb_typeof(p_sort) = 'null' then
    -- Ordre d'avant les filtres de chaque liste
    return case p_list
      when 'payments' then 'x.created_at desc, x.payment_id'
      when 'verifications' then 'x.submitted_at nulls last, x.created_at, x.verification_id'
      when 'venues' then 'x.name, x.id'
      when 'themes' then 'x.created_at, x.id'
      when 'moderation' then 'x.created_at, x.text_id'
      else 'x.starts_at desc, x.id'
    end;
  end if;
  if jsonb_typeof(p_sort) <> 'array' or jsonb_array_length(p_sort) > 3 then raise exception 'invalid_sort'; end if;
  for v_item in select * from jsonb_array_elements(p_sort) loop
    v_expr := app.list_sort_field(p_list, v_item->>'field');
    v_dir := coalesce(v_item->>'dir', 'asc');
    if v_expr is null or v_dir not in ('asc', 'desc') or (v_item->>'field') = any(v_seen) then
      raise exception 'invalid_sort';
    end if;
    v_seen := v_seen || (v_item->>'field');
    v_parts := v_parts || format('%s %s nulls last', v_expr, v_dir);
  end loop;
  return array_to_string(v_parts || v_id, ', ');
end $$;

create or replace function app.list_rows_sql(p_list text, p_filter jsonb, p_sort jsonb) returns text
language plpgsql stable set search_path = app, public as $$
declare
  v_where text := 'true';
  v_rows text;
begin
  v_rows := case p_list
    -- Mêmes colonnes que app.admin_payments
    when 'payments' then $q$
      select p.id as payment_id, p.created_at, p.user_id, u.member_number, mp.first_name, mp.last_name,
             p.purpose, p.amount_xof, p.provider, p.provider_transaction_id, p.status,
             p.refunded_amount_xof, p.refund_requested_at, p.reconciled_at,
             r.event_id, e.starts_at as event_starts_at,
             case when p.status = 'refunded' then 'refunded'
                  when p.status = 'succeeded' and p.refund_requested_at is not null then 'requested'
                  else 'none' end as refund
      from app.payments p
      left join app.users u on u.id = p.user_id
      left join app.member_profiles mp on mp.user_id = p.user_id
      left join app.event_registrations r on r.payment_id = p.id
      left join app.events e on e.id = r.event_id
    $q$
    -- Colonnes de app.verification_queue, plus sexe, âge et décision ; tous les dossiers
    when 'verifications' then $q$
      select v.id as verification_id, v.user_id, u.member_number, p.first_name, p.last_name, v.status, v.created_at,
             greatest(
               (select max(d.uploaded_at) from app.id_documents d where d.verification_id = v.id and d.superseded_at is null),
               (select max(h.signed_at) from app.honor_declarations h where h.user_id = v.user_id)
             ) as submitted_at,
             (select d.kind from app.id_documents d where d.verification_id = v.id and d.superseded_at is null and d.kind <> 'selfie' limit 1) as document_kind,
             exists (select 1 from app.id_documents d where d.verification_id = v.id and d.superseded_at is null and d.kind = 'selfie') as has_selfie,
             (select h.declared_marital_status from app.honor_declarations h where h.user_id = v.user_id order by h.signed_at desc limit 1) as declared_status,
             app.dossier_complete(v.user_id) as ready,
             p.sex,
             date_part('year', age((now() at time zone 'Africa/Porto-Novo')::date, p.birth_date))::integer as age,
             v.decided_at
      from app.verifications v
      join app.users u on u.id = v.user_id
      left join app.member_profiles p on p.user_id = v.user_id
    $q$
    -- Mêmes colonnes que app.admin_events
    when 'events' then $q$
      select e.id, e.starts_at, e.status, ve.name as venue_name, t.key as theme_key, e.price_xof,
             e.capacity_women::integer as capacity_women, e.capacity_men::integer as capacity_men,
             app.seats_taken(e.id, 'female') as taken_women, app.seats_taken(e.id, 'male') as taken_men,
             (select count(*)::integer from app.waitlist_entries w where w.event_id = e.id and w.sex = 'female') as waiting_women,
             (select count(*)::integer from app.waitlist_entries w where w.event_id = e.id and w.sex = 'male') as waiting_men,
             (select count(*)::integer from app.matches m where m.event_id = e.id) as matches
      from app.events e
      left join app.venues ve on ve.id = e.venue_id
      left join app.themes t on t.id = e.theme_id
    $q$
    -- Lieux et nombre de soirées qui les utilisent
    when 'venues' then $q$
      select v.id, v.name, v.address, v.city, v.is_partner, v.created_at,
             (select count(*)::integer from app.events e where e.venue_id = v.id) as events
      from app.venues v
    $q$
    -- Thèmes ; nom cherché dans les trois langues et la clé
    when 'themes' then $q$
      select t.id, t.key, t.name, t.min_age::integer as min_age, t.max_age::integer as max_age,
             t.required_religions, t.sectors, t.created_at,
             concat_ws(' ', t.name->>'fr', t.name->>'en', t.name->>'yo', t.key) as name_text,
             (select count(*)::integer from app.events e where e.theme_id = t.id) as events
      from app.themes t
    $q$
    -- Mêmes colonnes que app.moderation_queue : textes en attente seulement
    when 'moderation' then $q$
      select t.id as text_id, t.user_id, p.first_name, u.member_number, t.field, t.body, t.created_at
      from app.profile_texts t
      join app.users u on u.id = t.user_id
      left join app.member_profiles p on p.user_id = t.user_id
      where t.review_status = 'pending'
    $q$
  end;
  if v_rows is null then raise exception 'invalid_list'; end if;
  if p_filter is not null and jsonb_typeof(p_filter) <> 'null' then
    if app.filter_condition_count(p_filter) > 20 then raise exception 'invalid_filter'; end if;
    v_where := app.list_filter_sql(p_list, p_filter);
  end if;
  return format('with x as (%s) select x.*, (count(*) over ())::integer as total from x where %s order by %s',
    v_rows, v_where, app.list_sort_sql(p_list, p_sort));
end $$;

-- ---------------------------------------------------------------------
-- 3. Permissions, liste et export : toute liste de ce moteur
-- ---------------------------------------------------------------------
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
    else false
  end
$$;

create or replace function app.admin_list(
  p_list text,
  p_filter jsonb default null,
  p_sort jsonb default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns setof jsonb
language plpgsql stable security definer set search_path = app, public as $$
begin
  if app.list_columns(p_list) is null or not app.can_use_list(p_list) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query execute format('select to_jsonb(r) from (%s limit %s offset %s) r',
    app.list_rows_sql(p_list, p_filter, p_sort),
    greatest(1, least(coalesce(p_limit, 50), 200)), greatest(0, coalesce(p_offset, 0)));
end $$;

create or replace function app.admin_list_export(p_list text, p_filter jsonb, p_sort jsonb, p_format text)
returns setof jsonb
language plpgsql security definer set search_path = app, public as $$
declare v_count integer;
begin
  if app.list_columns(p_list) is null or not app.can_use_list(p_list) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_format is null or p_format not in ('csv', 'xlsx') then raise exception 'invalid_format'; end if;
  return query execute format('select to_jsonb(r) from (%s limit 5000) r', app.list_rows_sql(p_list, p_filter, p_sort));
  get diagnostics v_count = row_count;
  perform app.audit(p_list || '.exported', p_list, null,
    jsonb_build_object('format', p_format, 'rows', v_count, 'filter', p_filter, 'sort', p_sort));
end $$;

-- ---------------------------------------------------------------------
-- 4. Filtres enregistrés
-- ---------------------------------------------------------------------
alter table app.saved_filters
  drop constraint saved_filters_resource,
  add constraint saved_filters_resource
    check (resource in ('members', 'payments', 'verifications', 'events', 'venues', 'themes', 'moderation'));
