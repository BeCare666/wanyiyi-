-- Phase 2, étape 5 : filtres avancés « sur toutes les listes » (section 11.3), après celle des
-- membres (migration 20261019000500) : paiements, vérifications et soirées.
--   - Même arbre JSON que les membres : groupes ET / OU (3 niveaux, 20 conditions au plus).
--   - Champs en liste blanche par liste (app.list_field), chacun avec son type :
--       texte (contains), liste (in), plage numérique (between, bornes entières facultatives),
--       plage de dates (between, ["AAAA-MM-JJ", ...], heure de Cotonou), oui / non (is).
--   - Tri sur 3 colonnes au plus, en liste blanche par liste ; l'identifiant départage.
--   - Liste paginée côté serveur (app.admin_list) et export CSV / Excel de 5 000 lignes au plus,
--     journalisé (app.admin_list_export) ; permission de chaque liste contrôlée par la base.
--   - Filtres enregistrés et partagés (app.saved_filters) ouverts à ces trois listes.
--   - Le SQL est construit avec des expressions fixes et des valeurs échappées (%L) :
--     aucune saisie n'entre telle quelle dans la requête.
-- La liste des membres garde ses propres fonctions (app.member_filter_sql et suivantes).

-- ---------------------------------------------------------------------
-- 1. Catalogue des champs filtrables, des tris et des colonnes
-- ---------------------------------------------------------------------
-- Expressions sur la ligne « x » de la requête de chaque liste (app.list_rows_sql)
create function app.list_field(p_list text, p_field text)
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
    ('events', 'has_venue', 'boolean', '(x.venue_name is not null)', null)
  ) f(list, field, kind, expr, options)
  where f.list = p_list and f.field = p_field
$$;

-- Colonnes de tri : expression, et identifiant qui départage
create function app.list_sort_field(p_list text, p_field text) returns text
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
    ('events', 'matches', 'x.matches')
  ) s(list, field, expr)
  where s.list = p_list and s.field = p_field
$$;

-- Colonnes affichables de chaque liste (filtres enregistrés)
create function app.list_columns(p_list text) returns text[]
language sql immutable set search_path = app, public as $$
  select case p_list
    when 'payments' then array['date', 'purpose', 'status', 'provider', 'amount']
    when 'verifications' then array['status', 'dossier', 'declared', 'age', 'submitted']
    when 'events' then array['status', 'women', 'men', 'price', 'matches']
  end
$$;

-- ---------------------------------------------------------------------
-- 2. Traduction d'un filtre et d'un tri en SQL
-- ---------------------------------------------------------------------
create function app.list_filter_sql(p_list text, p_node jsonb, p_depth integer default 0) returns text
language plpgsql stable set search_path = app, public as $$
declare
  v_parts text[] := '{}';
  v_item jsonb;
  v_cmp text;
  v_value jsonb;
  v_field record;
  v_conds text[] := '{}';
begin
  if p_node is null or jsonb_typeof(p_node) <> 'object' then raise exception 'invalid_filter'; end if;

  -- Groupe
  if p_node ? 'op' then
    if p_depth >= 3 or p_node->>'op' not in ('and', 'or') or jsonb_typeof(p_node->'items') <> 'array' then
      raise exception 'invalid_filter';
    end if;
    for v_item in select * from jsonb_array_elements(p_node->'items') loop
      v_parts := v_parts || app.list_filter_sql(p_list, v_item, p_depth + 1);
    end loop;
    if cardinality(v_parts) = 0 then return 'true'; end if;
    return '(' || array_to_string(v_parts, case when p_node->>'op' = 'and' then ' and ' else ' or ' end) || ')';
  end if;

  -- Condition : champ du catalogue de la liste seulement
  select * into v_field from app.list_field(p_list, p_node->>'field');
  if not found then raise exception 'invalid_filter'; end if;
  v_cmp := p_node->>'cmp';
  v_value := p_node->'value';

  if v_field.kind = 'text' then
    if v_cmp is distinct from 'contains' or jsonb_typeof(v_value) is distinct from 'string'
       or char_length(v_value #>> '{}') not between 1 and 100 then
      raise exception 'invalid_filter';
    end if;
    return format('%s ilike %L', v_field.expr, '%' || (v_value #>> '{}') || '%');
  end if;

  if v_field.kind = 'list' then
    if v_cmp is distinct from 'in' or jsonb_typeof(v_value) is distinct from 'array' or jsonb_array_length(v_value) = 0
       or exists (select 1 from jsonb_array_elements(v_value) e where jsonb_typeof(e) <> 'string')
       or exists (select 1 from jsonb_array_elements_text(v_value) v where v <> all (v_field.options)) then
      raise exception 'invalid_filter';
    end if;
    return format('%s = any(%L::text[])', v_field.expr, array(select jsonb_array_elements_text(v_value)));
  end if;

  if v_field.kind = 'boolean' then
    if v_cmp is distinct from 'is' or jsonb_typeof(v_value) is distinct from 'boolean' then raise exception 'invalid_filter'; end if;
    return format('%s = %s', v_field.expr, case when (v_value::text)::boolean then 'true' else 'false' end);
  end if;

  -- Plages : nombres entiers (montants en francs CFA compris) ou dates
  if v_cmp is distinct from 'between' or jsonb_typeof(v_value) is distinct from 'array' or jsonb_array_length(v_value) <> 2 then
    raise exception 'invalid_filter';
  end if;
  for v_item, v_cmp in select * from (values (v_value->0, '>='), (v_value->1, '<=')) b(bound, op) loop
    if jsonb_typeof(v_item) = 'null' then continue; end if;
    if v_field.kind = 'date' then
      if jsonb_typeof(v_item) <> 'string' or (v_item #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_filter'; end if;
      v_conds := v_conds || format('%s %s %L::date', v_field.expr, v_cmp, v_item #>> '{}');
    else
      if jsonb_typeof(v_item) <> 'number' or (v_item #>> '{}') !~ '^\d{1,9}$' then raise exception 'invalid_filter'; end if;
      v_conds := v_conds || format('%s %s %s', v_field.expr, v_cmp, (v_item #>> '{}')::integer);
    end if;
  end loop;
  if cardinality(v_conds) = 0 then raise exception 'invalid_filter'; end if;
  return '(' || array_to_string(v_conds, ' and ') || ')';
end $$;

create function app.list_sort_sql(p_list text, p_sort jsonb) returns text
language plpgsql stable set search_path = app, public as $$
declare
  v_item jsonb;
  v_parts text[] := '{}';
  v_seen text[] := '{}';
  v_expr text;
  v_dir text;
  v_id text := case p_list when 'payments' then 'x.payment_id' when 'verifications' then 'x.verification_id' else 'x.id' end;
begin
  if p_sort is null or jsonb_typeof(p_sort) = 'null' then
    -- Ordre d'avant les filtres : paiements et soirées récents d'abord, file la plus ancienne d'abord
    return case p_list
      when 'payments' then 'x.created_at desc, x.payment_id'
      when 'verifications' then 'x.submitted_at nulls last, x.created_at, x.verification_id'
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

-- ---------------------------------------------------------------------
-- 3. Requête complète d'une liste (sans limite) : partagée par la liste et l'export
-- ---------------------------------------------------------------------
create function app.list_rows_sql(p_list text, p_filter jsonb, p_sort jsonb) returns text
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
-- 4. Permissions, liste paginée et export journalisé
-- ---------------------------------------------------------------------
-- Permission requise pour chaque liste (remplace la version des membres seuls)
create or replace function app.can_use_list(p_list text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select case p_list
    when 'members' then app.has_permission('members.manage')
    when 'payments' then app.has_permission('payments.read')
    when 'verifications' then app.has_permission('verifications.review')
    when 'events' then app.has_permission('events.manage')
    else false
  end
$$;

-- Une ligne JSON par résultat (colonnes de la liste et « total » : nombre de lignes du filtre)
create function app.admin_list(
  p_list text,
  p_filter jsonb default null,
  p_sort jsonb default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns setof jsonb
language plpgsql stable security definer set search_path = app, public as $$
begin
  if p_list not in ('payments', 'verifications', 'events') or not app.can_use_list(p_list) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query execute format('select to_jsonb(r) from (%s limit %s offset %s) r',
    app.list_rows_sql(p_list, p_filter, p_sort),
    greatest(1, least(coalesce(p_limit, 50), 200)), greatest(0, coalesce(p_offset, 0)));
end $$;

-- Export du résultat filtré : 5 000 lignes au plus, journalisé (format, lignes, filtre, tri)
create function app.admin_list_export(p_list text, p_filter jsonb, p_sort jsonb, p_format text)
returns setof jsonb
language plpgsql security definer set search_path = app, public as $$
declare v_count integer;
begin
  if p_list not in ('payments', 'verifications', 'events') or not app.can_use_list(p_list) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_format is null or p_format not in ('csv', 'xlsx') then raise exception 'invalid_format'; end if;
  return query execute format('select to_jsonb(r) from (%s limit 5000) r', app.list_rows_sql(p_list, p_filter, p_sort));
  get diagnostics v_count = row_count;
  perform app.audit(p_list || '.exported', p_list, null,
    jsonb_build_object('format', p_format, 'rows', v_count, 'filter', p_filter, 'sort', p_sort));
end $$;

-- ---------------------------------------------------------------------
-- 5. Filtres enregistrés ouverts aux trois listes
-- ---------------------------------------------------------------------
alter table app.saved_filters
  drop constraint saved_filters_resource,
  add constraint saved_filters_resource check (resource in ('members', 'payments', 'verifications', 'events'));

create or replace function app.check_saved_filter() returns trigger
language plpgsql set search_path = app, public as $$
begin
  if app.filter_condition_count(new.definition) > 20 then raise exception 'invalid_filter'; end if;
  if new.resource = 'members' then
    perform app.member_filter_sql(new.definition);
    perform app.member_sort_sql(new.sort);
    -- Colonnes affichables de la liste des membres
    if new.columns is not null and (
      cardinality(new.columns) = 0
      or not new.columns <@ array['status', 'role', 'sex', 'age', 'city', 'phone', 'activity', 'joined']
    ) then
      raise exception 'invalid_columns';
    end if;
  else
    perform app.list_filter_sql(new.resource, new.definition);
    perform app.list_sort_sql(new.resource, new.sort);
    if new.columns is not null and (cardinality(new.columns) = 0 or not new.columns <@ app.list_columns(new.resource)) then
      raise exception 'invalid_columns';
    end if;
  end if;
  return new;
end $$;

grant execute on function
  app.list_field(text, text),
  app.list_sort_field(text, text),
  app.list_columns(text),
  app.list_filter_sql(text, jsonb, integer),
  app.list_sort_sql(text, jsonb),
  app.list_rows_sql(text, jsonb, jsonb),
  app.admin_list(text, jsonb, jsonb, integer, integer),
  app.admin_list_export(text, jsonb, jsonb, text)
to authenticated, service_role;
