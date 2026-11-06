-- Demande du 06/11/2026 (réponses de l'utilisateur aux 4 questions du même jour) :
--   1. Une soirée chaque samedi sur 10 mois : outil de l'administration (heure et lieu choisis une
--      fois), soirées créées publiées, chacune modifiable ensuite.
--   2. 30 participants : 15 femmes et 15 hommes ; prix 20 000 FCFA.
--   3. Soirée complète : la personne est inscrite d'office à la prochaine soirée qui a encore de la
--      place pour son sexe, et alertée ; elle a 24 h pour payer, comme d'habitude. Plus de liste
--      d'attente pour les nouvelles réservations.
--   4. 3 matchs au plus par soirée et par personne. S'il y en a plus, on garde d'abord les matchs avec
--      les personnes qui en ont le moins, à égalité l'ordre des tours. Les discussions des soirées
--      précédentes restent ouvertes en plus.
--   5. Plus de choix des matchs : tous s'ouvrent aussitôt en discussion.
--   6. Plus de pointage manuel : la préparation des tables prend toutes les places confirmées
--      (payées) ; 15 + 15 donnent 15 tables, donc 15 codes QR.
--   7. Quatre sujets de débat par soirée, les mêmes sur toutes les tables, proposés d'office par
--      rotation dans une liste de 24 et modifiables par l'équipe.

-- ---------------------------------------------------------------------
-- 1. Capacité 15 × 15 et prix 20 000 FCFA
-- ---------------------------------------------------------------------
alter table app.events drop constraint if exists events_capacity_women_check;
alter table app.events drop constraint if exists events_capacity_men_check;
alter table app.events add constraint events_capacity_women_check check (capacity_women between 1 and 15);
alter table app.events add constraint events_capacity_men_check check (capacity_men between 1 and 15);
alter table app.events alter column capacity_women set default 15;
alter table app.events alter column capacity_men set default 15;
alter table app.events alter column price_xof set default 20000;

-- ---------------------------------------------------------------------
-- 2. Sujets de débat (textes dans les trois langues du site, par clé)
-- ---------------------------------------------------------------------
create table if not exists app.debate_topics (
  key text primary key check (key ~ '^[a-z_]{3,40}$'),
  position smallint not null unique check (position > 0)
);
alter table app.debate_topics enable row level security;
alter table app.debate_topics force row level security;
drop policy if exists debate_topics_select on app.debate_topics;
create policy debate_topics_select on app.debate_topics for select using (auth.uid() is not null);

insert into app.debate_topics (key, position) values
  ('lasting_love', 1), ('family_place', 2), ('money_together', 3), ('faith_couple', 4),
  ('house_chores', 5), ('children_education', 6), ('in_laws', 7), ('trust_social_media', 8),
  ('career_couple', 9), ('ideal_first_date', 10), ('respect', 11), ('tradition_modernity', 12),
  ('disagreements', 13), ('shared_hobbies', 14), ('where_to_live', 15), ('friends_other_sex', 16),
  ('small_attentions', 17), ('saving_projects', 18), ('roles_home', 19), ('lessons_past', 20),
  ('forgiveness', 21), ('phone_time', 22), ('travel_dreams', 23), ('friends_place', 24)
on conflict (key) do nothing;

alter table app.events add column if not exists topics text[];
alter table app.events drop constraint if exists events_topics_check;
alter table app.events add constraint events_topics_check check (topics is null or cardinality(topics) = 4);

-- Quatre sujets d'office : chaque semaine passe aux quatre suivants de la liste (6 semaines pour en faire le tour)
create or replace function app.default_event_topics(p_starts_at timestamptz) returns text[]
language sql stable security definer set search_path = app, public as $$
  select array_agg(t.key order by k.k)
  from generate_series(0, 3) as k(k)
  join app.debate_topics t
    on t.position = ((floor(extract(epoch from p_starts_at) / 604800)::bigint * 4 + k.k)
                     % nullif((select count(*) from app.debate_topics), 0)) + 1
$$;

create or replace function app.events_default_topics() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if new.topics is null then new.topics := app.default_event_topics(new.starts_at); end if;
  return new;
end $$;

drop trigger if exists events_default_topics on app.events;
create trigger events_default_topics before insert on app.events
  for each row execute function app.events_default_topics();

-- Soirées pas encore terminées : sujets d'office
update app.events set topics = app.default_event_topics(starts_at)
 where topics is null and status in ('draft', 'published', 'full', 'in_progress');

-- Choix des sujets par l'équipe : quatre sujets différents de la liste, jusqu'à la fin de la soirée
create or replace function app.set_event_topics(p_event uuid, p_topics text[]) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  perform app.require_permission('events.manage');
  if p_topics is null or cardinality(p_topics) <> 4
     or (select count(distinct x) from unnest(p_topics) as x) <> 4
     or exists (select 1 from unnest(p_topics) as x where not exists (select 1 from app.debate_topics t where t.key = x)) then
    raise exception 'invalid_topics';
  end if;
  update app.events set topics = p_topics where id = p_event and status in ('draft', 'published', 'full', 'in_progress');
  if not found then raise exception 'not_editable'; end if;
  perform app.audit('event.topics_updated', 'events', p_event, jsonb_build_object('topics', p_topics));
end $$;

-- Sujets de la table scannée (page de vote) : le code QR suffit, les sujets n'ont rien de personnel
create or replace function app.evening_topics_by_qr(p_qr text) returns text[]
language sql stable security definer set search_path = app, public as $$
  select e.topics from app.event_tables t join app.events e on e.id = t.event_id
  where auth.uid() is not null and t.qr_token = p_qr and e.status in ('published', 'full', 'in_progress')
$$;

-- ---------------------------------------------------------------------
-- 3. Modification d'une soirée : capacité 15 × 15 (reprise de 20261019000200, ce seul changement)
-- ---------------------------------------------------------------------
create or replace function app.save_event(
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
  -- Capacité (06/11/2026) : au plus 15 × 15
  if p_capacity_women is null or p_capacity_men is null
     or p_capacity_women not between 1 and 15 or p_capacity_men not between 1 and 15 then
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
  if v_event.status not in ('draft', 'published', 'full') then raise exception 'not_editable'; end if;
  if v_event.status <> 'draft' then
    if p_venue is null then raise exception 'venue_required'; end if;
    if exists (select 1 from app.rounds where event_id = p_event) then raise exception 'not_editable'; end if;
    if p_capacity_women < app.seats_taken(p_event, 'female') or p_capacity_men < app.seats_taken(p_event, 'male') then
      raise exception 'capacity_below_taken';
    end if;
  end if;
  update app.events
     set venue_id = p_venue, theme_id = p_theme, starts_at = p_starts_at,
         capacity_women = p_capacity_women, capacity_men = p_capacity_men,
         round_minutes = p_round_minutes, changeover_minutes = p_changeover_minutes, price_xof = p_price_xof
   where id = p_event;
  if v_event.status <> 'draft' then
    perform app.promote_waitlist(p_event);
    perform app.notify_evening(p_event, 'evening.updated');
  end if;
  perform app.audit('event.updated', 'events', p_event, jsonb_build_object('published', v_event.status <> 'draft'));
  return p_event;
end $$;

-- Soirées à venir pas encore préparées : 15 × 15 et 20 000 FCFA (les places déjà payées restent payées)
do $$
declare v_event uuid;
begin
  for v_event in
    update app.events e
       set capacity_women = greatest(e.capacity_women, 15), capacity_men = greatest(e.capacity_men, 15),
           price_xof = case when e.price_xof is null then null else 20000 end
     where e.status in ('draft', 'published', 'full') and e.starts_at > now()
       and not exists (select 1 from app.rounds r where r.event_id = e.id)
       and (e.capacity_women < 15 or e.capacity_men < 15 or e.price_xof <> 20000)
    returning e.id
  loop
    -- Places ajoutées : les personnes déjà en liste d'attente avancent
    perform app.promote_waitlist(v_event);
  end loop;
end $$;

-- Choix B (28/10) : la réduction du parrainage reste inférieure au prix d'une soirée, désormais 20 000
create or replace function app.admin_set_referral_settings(p_reward_xof integer, p_max_per_year integer) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.has_permission('members.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_reward_xof is null or p_reward_xof not between 0 and 1000000 then raise exception 'invalid_amount'; end if;
  if p_reward_xof >= 20000 then raise exception 'reward_too_high'; end if;
  if p_max_per_year is null or p_max_per_year not between 0 and 100 then raise exception 'invalid_limit'; end if;
  insert into app.settings (key, value, updated_by, updated_at) values
    ('referral.reward_xof', to_jsonb(p_reward_xof), auth.uid(), now()),
    ('referral.max_rewarded_per_year', to_jsonb(p_max_per_year), auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform app.audit('referral.settings', 'settings', null, jsonb_build_object('reward_xof', p_reward_xof, 'max_per_year', p_max_per_year));
end $$;

-- ---------------------------------------------------------------------
-- 4. Programmation des samedis
-- ---------------------------------------------------------------------
-- Une soirée publiée chaque samedi, du premier samedi à partir de p_first_day, pendant p_months mois,
-- à l'heure p_time (Cotonou), au lieu p_venue. Un samedi qui a déjà une soirée (non annulée) est sauté.
-- Renvoie le nombre de soirées créées.
create or replace function app.schedule_saturdays(
  p_venue uuid,
  p_first_day date,
  p_time time,
  p_months integer default 10,
  p_price_xof integer default 20000
) returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_day date;
  v_end date;
  v_start timestamptz;
  v_count integer := 0;
begin
  perform app.require_permission('events.manage');
  if p_venue is null or not exists (select 1 from app.venues where id = p_venue) then raise exception 'venue_required'; end if;
  if p_first_day is null or p_time is null then raise exception 'starts_at'; end if;
  if p_months is null or p_months not between 1 and 12 then raise exception 'invalid_months'; end if;
  if p_price_xof is null or p_price_xof < 0 then raise exception 'invalid_price'; end if;

  -- Premier samedi (isodow 6) à partir du jour donné
  v_day := p_first_day + ((6 - extract(isodow from p_first_day)::integer + 7) % 7);
  v_end := (p_first_day + make_interval(months => p_months))::date;
  while v_day < v_end loop
    v_start := (v_day + p_time) at time zone 'Africa/Porto-Novo';
    if v_start > now() and not exists (
      select 1 from app.events e
       where e.status <> 'cancelled' and (e.starts_at at time zone 'Africa/Porto-Novo')::date = v_day
    ) then
      insert into app.events (venue_id, starts_at, capacity_women, capacity_men, price_xof, status)
      values (p_venue, v_start, 15, 15, p_price_xof, 'published');
      v_count := v_count + 1;
    end if;
    v_day := v_day + 7;
  end loop;
  perform app.audit('events.scheduled_saturdays', 'events', null, jsonb_build_object(
    'venue_id', p_venue, 'first_day', p_first_day, 'time', p_time, 'months', p_months, 'price_xof', p_price_xof, 'created', v_count));
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- 5. Réservation : soirée complète, inscription d'office à la suivante
-- ---------------------------------------------------------------------
-- Refus lié au thème d'une soirée, ou null si le membre y a accès (règles de 20261029000000)
create or replace function app.theme_refusal(p_event app.events, p_user uuid, p_birth date) returns text
language plpgsql stable security definer set search_path = app, public as $$
declare
  v_theme app.themes;
  v_age integer;
  v_religion text;
  v_sector text;
begin
  if p_event.theme_id is null then return null; end if;
  select * into v_theme from app.themes where id = p_event.theme_id;
  v_age := extract(year from age((p_event.starts_at at time zone 'Africa/Porto-Novo')::date, p_birth))::integer;
  if (v_theme.min_age is not null and v_age < v_theme.min_age) or (v_theme.max_age is not null and v_age > v_theme.max_age) then
    return 'theme_age';
  end if;
  select pa."values"[1] into v_religion from app.profile_answers pa where pa.user_id = p_user and pa.side = 'self' and pa.category = 'religion';
  if coalesce(array_length(v_theme.required_religions, 1), 0) > 0 and (v_religion is null or not v_religion = any (v_theme.required_religions)) then
    return 'theme_religion';
  end if;
  select pa."values"[1] into v_sector from app.profile_answers pa where pa.user_id = p_user and pa.side = 'self' and pa.category = 'sector';
  if coalesce(array_length(v_theme.sectors, 1), 0) > 0 and (v_sector is null or not v_sector = any (v_theme.sectors)) then
    return 'theme_sector';
  end if;
  return null;
end $$;

-- Reprise de 20261029000000 : mêmes contrôles ; si la soirée est complète pour son sexe, le membre est
-- inscrit à la prochaine soirée publiée qui a de la place (thème compris), renvoie 'next_evening'.
create or replace function app.book_event(p_event uuid) returns text
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_profile app.member_profiles;
  v_event app.events;
  v_next app.events;
  v_refusal text;
  v_capacity integer;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into v_profile from app.member_profiles where user_id = v_uid;
  if v_profile is null or v_profile.status <> 'verified' then raise exception 'not_validated'; end if;
  if app.in_couple(v_uid) then
    raise exception 'couple_exclusivity';
  end if;
  if v_profile.evenings_blocked_until is not null and now() < v_profile.evenings_blocked_until then
    raise exception 'blocked_until';
  end if;
  if not app.has_booking_photo(v_uid) then
    raise exception 'photo_required';
  end if;

  select * into v_event from app.events where id = p_event for update;
  if v_event is null or v_event.status not in ('published', 'full') or now() >= v_event.starts_at then
    raise exception 'evening_closed';
  end if;
  if exists (select 1 from app.event_registrations where event_id = p_event and user_id = v_uid
             and status in ('booked', 'confirmed', 'checked_in'))
     or exists (select 1 from app.waitlist_entries where event_id = p_event and user_id = v_uid) then
    raise exception 'already_registered';
  end if;

  v_refusal := app.theme_refusal(v_event, v_uid, v_profile.birth_date);
  if v_refusal is not null then raise exception '%', v_refusal; end if;

  v_capacity := case v_profile.sex when 'female' then v_event.capacity_women else v_event.capacity_men end;
  if app.seats_taken(p_event, v_profile.sex) < v_capacity then
    insert into app.event_registrations (event_id, user_id, sex, status, seated_at)
    values (p_event, v_uid, v_profile.sex, 'booked', now())
    on conflict (event_id, user_id)
    do update set status = 'booked', seated_at = now(), confirmed_at = null, checked_in_at = null, created_at = now();
    return 'seat';
  end if;

  -- Complète (06/11/2026) : la prochaine soirée publiée qui a de la place pour son sexe
  for v_next in
    select * from app.events e
     where e.status in ('published', 'full') and e.starts_at > greatest(v_event.starts_at, now()) and e.id <> p_event
     order by e.starts_at
     for update
  loop
    continue when exists (select 1 from app.event_registrations r where r.event_id = v_next.id and r.user_id = v_uid
                           and r.status in ('booked', 'confirmed', 'checked_in'))
               or exists (select 1 from app.waitlist_entries w where w.event_id = v_next.id and w.user_id = v_uid);
    continue when app.theme_refusal(v_next, v_uid, v_profile.birth_date) is not null;
    continue when app.seats_taken(v_next.id, v_profile.sex)
                  >= case v_profile.sex when 'female' then v_next.capacity_women else v_next.capacity_men end;
    -- L'alerte dit que la soirée choisie était complète (app.on_registration_notify)
    perform set_config('app.full_event', p_event::text, true);
    insert into app.event_registrations (event_id, user_id, sex, status, seated_at)
    values (v_next.id, v_uid, v_profile.sex, 'booked', now())
    on conflict (event_id, user_id)
    do update set status = 'booked', seated_at = now(), confirmed_at = null, checked_in_at = null, created_at = now();
    perform set_config('app.full_event', '', true);
    perform app.audit('evening.moved_to_next', 'events', v_next.id, jsonb_build_object('full_event_id', p_event));
    return 'next_evening';
  end loop;
  raise exception 'no_evening_available';
end $$;

-- Reprise de 20261103000200 : une inscription d'office à la soirée suivante a sa propre alerte
create or replace function app.on_registration_notify() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare
  v_event app.events;
  v_payload jsonb;
  v_kind text;
  v_full text := coalesce(current_setting('app.full_event', true), '');
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  select * into v_event from app.events where id = new.event_id;
  v_payload := jsonb_build_object('event_id', new.event_id, 'starts_at', v_event.starts_at, 'priced', v_event.price_xof is not null);
  v_kind := case
    when new.status = 'booked' and auth.uid() = new.user_id and v_full <> '' then 'evening.moved_to_next'
    when new.status = 'booked' and auth.uid() = new.user_id then 'evening.booked'
    when new.status = 'confirmed' then 'evening.confirmed'
    when new.status = 'cancelled' and auth.uid() = new.user_id then 'evening.registration_cancelled'
    when new.status = 'released' then 'evening.seat_released'
  end;
  if v_kind = 'evening.moved_to_next' then
    v_payload := v_payload || jsonb_build_object('full_event_id', v_full,
      'full_starts_at', (select starts_at from app.events where id = v_full::uuid));
  end if;
  if v_kind = 'evening.confirmed' then
    v_payload := v_payload || jsonb_build_object('by_payment', exists (
      select 1 from app.payments p where p.id = new.payment_id and p.status = 'succeeded'));
  end if;
  if v_kind is not null then
    perform app.notify_with_deliveries(new.user_id, v_kind, v_payload);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 6. Préparation des tables : pointage automatique des places confirmées
-- ---------------------------------------------------------------------
-- Reprise de 20261014000000 : les places confirmées (payées) des membres actifs sont pointées
-- d'office, puis numérotation, tables, codes QR et rotation comme avant. 15 + 15 : 15 tables.
create or replace function app.prepare_evening(p_event uuid) returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_event app.events;
  v_women uuid[];
  v_men uuid[];
  v_n integer;
  v_round_id uuid;
  v_table_id uuid;
  v_man integer;
begin
  perform app.require_permission('events.manage');
  select * into v_event from app.events where id = p_event for update;
  if v_event.id is null then raise exception 'not_found'; end if;
  if exists (select 1 from app.rounds where event_id = p_event) then raise exception 'already_prepared'; end if;

  update app.event_registrations set status = 'checked_in', checked_in_at = now()
   where event_id = p_event and status = 'confirmed' and app.member_active(user_id);

  select array_agg(user_id order by checked_in_at, user_id) into v_women
    from app.event_registrations where event_id = p_event and sex = 'female' and status = 'checked_in';
  select array_agg(user_id order by checked_in_at, user_id) into v_men
    from app.event_registrations where event_id = p_event and sex = 'male' and status = 'checked_in';
  if v_women is null or v_men is null then raise exception 'not_enough_participants'; end if;

  v_n := greatest(array_length(v_women, 1), array_length(v_men, 1));

  update app.event_registrations r set seat_number = w.n
    from unnest(v_women) with ordinality as w(id, n) where r.event_id = p_event and r.user_id = w.id;
  update app.event_registrations r set seat_number = m.n
    from unnest(v_men) with ordinality as m(id, n) where r.event_id = p_event and r.user_id = m.id;

  for t in 1..v_n loop
    insert into app.event_tables (event_id, table_number, qr_token, qr_valid_from, qr_valid_until)
    values (p_event, t, encode(gen_random_bytes(18), 'hex'), v_event.starts_at, v_event.starts_at + interval '12 hours');
  end loop;

  for r in 1..v_n loop
    insert into app.rounds (event_id, round_number) values (p_event, r) returning id into v_round_id;
    for t in 1..v_n loop
      select id into v_table_id from app.event_tables where event_id = p_event and table_number = t;
      v_man := null;
      for m in 1..coalesce(array_length(v_men, 1), 0) loop
        if ((m - 1 + r - 1) % v_n) + 1 = t then v_man := m; end if;
      end loop;
      insert into app.round_pairings (round_id, table_id, woman_id, man_id)
      values (v_round_id, v_table_id, v_women[t], case when v_man is null then null else v_men[v_man] end);
    end loop;
  end loop;
  perform app.audit('evening.prepared', 'events', p_event, jsonb_build_object('tables', v_n,
    'women', array_length(v_women, 1), 'men', array_length(v_men, 1)));
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- 7. Matchs : 3 au plus par soirée et par personne, ouverts aussitôt
-- ---------------------------------------------------------------------
-- Matchs pas encore annoncés d'une soirée : tant qu'une personne en a plus de 3, on prend celle qui
-- en a le plus, on garde ses 3 matchs avec les personnes qui en ont le moins (à égalité : le tour le
-- plus tôt), et on retire les autres. Renvoie le nombre de matchs retirés. Interne.
create or replace function app.limit_evening_matches(p_event uuid, p_max integer default 3) returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_member uuid;
  v_removed integer := 0;
  v_n integer;
begin
  loop
    v_member := null;
    select x.member into v_member from (
      select m.member, count(*) as n
      from app.matches a cross join lateral (values (a.member_a), (a.member_b)) as m(member)
      where a.event_id = p_event and a.notified_at is null
      group by m.member having count(*) > p_max
      order by count(*) desc, m.member
      limit 1
    ) x;
    exit when v_member is null;

    with mine as (
      select a.id,
             (select count(*) from app.matches b
               where b.event_id = p_event and b.notified_at is null
                 and (case when a.member_a = v_member then a.member_b else a.member_a end) in (b.member_a, b.member_b)) as partner_count,
             (select min(ro.round_number) from app.votes v
                join app.round_pairings pa on pa.id = v.pairing_id
                join app.rounds ro on ro.id = pa.round_id
               where ro.event_id = p_event and v.voter_id = a.member_a and v.target_id = a.member_b) as round_number
      from app.matches a
      where a.event_id = p_event and a.notified_at is null and v_member in (a.member_a, a.member_b)
    ), ranked as (
      select id, row_number() over (order by partner_count, round_number nulls last, id) as rank from mine
    )
    delete from app.matches where id in (select id from ranked where rank > p_max);
    get diagnostics v_n = row_count;
    v_removed := v_removed + v_n;
  end loop;
  if v_removed > 0 then
    perform app.audit('matches.limited', 'events', p_event, jsonb_build_object('removed', v_removed, 'max', p_max));
  end if;
  return v_removed;
end $$;

-- Reprise de 20261103000000 : la limite de 3 passe avant l'annonce
create or replace function app.compute_matches(p_event uuid) returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_event app.events;
  v_count integer;
begin
  perform app.require_permission('events.manage');
  select * into v_event from app.events where id = p_event for update;
  if v_event.status <> 'finished' then raise exception 'evening_not_finished'; end if;
  insert into app.matches (event_id, member_a, member_b, announced_at)
  select distinct p_event, least(a.voter_id, a.target_id), greatest(a.voter_id, a.target_id), now()
  from app.votes a
  join app.round_pairings pa on pa.id = a.pairing_id
  join app.rounds ra on ra.id = pa.round_id and ra.event_id = p_event
  join app.votes b on b.voter_id = a.target_id and b.target_id = a.voter_id and b.pairing_id = a.pairing_id
  where a.choice = 'yes' and b.choice = 'yes'
  on conflict (event_id, member_a, member_b) do nothing;
  get diagnostics v_count = row_count;
  update app.events set results_computed_at = now() where id = p_event;
  update app.matches set announced_at = now() where event_id = p_event and notified_at is null and announced_at > now();
  v_count := v_count - app.limit_evening_matches(p_event);
  perform app.announce_matches();
  return greatest(v_count, 0);
end $$;

-- Reprise de 20261026000400 : plus de limite de 2 découvertes actives
create or replace function app.try_open_discovery(p_match uuid) returns uuid
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
  if app.in_couple(v_match.member_a) or app.in_couple(v_match.member_b) then
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

-- Reprise de 20261026000400 : plus de choix, chaque nouveau match est choisi d'office pour les deux
create or replace function app.announce_matches() returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_count integer;
  v_ids uuid[];
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

  insert into app.match_choices (match_id, user_id, automatic)
  select a.id, m.member, true
  from app.matches a cross join lateral (values (a.member_a), (a.member_b)) as m(member)
  where a.id = any(v_ids) and not app.in_couple(m.member)
  on conflict do nothing;

  for v_match in select unnest(v_ids) loop
    perform app.try_open_discovery(v_match);
  end loop;
  return v_count;
end $$;

-- Reprise de 20261026000400 : sans place à vérifier (anciens matchs encore en attente)
create or replace function app.choose_match(p_match uuid) returns uuid
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
  insert into app.match_choices (match_id, user_id) values (p_match, v_uid);
  return app.try_open_discovery(p_match);
end $$;

-- Rattrapage : les matchs annoncés encore en attente de choix s'ouvrent maintenant
do $$
declare v_match uuid;
begin
  insert into app.match_choices (match_id, user_id, automatic)
  select a.id, m.member, true
  from app.matches a cross join lateral (values (a.member_a), (a.member_b)) as m(member)
  where a.status = 'pending_choice' and a.notified_at is not null and now() < app.match_pending_expires_at(a)
    and not app.in_couple(m.member)
  on conflict do nothing;
  for v_match in
    select a.id from app.matches a
     where a.status = 'pending_choice' and a.notified_at is not null and now() < app.match_pending_expires_at(a)
  loop
    perform app.try_open_discovery(v_match);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 8. Discussions façon WhatsApp : liste avec dernier message, et accusé de lecture
-- ---------------------------------------------------------------------
create or replace function app.my_discovery_chats()
returns table (discovery_id uuid, conversation_id uuid, last_body text, last_is_system boolean, last_from_me boolean, last_at timestamptz, unread integer)
language sql stable security definer set search_path = app, public as $$
  select d.id, c.id, lm.body, lm.is_system, lm.sender_id is not distinct from auth.uid(), lm.created_at,
         (select count(*)::integer from app.messages m
           where m.conversation_id = c.id and not m.is_system and m.sender_id is distinct from auth.uid()
             and m.created_at > coalesce(r.read_at, '-infinity'::timestamptz))
  from app.discoveries d
  join app.matches mt on mt.id = d.match_id
  join app.conversations c on c.discovery_id = d.id and c.kind = 'discovery'
  left join app.conversation_reads r on r.conversation_id = c.id and r.user_id = auth.uid()
  left join lateral (
    select m.body, m.is_system, m.sender_id, m.created_at from app.messages m
     where m.conversation_id = c.id order by m.created_at desc limit 1
  ) lm on true
  where auth.uid() is not null and auth.uid() in (mt.member_a, mt.member_b) and d.status in ('active', 'extended')
$$;

-- Dernière lecture de la conversation par l'autre membre (pas le conseiller) : « lu » sur mes messages
create or replace function app.conversation_partner_read_at(p_conversation uuid) returns timestamptz
language plpgsql stable security definer set search_path = app, public as $$
begin
  if auth.uid() is null or not app.conversation_member(p_conversation) then raise exception 'not_member'; end if;
  return (
    select max(r.read_at) from app.conversation_reads r
     where r.conversation_id = p_conversation and r.user_id <> auth.uid()
       and not exists (select 1 from app.counselors co where co.user_id = r.user_id)
  );
end $$;

-- ---------------------------------------------------------------------
-- 9. Droits
-- ---------------------------------------------------------------------
revoke all on function app.default_event_topics(timestamptz), app.events_default_topics(),
  app.theme_refusal(app.events, uuid, date), app.limit_evening_matches(uuid, integer) from public;
grant select on app.debate_topics to authenticated;
grant execute on function
  app.set_event_topics(uuid, text[]),
  app.evening_topics_by_qr(text),
  app.schedule_saturdays(uuid, date, time, integer, integer),
  app.my_discovery_chats(),
  app.conversation_partner_read_at(uuid)
to authenticated, service_role;
