-- Phase 3, étape 2 (suite) : vie et fins du couple (section 9.5 ; questions 6 et 7, réponses de
-- l'utilisateur du 26 octobre 2026).
--   - Activité : message, étape du parcours, rendez-vous déclaré, ouverture de l'espace du couple.
--   - 60 jours sans activité : alerte au conseiller du couple, ou à l'administration s'il n'y en a
--     pas ; 14 jours plus tard sans activité : pause (chat en lecture seule, exclusivité levée :
--     soirées et nouveaux matchs de nouveau possibles) ; reprise quand les DEUX cliquent
--     « Reprendre ».
--   - Union célébrée : déclarée par les deux ; chat en lecture seule, effacé après 12 mois sauf si
--     les deux demandent à le garder.
--   - Séparation : décidée par les deux ; chat fermé, gardé 90 jours (modération seulement) puis
--     effacé ; retour aux soirées après 1 mois pour les deux.
--   - Départ d'un seul : à tout moment ; chat fermé, gardé 90 jours puis effacé ; l'autre reçoit un
--     message automatique signé du conseiller, ou un message neutre sans conseiller ; pas
--     d'attente avant les soirées.
--   - Toute fin retire le conseiller. Les membres ne relisent plus une conversation de couple
--     terminée par séparation ou départ.

-- Demandes de chacun (reprise, union, séparation, garder le chat après l'union)
create table app.couple_requests (
  couple_id uuid not null references app.couples (id) on delete cascade,
  user_id uuid not null references app.users (id) on delete cascade,
  kind text not null check (kind in ('resume', 'union', 'separation', 'keep_chat')),
  created_at timestamptz not null default now(),
  primary key (couple_id, user_id, kind)
);
alter table app.couple_requests enable row level security;
alter table app.couple_requests force row level security;
create policy couple_requests_select_self on app.couple_requests for select using (user_id = auth.uid());

alter table app.couples
  add column inactivity_alerted_at timestamptz,
  add column paused_at timestamptz;

-- ---------------------------------------------------------------------
-- 1. Exclusivité : seulement pour un couple en cours (la pause la lève)
-- ---------------------------------------------------------------------
create or replace function app.in_couple(p_user uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (select 1 from app.couples c where p_user in (c.member_a, c.member_b) and c.status = 'active')
$$;

create or replace function app.book_event(p_event uuid) returns text
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_profile app.member_profiles;
  v_event app.events;
  v_theme app.themes;
  v_age integer;
  v_religion text;
  v_sector text;
  v_capacity integer;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into v_profile from app.member_profiles where user_id = v_uid;
  if v_profile is null or v_profile.status <> 'verified' then raise exception 'not_validated'; end if;
  -- Exclusivité (9.5) : couple en cours ; la pause la lève (question 6)
  if app.in_couple(v_uid) then
    raise exception 'couple_exclusivity';
  end if;
  if v_profile.evenings_blocked_until is not null and now() < v_profile.evenings_blocked_until then
    raise exception 'blocked_until';
  end if;

  -- Verrou sur la soirée : deux réservations simultanées ne dépassent jamais le quota
  select * into v_event from app.events where id = p_event for update;
  if v_event is null or v_event.status not in ('published', 'full') or now() >= v_event.starts_at then
    raise exception 'evening_closed';
  end if;
  if exists (select 1 from app.event_registrations where event_id = p_event and user_id = v_uid
             and status in ('booked', 'confirmed', 'checked_in'))
     or exists (select 1 from app.waitlist_entries where event_id = p_event and user_id = v_uid) then
    raise exception 'already_registered';
  end if;

  -- Soirée thématique : critères d'accès automatiques
  if v_event.theme_id is not null then
    select * into v_theme from app.themes where id = v_event.theme_id;
    v_age := extract(year from age((v_event.starts_at at time zone 'Africa/Porto-Novo')::date, v_profile.birth_date))::integer;
    if (v_theme.min_age is not null and v_age < v_theme.min_age) or (v_theme.max_age is not null and v_age > v_theme.max_age) then
      raise exception 'theme_age';
    end if;
    select pa."values"[1] into v_religion from app.profile_answers pa where pa.user_id = v_uid and pa.side = 'self' and pa.category = 'religion';
    if coalesce(array_length(v_theme.required_religions, 1), 0) > 0 and (v_religion is null or not v_religion = any (v_theme.required_religions)) then
      raise exception 'theme_religion';
    end if;
    select pa."values"[1] into v_sector from app.profile_answers pa where pa.user_id = v_uid and pa.side = 'self' and pa.category = 'sector';
    if coalesce(array_length(v_theme.sectors, 1), 0) > 0 and (v_sector is null or not v_sector = any (v_theme.sectors)) then
      raise exception 'theme_sector';
    end if;
  end if;

  v_capacity := case v_profile.sex when 'female' then v_event.capacity_women else v_event.capacity_men end;
  if app.seats_taken(p_event, v_profile.sex) < v_capacity then
    insert into app.event_registrations (event_id, user_id, sex, status, seated_at)
    values (p_event, v_uid, v_profile.sex, 'booked', now())
    on conflict (event_id, user_id)
    do update set status = 'booked', seated_at = now(), confirmed_at = null, checked_in_at = null, created_at = now();
    return 'seat';
  end if;

  insert into app.waitlist_entries (event_id, user_id, sex, position)
  values (p_event, v_uid, v_profile.sex,
          coalesce((select max(position) from app.waitlist_entries where event_id = p_event and sex = v_profile.sex), 0) + 1);
  return 'waitlist';
end $$;

-- Blocage des soirées après une séparation : posé par app.couple_decide seulement (drapeau de
-- transaction app.couple_separation), comme l'état « deleted » par la suppression de compte
create or replace function app.protect_profile_columns() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.is_client() or app.is_team() then
    new.updated_at := now();
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'registering';
    new.journey_stage := 'registration';
    new.evenings_blocked_until := null;
  elsif (new.status is distinct from old.status
         and not (old.status in ('registering', 'to_correct') and new.status = 'pending_verification'
                  and app.dossier_complete(new.user_id))
         and coalesce(current_setting('app.account_deletion', true), '') <> 'on')
     or new.journey_stage is distinct from old.journey_stage
     or (new.evenings_blocked_until is distinct from old.evenings_blocked_until
         and coalesce(current_setting('app.couple_separation', true), '') <> 'on')
     or new.sex is distinct from old.sex
     or new.birth_date is distinct from old.birth_date then
    -- Sexe et date de naissance sont vérifiés sur la pièce d'identité : modifiables par l'équipe seulement
    raise exception 'forbidden_column' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. Activité
-- ---------------------------------------------------------------------
-- Toute activité remet le compteur à zéro et efface l'alerte (pas la pause : reprise par les deux)
create function app.couple_activity(p_couple uuid) returns void
language sql security definer set search_path = app, public as $$
  update app.couples set last_activity_at = now(), inactivity_alerted_at = null where id = p_couple
$$;

-- Ouverture de l'espace du couple par l'un des deux (compte comme activité)
create function app.touch_couple(p_couple uuid) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if not exists (select 1 from app.couples c where c.id = p_couple and auth.uid() in (c.member_a, c.member_b) and c.status in ('active', 'paused')) then
    raise exception 'not_member';
  end if;
  perform app.couple_activity(p_couple);
end $$;

create function app.couple_activity_on_message() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if not new.is_system then
    perform app.couple_activity(c.couple_id) from app.conversations c where c.id = new.conversation_id and c.kind = 'couple';
  end if;
  return new;
end $$;
create trigger messages_couple_activity after insert on app.messages for each row execute function app.couple_activity_on_message();

create function app.couple_activity_on_milestone() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if new.reached_at is not null then perform app.couple_activity(new.couple_id); end if;
  return new;
end $$;
create trigger milestones_couple_activity after insert or update of reached_at on app.couple_milestones
  for each row execute function app.couple_activity_on_milestone();

create function app.couple_activity_on_date() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if new.couple_id is not null then perform app.couple_activity(new.couple_id); end if;
  return new;
end $$;
create trigger date_checkins_couple_activity after insert on app.date_checkins for each row execute function app.couple_activity_on_date();

-- ---------------------------------------------------------------------
-- 3. Inactivité : alerte à 60 jours, pause 14 jours plus tard (tâche planifiée de l'API)
-- ---------------------------------------------------------------------
create function app.couple_inactivity() returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_couple app.couples;
  v_count integer := 0;
  v_admin uuid;
begin
  perform app.require_permission('couples.manage');
  for v_couple in
    select * from app.couples
    where status = 'active' and inactivity_alerted_at is null and last_activity_at <= now() - interval '60 days'
    for update
  loop
    update app.couples set inactivity_alerted_at = now() where id = v_couple.id;
    if v_couple.counselor_id is not null then
      perform app.notify_with_deliveries(v_couple.counselor_id, 'couple.inactive', jsonb_build_object('couple_id', v_couple.id));
    else
      for v_admin in select u.id from app.users u where u.role in ('admin', 'super_admin') loop
        perform app.notify_with_deliveries(v_admin, 'couple.inactive', jsonb_build_object('couple_id', v_couple.id));
      end loop;
    end if;
    perform app.audit('couple.inactivity_alert', 'couples', v_couple.id, jsonb_build_object('counselor', v_couple.counselor_id));
    v_count := v_count + 1;
  end loop;

  for v_couple in
    select * from app.couples
    where status = 'active' and inactivity_alerted_at is not null and inactivity_alerted_at <= now() - interval '14 days'
      and last_activity_at <= inactivity_alerted_at
    for update
  loop
    update app.couples set status = 'paused', paused_at = now() where id = v_couple.id;
    update app.conversations set read_only = true where couple_id = v_couple.id and kind = 'couple';
    delete from app.couple_requests where couple_id = v_couple.id and kind = 'resume';
    perform app.couple_system_message(v_couple.id, 'couple.paused', null);
    perform app.notify_with_deliveries(v_couple.member_a, 'couple.paused', jsonb_build_object('couple_id', v_couple.id));
    perform app.notify_with_deliveries(v_couple.member_b, 'couple.paused', jsonb_build_object('couple_id', v_couple.id));
    perform app.audit('couple.paused', 'couples', v_couple.id, '{}'::jsonb);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- 4. Décisions des deux membres : reprise, union, séparation, garder le chat
-- ---------------------------------------------------------------------
-- Demande d'un membre ; renvoie vrai quand les deux l'ont faite. Interne.
create function app.couple_request(p_couple uuid, p_kind text) returns boolean
language plpgsql security definer set search_path = app, public as $$
declare v_couple app.couples;
begin
  select * into v_couple from app.couples where id = p_couple for update;
  insert into app.couple_requests (couple_id, user_id, kind) values (p_couple, auth.uid(), p_kind) on conflict do nothing;
  return (select count(*) from app.couple_requests r where r.couple_id = p_couple and r.kind = p_kind
          and r.user_id in (v_couple.member_a, v_couple.member_b)) = 2;
end $$;

-- Fin du couple : statut, chat, conseiller retiré, demandes effacées. Interne.
create function app.end_couple(p_couple uuid, p_status app.couple_status) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  update app.couples set status = p_status, ended_at = now(), memory_space = (p_status = 'union_celebrated') where id = p_couple;
  update app.counselor_access set status = 'revoked', revoked_at = now() where couple_id = p_couple and status in ('requested', 'granted');
  if p_status = 'union_celebrated' then
    update app.conversations set read_only = true, delete_after = now() + interval '12 months' where couple_id = p_couple and kind = 'couple';
  else
    update app.conversations set closed_at = now(), read_only = true, delete_after = now() + interval '90 days'
     where couple_id = p_couple and kind = 'couple';
  end if;
  delete from app.couple_requests where couple_id = p_couple and kind in ('resume', 'union', 'separation');
end $$;

create function app.couple_decide(p_couple uuid, p_kind text) returns text
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_couple app.couples;
  v_other uuid;
begin
  select * into v_couple from app.couples where id = p_couple for update;
  if not found or v_uid is null or v_uid not in (v_couple.member_a, v_couple.member_b) then raise exception 'not_member'; end if;
  if p_kind not in ('resume', 'union', 'separation', 'keep_chat') then raise exception 'invalid_request'; end if;
  v_other := case when v_uid = v_couple.member_a then v_couple.member_b else v_couple.member_a end;

  if p_kind = 'keep_chat' then
    if v_couple.status <> 'union_celebrated' then raise exception 'invalid_status'; end if;
    if app.couple_request(p_couple, 'keep_chat') then
      update app.couples set keep_chat_after_union = true where id = p_couple;
      update app.conversations set delete_after = null where couple_id = p_couple and kind = 'couple';
      perform app.audit('couple.keep_chat', 'couples', p_couple, '{}'::jsonb);
      return 'done';
    end if;
    return 'recorded';
  end if;

  if p_kind = 'resume' then
    if v_couple.status <> 'paused' then raise exception 'invalid_status'; end if;
    if app.couple_request(p_couple, 'resume') then
      update app.couples set status = 'active', paused_at = null, inactivity_alerted_at = null, last_activity_at = now() where id = p_couple;
      if v_couple.blocked_at is null then
        update app.conversations set read_only = false where couple_id = p_couple and kind = 'couple' and closed_at is null;
      end if;
      delete from app.couple_requests where couple_id = p_couple and kind = 'resume';
      perform app.couple_system_message(p_couple, 'couple.resumed', null);
      perform app.audit('couple.resumed', 'couples', p_couple, '{}'::jsonb);
      return 'done';
    end if;
    perform app.couple_system_message(p_couple, 'couple.resume_requested', v_uid);
    return 'recorded';
  end if;

  if v_couple.status not in ('active', 'paused') then raise exception 'invalid_status'; end if;

  if p_kind = 'union' then
    if app.couple_request(p_couple, 'union') then
      perform app.end_couple(p_couple, 'union_celebrated');
      perform app.couple_system_message(p_couple, 'couple.union_celebrated', null);
      perform app.notify_with_deliveries(v_couple.member_a, 'couple.union_celebrated', jsonb_build_object('couple_id', p_couple));
      perform app.notify_with_deliveries(v_couple.member_b, 'couple.union_celebrated', jsonb_build_object('couple_id', p_couple));
      perform app.audit('couple.union_celebrated', 'couples', p_couple, '{}'::jsonb);
      return 'done';
    end if;
    perform app.couple_system_message(p_couple, 'couple.union_requested', v_uid);
    return 'recorded';
  end if;

  -- Séparation : les deux ; retour aux soirées après 1 mois pour les deux
  if app.couple_request(p_couple, 'separation') then
    perform app.end_couple(p_couple, 'separated');
    perform set_config('app.couple_separation', 'on', true);
    update app.member_profiles set evenings_blocked_until = greatest(coalesce(evenings_blocked_until, now()), now() + interval '1 month')
     where user_id in (v_couple.member_a, v_couple.member_b);
    perform set_config('app.couple_separation', '', true);
    perform app.notify_with_deliveries(v_couple.member_a, 'couple.separated', jsonb_build_object('couple_id', p_couple));
    perform app.notify_with_deliveries(v_couple.member_b, 'couple.separated', jsonb_build_object('couple_id', p_couple));
    perform app.audit('couple.separated', 'couples', p_couple, '{}'::jsonb);
    return 'done';
  end if;
  perform app.couple_system_message(p_couple, 'couple.separation_requested', v_uid);
  return 'recorded';
end $$;

-- Départ d'un seul, à tout moment, sans justification
create function app.leave_couple(p_couple uuid) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_couple app.couples;
  v_other uuid;
  v_counselor text;
begin
  select * into v_couple from app.couples where id = p_couple for update;
  if not found or v_uid is null or v_uid not in (v_couple.member_a, v_couple.member_b) then raise exception 'not_member'; end if;
  if v_couple.status not in ('active', 'paused') then raise exception 'invalid_status'; end if;
  v_other := case when v_uid = v_couple.member_a then v_couple.member_b else v_couple.member_a end;
  -- Conseiller du couple au moment du départ (accès accordé), pour signer le message
  select co.display_name into v_counselor
  from app.counselor_access a join app.counselors co on co.user_id = a.counselor_id
  where a.couple_id = p_couple and a.status = 'granted' order by a.granted_at desc limit 1;
  perform app.end_couple(p_couple, 'left');
  if v_counselor is not null then
    perform app.notify_with_deliveries(v_other, 'couple.ended_by_partner_counselor', jsonb_build_object('couple_id', p_couple, 'counselor', v_counselor));
  else
    perform app.notify_with_deliveries(v_other, 'couple.ended_by_partner', jsonb_build_object('couple_id', p_couple));
  end if;
  perform app.audit('couple.left', 'couples', p_couple, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 5. Lecture : plus de chat après une séparation ou un départ ; effacement programmé
-- ---------------------------------------------------------------------
create or replace function app.conversation_member(p_conversation uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.conversations c
    left join app.discoveries d on d.id = c.discovery_id
    left join app.matches m on m.id = d.match_id
    left join app.couples cp on cp.id = c.couple_id
    where c.id = p_conversation
      and (
        (c.kind = 'discovery' and auth.uid() in (m.member_a, m.member_b))
        or (c.kind = 'couple' and auth.uid() in (cp.member_a, cp.member_b) and cp.status in ('active', 'paused', 'union_celebrated'))
        or (c.kind = 'counselor_private' and auth.uid() in (c.member_id, c.counselor_id))
      )
  )
$$;

-- Tâche planifiée : messages effacés à l'échéance (90 jours après une fin, 12 mois après l'union)
create function app.purge_conversations() returns integer
language plpgsql security definer set search_path = app, public as $$
declare v_count integer;
begin
  perform app.require_permission('couples.manage');
  delete from app.messages m using app.conversations c
   where m.conversation_id = c.id and c.delete_after is not null and c.delete_after <= now();
  get diagnostics v_count = row_count;
  update app.conversations set delete_after = null where delete_after is not null and delete_after <= now();
  if v_count > 0 then perform app.audit('conversations.purged', 'messages', null, jsonb_build_object('messages', v_count)); end if;
  return v_count;
end $$;

-- État du couple pour l'un des deux : ses propres demandes seulement, pas celles de l'autre
create function app.my_couple()
returns table (couple_id uuid, partner_first_name text, status app.couple_status, created_at timestamptz,
               paused_at timestamptz, blocked boolean, my_requests text[], counselor_name text)
language sql stable security definer set search_path = app, public as $$
  select c.id, p.first_name, c.status, c.created_at, c.paused_at, c.blocked_at is not null,
         coalesce(array(select r.kind from app.couple_requests r where r.couple_id = c.id and r.user_id = auth.uid()), '{}'),
         (select co.display_name from app.counselor_access a join app.counselors co on co.user_id = a.counselor_id
           where a.couple_id = c.id and a.status = 'granted' order by a.granted_at desc limit 1)
  from app.couples c
  join app.member_profiles p on p.user_id = case when c.member_a = auth.uid() then c.member_b else c.member_a end
  where auth.uid() in (c.member_a, c.member_b)
  order by c.created_at desc
  limit 1
$$;

revoke execute on function app.couple_activity(uuid), app.couple_request(uuid, text), app.end_couple(uuid, app.couple_status) from public;
grant execute on function
  app.touch_couple(uuid),
  app.couple_decide(uuid, text),
  app.leave_couple(uuid),
  app.my_couple()
to authenticated, service_role;
grant execute on function app.couple_inactivity(), app.purge_conversations() to service_role;
