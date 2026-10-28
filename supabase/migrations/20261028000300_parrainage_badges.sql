-- Phase 4, étapes 5 et 6 : parrainage et badges de confiance (questions 4 et 5 de
-- propositions/PROPOSITIONS-QUESTIONS-PHASE4.txt, validées le 27 octobre 2026, montants compris).
-- Parrainage :
--   a) Tout membre vérifié peut parrainer.
--   b) Lien personnel avec un code (partageable par WhatsApp) ; le code peut être saisi à
--      l'inscription.
--   c) Acquis à la première soirée PAYÉE ET POINTÉE à l'entrée du filleul.
--   d) Réduction de 2 000 FCFA sur la prochaine soirée du parrain, 5 parrainages récompensés par
--      an au plus (année civile, heure de Cotonou) ; rien pour le filleul. Montant et plafond
--      réglables. Une réduction par soirée ; appliquée seulement si le prix la dépasse.
--   e) Le parrain ne voit que le prénom de ses filleuls et l'état « en attente / acquis » ;
--      l'équipe voit le lien parrain / filleul dans la fiche du membre.
-- Badges de confiance :
--   a) « Identité vérifiée » (vérification validée), « Présent(e) aux soirées » (2 soirées
--      pointées au moins), « Profil complet » (sections du profil remplies et une photo
--      approuvée), « Parrain(e) » (un parrainage acquis au moins).
--   b) Attribution automatique par une tâche quotidienne de l'API, jamais à la main.
--   c) Visibles du membre, de ses matchs et découvertes, de son couple et de son conseiller ;
--      jamais sur la vitrine.
--   d) Retrait automatique quand la condition n'est plus remplie ; aucun badge pendant une
--      suspension (ni après une exclusion), rendus à la fin de celle-ci.

insert into app.settings (key, value) values
  ('referral.reward_xof', '2000'),
  ('referral.max_rewarded_per_year', '5')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. Parrainage : codes, liens parrain / filleul, réductions
-- ---------------------------------------------------------------------
create table app.referral_codes (
  user_id uuid primary key references app.users (id) on delete cascade,
  code text not null unique check (code ~ '^[0-9A-F]{8}$'),
  created_at timestamptz not null default now()
);
alter table app.referral_codes enable row level security;
alter table app.referral_codes force row level security;

-- Table du schéma initial (jamais remplie) : une ligne par filleul
alter table app.referrals
  drop constraint referrals_code_key,
  alter column referred_id set not null,
  add constraint referrals_referred_unique unique (referred_id),
  add constraint referrals_not_self check (referrer_id <> referred_id),
  add column acquired_at timestamptz,
  add column rewarded boolean not null default false;

create table app.member_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users (id) on delete cascade,
  amount_xof integer not null check (amount_xof > 0),
  reason text not null check (reason in ('referral')),
  referral_id uuid references app.referrals (id),
  created_at timestamptz not null default now(),
  used_payment_id uuid references app.payments (id),
  used_at timestamptz
);
alter table app.member_credits enable row level security;
alter table app.member_credits force row level security;

alter table app.payments
  add column credit_id uuid references app.member_credits (id),
  add column credit_xof integer not null default 0 check (credit_xof >= 0);

-- Code personnel du membre vérifié (créé à la première demande) : 8 caractères hexadécimaux
create function app.my_referral_code() returns text
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce((select p.status::text from app.member_profiles p where p.user_id = v_uid), '') <> 'verified' then raise exception 'not_verified'; end if;
  select code into v_code from app.referral_codes where user_id = v_uid;
  if v_code is not null then return v_code; end if;
  loop
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
    begin
      insert into app.referral_codes (user_id, code) values (v_uid, v_code);
      return v_code;
    exception when unique_violation then
      if exists (select 1 from app.referral_codes where user_id = v_uid) then
        return (select code from app.referral_codes where user_id = v_uid);
      end if;
    end;
  end loop;
end $$;

-- Code d'un parrain vérifié et actif (contrôle avant l'inscription)
create function app.referral_code_valid(p_code text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.referral_codes c join app.member_profiles p on p.user_id = c.user_id
    where c.code = upper(btrim(coalesce(p_code, ''))) and p.status = 'verified'
  )
$$;

-- Le nouveau membre indique son parrain (à l'inscription ; avant sa première soirée)
create function app.set_referrer(p_code text) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_referrer uuid;
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if v_uid is null or not exists (select 1 from app.member_profiles where user_id = v_uid) then raise exception 'forbidden' using errcode = '42501'; end if;
  if exists (select 1 from app.referrals where referred_id = v_uid) then raise exception 'already_referred'; end if;
  if exists (select 1 from app.event_registrations r where r.user_id = v_uid and r.status in ('checked_in', 'no_show')) then raise exception 'too_late'; end if;
  select c.user_id into v_referrer from app.referral_codes c join app.member_profiles p on p.user_id = c.user_id
   where c.code = v_code and p.status = 'verified';
  if v_referrer is null then raise exception 'invalid_referral_code'; end if;
  if v_referrer = v_uid then raise exception 'own_code'; end if;
  insert into app.referrals (referrer_id, referred_id, code) values (v_referrer, v_uid, v_code);
  perform app.audit('referral.created', 'referrals', null, jsonb_build_object('referrer', v_referrer, 'referred', v_uid));
end $$;

-- Filleuls du parrain : prénom seulement (aucun après la suppression du compte) et état
create function app.my_referrals()
returns table (first_name text, acquired boolean, rewarded boolean, created_at timestamptz)
language sql stable security definer set search_path = app, public as $$
  select case when app.member_gone(r.referred_id) then null else p.first_name end, r.acquired_at is not null, r.rewarded, r.created_at
  from app.referrals r left join app.member_profiles p on p.user_id = r.referred_id
  where r.referrer_id = auth.uid()
  order by r.created_at desc
$$;

-- Réduction disponible : ni utilisée, ni réservée par un paiement en attente d'une place encore tenue
create function app.available_credit(p_user uuid)
returns table (credit_id uuid, amount_xof integer)
language sql stable security definer set search_path = app, public as $$
  select c.id, c.amount_xof from app.member_credits c
  where c.user_id = p_user and c.used_at is null
    and not exists (
      select 1 from app.payments pay join app.event_registrations r on r.payment_id = pay.id
      where pay.credit_id = c.id and pay.status = 'pending' and r.status in ('booked', 'confirmed'))
  order by c.created_at, c.id
  limit 1
$$;

-- Mes réductions (espace membre)
create function app.my_credits()
returns table (amount_xof integer, created_at timestamptz, used_at timestamptz)
language sql stable security definer set search_path = app, public as $$
  select c.amount_xof, c.created_at, c.used_at from app.member_credits c where c.user_id = auth.uid() order by c.created_at desc
$$;

-- Montant à payer pour sa place (appelé par l'API avec le jeton du membre) : prix de la soirée,
-- moins une réduction de parrainage si le prix la dépasse
create function app.evening_payment_quote(p_event uuid)
returns table (price_xof integer, credit_id uuid, credit_xof integer, amount_xof integer)
language plpgsql stable security definer set search_path = app, public as $$
declare
  v_price integer;
  v_credit record;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from app.event_registrations r where r.event_id = p_event and r.user_id = auth.uid() and r.status in ('booked', 'confirmed')) then
    raise exception 'not_registered';
  end if;
  select e.price_xof into v_price from app.events e where e.id = p_event;
  if v_price is null or v_price <= 0 then raise exception 'price_not_set'; end if;
  select * into v_credit from app.available_credit(auth.uid());
  if v_credit.credit_id is not null and v_price > v_credit.amount_xof then
    return query select v_price, v_credit.credit_id, v_credit.amount_xof, v_price - v_credit.amount_xof;
  else
    return query select v_price, null::uuid, 0, v_price;
  end if;
end $$;

-- Réduction utilisée quand le paiement réussit ; rendue si ce paiement est remboursé
create function app.credit_on_payment() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if new.credit_id is not null and new.status is distinct from old.status then
    if new.status = 'succeeded' then
      update app.member_credits set used_payment_id = new.id, used_at = now() where id = new.credit_id and used_at is null;
    elsif new.status = 'refunded' then
      update app.member_credits set used_payment_id = null, used_at = null where id = new.credit_id and used_payment_id = new.id;
    end if;
  end if;
  return new;
end $$;

create trigger payments_credit after update of status on app.payments
  for each row execute function app.credit_on_payment();

-- Parrainage acquis au pointage d'une soirée payée du filleul ; récompense dans la limite annuelle
create function app.referral_on_checkin() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare
  v_referral app.referrals;
  v_year integer := extract(year from (now() at time zone 'Africa/Porto-Novo'))::integer;
  v_rewarded boolean;
begin
  if new.status = 'checked_in' and old.status is distinct from 'checked_in'
     and exists (select 1 from app.payments p where p.id = new.payment_id and p.status = 'succeeded') then
    select * into v_referral from app.referrals where referred_id = new.user_id and acquired_at is null for update;
    if found then
      v_rewarded := (select count(*) from app.referrals r
                      where r.referrer_id = v_referral.referrer_id and r.rewarded
                        and extract(year from (r.acquired_at at time zone 'Africa/Porto-Novo'))::integer = v_year)
                    < app.setting_int('referral.max_rewarded_per_year', 5);
      update app.referrals set acquired_at = now(), rewarded = v_rewarded where id = v_referral.id;
      if v_rewarded then
        insert into app.member_credits (user_id, amount_xof, reason, referral_id)
        values (v_referral.referrer_id, app.setting_int('referral.reward_xof', 2000), 'referral', v_referral.id);
      end if;
      perform app.notify_with_deliveries(v_referral.referrer_id, 'referral.acquired',
        jsonb_build_object('first_name', (select p.first_name from app.member_profiles p where p.user_id = new.user_id), 'rewarded', v_rewarded));
      perform app.audit('referral.acquired', 'referrals', v_referral.id, jsonb_build_object('rewarded', v_rewarded));
    end if;
  end if;
  return new;
end $$;

create trigger registrations_referral after update of status on app.event_registrations
  for each row execute function app.referral_on_checkin();

-- Réglages (montants réglables dans l'administration)
create function app.referral_settings()
returns table (reward_xof integer, max_rewarded_per_year integer)
language sql stable security definer set search_path = app, public as $$
  select app.setting_int('referral.reward_xof', 2000), app.setting_int('referral.max_rewarded_per_year', 5)
$$;

create function app.admin_set_referral_settings(p_reward_xof integer, p_max_per_year integer) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.has_permission('members.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_reward_xof is null or p_reward_xof not between 0 and 1000000 then raise exception 'invalid_amount'; end if;
  if p_max_per_year is null or p_max_per_year not between 0 and 100 then raise exception 'invalid_limit'; end if;
  insert into app.settings (key, value, updated_by, updated_at) values
    ('referral.reward_xof', to_jsonb(p_reward_xof), auth.uid(), now()),
    ('referral.max_rewarded_per_year', to_jsonb(p_max_per_year), auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform app.audit('referral.settings', 'settings', null, jsonb_build_object('reward_xof', p_reward_xof, 'max_per_year', p_max_per_year));
end $$;

-- Fiche du membre (équipe) : son parrain et ses filleuls
create function app.admin_member_referrals(p_user uuid)
returns table (role text, user_id uuid, first_name text, member_number text, acquired boolean, rewarded boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('members.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select 'referrer'::text, r.referrer_id, p.first_name, u.member_number, r.acquired_at is not null, r.rewarded, r.created_at
    from app.referrals r join app.users u on u.id = r.referrer_id left join app.member_profiles p on p.user_id = r.referrer_id
    where r.referred_id = p_user
    union all
    select 'referred'::text, r.referred_id, p.first_name, u.member_number, r.acquired_at is not null, r.rewarded, r.created_at
    from app.referrals r join app.users u on u.id = r.referred_id left join app.member_profiles p on p.user_id = r.referred_id
    where r.referrer_id = p_user
    order by 1, 7 desc;
end $$;

-- ---------------------------------------------------------------------
-- 2. Badges de confiance
-- ---------------------------------------------------------------------
alter table app.trust_badges add constraint trust_badges_badge
  check (badge in ('identity_verified', 'evenings_attended', 'profile_complete', 'sponsor'));

-- Sections du profil (apps/web/.../profil/profile.ts) : 3 textes « Je me décris » et 21
-- catégories, de chaque côté (« Je me décris » et « Ce que je recherche »)
create function app.profile_complete(p_user uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select
    (select count(distinct t.field) from app.profile_texts t where t.user_id = p_user and t.review_status <> 'rejected') = 3
    and (select count(*) from app.profile_answers a
          where a.user_id = p_user and cardinality(a.values) > 0
            and a.category in ('marital_status', 'children', 'wants_children', 'intention', 'timeline', 'religion', 'religious_practice',
                               'education', 'sector', 'income', 'languages', 'height', 'build', 'personality', 'tobacco', 'alcohol',
                               'going_out', 'interests', 'money_management', 'extended_family', 'desired_location')) = 42
$$;

-- Badges mérités aujourd'hui (aucun pendant une suspension ou après une exclusion)
create function app.earned_badges(p_user uuid) returns text[]
language sql stable security definer set search_path = app, public as $$
  select case when coalesce(p.status::text, 'deleted') in ('suspended', 'excluded', 'deleted') then '{}'::text[]
  else array_remove(array[
    case when exists (select 1 from app.verifications v where v.user_id = p_user and v.status = 'approved') then 'identity_verified' end,
    case when (select count(*) from app.event_registrations r where r.user_id = p_user and r.status = 'checked_in') >= 2 then 'evenings_attended' end,
    case when app.profile_complete(p_user) and exists (select 1 from app.photos ph where ph.user_id = p_user and ph.review_status = 'approved')
         then 'profile_complete' end,
    case when exists (select 1 from app.referrals r where r.referrer_id = p_user and r.acquired_at is not null) then 'sponsor' end
  ], null) end
  from app.users u left join app.member_profiles p on p.user_id = u.id
  where u.id = p_user
$$;

-- Tâche quotidienne de l'API (clé service role) : attribution et retrait ; renvoie le nombre de changements
create function app.refresh_trust_badges() returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_added integer;
  v_removed integer;
begin
  with wanted as (
    select p.user_id, unnest(app.earned_badges(p.user_id)) as badge from app.member_profiles p
  ), removed as (
    delete from app.trust_badges b
     where not exists (select 1 from wanted w where w.user_id = b.user_id and w.badge = b.badge)
    returning 1
  )
  select count(*) into v_removed from removed;
  with wanted as (
    select p.user_id, unnest(app.earned_badges(p.user_id)) as badge from app.member_profiles p
  ), added as (
    insert into app.trust_badges (user_id, badge)
    select w.user_id, w.badge from wanted w
    on conflict (user_id, badge) do nothing
    returning 1
  )
  select count(*) into v_added from added;
  return v_added + v_removed;
end $$;

-- Badges d'un membre, pour lui-même, ses matchs et découvertes, son couple, son conseiller et
-- l'équipe des membres ; vide pour tout autre (jamais sur la vitrine)
create function app.badges_of(p_user uuid) returns text[]
language sql stable security definer set search_path = app, public as $$
  select case when
    auth.uid() is not null and (
      p_user = auth.uid()
      or app.has_permission('members.manage')
      or exists (
        select 1 from app.matches m
        left join app.discoveries d on d.match_id = m.id
        where m.notified_at is not null
          and (m.status = 'pending_choice' or (m.status = 'discovery_open' and d.status in ('active', 'extended', 'continued')))
          and ((m.member_a = auth.uid() and m.member_b = p_user) or (m.member_b = auth.uid() and m.member_a = p_user)))
      or exists (
        select 1 from app.couples c
        where c.status in ('active', 'paused', 'union_celebrated')
          and ((c.member_a = auth.uid() and c.member_b = p_user) or (c.member_b = auth.uid() and c.member_a = p_user)))
      or exists (
        select 1 from app.couples c
        where p_user in (c.member_a, c.member_b) and app.my_counselor_access(c.id) is not null)
    )
  then coalesce((select array_agg(b.badge order by b.badge) from app.trust_badges b where b.user_id = p_user), '{}')
  else '{}'::text[] end
$$;

revoke execute on function app.refresh_trust_badges(), app.credit_on_payment(), app.referral_on_checkin(), app.available_credit(uuid),
  app.profile_complete(uuid), app.earned_badges(uuid) from public;
grant execute on function app.refresh_trust_badges() to service_role;
grant execute on function
  app.my_referral_code(),
  app.referral_code_valid(text),
  app.set_referrer(text),
  app.my_referrals(),
  app.my_credits(),
  app.evening_payment_quote(uuid),
  app.referral_settings(),
  app.admin_set_referral_settings(integer, integer),
  app.admin_member_referrals(uuid),
  app.badges_of(uuid)
to authenticated, service_role;
