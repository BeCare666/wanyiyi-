-- Phase 3, étape 5 : espace du couple (section 9.5 ; question 10 d).
--   - Partage des numéros : seulement dans l'espace du couple, quand les deux ont cliqué
--     « Partager mon numéro » ; le bouton n'existe que si le réglage « Autoriser le partage de mon
--     numéro » (share_phone) est vrai. Le numéro de l'autre n'apparaît qu'une fois les deux clics
--     faits, et seulement pendant le couple (en cours ou en pause) ; jamais pendant un blocage.
--     Chacun ne sait pas si l'autre a déjà cliqué (comme les décisions de la découverte).
--   - Rendez-vous déclarés : par l'un des deux, pendant le couple en cours ; c'est une activité
--     (question 6). Le message « Bien rentré(e) ? » attend la question 5.
--   - Étapes du parcours : lisibles par les deux ; qui les marque attend une question.
--   - Messages non lus (tableau de bord) : dernière lecture de chaque conversation par membre.

-- ---------------------------------------------------------------------
-- 1. Étapes du parcours : lecture par les deux membres
-- ---------------------------------------------------------------------
create policy couple_milestones_select_member on app.couple_milestones for select using (
  exists (select 1 from app.couples c where c.id = couple_id and auth.uid() in (c.member_a, c.member_b))
);

-- ---------------------------------------------------------------------
-- 2. Partage des numéros (double clic)
-- ---------------------------------------------------------------------
create function app.share_my_phone(p_couple uuid) returns boolean
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_couple app.couples;
begin
  select * into v_couple from app.couples where id = p_couple for update;
  if not found or v_uid is null or v_uid not in (v_couple.member_a, v_couple.member_b) then raise exception 'not_member'; end if;
  if v_couple.status not in ('active', 'paused') then raise exception 'invalid_status'; end if;
  if v_couple.blocked_at is not null then raise exception 'couple_blocked'; end if;
  if not coalesce((select p.share_phone from app.member_profiles p where p.user_id = v_uid), false) then
    raise exception 'phone_sharing_disabled';
  end if;
  if (select u.phone from app.users u where u.id = v_uid) is null then raise exception 'no_phone'; end if;
  insert into app.phone_shares (couple_id, user_id) values (p_couple, v_uid) on conflict do nothing;
  perform app.audit('couple.phone_shared', 'couples', p_couple, '{}'::jsonb);
  return (select count(*) from app.phone_shares s where s.couple_id = p_couple and s.user_id in (v_couple.member_a, v_couple.member_b)) = 2;
end $$;

-- État pour le membre : a-t-il cliqué, peut-il cliquer, et le numéro de l'autre si les deux l'ont fait
create function app.my_couple_phone(p_couple uuid)
returns table (i_shared boolean, can_share boolean, partner_phone text)
language sql stable security definer set search_path = app, public as $$
  select
    exists (select 1 from app.phone_shares s where s.couple_id = c.id and s.user_id = auth.uid()),
    coalesce(me.share_phone, false) and u.phone is not null,
    case when c.status in ('active', 'paused') and c.blocked_at is null
          and (select count(*) from app.phone_shares s where s.couple_id = c.id and s.user_id in (c.member_a, c.member_b)) = 2
         then (select o.phone from app.users o where o.id = case when c.member_a = auth.uid() then c.member_b else c.member_a end)
    end
  from app.couples c
  join app.users u on u.id = auth.uid()
  left join app.member_profiles me on me.user_id = auth.uid()
  where c.id = p_couple and auth.uid() in (c.member_a, c.member_b)
$$;

-- ---------------------------------------------------------------------
-- 3. Rendez-vous déclarés (activité du couple)
-- ---------------------------------------------------------------------
create function app.declare_date(p_couple uuid, p_date_at timestamptz) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_couple app.couples;
  v_id uuid;
begin
  select * into v_couple from app.couples where id = p_couple;
  if not found or v_uid is null or v_uid not in (v_couple.member_a, v_couple.member_b) then raise exception 'not_member'; end if;
  if v_couple.status <> 'active' then raise exception 'invalid_status'; end if;
  if p_date_at is null then raise exception 'invalid_date'; end if;
  insert into app.date_checkins (couple_id, declared_by, date_at) values (p_couple, v_uid, p_date_at) returning id into v_id;
  return v_id;
end $$;

create function app.my_couple_dates(p_couple uuid)
returns table (id uuid, date_at timestamptz, declared_by_me boolean)
language sql stable security definer set search_path = app, public as $$
  select d.id, d.date_at, d.declared_by = auth.uid()
  from app.date_checkins d
  join app.couples c on c.id = d.couple_id
  where d.couple_id = p_couple and auth.uid() in (c.member_a, c.member_b)
  order by d.date_at desc
  limit 50
$$;

-- ---------------------------------------------------------------------
-- 4. Messages non lus (tableau de bord, 6.2-1) : dernière lecture de chaque conversation
-- ---------------------------------------------------------------------
create table app.conversation_reads (
  conversation_id uuid not null references app.conversations (id) on delete cascade,
  user_id uuid not null references app.users (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
alter table app.conversation_reads enable row level security;
alter table app.conversation_reads force row level security;
create policy conversation_reads_select_self on app.conversation_reads for select using (user_id = auth.uid());

-- Conversation lue par le membre (à l'affichage de la page) ; seulement les siennes
create function app.mark_conversation_read(p_conversation uuid) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if auth.uid() is null or not app.conversation_member(p_conversation) then raise exception 'not_member'; end if;
  insert into app.conversation_reads (conversation_id, user_id) values (p_conversation, auth.uid())
  on conflict (conversation_id, user_id) do update set read_at = now();
end $$;

-- Messages de l'autre (ou du conseiller) arrivés depuis la dernière lecture, par conversation lisible
create function app.my_unread_messages()
returns table (conversation_id uuid, kind app.conversation_kind, discovery_id uuid, couple_id uuid, unread integer)
language sql stable security definer set search_path = app, public as $$
  select c.id, c.kind, c.discovery_id, c.couple_id,
         (select count(*)::integer from app.messages m
           where m.conversation_id = c.id and not m.is_system and m.sender_id is distinct from auth.uid()
             and m.created_at > coalesce(r.read_at, '-infinity'::timestamptz))
  from app.conversations c
  left join app.conversation_reads r on r.conversation_id = c.id and r.user_id = auth.uid()
  left join app.discoveries d on d.id = c.discovery_id
  left join app.matches mt on mt.id = d.match_id
  left join app.couples cp on cp.id = c.couple_id
  where c.kind in ('discovery', 'couple')
    and (auth.uid() in (mt.member_a, mt.member_b) or auth.uid() in (cp.member_a, cp.member_b))
    and app.conversation_member(c.id)
$$;

grant execute on function
  app.mark_conversation_read(uuid),
  app.my_unread_messages(),
  app.share_my_phone(uuid),
  app.my_couple_phone(uuid),
  app.declare_date(uuid, timestamptz),
  app.my_couple_dates(uuid)
to authenticated, service_role;
