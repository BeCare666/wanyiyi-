-- Phase 3, étape 7 : administration des matchs et découvertes (11.2-6), des couples (11.2-7) et
-- des conseillers (11.2-8 ; question 9 a, réponse du 26 octobre 2026 : l'administration crée le
-- conseiller à partir d'un compte existant).
--   - Listes « discoveries » et « couples » ajoutées au moteur de filtres de la migration
--     20261026000200 (filtres ET / OU, tri, colonnes, filtres enregistrés, export journalisé).
--   - Nouvelles permissions : couples.read et counselors.manage (administration et super
--     administration). Les matchs et découvertes suivent events.manage, comme les soirées.
--   - Création d'un conseiller : seul passage de rôle permis hors super administration, de
--     « membre » à « conseiller », par app.admin_create_counselor, journalisé.
-- Les fonctions du moteur sont enveloppées : les listes déjà livrées passent par les versions
-- précédentes, renommées en *_core.

-- Blocage d'un couple par l'administration (question 9, réponse du 26 octobre 2026 ; fonctions dans
-- la migration 20261026001000)
alter table app.couples
  add column blocked_at timestamptz,
  add column blocked_reason text,
  add column blocked_by uuid references app.users (id);

insert into app.role_permissions (role, permission) values
  ('admin', 'couples.read'), ('super_admin', 'couples.read'),
  ('admin', 'counselors.manage'), ('super_admin', 'counselors.manage')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 1. Catalogue : nouvelles listes autour des fonctions existantes
-- ---------------------------------------------------------------------
alter function app.list_field(text, text) rename to list_field_core;
alter function app.list_sort_field(text, text) rename to list_sort_field_core;
alter function app.list_columns(text) rename to list_columns_core;
alter function app.list_sort_sql(text, jsonb) rename to list_sort_sql_core;
alter function app.list_rows_sql(text, jsonb, jsonb) rename to list_rows_sql_core;

create function app.list_field(p_list text, p_field text)
returns table (kind text, expr text, options text[])
language sql stable set search_path = app, public as $$
  select * from app.list_field_core(p_list, p_field)
  union all
  select f.kind, f.expr, f.options
  from (values
    -- Matchs et découvertes : les deux membres, l'état du match et de la découverte, les échéances
    ('discoveries', 'member', 'text', $e$concat_ws(' ', x.a_first_name, x.a_last_name, x.b_first_name, x.b_last_name)$e$, null::text[]),
    ('discoveries', 'member_number', 'text', $e$concat_ws(' ', x.a_number, x.b_number)$e$, null),
    ('discoveries', 'match_status', 'list', 'x.match_status::text', enum_range(null::app.match_status)::text[]),
    ('discoveries', 'discovery_status', 'list', $e$coalesce(x.discovery_status::text, 'none')$e$,
      array['none', 'active', 'extended', 'continued', 'closed', 'expired']),
    ('discoveries', 'announced_at', 'date', $e$(x.announced_at at time zone 'Africa/Porto-Novo')::date$e$, null),
    ('discoveries', 'deadline', 'date', $e$(coalesce(x.ends_at, x.pending_expires_at) at time zone 'Africa/Porto-Novo')::date$e$, null),
    ('discoveries', 'event_date', 'date', $e$(x.event_starts_at at time zone 'Africa/Porto-Novo')::date$e$, null),
    ('discoveries', 'extended', 'boolean', 'x.extended', null),
    -- Couples
    ('couples', 'member', 'text', $e$concat_ws(' ', x.a_first_name, x.a_last_name, x.b_first_name, x.b_last_name)$e$, null),
    ('couples', 'member_number', 'text', $e$concat_ws(' ', x.a_number, x.b_number)$e$, null),
    ('couples', 'status', 'list', 'x.status::text', enum_range(null::app.couple_status)::text[]),
    ('couples', 'has_counselor', 'boolean', '(x.counselor_id is not null)', null),
    ('couples', 'blocked', 'boolean', '(x.blocked_at is not null)', null),
    ('couples', 'counselor', 'text', 'x.counselor_name', null),
    ('couples', 'created_at', 'date', $e$(x.created_at at time zone 'Africa/Porto-Novo')::date$e$, null),
    ('couples', 'last_activity_at', 'date', $e$(x.last_activity_at at time zone 'Africa/Porto-Novo')::date$e$, null),
    ('couples', 'inactive_days', 'number', 'x.inactive_days', null)
  ) f(list, field, kind, expr, options)
  where f.list = p_list and f.field = p_field
$$;

create function app.list_sort_field(p_list text, p_field text) returns text
language sql immutable set search_path = app, public as $$
  select coalesce(
    app.list_sort_field_core(p_list, p_field),
    (select s.expr from (values
      ('discoveries', 'announced_at', 'x.announced_at'),
      ('discoveries', 'deadline', 'coalesce(x.ends_at, x.pending_expires_at)'),
      ('discoveries', 'event_date', 'x.event_starts_at'),
      ('couples', 'created_at', 'x.created_at'),
      ('couples', 'last_activity_at', 'x.last_activity_at'),
      ('couples', 'inactive_days', 'x.inactive_days')
    ) s(list, field, expr) where s.list = p_list and s.field = p_field)
  )
$$;

create function app.list_columns(p_list text) returns text[]
language sql immutable set search_path = app, public as $$
  select coalesce(app.list_columns_core(p_list), case p_list
    when 'discoveries' then array['event', 'status', 'deadline']
    when 'couples' then array['status', 'counselor', 'activity', 'created']
  end)
$$;

-- Ordre par défaut des nouvelles listes (chaque ligne a une colonne « id » qui départage)
create function app.list_sort_sql(p_list text, p_sort jsonb) returns text
language plpgsql stable set search_path = app, public as $$
begin
  if (p_sort is null or jsonb_typeof(p_sort) = 'null') and p_list in ('discoveries', 'couples') then
    return case p_list when 'discoveries' then 'x.announced_at desc, x.id' else 'x.created_at desc, x.id' end;
  end if;
  return app.list_sort_sql_core(p_list, p_sort);
end $$;

create function app.list_rows_sql(p_list text, p_filter jsonb, p_sort jsonb) returns text
language plpgsql stable set search_path = app, public as $$
declare
  v_where text := 'true';
  v_rows text;
begin
  if p_list not in ('discoveries', 'couples') then return app.list_rows_sql_core(p_list, p_filter, p_sort); end if;
  v_rows := case p_list
    when 'discoveries' then $q$
      select m.id, e.starts_at as event_starts_at, m.status as match_status, m.announced_at,
             app.match_pending_expires_at(m) as pending_expires_at,
             d.id as discovery_id, d.status as discovery_status, d.opened_at, d.ends_at,
             coalesce(d.extended, false) as extended, d.closed_at,
             pa.first_name as a_first_name, pa.last_name as a_last_name, ua.member_number as a_number,
             pb.first_name as b_first_name, pb.last_name as b_last_name, ub.member_number as b_number
      from app.matches m
      join app.events e on e.id = m.event_id
      left join app.discoveries d on d.match_id = m.id
      join app.users ua on ua.id = m.member_a left join app.member_profiles pa on pa.user_id = m.member_a
      join app.users ub on ub.id = m.member_b left join app.member_profiles pb on pb.user_id = m.member_b
    $q$
    else $q$
      select c.id, c.status, c.created_at, c.last_activity_at, c.ended_at, c.counselor_id, c.blocked_at, c.blocked_reason,
             co.display_name as counselor_name,
             ((now() at time zone 'Africa/Porto-Novo')::date - (c.last_activity_at at time zone 'Africa/Porto-Novo')::date) as inactive_days,
             pa.first_name as a_first_name, pa.last_name as a_last_name, ua.member_number as a_number,
             pb.first_name as b_first_name, pb.last_name as b_last_name, ub.member_number as b_number
      from app.couples c
      left join app.counselors co on co.user_id = c.counselor_id
      join app.users ua on ua.id = c.member_a left join app.member_profiles pa on pa.user_id = c.member_a
      join app.users ub on ub.id = c.member_b left join app.member_profiles pb on pb.user_id = c.member_b
    $q$
  end;
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
    else false
  end
$$;

alter table app.saved_filters
  drop constraint saved_filters_resource,
  add constraint saved_filters_resource
    check (resource in ('members', 'payments', 'verifications', 'events', 'venues', 'themes', 'moderation', 'discoveries', 'couples'));

-- ---------------------------------------------------------------------
-- 2. Conseillers (11.2-8, question 9 a)
-- ---------------------------------------------------------------------
-- Seul passage de rôle hors super administration : membre vers conseiller, par la fonction ci-dessous
create or replace function app.protect_user_columns() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.is_client() then return new; end if;
  if (new.phone is distinct from old.phone and coalesce(current_setting('app.phone_change', true), '') <> 'on')
     or new.member_number is distinct from old.member_number then
    raise exception 'forbidden_column' using errcode = '42501';
  end if;
  if new.role is distinct from old.role then
    if not app.has_permission('roles.manage')
       and not (coalesce(current_setting('app.counselor_promotion', true), '') = 'on'
                and old.role = 'member' and new.role = 'counselor' and app.has_permission('counselors.manage')) then
      raise exception 'forbidden_column' using errcode = '42501';
    end if;
    perform app.audit('role.changed', 'users', new.id, jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  return new;
end $$;

create policy counselors_select_team on app.counselors for select using (app.has_permission('counselors.manage'));
create policy counselors_select_self on app.counselors for select using (user_id = auth.uid());

create function app.admin_create_counselor(p_user uuid, p_display_name text, p_bio text, p_languages app.locale[], p_max_couples integer)
returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_role app.role;
  v_name text := btrim(coalesce(p_display_name, ''));
begin
  if not app.has_permission('counselors.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'self_action'; end if;
  select role into v_role from app.users where id = p_user for update;
  if not found then raise exception 'not_found'; end if;
  if v_role <> 'member' then raise exception 'not_a_member'; end if;
  if char_length(v_name) not between 1 and 80 then raise exception 'name_required'; end if;
  if coalesce(p_max_couples, 0) not between 1 and 100 then raise exception 'invalid_capacity'; end if;
  if p_languages is null or cardinality(p_languages) = 0 then raise exception 'languages_required'; end if;
  perform set_config('app.counselor_promotion', 'on', true);
  update app.users set role = 'counselor' where id = p_user;
  perform set_config('app.counselor_promotion', '', true);
  insert into app.counselors (user_id, display_name, bio, languages, max_couples)
  values (p_user, v_name, nullif(btrim(coalesce(p_bio, '')), ''), p_languages, p_max_couples);
  perform app.audit('counselor.created', 'counselors', p_user, jsonb_build_object('max_couples', p_max_couples));
end $$;

create function app.admin_update_counselor(p_user uuid, p_display_name text, p_bio text, p_languages app.locale[], p_max_couples integer, p_available boolean)
returns void
language plpgsql security definer set search_path = app, public as $$
declare v_name text := btrim(coalesce(p_display_name, ''));
begin
  if not app.has_permission('counselors.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(v_name) not between 1 and 80 then raise exception 'name_required'; end if;
  if coalesce(p_max_couples, 0) not between 1 and 100 then raise exception 'invalid_capacity'; end if;
  if p_languages is null or cardinality(p_languages) = 0 then raise exception 'languages_required'; end if;
  update app.counselors
     set display_name = v_name, bio = nullif(btrim(coalesce(p_bio, '')), ''), languages = p_languages,
         max_couples = p_max_couples, is_available = coalesce(p_available, true)
   where user_id = p_user;
  if not found then raise exception 'not_found'; end if;
  perform app.audit('counselor.updated', 'counselors', p_user, jsonb_build_object('available', p_available, 'max_couples', p_max_couples));
end $$;

-- Liste des conseillers : charge (couples en cours) et disponibilité
create function app.admin_counselors()
returns table (user_id uuid, display_name text, bio text, languages app.locale[], max_couples integer, is_available boolean,
               member_number text, active_couples integer)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('counselors.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select c.user_id, c.display_name, c.bio, c.languages, c.max_couples::integer, c.is_available, u.member_number,
           (select count(*)::integer from app.couples cp where cp.counselor_id = c.user_id and cp.status in ('active', 'paused'))
    from app.counselors c join app.users u on u.id = c.user_id
    order by c.display_name;
end $$;

grant execute on function
  app.list_field(text, text),
  app.list_sort_field(text, text),
  app.list_columns(text),
  app.list_sort_sql(text, jsonb),
  app.list_rows_sql(text, jsonb, jsonb),
  app.admin_create_counselor(uuid, text, text, app.locale[], integer),
  app.admin_update_counselor(uuid, text, text, app.locale[], integer, boolean),
  app.admin_counselors()
to authenticated, service_role;
