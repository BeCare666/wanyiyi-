-- Phase 3 : règles validées le 27 octobre 2026 (propositions/PROPOSITIONS-QUESTIONS-PHASE3.txt).
--   - 16 : parcours du couple en 5 étapes. Une étape est franchie quand LES DEUX membres la
--     confirment (message dans la conversation à chaque demande) ; date = seconde confirmation,
--     corrigeable ensuite par l'un ou l'autre (journalisé, message dans la conversation) ; retrait
--     d'une étape par les deux de la même manière ; pas de note libre. « Séances avec le
--     conseiller » n'est jamais confirmée à la main : elle est franchie à la première séance faite
--     (question 9 c). Le conseiller du couple voit les étapes sans les marquer.
--   - 4 : lieux conseillés pour un premier rendez-vous : case dans l'administration (Lieux), avec
--     quartier, type et horaires ; liste visible des membres en découverte ou en couple.

-- ---------------------------------------------------------------------
-- 1. Étapes confirmées par les deux
-- ---------------------------------------------------------------------
create table app.milestone_confirmations (
  couple_id uuid not null references app.couples (id) on delete cascade,
  kind app.milestone_kind not null,
  action text not null check (action in ('reach', 'remove')),
  user_id uuid not null references app.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (couple_id, kind, action, user_id)
);
alter table app.milestone_confirmations enable row level security;
alter table app.milestone_confirmations force row level security;
create policy milestone_confirmations_select_self on app.milestone_confirmations for select using (user_id = auth.uid());

-- Le conseiller qui suit le couple voit ses étapes
create policy couple_milestones_select_counselor on app.couple_milestones for select using (app.my_counselor_access(couple_id) is not null);

-- Message système avec un argument (« code:argument », traduit par le site). Interne.
create function app.couple_system_message_arg(p_couple uuid, p_code text, p_arg text, p_sender uuid) returns void
language sql security definer set search_path = app, public as $$
  insert into app.messages (conversation_id, sender_id, body, is_system)
  select c.id, p_sender, p_code || ':' || p_arg, true from app.conversations c where c.couple_id = p_couple and c.kind = 'couple'
$$;

create function app.confirm_milestone(p_couple uuid, p_kind app.milestone_kind, p_action text) returns text
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_couple app.couples;
  v_reached boolean;
begin
  select * into v_couple from app.couples where id = p_couple for update;
  if not found or v_uid is null or v_uid not in (v_couple.member_a, v_couple.member_b) then raise exception 'not_member'; end if;
  if v_couple.status not in ('active', 'paused') then raise exception 'invalid_status'; end if;
  if p_action not in ('reach', 'remove') then raise exception 'invalid_request'; end if;
  if p_kind = 'counselor_sessions' then raise exception 'automatic_milestone'; end if;
  v_reached := exists (select 1 from app.couple_milestones m where m.couple_id = p_couple and m.kind = p_kind and m.reached_at is not null);
  if (p_action = 'reach' and v_reached) or (p_action = 'remove' and not v_reached) then raise exception 'invalid_status'; end if;

  insert into app.milestone_confirmations (couple_id, kind, action, user_id) values (p_couple, p_kind, p_action, v_uid)
  on conflict do nothing;
  if (select count(*) from app.milestone_confirmations c
       where c.couple_id = p_couple and c.kind = p_kind and c.action = p_action and c.user_id in (v_couple.member_a, v_couple.member_b)) < 2 then
    perform app.couple_system_message_arg(p_couple, 'milestone.' || p_action || '_requested', p_kind::text, v_uid);
    return 'recorded';
  end if;

  delete from app.milestone_confirmations where couple_id = p_couple and kind = p_kind;
  if p_action = 'reach' then
    insert into app.couple_milestones (couple_id, kind, reached_at) values (p_couple, p_kind, now())
    on conflict (couple_id, kind) do update set reached_at = now();
  else
    update app.couple_milestones set reached_at = null where couple_id = p_couple and kind = p_kind;
  end if;
  perform app.couple_system_message_arg(p_couple, case p_action when 'reach' then 'milestone.reached' else 'milestone.removed' end, p_kind::text, null);
  perform app.audit('milestone.' || p_action, 'couples', p_couple, jsonb_build_object('kind', p_kind));
  return 'done';
end $$;

-- Correction de la date d'une étape franchie par l'un ou l'autre (pas dans le futur)
create function app.set_milestone_date(p_couple uuid, p_kind app.milestone_kind, p_date date) returns void
language plpgsql security definer set search_path = app, public as $$
declare v_couple app.couples;
begin
  select * into v_couple from app.couples where id = p_couple for update;
  if not found or auth.uid() is null or auth.uid() not in (v_couple.member_a, v_couple.member_b) then raise exception 'not_member'; end if;
  if v_couple.status not in ('active', 'paused') then raise exception 'invalid_status'; end if;
  if p_date is null or p_date > (now() at time zone 'Africa/Porto-Novo')::date or p_date < (v_couple.created_at at time zone 'Africa/Porto-Novo')::date then
    raise exception 'invalid_date';
  end if;
  update app.couple_milestones set reached_at = (p_date::timestamp + time '12:00') at time zone 'Africa/Porto-Novo'
   where couple_id = p_couple and kind = p_kind and reached_at is not null;
  if not found then raise exception 'invalid_status'; end if;
  perform app.couple_system_message_arg(p_couple, 'milestone.date_changed', p_kind::text, auth.uid());
  perform app.audit('milestone.date_changed', 'couples', p_couple, jsonb_build_object('kind', p_kind, 'date', p_date));
end $$;

-- Étapes du couple pour le membre : franchies, et ses propres confirmations en attente seulement
create function app.my_milestones(p_couple uuid)
returns table (kind app.milestone_kind, reached_at timestamptz, i_confirmed_reach boolean, i_confirmed_remove boolean)
language sql stable security definer set search_path = app, public as $$
  select k.kind, m.reached_at,
         exists (select 1 from app.milestone_confirmations c where c.couple_id = p_couple and c.kind = k.kind and c.action = 'reach' and c.user_id = auth.uid()),
         exists (select 1 from app.milestone_confirmations c where c.couple_id = p_couple and c.kind = k.kind and c.action = 'remove' and c.user_id = auth.uid())
  from unnest(enum_range(null::app.milestone_kind)) as k(kind)
  left join app.couple_milestones m on m.couple_id = p_couple and m.kind = k.kind
  where exists (select 1 from app.couples c where c.id = p_couple and auth.uid() in (c.member_a, c.member_b))
$$;

-- ---------------------------------------------------------------------
-- 2. Lieux conseillés pour un premier rendez-vous
-- ---------------------------------------------------------------------
alter table app.venues
  add column first_date_partner boolean not null default false,
  add column district text check (char_length(district) <= 80),
  add column venue_kind text check (venue_kind in ('cafe', 'restaurant', 'other')),
  add column opening_hours text check (char_length(opening_hours) <= 120);

-- Membres en découverte ouverte ou en couple (en cours, en pause) seulement
create function app.first_date_venues()
returns table (id uuid, name text, district text, address text, city text, venue_kind text, opening_hours text)
language sql stable security definer set search_path = app, public as $$
  select v.id, v.name, v.district, v.address, v.city, v.venue_kind, v.opening_hours
  from app.venues v
  where v.first_date_partner
    and (
      exists (select 1 from app.discoveries d join app.matches m on m.id = d.match_id
               where d.status in ('active', 'extended') and auth.uid() in (m.member_a, m.member_b))
      or exists (select 1 from app.couples c where c.status in ('active', 'paused') and auth.uid() in (c.member_a, c.member_b))
    )
  order by v.city, v.district nulls last, v.name
$$;

revoke execute on function app.couple_system_message_arg(uuid, text, text, uuid) from public;
grant execute on function
  app.confirm_milestone(uuid, app.milestone_kind, text),
  app.set_milestone_date(uuid, app.milestone_kind, date),
  app.my_milestones(uuid),
  app.first_date_venues()
to authenticated, service_role;
