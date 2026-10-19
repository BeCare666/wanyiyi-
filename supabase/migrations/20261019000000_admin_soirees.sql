-- Phase 2, étape 5 : module « Soirées » de l'administration (section 11.2-5).
-- Création et publication d'une soirée, lieux, inscriptions et liste d'attente,
-- résultats. Le pointage, la préparation (tables, codes QR, rotation), le début,
-- la fin et le calcul des matchs existent déjà (migration 20261014000000).
--
-- Règles retenues sans rien inventer :
--   - une soirée se crée en brouillon et ne se modifie qu'en brouillon ; la modification
--     ou l'annulation d'une soirée publiée attend une décision (remboursements, question 2) ;
--   - publication : lieu obligatoire (l'adresse est communiquée aux participants confirmés)
--     et début dans le futur ; le tarif peut rester vide (« Tarif communiqué prochainement »).

-- ---------------------------------------------------------------------
-- 1. Plus d'écriture directe sur les soirées et leur déroulé : tout passe par les fonctions
--    (l'état d'une soirée commande la réservation, le vote et le calcul des matchs).
--    Lieux et thèmes restent modifiables directement par la permission events.manage.
-- ---------------------------------------------------------------------
drop policy events_manage on app.events;
create policy events_select_team on app.events for select using (app.has_permission('events.manage'));

drop policy event_tables_manage on app.event_tables;
create policy event_tables_select_team on app.event_tables for select using (app.has_permission('events.manage'));
drop policy rounds_manage on app.rounds;
create policy rounds_select_team on app.rounds for select using (app.has_permission('events.manage'));
drop policy pairings_manage on app.round_pairings;
create policy pairings_select_team on app.round_pairings for select using (app.has_permission('events.manage'));

-- ---------------------------------------------------------------------
-- 2. Création et modification d'un brouillon
-- ---------------------------------------------------------------------
create function app.save_event(
  p_event uuid,
  p_venue uuid,
  p_theme uuid,
  p_starts_at timestamptz,
  p_capacity_women smallint,
  p_capacity_men smallint,
  p_round_minutes smallint,
  p_changeover_minutes smallint,
  p_price_xof integer
) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_event app.events;
  v_id uuid;
begin
  perform app.require_permission('events.manage');
  if p_starts_at is null or p_starts_at <= now() then raise exception 'starts_in_past'; end if;
  -- Capacité 9.2 : au plus 12 × 12
  if p_capacity_women is null or p_capacity_men is null
     or p_capacity_women not between 1 and 12 or p_capacity_men not between 1 and 12 then
    raise exception 'invalid_capacity';
  end if;
  if p_round_minutes is null or p_round_minutes < 1 or p_changeover_minutes is null or p_changeover_minutes < 0 then
    raise exception 'invalid_duration';
  end if;
  if p_price_xof is not null and p_price_xof < 0 then raise exception 'invalid_price'; end if;
  if p_venue is not null and not exists (select 1 from app.venues where id = p_venue) then raise exception 'venue_not_found'; end if;
  if p_theme is not null and not exists (select 1 from app.themes where id = p_theme) then raise exception 'theme_not_found'; end if;

  if p_event is null then
    insert into app.events (venue_id, theme_id, starts_at, capacity_women, capacity_men, round_minutes, changeover_minutes, price_xof, status)
    values (p_venue, p_theme, p_starts_at, p_capacity_women, p_capacity_men, p_round_minutes, p_changeover_minutes, p_price_xof, 'draft')
    returning id into v_id;
    perform app.audit('event.created', 'events', v_id);
    return v_id;
  end if;

  select * into v_event from app.events where id = p_event for update;
  if v_event.id is null then raise exception 'not_found'; end if;
  if v_event.status <> 'draft' then raise exception 'not_draft'; end if;
  update app.events
     set venue_id = p_venue, theme_id = p_theme, starts_at = p_starts_at,
         capacity_women = p_capacity_women, capacity_men = p_capacity_men,
         round_minutes = p_round_minutes, changeover_minutes = p_changeover_minutes, price_xof = p_price_xof
   where id = p_event;
  perform app.audit('event.updated', 'events', p_event);
  return p_event;
end $$;

-- Publication : la soirée apparaît au calendrier des membres et devient réservable
create function app.publish_event(p_event uuid) returns void
language plpgsql security definer set search_path = app, public as $$
declare v_event app.events;
begin
  perform app.require_permission('events.manage');
  select * into v_event from app.events where id = p_event for update;
  if v_event.id is null then raise exception 'not_found'; end if;
  if v_event.status <> 'draft' then raise exception 'not_draft'; end if;
  if v_event.venue_id is null then raise exception 'venue_required'; end if;
  if v_event.starts_at <= now() then raise exception 'starts_in_past'; end if;
  update app.events set status = 'published' where id = p_event;
  perform app.audit('event.published', 'events', p_event);
end $$;

-- Suppression d'un brouillon (jamais visible des membres, donc sans inscription)
create function app.delete_draft_event(p_event uuid) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  perform app.require_permission('events.manage');
  delete from app.events where id = p_event and status = 'draft';
  if not found then raise exception 'not_draft'; end if;
  perform app.audit('event.deleted', 'events', p_event);
end $$;

-- ---------------------------------------------------------------------
-- 3. Lecture pour l'équipe
-- ---------------------------------------------------------------------
-- Liste des soirées, brouillons compris, avec le remplissage par sexe
create function app.admin_events()
returns table (
  id uuid,
  starts_at timestamptz,
  status app.event_status,
  venue_name text,
  theme_key text,
  price_xof integer,
  capacity_women integer,
  capacity_men integer,
  taken_women integer,
  taken_men integer,
  waiting_women integer,
  waiting_men integer,
  matches integer
)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('events.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select e.id, e.starts_at, e.status, v.name, t.key, e.price_xof,
           e.capacity_women::integer, e.capacity_men::integer,
           app.seats_taken(e.id, 'female'), app.seats_taken(e.id, 'male'),
           (select count(*)::integer from app.waitlist_entries w where w.event_id = e.id and w.sex = 'female'),
           (select count(*)::integer from app.waitlist_entries w where w.event_id = e.id and w.sex = 'male'),
           (select count(*)::integer from app.matches m where m.event_id = e.id)
    from app.events e
    left join app.venues v on v.id = e.venue_id
    left join app.themes t on t.id = e.theme_id
    order by e.starts_at desc;
end $$;

-- Inscriptions et liste d'attente d'une soirée. « position » : rang dans la liste d'attente du même sexe.
create function app.event_participants(p_event uuid)
returns table (
  user_id uuid,
  member_number text,
  first_name text,
  last_name text,
  sex app.sex,
  status app.registration_status,
  waitlist_position integer,
  registered_at timestamptz,
  confirmed_at timestamptz,
  checked_in_at timestamptz,
  seat_number smallint
)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('events.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select r.user_id, u.member_number, p.first_name, p.last_name, r.sex, r.status, null::integer,
           coalesce(r.seated_at, r.created_at), r.confirmed_at, r.checked_in_at, r.seat_number
    from app.event_registrations r
    join app.users u on u.id = r.user_id
    left join app.member_profiles p on p.user_id = r.user_id
    where r.event_id = p_event
    union all
    select w.user_id, u.member_number, p.first_name, p.last_name, w.sex, 'waitlisted'::app.registration_status,
           (row_number() over (partition by w.sex order by w.position))::integer,
           w.created_at, null, null, null
    from app.waitlist_entries w
    join app.users u on u.id = w.user_id
    left join app.member_profiles p on p.user_id = w.user_id
    where w.event_id = p_event
    order by 5, 7 nulls first, 11 nulls last, 8;
end $$;

-- Résultats : participation, votes et matchs (jamais le détail des « non », 9.3)
create function app.event_results(p_event uuid)
returns table (checked_in integer, voters integer, matches integer, announced_at timestamptz, results_computed_at timestamptz)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('events.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select (select count(*)::integer from app.event_registrations r where r.event_id = e.id and r.status = 'checked_in'),
           (select count(distinct vo.voter_id)::integer from app.votes vo
              join app.round_pairings pa on pa.id = vo.pairing_id
              join app.rounds ro on ro.id = pa.round_id where ro.event_id = e.id),
           (select count(*)::integer from app.matches m where m.event_id = e.id),
           app.match_announcement_at(e.starts_at),
           e.results_computed_at
    from app.events e where e.id = p_event;
end $$;

-- Matchs d'une soirée, pour l'équipe : prénoms et numéros de membre
create function app.event_matches(p_event uuid)
returns table (match_id uuid, member_a_number text, member_a_first_name text, member_b_number text, member_b_first_name text, announced_at timestamptz, notified_at timestamptz)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('events.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select m.id, ua.member_number, pa.first_name, ub.member_number, pb.first_name, m.announced_at, m.notified_at
    from app.matches m
    join app.users ua on ua.id = m.member_a
    join app.users ub on ub.id = m.member_b
    left join app.member_profiles pa on pa.user_id = m.member_a
    left join app.member_profiles pb on pb.user_id = m.member_b
    where m.event_id = p_event
    order by pa.first_name, pb.first_name;
end $$;

grant execute on function
  app.save_event(uuid, uuid, uuid, timestamptz, smallint, smallint, smallint, smallint, integer),
  app.publish_event(uuid),
  app.delete_draft_event(uuid),
  app.admin_events(),
  app.event_participants(uuid),
  app.event_results(uuid),
  app.event_matches(uuid)
to authenticated, service_role;
