-- Phase 3 : canal privé avec le conseiller et séances (question 9, propositions validées le
-- 27 octobre 2026).
--   - Un couple peut rester sans conseiller (rien à coder : c'est un choix du couple).
--   - Canal privé : seulement avec le conseiller ATTRIBUÉ au couple, tant que son accès est en
--     cours ; chacun des deux membres a le sien, l'autre ne le lit jamais. Il se ferme quand le
--     conseiller est retiré ou le couple terminé : illisible, gardé 90 jours pour la modération,
--     puis effacé.
--   - Séances comprises dans l'accès déjà payé : le conseiller propose une date (en ligne, ou dans
--     un lieu), chacun des deux l'accepte d'un clic ; elle apparaît dans l'espace du couple et dans
--     l'agenda du conseiller, qui la marque « faite » ensuite. La première séance faite franchit
--     l'étape « Séances avec le conseiller » (question 16). La médiation à trois se fait dans le
--     chat du couple.

-- ---------------------------------------------------------------------
-- 1. Canal privé
-- ---------------------------------------------------------------------
-- Lisible seulement tant qu'il est ouvert (membres et conseiller)
create or replace function app.conversation_member(p_conversation uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.conversations c
    left join app.discoveries d on d.id = c.discovery_id
    left join app.matches m on m.id = d.match_id
    left join app.couples cp on cp.id = c.couple_id
    where c.id = p_conversation
      and (
        (c.kind = 'discovery' and auth.uid() in (m.member_a, m.member_b) and d.status in ('active', 'extended', 'continued'))
        or (c.kind = 'couple' and auth.uid() in (cp.member_a, cp.member_b) and cp.status in ('active', 'paused', 'union_celebrated'))
        or (c.kind = 'counselor_private' and auth.uid() in (c.member_id, c.counselor_id) and c.closed_at is null)
      )
  )
$$;

-- Ouvre (ou retrouve) le canal privé du membre avec le conseiller de son couple
create function app.open_private_channel(p_couple uuid) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_counselor uuid;
  v_id uuid;
begin
  if not exists (select 1 from app.couples c where c.id = p_couple and v_uid in (c.member_a, c.member_b)) then raise exception 'not_member'; end if;
  select a.counselor_id into v_counselor from app.counselor_access a
   where a.couple_id = p_couple and a.status = 'granted' order by a.granted_at desc limit 1;
  if v_counselor is null then raise exception 'no_counselor'; end if;
  select c.id into v_id from app.conversations c
   where c.kind = 'counselor_private' and c.couple_id = p_couple and c.member_id = v_uid and c.counselor_id = v_counselor and c.closed_at is null;
  if v_id is null then
    insert into app.conversations (kind, couple_id, member_id, counselor_id) values ('counselor_private', p_couple, v_uid, v_counselor)
    returning id into v_id;
    perform app.audit('counselor_private.opened', 'conversations', v_id, '{}'::jsonb);
  end if;
  return v_id;
end $$;

-- Retrait du conseiller (ou fin du couple, qui le retire) : canaux privés fermés, 90 jours
create function app.close_private_channels_on_revoke() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if old.status = 'granted' and new.status <> 'granted' then
    update app.conversations
       set closed_at = now(), read_only = true, delete_after = now() + interval '90 days'
     where kind = 'counselor_private' and couple_id = new.couple_id and counselor_id = old.counselor_id and closed_at is null;
  end if;
  return new;
end $$;
create trigger counselor_access_close_private after update of status on app.counselor_access
  for each row execute function app.close_private_channels_on_revoke();

-- Canaux privés ouverts du conseiller connecté, avec messages non lus
create function app.counselor_private_channels()
returns table (conversation_id uuid, couple_id uuid, member_first_name text, last_message_at timestamptz, unread integer)
language sql stable security definer set search_path = app, public as $$
  select c.id, c.couple_id, p.first_name,
         (select max(m.created_at) from app.messages m where m.conversation_id = c.id),
         (select count(*)::integer from app.messages m
           where m.conversation_id = c.id and m.sender_id is distinct from auth.uid()
             and m.created_at > coalesce((select r.read_at from app.conversation_reads r where r.conversation_id = c.id and r.user_id = auth.uid()), '-infinity'::timestamptz))
  from app.conversations c
  left join app.member_profiles p on p.user_id = c.member_id
  where c.kind = 'counselor_private' and c.counselor_id = auth.uid() and c.closed_at is null
  order by 4 desc nulls last
$$;

-- ---------------------------------------------------------------------
-- 2. Séances
-- ---------------------------------------------------------------------
alter table app.sessions
  add column status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'cancelled', 'done')),
  add column mode text not null default 'online' check (mode in ('online', 'place')),
  add column proposed_at timestamptz not null default now();
alter table app.sessions add constraint sessions_location_length check (char_length(location) <= 200);

create table app.session_acceptances (
  session_id uuid not null references app.sessions (id) on delete cascade,
  user_id uuid not null references app.users (id) on delete cascade,
  accepted_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
alter table app.session_acceptances enable row level security;
alter table app.session_acceptances force row level security;

-- Proposition du conseiller qui suit le couple (date future, en ligne ou dans un lieu)
create function app.propose_session(p_couple uuid, p_at timestamptz, p_mode text, p_location text) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_couple app.couples;
  v_location text := nullif(btrim(coalesce(p_location, '')), '');
  v_id uuid;
begin
  if app.my_counselor_access(p_couple) is null then raise exception 'not_counselor'; end if;
  select * into v_couple from app.couples where id = p_couple;
  if v_couple.status not in ('active', 'paused') then raise exception 'invalid_status'; end if;
  if p_at is null or p_at <= now() then raise exception 'invalid_date'; end if;
  if p_mode not in ('online', 'place') then raise exception 'invalid_mode'; end if;
  if p_mode = 'place' and v_location is null then raise exception 'location_required'; end if;
  if char_length(coalesce(v_location, '')) > 200 then raise exception 'location_too_long'; end if;
  insert into app.sessions (counselor_id, couple_id, is_mediation, scheduled_at, location, mode)
  values (auth.uid(), p_couple, false, p_at, v_location, p_mode) returning id into v_id;
  perform app.couple_system_message(p_couple, 'session.proposed', auth.uid());
  perform app.notify_with_deliveries(v_couple.member_a, 'session.proposed', jsonb_build_object('couple_id', p_couple, 'session_id', v_id));
  perform app.notify_with_deliveries(v_couple.member_b, 'session.proposed', jsonb_build_object('couple_id', p_couple, 'session_id', v_id));
  perform app.audit('session.proposed', 'sessions', v_id, '{}'::jsonb);
  return v_id;
end $$;

-- Accord d'un membre ; la séance est confirmée quand les deux ont accepté
create function app.accept_session(p_session uuid) returns text
language plpgsql security definer set search_path = app, public as $$
declare
  v_session app.sessions;
  v_couple app.couples;
begin
  select * into v_session from app.sessions where id = p_session for update;
  select * into v_couple from app.couples where id = v_session.couple_id;
  if not found or auth.uid() is null or auth.uid() not in (v_couple.member_a, v_couple.member_b) then raise exception 'not_member'; end if;
  if v_session.status <> 'proposed' or v_session.scheduled_at <= now() then raise exception 'not_pending'; end if;
  insert into app.session_acceptances (session_id, user_id) values (p_session, auth.uid()) on conflict do nothing;
  if (select count(*) from app.session_acceptances s where s.session_id = p_session and s.user_id in (v_couple.member_a, v_couple.member_b)) < 2 then
    return 'recorded';
  end if;
  update app.sessions set status = 'confirmed' where id = p_session;
  perform app.couple_system_message(v_couple.id, 'session.confirmed', null);
  perform app.notify_with_deliveries(v_session.counselor_id, 'session.confirmed', jsonb_build_object('couple_id', v_couple.id, 'session_id', p_session));
  perform app.audit('session.confirmed', 'sessions', p_session, '{}'::jsonb);
  return 'confirmed';
end $$;

-- Annulation par le conseiller (séance proposée ou confirmée, pas encore faite)
create function app.cancel_session(p_session uuid) returns void
language plpgsql security definer set search_path = app, public as $$
declare v_session app.sessions;
begin
  select * into v_session from app.sessions where id = p_session for update;
  if not found or v_session.counselor_id is distinct from auth.uid() then raise exception 'not_counselor'; end if;
  if v_session.status not in ('proposed', 'confirmed') then raise exception 'invalid_status'; end if;
  update app.sessions set status = 'cancelled' where id = p_session;
  perform app.couple_system_message(v_session.couple_id, 'session.cancelled', auth.uid());
  perform app.audit('session.cancelled', 'sessions', p_session, '{}'::jsonb);
end $$;

-- Séance faite (confirmée, heure passée) ; la première franchit l'étape « Séances avec le conseiller »
create function app.complete_session(p_session uuid) returns void
language plpgsql security definer set search_path = app, public as $$
declare v_session app.sessions;
begin
  select * into v_session from app.sessions where id = p_session for update;
  if not found or v_session.counselor_id is distinct from auth.uid() then raise exception 'not_counselor'; end if;
  if v_session.status <> 'confirmed' or v_session.scheduled_at > now() then raise exception 'invalid_status'; end if;
  update app.sessions set status = 'done', completed_at = now() where id = p_session;
  if not exists (select 1 from app.couple_milestones m where m.couple_id = v_session.couple_id and m.kind = 'counselor_sessions' and m.reached_at is not null) then
    insert into app.couple_milestones (couple_id, kind, reached_at) values (v_session.couple_id, 'counselor_sessions', now())
    on conflict (couple_id, kind) do update set reached_at = now();
    perform app.couple_system_message_arg(v_session.couple_id, 'milestone.reached', 'counselor_sessions', null);
  end if;
  perform app.audit('session.done', 'sessions', p_session, '{}'::jsonb);
end $$;

-- Séances d'un couple : pour les deux membres et le conseiller qui le suit (accord de chacun visible
-- seulement pour soi)
create function app.couple_sessions(p_couple uuid)
returns table (id uuid, scheduled_at timestamptz, mode text, location text, status text, counselor_name text, i_accepted boolean)
language sql stable security definer set search_path = app, public as $$
  select s.id, s.scheduled_at, s.mode, s.location, s.status, co.display_name,
         exists (select 1 from app.session_acceptances a where a.session_id = s.id and a.user_id = auth.uid())
  from app.sessions s
  left join app.counselors co on co.user_id = s.counselor_id
  where s.couple_id = p_couple
    and (
      exists (select 1 from app.couples c where c.id = p_couple and auth.uid() in (c.member_a, c.member_b))
      or app.my_counselor_access(p_couple) is not null
    )
  order by s.scheduled_at desc
  limit 50
$$;

-- Agenda du conseiller : séances à venir (proposées ou confirmées) des couples qu'il suit
create function app.counselor_agenda()
returns table (id uuid, couple_id uuid, a_first_name text, b_first_name text, scheduled_at timestamptz, mode text, location text, status text)
language sql stable security definer set search_path = app, public as $$
  select s.id, s.couple_id, pa.first_name, pb.first_name, s.scheduled_at, s.mode, s.location, s.status
  from app.sessions s
  join app.couples c on c.id = s.couple_id
  left join app.member_profiles pa on pa.user_id = c.member_a
  left join app.member_profiles pb on pb.user_id = c.member_b
  where s.counselor_id = auth.uid() and s.status in ('proposed', 'confirmed') and app.my_counselor_access(s.couple_id) is not null
  order by s.scheduled_at
$$;

grant execute on function
  app.open_private_channel(uuid),
  app.counselor_private_channels(),
  app.propose_session(uuid, timestamptz, text, text),
  app.accept_session(uuid),
  app.cancel_session(uuid),
  app.complete_session(uuid),
  app.couple_sessions(uuid),
  app.counselor_agenda()
to authenticated, service_role;
