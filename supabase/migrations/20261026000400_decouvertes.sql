-- Phase 3, étape 2 : découvertes (section 9.4) et ouverture des découvertes (question 2 de la
-- phase 3, choix du 26 octobre 2026). Règles de packages/domain/src/discovery.ts :
--   - 2 découvertes actives au plus par membre (statuts active ou extended) ;
--   - une découverte ne s'ouvre que si les deux membres ont choisi le match et ont chacun une
--     place ; à l'annonce de 8 h, les nouveaux matchs d'un membre qui tiennent tous dans ses
--     places libres sont choisis d'office, sinon il choisit lui-même ;
--   - un match non ouvert attend 7 jours après l'annonce, puis expire (message neutre aux deux) ;
--   - en couple, aucun nouveau match ne s'ouvre (exclusivité 9.5, question 13 en attente) ;
--   - 14 jours de découverte ; une seule prolongation de 7 jours si les deux la demandent ;
--   - « Je veux continuer » des deux : couple, et fermeture des autres découvertes des deux ;
--   - toute fin : même message neutre « Cette mise en relation est terminée. », aucune raison.
-- Aucun membre ne voit le choix ni la décision de l'autre. Écritures par fonctions seulement.
-- Inactivité et fins du couple : questions 6 et 7, plus tard.

-- ---------------------------------------------------------------------
-- 1. Choix des matchs
-- ---------------------------------------------------------------------
create table app.match_choices (
  match_id uuid not null references app.matches (id) on delete cascade,
  user_id uuid not null references app.users (id) on delete cascade,
  automatic boolean not null default false,  -- choisi d'office à l'annonce
  chosen_at timestamptz not null default now(),
  primary key (match_id, user_id)
);
alter table app.match_choices enable row level security;
alter table app.match_choices force row level security;

-- Chacun ne voit que ses propres choix et décisions
create policy match_choices_select_self on app.match_choices for select using (user_id = auth.uid());
create policy discovery_decisions_select_self on app.discovery_decisions for select using (user_id = auth.uid());
create policy discoveries_select_member on app.discoveries for select using (
  exists (select 1 from app.matches m where m.id = match_id and auth.uid() in (m.member_a, m.member_b))
);
create policy discoveries_select_team on app.discoveries for select using (app.has_permission('events.manage'));
create policy couples_select_member on app.couples for select using (auth.uid() in (member_a, member_b));
create policy couples_select_team on app.couples for select using (app.has_permission('events.manage'));

-- ---------------------------------------------------------------------
-- 2. Places et ouverture
-- ---------------------------------------------------------------------
create function app.active_discovery_count(p_user uuid) returns integer
language sql stable security definer set search_path = app, public as $$
  select count(*)::integer
  from app.discoveries d join app.matches m on m.id = d.match_id
  where d.status in ('active', 'extended') and p_user in (m.member_a, m.member_b)
$$;

create function app.in_couple(p_user uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (select 1 from app.couples c where p_user in (c.member_a, c.member_b) and c.status in ('active', 'paused'))
$$;

create function app.match_pending_expires_at(p_match app.matches) returns timestamptz
language sql immutable set search_path = app, public as $$
  select coalesce(p_match.pending_expires_at, p_match.announced_at + interval '7 days')
$$;

-- Ouvre la découverte si les deux ont choisi, ont une place et ne sont pas en couple. Interne.
create function app.try_open_discovery(p_match uuid) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_match app.matches;
  v_discovery uuid;
begin
  select * into v_match from app.matches where id = p_match for update;
  if v_match.status <> 'pending_choice' or now() >= app.match_pending_expires_at(v_match) then return null; end if;
  if (select count(*) from app.match_choices c where c.match_id = p_match and c.user_id in (v_match.member_a, v_match.member_b)) < 2 then
    return null;
  end if;
  if app.active_discovery_count(v_match.member_a) >= 2 or app.active_discovery_count(v_match.member_b) >= 2
     or app.in_couple(v_match.member_a) or app.in_couple(v_match.member_b) then
    return null;
  end if;
  insert into app.discoveries (match_id, opened_at, ends_at) values (p_match, now(), now() + interval '14 days')
    returning id into v_discovery;
  update app.matches set status = 'discovery_open' where id = p_match;
  insert into app.conversations (kind, discovery_id) values ('discovery', v_discovery);
  perform app.notify_with_deliveries(v_match.member_a, 'discovery.opened', jsonb_build_object('discovery_id', v_discovery));
  perform app.notify_with_deliveries(v_match.member_b, 'discovery.opened', jsonb_build_object('discovery_id', v_discovery));
  perform app.audit('discovery.opened', 'discoveries', v_discovery, jsonb_build_object('match_id', p_match));
  return v_discovery;
end $$;

-- ---------------------------------------------------------------------
-- 3. Annonce de 8 h : notification, attente de 7 jours, choix d'office, ouverture
-- ---------------------------------------------------------------------
create or replace function app.announce_matches() returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_count integer;
  v_ids uuid[];
  v_member uuid;
  v_new uuid[];
  v_match uuid;
begin
  perform app.require_permission('events.manage');
  with due as (
    update app.matches set notified_at = now(), pending_expires_at = announced_at + interval '7 days'
     where announced_at <= now() and notified_at is null
     returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from due;

  insert into app.notifications (user_id, kind, payload)
  select m.member, 'match.announced', jsonb_build_object('match_id', a.id)
  from app.matches a cross join lateral (values (a.member_a), (a.member_b)) as m(member)
  where a.id = any(v_ids);
  get diagnostics v_count = row_count;

  -- Choix d'office : tous les nouveaux matchs du membre tiennent dans ses places libres
  for v_member in
    select distinct m.member from app.matches a cross join lateral (values (a.member_a), (a.member_b)) as m(member) where a.id = any(v_ids)
  loop
    v_new := array(select a.id from app.matches a where a.id = any(v_ids) and v_member in (a.member_a, a.member_b));
    if not app.in_couple(v_member) and cardinality(v_new) <= 2 - app.active_discovery_count(v_member) then
      insert into app.match_choices (match_id, user_id, automatic)
      select unnest(v_new), v_member, true
      on conflict do nothing;
    end if;
  end loop;

  for v_match in select unnest(v_ids) loop
    perform app.try_open_discovery(v_match);
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- 4. Actions du membre
-- ---------------------------------------------------------------------
-- Choisir d'ouvrir un match en attente ; renvoie la découverte si elle s'ouvre aussitôt
create function app.choose_match(p_match uuid) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_match app.matches;
begin
  select * into v_match from app.matches where id = p_match for update;
  if not found or v_uid is null or v_uid not in (v_match.member_a, v_match.member_b) or v_match.announced_at > now() then
    raise exception 'not_member';
  end if;
  if v_match.status <> 'pending_choice' then raise exception 'not_pending'; end if;
  if now() >= app.match_pending_expires_at(v_match) then raise exception 'expired'; end if;
  if exists (select 1 from app.match_choices c where c.match_id = p_match and c.user_id = v_uid) then raise exception 'already_chosen'; end if;
  if app.in_couple(v_uid) then raise exception 'couple_exclusivity'; end if;
  if app.active_discovery_count(v_uid) >= 2 then raise exception 'no_free_slot'; end if;
  insert into app.match_choices (match_id, user_id) values (p_match, v_uid);
  return app.try_open_discovery(p_match);
end $$;

-- Ferme une découverte (fin à l'échéance, ou couple formé ailleurs) ; message neutre aux deux. Interne.
create function app.close_discovery(p_discovery uuid, p_status app.discovery_status) returns void
language plpgsql security definer set search_path = app, public as $$
declare v_match app.matches;
begin
  select m.* into v_match from app.discoveries d join app.matches m on m.id = d.match_id where d.id = p_discovery;
  update app.discoveries set status = p_status, closed_at = now() where id = p_discovery and status in ('active', 'extended');
  if not found then return; end if;
  update app.matches set status = 'closed' where id = v_match.id;
  update app.conversations set closed_at = now() where discovery_id = p_discovery and closed_at is null;
  perform app.notify_with_deliveries(v_match.member_a, 'discovery.closed', jsonb_build_object('discovery_id', p_discovery));
  perform app.notify_with_deliveries(v_match.member_b, 'discovery.closed', jsonb_build_object('discovery_id', p_discovery));
  perform app.audit('discovery.' || p_status::text, 'discoveries', p_discovery, '{}'::jsonb);
end $$;

-- « Je veux continuer » et « Prolonger » : chacun pour soi ; l'effet n'a lieu que si les deux l'ont demandé
create function app.decide_discovery(p_discovery uuid, p_continue boolean, p_extension boolean) returns text
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_discovery app.discoveries;
  v_match app.matches;
  v_continue integer;
  v_extend integer;
  v_couple uuid;
  v_other uuid;
begin
  select * into v_discovery from app.discoveries where id = p_discovery for update;
  select * into v_match from app.matches where id = v_discovery.match_id;
  if not found or v_uid is null or v_uid not in (v_match.member_a, v_match.member_b) then raise exception 'not_member'; end if;
  if v_discovery.status not in ('active', 'extended') or now() >= v_discovery.ends_at then raise exception 'not_active'; end if;

  insert into app.discovery_decisions (discovery_id, user_id, wants_to_continue, wants_extension, updated_at)
  values (p_discovery, v_uid, coalesce(p_continue, false), coalesce(p_extension, false), now())
  on conflict (discovery_id, user_id) do update
    set wants_to_continue = excluded.wants_to_continue, wants_extension = excluded.wants_extension, updated_at = now();

  select count(*) filter (where wants_to_continue), count(*) filter (where wants_extension)
    into v_continue, v_extend
  from app.discovery_decisions where discovery_id = p_discovery;

  -- Les deux veulent continuer : espace du couple, exclusivité, autres découvertes fermées
  if v_continue = 2 then
    update app.discoveries set status = 'continued', closed_at = now() where id = p_discovery;
    update app.conversations set closed_at = now() where discovery_id = p_discovery and closed_at is null;
    insert into app.couples (discovery_id, member_a, member_b) values (p_discovery, v_match.member_a, v_match.member_b)
      returning id into v_couple;
    insert into app.conversations (kind, couple_id) values ('couple', v_couple);
    for v_other in
      select d.id from app.discoveries d join app.matches m on m.id = d.match_id
      where d.id <> p_discovery and d.status in ('active', 'extended')
        and (m.member_a in (v_match.member_a, v_match.member_b) or m.member_b in (v_match.member_a, v_match.member_b))
    loop
      perform app.close_discovery(v_other, 'closed');
    end loop;
    perform app.notify_with_deliveries(v_match.member_a, 'couple.opened', jsonb_build_object('couple_id', v_couple));
    perform app.notify_with_deliveries(v_match.member_b, 'couple.opened', jsonb_build_object('couple_id', v_couple));
    perform app.audit('couple.opened', 'couples', v_couple, jsonb_build_object('discovery_id', p_discovery));
    return 'couple';
  end if;

  -- Les deux demandent la prolongation : une seule fois, 7 jours
  if v_extend = 2 and not v_discovery.extended then
    update app.discoveries set extended = true, status = 'extended', ends_at = ends_at + interval '7 days' where id = p_discovery;
    update app.discovery_decisions set wants_extension = false where discovery_id = p_discovery;
    perform app.notify_with_deliveries(v_match.member_a, 'discovery.extended', jsonb_build_object('discovery_id', p_discovery));
    perform app.notify_with_deliveries(v_match.member_b, 'discovery.extended', jsonb_build_object('discovery_id', p_discovery));
    perform app.audit('discovery.extended', 'discoveries', p_discovery, '{}'::jsonb);
    return 'extended';
  end if;
  return 'recorded';
end $$;

-- ---------------------------------------------------------------------
-- 5. Tâche planifiée : fin des découvertes et des attentes
-- ---------------------------------------------------------------------
create function app.expire_discoveries() returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_count integer := 0;
  v_id uuid;
  v_match app.matches;
begin
  perform app.require_permission('events.manage');
  for v_id in select id from app.discoveries where status in ('active', 'extended') and ends_at <= now() loop
    perform app.close_discovery(v_id, 'expired');
    v_count := v_count + 1;
  end loop;
  -- Matchs jamais ouverts : 7 jours après l'annonce, même message neutre aux deux
  for v_match in
    select * from app.matches where status = 'pending_choice' and notified_at is not null and now() >= app.match_pending_expires_at(matches)
    for update
  loop
    update app.matches set status = 'expired' where id = v_match.id;
    perform app.notify_with_deliveries(v_match.member_a, 'match.expired', jsonb_build_object('match_id', v_match.id));
    perform app.notify_with_deliveries(v_match.member_b, 'match.expired', jsonb_build_object('match_id', v_match.id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- 6. Lecture par le membre (prénom de l'autre seulement, jamais son choix ni sa décision)
-- ---------------------------------------------------------------------
create function app.my_discoveries()
returns table (
  match_id uuid,
  discovery_id uuid,
  partner_first_name text,
  announced_at timestamptz,
  match_status app.match_status,
  pending_expires_at timestamptz,
  chosen_by_me boolean,
  discovery_status app.discovery_status,
  opened_at timestamptz,
  ends_at timestamptz,
  extended boolean,
  i_want_to_continue boolean,
  i_want_extension boolean,
  free_slots integer
)
language sql stable security definer set search_path = app, public as $$
  select m.id, d.id, mp.first_name, m.announced_at, m.status, app.match_pending_expires_at(m),
         exists (select 1 from app.match_choices c where c.match_id = m.id and c.user_id = auth.uid()),
         d.status, d.opened_at, d.ends_at, coalesce(d.extended, false),
         coalesce(dd.wants_to_continue, false), coalesce(dd.wants_extension, false),
         greatest(0, 2 - app.active_discovery_count(auth.uid()))
  from app.matches m
  join app.member_profiles mp on mp.user_id = case when m.member_a = auth.uid() then m.member_b else m.member_a end
  left join app.discoveries d on d.match_id = m.id
  left join app.discovery_decisions dd on dd.discovery_id = d.id and dd.user_id = auth.uid()
  where auth.uid() in (m.member_a, m.member_b) and m.announced_at <= now() and m.notified_at is not null
  order by m.announced_at desc, m.id
$$;

revoke execute on function app.try_open_discovery(uuid), app.close_discovery(uuid, app.discovery_status) from public;
grant execute on function
  app.active_discovery_count(uuid),
  app.in_couple(uuid),
  app.match_pending_expires_at(app.matches),
  app.choose_match(uuid),
  app.decide_discovery(uuid, boolean, boolean),
  app.my_discoveries()
to authenticated, service_role;
grant execute on function app.expire_discoveries(), app.try_open_discovery(uuid), app.close_discovery(uuid, app.discovery_status) to service_role;
