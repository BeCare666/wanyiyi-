-- Phase 2, étape 5 : filtres avancés de l'administration (section 11.3), liste des membres.
--   - Filtre en arbre JSON : groupes ET / OU imbriqués (3 niveaux, 20 conditions au plus).
--       groupe    : {"op": "and" | "or", "items": [...]}
--       condition : {"field": "...", "cmp": "...", "value": ...}
--   - Champs en liste blanche, chacun avec sa comparaison :
--       texte (contains)        : name, member_number, phone, city
--       liste (in)              : status, role, sex
--       plage numérique (between, [min, max], bornes facultatives) : age, evenings_attended, matches
--       plage de dates (between, ["AAAA-MM-JJ", "AAAA-MM-JJ"], heure de Cotonou) : created_at
--       oui / non (is)          : evenings_blocked, sanctioned
--   - Tri sur plusieurs colonnes (3 au plus) : [{"field": "...", "dir": "asc" | "desc"}].
--   - Le SQL est construit avec des expressions fixes et des valeurs échappées (%L) :
--     aucune saisie n'entre telle quelle dans la requête.
--   - Filtres enregistrés, personnels ou partagés entre administrateurs.

-- ---------------------------------------------------------------------
-- 1. Traduction d'un filtre en condition SQL
-- ---------------------------------------------------------------------
create function app.member_filter_sql(p_node jsonb, p_depth integer default 0) returns text
language plpgsql immutable set search_path = app, public as $$
declare
  v_parts text[] := '{}';
  v_item jsonb;
  v_field text;
  v_cmp text;
  v_value jsonb;
  v_expr text;
  v_low jsonb;
  v_high jsonb;
  v_conds text[] := '{}';
begin
  if p_node is null or jsonb_typeof(p_node) <> 'object' then raise exception 'invalid_filter'; end if;

  -- Groupe
  if p_node ? 'op' then
    if p_depth >= 3 or p_node->>'op' not in ('and', 'or') or jsonb_typeof(p_node->'items') <> 'array' then
      raise exception 'invalid_filter';
    end if;
    for v_item in select * from jsonb_array_elements(p_node->'items') loop
      v_parts := v_parts || app.member_filter_sql(v_item, p_depth + 1);
    end loop;
    if cardinality(v_parts) = 0 then return 'true'; end if;
    return '(' || array_to_string(v_parts, case when p_node->>'op' = 'and' then ' and ' else ' or ' end) || ')';
  end if;

  -- Condition
  v_field := p_node->>'field';
  v_cmp := p_node->>'cmp';
  v_value := p_node->'value';

  if v_field in ('name', 'member_number', 'phone', 'city') then
    if v_cmp <> 'contains' or jsonb_typeof(v_value) <> 'string' or char_length(v_value #>> '{}') not between 1 and 100 then
      raise exception 'invalid_filter';
    end if;
    v_expr := case v_field
      when 'name' then $e$(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, ''))$e$
      when 'member_number' then 'm.member_number'
      when 'phone' then 'm.phone'
      else 'm.city'
    end;
    return format('%s ilike %L', v_expr, '%' || (v_value #>> '{}') || '%');
  end if;

  if v_field in ('status', 'role', 'sex') then
    if v_cmp <> 'in' or jsonb_typeof(v_value) <> 'array' or jsonb_array_length(v_value) = 0
       or exists (select 1 from jsonb_array_elements(v_value) e where jsonb_typeof(e) <> 'string')
       or exists (
         select 1 from jsonb_array_elements_text(v_value) v
         where v not in (
           select unnest(case v_field
             when 'status' then enum_range(null::app.member_status)::text[]
             when 'role' then enum_range(null::app.role)::text[]
             else enum_range(null::app.sex)::text[]
           end)
         )
       ) then
      raise exception 'invalid_filter';
    end if;
    return format('m.%I::text = any(%L::text[])', v_field, array(select jsonb_array_elements_text(v_value)));
  end if;

  if v_field in ('age', 'evenings_attended', 'matches', 'created_at') then
    if v_cmp <> 'between' or jsonb_typeof(v_value) <> 'array' or jsonb_array_length(v_value) <> 2 then
      raise exception 'invalid_filter';
    end if;
    v_low := v_value->0;
    v_high := v_value->1;
    v_expr := case v_field
      when 'created_at' then $e$(m.created_at at time zone 'Africa/Porto-Novo')::date$e$
      else 'm.' || v_field
    end;
    for v_item, v_cmp in select * from (values (v_low, '>='), (v_high, '<=')) b(bound, op) loop
      if jsonb_typeof(v_item) = 'null' then continue; end if;
      if v_field = 'created_at' then
        if jsonb_typeof(v_item) <> 'string' or (v_item #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_filter'; end if;
        v_conds := v_conds || format('%s %s %L::date', v_expr, v_cmp, v_item #>> '{}');
      else
        if jsonb_typeof(v_item) <> 'number' or (v_item #>> '{}') !~ '^\d{1,4}$' then raise exception 'invalid_filter'; end if;
        v_conds := v_conds || format('%s %s %s', v_expr, v_cmp, (v_item #>> '{}')::integer);
      end if;
    end loop;
    if cardinality(v_conds) = 0 then raise exception 'invalid_filter'; end if;
    return '(' || array_to_string(v_conds, ' and ') || ')';
  end if;

  if v_field in ('evenings_blocked', 'sanctioned') then
    if v_cmp <> 'is' or jsonb_typeof(v_value) <> 'boolean' then raise exception 'invalid_filter'; end if;
    return format('m.%I = %s', v_field, case when (v_value::text)::boolean then 'true' else 'false' end);
  end if;

  raise exception 'invalid_filter';
end $$;

-- Nombre de conditions d'un filtre (limite : 20)
create function app.filter_condition_count(p_node jsonb) returns integer
language sql immutable set search_path = app, public as $$
  select case
    when jsonb_typeof(p_node) = 'object' and p_node ? 'op' and jsonb_typeof(p_node->'items') = 'array'
      then coalesce((select sum(app.filter_condition_count(e))::integer from jsonb_array_elements(p_node->'items') e), 0)
    else 1
  end
$$;

-- Tri : 3 colonnes au plus, en liste blanche ; l'identifiant départage toujours
create function app.member_sort_sql(p_sort jsonb) returns text
language plpgsql immutable set search_path = app, public as $$
declare
  v_item jsonb;
  v_parts text[] := '{}';
  v_seen text[] := '{}';
  v_field text;
  v_dir text;
begin
  if p_sort is null or jsonb_typeof(p_sort) = 'null' then return 'm.created_at desc, m.user_id'; end if;
  if jsonb_typeof(p_sort) <> 'array' or jsonb_array_length(p_sort) > 3 then raise exception 'invalid_sort'; end if;
  for v_item in select * from jsonb_array_elements(p_sort) loop
    v_field := v_item->>'field';
    v_dir := coalesce(v_item->>'dir', 'asc');
    if v_field not in ('created_at', 'name', 'age', 'evenings_attended', 'matches', 'member_number', 'status')
       or v_dir not in ('asc', 'desc') or v_field = any(v_seen) then
      raise exception 'invalid_sort';
    end if;
    v_seen := v_seen || v_field;
    v_parts := v_parts || format('%s %s nulls last',
      case v_field
        when 'name' then $e$lower(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, ''))$e$
        when 'status' then 'm.status::text'
        else 'm.' || v_field
      end, v_dir);
  end loop;
  return array_to_string(v_parts || 'm.user_id'::text, ', ');
end $$;

-- ---------------------------------------------------------------------
-- 2. Liste des membres filtrée (mêmes colonnes que admin_members)
-- ---------------------------------------------------------------------
-- Requête complète (sans limite) d'un filtre et d'un tri validés : partagée par la liste et l'export
create function app.member_rows_sql(p_filter jsonb, p_sort jsonb) returns text
language plpgsql immutable set search_path = app, public as $$
declare
  v_where text := 'true';
begin
  if p_filter is not null and jsonb_typeof(p_filter) <> 'null' then
    if app.filter_condition_count(p_filter) > 20 then raise exception 'invalid_filter'; end if;
    v_where := app.member_filter_sql(p_filter);
  end if;
  return format($q$
      with m as (
        select u.id as user_id, u.member_number, u.phone, u.role, p.first_name, p.last_name, p.sex, p.birth_date, p.city, p.status, u.created_at,
               date_part('year', age((now() at time zone 'Africa/Porto-Novo')::date, p.birth_date))::integer as age,
               (select count(*)::integer from app.event_registrations r where r.user_id = u.id and r.status = 'checked_in') as evenings_attended,
               (select count(*)::integer from app.matches x where u.id in (x.member_a, x.member_b)) as matches,
               coalesce(p.evenings_blocked_until > now(), false) as evenings_blocked,
               exists (select 1 from app.sanctions s where s.user_id = u.id) as sanctioned
        from app.users u
        left join app.member_profiles p on p.user_id = u.id
      )
      select m.user_id, m.member_number, m.phone, m.role, m.first_name, m.last_name, m.sex, m.birth_date, m.city, m.status, m.created_at,
             m.evenings_attended, m.matches, (count(*) over ())::integer as total
      from m
      where %s
      order by %s
    $q$, v_where, app.member_sort_sql(p_sort));
end $$;

create function app.admin_members_filtered(
  p_filter jsonb default null,
  p_sort jsonb default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  member_number text,
  phone text,
  role app.role,
  first_name text,
  last_name text,
  sex app.sex,
  birth_date date,
  city text,
  status app.member_status,
  created_at timestamptz,
  evenings_attended integer,
  matches integer,
  total integer
)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('members.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query execute app.member_rows_sql(p_filter, p_sort)
    || format(' limit %s offset %s', greatest(1, least(coalesce(p_limit, 50), 200)), greatest(0, coalesce(p_offset, 0)));
end $$;

-- ---------------------------------------------------------------------
-- 3. Filtres enregistrés, personnels ou partagés (11.3)
-- ---------------------------------------------------------------------
-- Table prévue par le schéma initial (resource, definition : arbre ET / OU), sans politique jusqu'ici
alter table app.saved_filters
  add column sort jsonb,
  add column columns text[],
  add constraint saved_filters_resource check (resource in ('members')),
  add constraint saved_filters_name check (char_length(btrim(name)) between 1 and 80);

-- Permission requise pour la liste concernée
create function app.can_use_list(p_list text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select case p_list when 'members' then app.has_permission('members.manage') else false end
$$;

create policy saved_filters_select on app.saved_filters for select
  using (app.can_use_list(resource) and (owner_id = auth.uid() or shared));
create policy saved_filters_insert on app.saved_filters for insert
  with check (app.can_use_list(resource) and owner_id = auth.uid());
create policy saved_filters_update on app.saved_filters for update
  using (owner_id = auth.uid()) with check (app.can_use_list(resource) and owner_id = auth.uid());
create policy saved_filters_delete on app.saved_filters for delete using (owner_id = auth.uid());

-- Un filtre enregistré doit être valide : contrôlé à l'écriture
create function app.check_saved_filter() returns trigger
language plpgsql set search_path = app, public as $$
begin
  if new.resource = 'members' then
    if app.filter_condition_count(new.definition) > 20 then raise exception 'invalid_filter'; end if;
    perform app.member_filter_sql(new.definition);
    perform app.member_sort_sql(new.sort);
    -- Colonnes affichables de la liste des membres
    if new.columns is not null and (
      cardinality(new.columns) = 0
      or not new.columns <@ array['status', 'role', 'sex', 'age', 'city', 'phone', 'activity', 'joined']
    ) then
      raise exception 'invalid_columns';
    end if;
  end if;
  return new;
end $$;

create trigger saved_filters_check before insert or update on app.saved_filters
  for each row execute function app.check_saved_filter();

-- Table couverte par les droits par défaut du schéma (migration 20261014000000) ; la RLS s'applique
grant execute on function
  app.admin_members_filtered(jsonb, jsonb, integer, integer),
  app.member_filter_sql(jsonb, integer),
  app.member_sort_sql(jsonb),
  app.member_rows_sql(jsonb, jsonb),
  app.filter_condition_count(jsonb),
  app.can_use_list(text)
to authenticated, service_role;
