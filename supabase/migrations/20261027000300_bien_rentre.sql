-- Phase 3 : « Bien rentré(e) ? » (question 5, proposition validée le 27 octobre 2026).
--   a) Rendez-vous déclarés pendant le couple (déjà fait) ET pendant la découverte.
--   b) 3 heures après l'heure déclarée, chacun des deux reçoit « Bien rentré(e) ? » (espace membre
--      et e-mail) avec « Oui » ou « J'ai besoin d'aide ».
--   c) « J'ai besoin d'aide » : alerte immédiate à l'administration et au conseiller du couple,
--      avec prénom, numéro de membre et téléphone ; le membre voit le numéro d'urgence de l'équipe.
--   d) Sans réponse : rappel 12 heures après l'envoi ; toujours rien 24 heures après le
--      rendez-vous : alerte à l'administration.
--   e) L'autre personne ne voit jamais la réponse.
-- Tâche planifiée de l'API « date-checkins » (toutes les 15 minutes). Un rendez-vous déclaré plus
-- de 24 heures après l'avoir eu ne déclenche pas de message.

create table app.date_checkin_answers (
  checkin_id uuid not null references app.date_checkins (id) on delete cascade,
  user_id uuid not null references app.users (id) on delete cascade,
  sent_at timestamptz not null default now(),
  reminded_at timestamptz,
  answer text check (answer in ('ok', 'help')),
  answered_at timestamptz,
  alerted_at timestamptz,          -- alerte envoyée à l'équipe (aide demandée ou sans réponse)
  handled_at timestamptz,          -- alerte traitée par l'équipe
  handled_by uuid references app.users (id),
  primary key (checkin_id, user_id)
);
alter table app.date_checkin_answers enable row level security;
alter table app.date_checkin_answers force row level security;
create policy date_checkin_answers_select_self on app.date_checkin_answers for select using (user_id = auth.uid());

-- Les deux membres concernés par un rendez-vous (couple ou découverte). Interne.
create function app.checkin_members(p_checkin uuid) returns uuid[]
language sql stable security definer set search_path = app, public as $$
  select coalesce(
    (select array[c.member_a, c.member_b] from app.date_checkins d join app.couples c on c.id = d.couple_id where d.id = p_checkin),
    (select array[m.member_a, m.member_b] from app.date_checkins d join app.discoveries s on s.id = d.discovery_id
       join app.matches m on m.id = s.match_id where d.id = p_checkin)
  )
$$;

-- ---------------------------------------------------------------------
-- 1. Rendez-vous déclaré pendant la découverte
-- ---------------------------------------------------------------------
create function app.declare_discovery_date(p_discovery uuid, p_date_at timestamptz) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if not exists (
    select 1 from app.discoveries d join app.matches m on m.id = d.match_id
    where d.id = p_discovery and v_uid in (m.member_a, m.member_b)
  ) then raise exception 'not_member'; end if;
  if not exists (select 1 from app.discoveries d where d.id = p_discovery and d.status in ('active', 'extended')) then
    raise exception 'not_active';
  end if;
  if p_date_at is null then raise exception 'invalid_date'; end if;
  insert into app.date_checkins (discovery_id, declared_by, date_at) values (p_discovery, v_uid, p_date_at) returning id into v_id;
  return v_id;
end $$;

create function app.my_discovery_dates(p_discovery uuid)
returns table (id uuid, date_at timestamptz, declared_by_me boolean)
language sql stable security definer set search_path = app, public as $$
  select d.id, d.date_at, d.declared_by = auth.uid()
  from app.date_checkins d
  join app.discoveries s on s.id = d.discovery_id
  join app.matches m on m.id = s.match_id
  where d.discovery_id = p_discovery and auth.uid() in (m.member_a, m.member_b)
  order by d.date_at desc
  limit 50
$$;

-- ---------------------------------------------------------------------
-- 2. Alerte à l'équipe (et au conseiller du couple). Interne.
-- ---------------------------------------------------------------------
create function app.checkin_alert(p_checkin uuid, p_user uuid, p_kind text) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_payload jsonb;
  v_target uuid;
begin
  select jsonb_build_object('checkin_id', p_checkin, 'first_name', p.first_name, 'member_number', u.member_number, 'phone', u.phone,
                            'date_at', d.date_at)
    into v_payload
  from app.users u left join app.member_profiles p on p.user_id = u.id, app.date_checkins d
  where u.id = p_user and d.id = p_checkin;
  for v_target in
    select u.id from app.users u where u.role in ('admin', 'super_admin')
    union
    select a.counselor_id from app.date_checkins d join app.counselor_access a on a.couple_id = d.couple_id
     where d.id = p_checkin and a.status = 'granted' and a.counselor_id is not null
  loop
    perform app.notify_with_deliveries(v_target, p_kind, v_payload);
  end loop;
  update app.date_checkin_answers set alerted_at = now() where checkin_id = p_checkin and user_id = p_user;
  perform app.audit(p_kind, 'date_checkins', p_checkin, jsonb_build_object('member', p_user));
end $$;

-- ---------------------------------------------------------------------
-- 3. Tâche planifiée : envoi à 3 h, rappel à 12 h, alerte à 24 h
-- ---------------------------------------------------------------------
create function app.process_date_checkins() returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_count integer := 0;
  v_checkin app.date_checkins;
  v_member uuid;
  v_answer app.date_checkin_answers;
begin
  perform app.require_permission('couples.manage');
  for v_checkin in
    select * from app.date_checkins
    where checkin_sent_at is null and date_at <= now() - interval '3 hours' and date_at > now() - interval '24 hours'
    for update skip locked
  loop
    foreach v_member in array coalesce(app.checkin_members(v_checkin.id), '{}') loop
      insert into app.date_checkin_answers (checkin_id, user_id) values (v_checkin.id, v_member) on conflict do nothing;
      perform app.notify_with_deliveries(v_member, 'date.checkin', jsonb_build_object('checkin_id', v_checkin.id));
      v_count := v_count + 1;
    end loop;
    update app.date_checkins set checkin_sent_at = now() where id = v_checkin.id;
  end loop;

  for v_answer in
    select * from app.date_checkin_answers where answer is null and reminded_at is null and sent_at <= now() - interval '12 hours'
    for update skip locked
  loop
    update app.date_checkin_answers set reminded_at = now() where checkin_id = v_answer.checkin_id and user_id = v_answer.user_id;
    perform app.notify_with_deliveries(v_answer.user_id, 'date.checkin_reminder', jsonb_build_object('checkin_id', v_answer.checkin_id));
    v_count := v_count + 1;
  end loop;

  for v_answer in
    select a.* from app.date_checkin_answers a join app.date_checkins d on d.id = a.checkin_id
    where a.answer is null and a.alerted_at is null and d.date_at <= now() - interval '24 hours'
    for update of a skip locked
  loop
    perform app.checkin_alert(v_answer.checkin_id, v_answer.user_id, 'date.checkin_no_answer');
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- 4. Réponse du membre ; liste de ses messages en attente
-- ---------------------------------------------------------------------
create function app.answer_checkin(p_checkin uuid, p_answer text) returns void
language plpgsql security definer set search_path = app, public as $$
declare v_row app.date_checkin_answers;
begin
  if p_answer not in ('ok', 'help') then raise exception 'invalid_answer'; end if;
  select * into v_row from app.date_checkin_answers where checkin_id = p_checkin and user_id = auth.uid() for update;
  if not found then raise exception 'not_found'; end if;
  update app.date_checkin_answers set answer = p_answer, answered_at = now() where checkin_id = p_checkin and user_id = auth.uid();
  if p_answer = 'help' then perform app.checkin_alert(p_checkin, auth.uid(), 'date.help_requested'); end if;
end $$;

create function app.my_pending_checkins()
returns table (checkin_id uuid, date_at timestamptz, partner_first_name text)
language sql stable security definer set search_path = app, public as $$
  select a.checkin_id, d.date_at,
         (select p.first_name from app.member_profiles p
           where p.user_id = (select x from unnest(app.checkin_members(d.id)) x where x <> auth.uid() limit 1))
  from app.date_checkin_answers a join app.date_checkins d on d.id = a.checkin_id
  where a.user_id = auth.uid() and a.answer is null
  order by d.date_at desc
$$;

-- ---------------------------------------------------------------------
-- 5. Administration : alertes à traiter
-- ---------------------------------------------------------------------
create function app.admin_safety_alerts()
returns table (checkin_id uuid, user_id uuid, first_name text, member_number text, phone text, answer text,
               date_at timestamptz, alerted_at timestamptz, handled_at timestamptz)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('couples.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select a.checkin_id, a.user_id, p.first_name, u.member_number, u.phone, a.answer, d.date_at, a.alerted_at, a.handled_at
    from app.date_checkin_answers a
    join app.date_checkins d on d.id = a.checkin_id
    join app.users u on u.id = a.user_id
    left join app.member_profiles p on p.user_id = a.user_id
    where a.alerted_at is not null
    order by (a.handled_at is null) desc, a.alerted_at desc
    limit 200;
end $$;

create function app.admin_handle_safety_alert(p_checkin uuid, p_user uuid) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.has_permission('couples.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  update app.date_checkin_answers set handled_at = now(), handled_by = auth.uid()
   where checkin_id = p_checkin and user_id = p_user and alerted_at is not null and handled_at is null;
  if not found then raise exception 'not_found'; end if;
  perform app.audit('date.alert_handled', 'date_checkins', p_checkin, jsonb_build_object('member', p_user));
end $$;

revoke execute on function app.checkin_members(uuid), app.checkin_alert(uuid, uuid, text) from public;
grant execute on function
  app.declare_discovery_date(uuid, timestamptz),
  app.my_discovery_dates(uuid),
  app.answer_checkin(uuid, text),
  app.my_pending_checkins(),
  app.admin_safety_alerts(),
  app.admin_handle_safety_alert(uuid, uuid)
to authenticated, service_role;
grant execute on function app.process_date_checkins() to service_role;
