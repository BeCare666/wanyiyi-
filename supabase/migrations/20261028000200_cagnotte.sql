-- Phase 4, étape 4 : cagnotte (11.2-10 ; question 3 de
-- propositions/PROPOSITIONS-QUESTIONS-PHASE4.txt, validée le 27 octobre 2026, montants compris).
--   a) Proposée par l'un, acceptée par l'autre (les deux d'accord), couple en cours avec l'étape
--      « Dot ou mariage » franchie, ou union célébrée. Une seule cagnotte proposée ou ouverte.
--   b) Contribution par toute personne qui a le lien, sans compte (par l'API, qui demande le
--      paiement à FeexPay) : prénom ou nom affiché obligatoire, ou « Anonyme » ; message de
--      300 caractères au plus, relu par le filtre des textes du profil. La page publique ne
--      montre que le titre choisi par le couple et l'objectif.
--   c) 1 000 FCFA au moins par contribution (réglable), aucun maximum ; objectif facultatif.
--   d) Commission Ifedele de 0 % au lancement (réglable), figée à l'ouverture ; frais FeexPay
--      déduits du montant reversé (l'équipe saisit le montant réellement envoyé).
--   e) Reversement manuel par l'équipe vers UN numéro Mobile Money déclaré à la proposition et
--      confirmé par l'autre en acceptant ; demandé par les deux à tout moment (chaque demande
--      couvre les contributions pas encore reversées), proposé à la clôture ; journalisé.
--   f) Clôture à la date choisie (90 jours au plus après l'ouverture) ou plus tôt par les deux.
--      Séparation ou départ avant le reversement : cagnotte fermée, reversements en attente
--      annulés, contributions non reversées marquées « à rembourser » (remboursement manuel
--      depuis Paiements, comme une soirée annulée).
--   g) Le couple voit chaque contribution : nom affiché (ou « Anonyme »), message et montant,
--      sauf si le contributeur a choisi « montant masqué ».
-- Nouvelle permission cagnottes.manage (administration et super administration).

insert into app.role_permissions (role, permission) values
  ('admin', 'cagnottes.manage'), ('super_admin', 'cagnottes.manage')
on conflict do nothing;

insert into app.settings (key, value) values
  ('cagnotte.min_contribution_xof', '1000'),
  ('cagnotte.commission_percent', '0')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
alter table app.cagnottes
  add column status text not null default 'proposed'
    check (status in ('proposed', 'open', 'closed', 'paid_out', 'refused', 'cancelled')),
  add column proposed_by uuid references app.users (id),
  add column payout_phone text,
  add column opened_at timestamptz,
  add column commission_percent numeric(5, 2) not null default 0 check (commission_percent between 0 and 50),
  add column closed_at timestamptz,
  add column closed_reason text check (closed_reason in ('date', 'couple', 'separation')),
  add constraint cagnottes_title check (char_length(title) between 3 and 80);

create unique index cagnottes_one_active on app.cagnottes (couple_id) where status in ('proposed', 'open');

alter table app.contributions
  add column is_anonymous boolean not null default false,
  add column hide_amount boolean not null default false,
  add column payout_id uuid;

create table app.cagnotte_payouts (
  id uuid primary key default gen_random_uuid(),
  cagnotte_id uuid not null references app.cagnottes (id),
  requested_at timestamptz not null default now(),
  gross_xof integer not null check (gross_xof > 0),
  commission_xof integer not null check (commission_xof >= 0),
  status text not null default 'requested' check (status in ('requested', 'paid', 'cancelled')),
  payout_phone text not null,
  sent_xof integer check (sent_xof > 0),
  reference text,
  paid_at timestamptz,
  paid_by uuid references app.users (id)
);
alter table app.cagnotte_payouts enable row level security;
alter table app.cagnotte_payouts force row level security;
alter table app.contributions add constraint contributions_payout_fk foreign key (payout_id) references app.cagnotte_payouts (id);

-- Demandes à deux (clôture anticipée, reversement), comme les décisions du couple
create table app.cagnotte_requests (
  cagnotte_id uuid not null references app.cagnottes (id) on delete cascade,
  user_id uuid not null references app.users (id) on delete cascade,
  kind text not null check (kind in ('close', 'payout')),
  created_at timestamptz not null default now(),
  primary key (cagnotte_id, user_id, kind)
);
alter table app.cagnotte_requests enable row level security;
alter table app.cagnotte_requests force row level security;

-- ---------------------------------------------------------------------
-- 2. Réglages (montants réglables dans l'administration)
-- ---------------------------------------------------------------------
create function app.cagnotte_commission_percent() returns numeric
language sql stable security definer set search_path = app, public as $$
  select coalesce((select (value #>> '{}')::numeric from app.settings where key = 'cagnotte.commission_percent'), 0)
$$;

-- Réglages en vigueur (contribution minimale, commission des prochaines ouvertures)
create function app.cagnotte_settings()
returns table (min_contribution_xof integer, commission_percent numeric)
language sql stable security definer set search_path = app, public as $$
  select app.setting_int('cagnotte.min_contribution_xof', 1000), app.cagnotte_commission_percent()
$$;

create function app.admin_set_cagnotte_settings(p_min_contribution_xof integer, p_commission_percent numeric) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.has_permission('cagnottes.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_min_contribution_xof is null or p_min_contribution_xof not between 100 and 10000000 then raise exception 'invalid_amount'; end if;
  if p_commission_percent is null or p_commission_percent < 0 or p_commission_percent > 50 or p_commission_percent <> round(p_commission_percent, 2) then
    raise exception 'invalid_commission';
  end if;
  insert into app.settings (key, value, updated_by, updated_at) values
    ('cagnotte.min_contribution_xof', to_jsonb(p_min_contribution_xof), auth.uid(), now()),
    ('cagnotte.commission_percent', to_jsonb(p_commission_percent), auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform app.audit('cagnotte.settings', 'settings', null,
    jsonb_build_object('min_contribution_xof', p_min_contribution_xof, 'commission_percent', p_commission_percent));
end $$;

-- ---------------------------------------------------------------------
-- 3. Création à deux
-- ---------------------------------------------------------------------
-- Contributions reçues (paiement réussi, ni remboursé ni à rembourser) d'une cagnotte
create function app.cagnotte_collected(p_cagnotte uuid) returns integer
language sql stable security definer set search_path = app, public as $$
  select coalesce(sum(c.amount_xof), 0)::integer
  from app.contributions c join app.payments p on p.id = c.payment_id
  where c.cagnotte_id = p_cagnotte and p.status = 'succeeded'
$$;

-- Numéro Mobile Money du Bénin : 229 suivi de 8 ou 10 chiffres, « + » facultatif
create function app.valid_payout_phone(p_phone text) returns text
language sql immutable set search_path = app, public as $$
  select case when regexp_replace(coalesce(p_phone, ''), '\s', '', 'g') ~ '^\+?229([0-9]{8}|[0-9]{10})$'
              then '+' || ltrim(regexp_replace(p_phone, '\s', '', 'g'), '+') end
$$;

create function app.propose_cagnotte(p_couple uuid, p_title text, p_goal_xof integer, p_closes_on date, p_payout_phone text) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_couple app.couples;
  v_title text := btrim(coalesce(p_title, ''));
  v_phone text := app.valid_payout_phone(p_payout_phone);
  v_closes timestamptz;
  v_id uuid;
begin
  select * into v_couple from app.couples where id = p_couple for update;
  if not found or v_uid is null or v_uid not in (v_couple.member_a, v_couple.member_b) then raise exception 'not_member'; end if;
  if v_couple.blocked_at is not null then raise exception 'couple_blocked'; end if;
  if v_couple.status not in ('active', 'union_celebrated') then raise exception 'invalid_status'; end if;
  if v_couple.status = 'active' and not exists (
       select 1 from app.couple_milestones m where m.couple_id = p_couple and m.kind = 'dowry_or_wedding' and m.reached_at is not null) then
    raise exception 'too_early';
  end if;
  if exists (select 1 from app.cagnottes c where c.couple_id = p_couple and c.status in ('proposed', 'open')) then raise exception 'already_open'; end if;
  if char_length(v_title) not between 3 and 80 then raise exception 'invalid_title'; end if;
  if cardinality(app.text_contact_issues(v_title)) > 0 then raise exception 'contact_details'; end if;
  if p_goal_xof is not null and p_goal_xof not between 1000 and 1000000000 then raise exception 'invalid_goal'; end if;
  -- Fin de journée (heure de Cotonou) du jour choisi, 90 jours au plus après aujourd'hui
  v_closes := ((p_closes_on + 1)::timestamp at time zone 'Africa/Porto-Novo');
  if p_closes_on is null or v_closes <= now() or v_closes > now() + interval '90 days' then raise exception 'invalid_closing'; end if;
  if v_phone is null then raise exception 'invalid_phone'; end if;

  insert into app.cagnottes (couple_id, title, goal_xof, closes_at, proposed_by, payout_phone)
  values (p_couple, v_title, p_goal_xof, v_closes, v_uid, v_phone)
  returning id into v_id;
  perform app.notify_with_deliveries(case when v_uid = v_couple.member_a then v_couple.member_b else v_couple.member_a end,
    'cagnotte.proposed', jsonb_build_object('couple_id', p_couple));
  perform app.audit('cagnotte.proposed', 'cagnottes', v_id, '{}'::jsonb);
  return v_id;
end $$;

-- Réponse de l'autre : accepter confirme le titre, la date et le numéro de reversement
create function app.answer_cagnotte(p_cagnotte uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_cagnotte app.cagnottes;
  v_couple app.couples;
begin
  select * into v_cagnotte from app.cagnottes where id = p_cagnotte for update;
  select * into v_couple from app.couples where id = v_cagnotte.couple_id;
  if not found or v_uid is null or v_uid not in (v_couple.member_a, v_couple.member_b) then raise exception 'not_member'; end if;
  if v_cagnotte.status <> 'proposed' then raise exception 'not_pending'; end if;
  if v_uid = v_cagnotte.proposed_by then raise exception 'own_request'; end if;
  if not coalesce(p_accept, false) then
    update app.cagnottes set status = 'refused' where id = p_cagnotte;
    perform app.notify_with_deliveries(v_cagnotte.proposed_by, 'cagnotte.refused', jsonb_build_object('couple_id', v_couple.id));
    perform app.audit('cagnotte.refused', 'cagnottes', p_cagnotte, '{}'::jsonb);
    return 'refused';
  end if;
  if v_couple.status not in ('active', 'union_celebrated') or v_couple.blocked_at is not null then raise exception 'invalid_status'; end if;
  if v_cagnotte.closes_at <= now() or v_cagnotte.closes_at > now() + interval '90 days' then raise exception 'invalid_closing'; end if;
  update app.cagnottes
     set status = 'open', opened_at = now(), commission_percent = app.cagnotte_commission_percent(),
         public_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
   where id = p_cagnotte;
  perform app.notify_with_deliveries(v_cagnotte.proposed_by, 'cagnotte.opened', jsonb_build_object('couple_id', v_couple.id));
  perform app.audit('cagnotte.opened', 'cagnottes', p_cagnotte, jsonb_build_object('commission_percent', app.cagnotte_commission_percent()));
  return 'open';
end $$;

-- Retrait de sa proposition tant que l'autre n'a pas répondu
create function app.cancel_cagnotte_proposal(p_cagnotte uuid) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  update app.cagnottes set status = 'cancelled' where id = p_cagnotte and status = 'proposed' and proposed_by = auth.uid();
  if not found then raise exception 'not_pending'; end if;
  perform app.audit('cagnotte.cancelled', 'cagnottes', p_cagnotte, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 4. Décisions à deux : clôture anticipée, demande de reversement
-- ---------------------------------------------------------------------
create function app.cagnotte_decide(p_cagnotte uuid, p_kind text) returns text
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_cagnotte app.cagnottes;
  v_couple app.couples;
  v_gross integer;
  v_payout uuid;
begin
  select * into v_cagnotte from app.cagnottes where id = p_cagnotte for update;
  select * into v_couple from app.couples where id = v_cagnotte.couple_id;
  if not found or v_uid is null or v_uid not in (v_couple.member_a, v_couple.member_b) then raise exception 'not_member'; end if;
  if p_kind not in ('close', 'payout') then raise exception 'invalid_kind'; end if;
  if v_couple.status not in ('active', 'paused', 'union_celebrated') or v_couple.blocked_at is not null then raise exception 'invalid_status'; end if;
  if p_kind = 'close' and v_cagnotte.status <> 'open' then raise exception 'invalid_status'; end if;
  if p_kind = 'payout' and v_cagnotte.status not in ('open', 'closed') then raise exception 'invalid_status'; end if;
  if p_kind = 'payout' and exists (select 1 from app.cagnotte_payouts o where o.cagnotte_id = p_cagnotte and o.status = 'requested') then
    raise exception 'payout_pending';
  end if;

  insert into app.cagnotte_requests (cagnotte_id, user_id, kind) values (p_cagnotte, v_uid, p_kind) on conflict do nothing;
  if (select count(*) from app.cagnotte_requests r where r.cagnotte_id = p_cagnotte and r.kind = p_kind and r.user_id in (v_couple.member_a, v_couple.member_b)) < 2 then
    perform app.notify_with_deliveries(case when v_uid = v_couple.member_a then v_couple.member_b else v_couple.member_a end,
      'cagnotte.' || p_kind || '_requested', jsonb_build_object('couple_id', v_couple.id));
    return 'recorded';
  end if;
  delete from app.cagnotte_requests where cagnotte_id = p_cagnotte and kind = p_kind;

  if p_kind = 'close' then
    update app.cagnottes set status = 'closed', closed_at = now(), closed_reason = 'couple' where id = p_cagnotte;
    perform app.audit('cagnotte.closed', 'cagnottes', p_cagnotte, jsonb_build_object('reason', 'couple'));
    return 'closed';
  end if;

  -- Reversement : contributions reçues pas encore reversées
  select coalesce(sum(c.amount_xof), 0)::integer into v_gross
  from app.contributions c join app.payments p on p.id = c.payment_id
  where c.cagnotte_id = p_cagnotte and p.status = 'succeeded' and c.payout_id is null;
  if v_gross = 0 then raise exception 'nothing_to_pay_out'; end if;
  insert into app.cagnotte_payouts (cagnotte_id, gross_xof, commission_xof, payout_phone)
  values (p_cagnotte, v_gross, floor(v_gross * v_cagnotte.commission_percent / 100)::integer, v_cagnotte.payout_phone)
  returning id into v_payout;
  update app.contributions c set payout_id = v_payout
    from app.payments p
   where p.id = c.payment_id and c.cagnotte_id = p_cagnotte and p.status = 'succeeded' and c.payout_id is null;
  perform app.audit('cagnotte.payout_requested', 'cagnotte_payouts', v_payout, jsonb_build_object('gross_xof', v_gross));
  return 'payout_requested';
end $$;

-- ---------------------------------------------------------------------
-- 5. Lecture par le couple
-- ---------------------------------------------------------------------
-- Dernière cagnotte du couple, avec ses propres demandes seulement
create function app.my_cagnotte(p_couple uuid)
returns table (id uuid, status text, title text, goal_xof integer, closes_at timestamptz, opened_at timestamptz, public_token text,
               payout_phone text, commission_percent numeric, collected_xof integer, proposed_by_me boolean, my_requests text[],
               payout_pending boolean, paid_out_xof integer, closed_reason text)
language sql stable security definer set search_path = app, public as $$
  select c.id, c.status, c.title, c.goal_xof, c.closes_at, c.opened_at, c.public_token, c.payout_phone, c.commission_percent,
         app.cagnotte_collected(c.id), c.proposed_by = auth.uid(),
         coalesce(array(select r.kind from app.cagnotte_requests r where r.cagnotte_id = c.id and r.user_id = auth.uid()), '{}'),
         exists (select 1 from app.cagnotte_payouts o where o.cagnotte_id = c.id and o.status = 'requested'),
         coalesce((select sum(o.sent_xof) from app.cagnotte_payouts o where o.cagnotte_id = c.id and o.status = 'paid'), 0)::integer,
         c.closed_reason
  from app.cagnottes c
  join app.couples cp on cp.id = c.couple_id
  where c.couple_id = p_couple and auth.uid() in (cp.member_a, cp.member_b) and c.status not in ('refused', 'cancelled')
  order by c.created_at desc
  limit 1
$$;

-- Contributions reçues : nom affiché (null si anonyme), message, montant (null si masqué)
create function app.cagnotte_contributions(p_cagnotte uuid)
returns table (id uuid, contributor_name text, message text, amount_xof integer, created_at timestamptz)
language sql stable security definer set search_path = app, public as $$
  select c.id, case when c.is_anonymous then null else c.contributor_name end, c.message,
         case when c.hide_amount then null else c.amount_xof end, c.created_at
  from app.contributions c
  join app.payments p on p.id = c.payment_id
  join app.cagnottes g on g.id = c.cagnotte_id
  join app.couples cp on cp.id = g.couple_id
  where c.cagnotte_id = p_cagnotte and auth.uid() in (cp.member_a, cp.member_b) and p.status = 'succeeded'
  order by c.created_at desc
  limit 500
$$;

-- ---------------------------------------------------------------------
-- 6. Page publique et contribution (sans compte, par l'API)
-- ---------------------------------------------------------------------
-- Ni nom ni photo du couple : titre, objectif, progression (si objectif), date de fin
create function app.public_cagnotte(p_token text)
returns table (title text, goal_xof integer, progress_percent integer, closes_at timestamptz, accepting boolean, min_contribution_xof integer)
language sql stable security definer set search_path = app, public as $$
  select c.title, c.goal_xof,
         case when c.goal_xof is not null then least(100, floor(app.cagnotte_collected(c.id) * 100.0 / c.goal_xof))::integer end,
         c.closes_at, c.status = 'open' and c.closes_at > now(),
         app.setting_int('cagnotte.min_contribution_xof', 1000)
  from app.cagnottes c
  where p_token is not null and char_length(p_token) = 64 and c.public_token = p_token and c.status in ('open', 'closed', 'paid_out')
$$;

-- Contribution (clé service role de l'API seulement) : paiement « contribution » sans membre,
-- puis l'API demande le paiement Mobile Money à FeexPay ; comptée quand le paiement réussit
create function app.create_contribution(
  p_token text, p_name text, p_anonymous boolean, p_message text, p_amount_xof integer, p_hide_amount boolean, p_provider app.payment_provider
) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_cagnotte app.cagnottes;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_payment uuid;
begin
  select * into v_cagnotte from app.cagnottes
   where p_token is not null and char_length(p_token) = 64 and public_token = p_token;
  if not found then raise exception 'not_found'; end if;
  if v_cagnotte.status <> 'open' or v_cagnotte.closes_at <= now() then raise exception 'cagnotte_closed'; end if;
  if p_amount_xof is null or p_amount_xof < app.setting_int('cagnotte.min_contribution_xof', 1000) or p_amount_xof > 10000000 then
    raise exception 'invalid_amount';
  end if;
  if not coalesce(p_anonymous, false) and (v_name is null or char_length(v_name) > 60) then raise exception 'name_required'; end if;
  if char_length(coalesce(v_name, '')) > 60 then raise exception 'name_required'; end if;
  if char_length(coalesce(v_message, '')) > 300 then raise exception 'message_too_long'; end if;
  if cardinality(app.text_contact_issues(coalesce(v_name, '') || ' ' || coalesce(v_message, ''))) > 0 then raise exception 'contact_details'; end if;

  insert into app.payments (user_id, purpose, amount_xof, provider) values (null, 'contribution', p_amount_xof, p_provider)
  returning id into v_payment;
  insert into app.contributions (cagnotte_id, contributor_name, message, amount_xof, payment_id, is_anonymous, hide_amount)
  values (v_cagnotte.id, v_name, v_message, p_amount_xof, v_payment, coalesce(p_anonymous, false), coalesce(p_hide_amount, false));
  perform app.audit('contribution.created', 'payments', v_payment, jsonb_build_object('cagnotte', v_cagnotte.id, 'amount_xof', p_amount_xof));
  return v_payment;
end $$;

-- Contribution reçue : les deux membres sont prévenus (sans le montant si masqué)
create function app.contribution_payment_received() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare
  v_contribution app.contributions;
  v_couple app.couples;
begin
  if new.status = 'succeeded' and old.status is distinct from 'succeeded' and new.purpose = 'contribution' then
    select * into v_contribution from app.contributions where payment_id = new.id;
    if found then
      select cp.* into v_couple from app.couples cp join app.cagnottes g on g.couple_id = cp.id where g.id = v_contribution.cagnotte_id;
      perform app.notify_with_deliveries(v_couple.member_a, 'cagnotte.contribution', jsonb_build_object('couple_id', v_couple.id));
      perform app.notify_with_deliveries(v_couple.member_b, 'cagnotte.contribution', jsonb_build_object('couple_id', v_couple.id));
    end if;
  end if;
  return new;
end $$;

create trigger payments_contribution_received after update of status on app.payments
  for each row execute function app.contribution_payment_received();

-- ---------------------------------------------------------------------
-- 7. Clôture à la date choisie (tâche de l'API) et séparation
-- ---------------------------------------------------------------------
create function app.close_due_cagnottes() returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    update app.cagnottes c set status = 'closed', closed_at = now(), closed_reason = 'date'
     where c.status = 'open' and c.closes_at <= now()
    returning c.id, c.couple_id
  loop
    v_count := v_count + 1;
    -- Reversement proposé à la clôture (question 3 e)
    perform app.notify_with_deliveries(cp.member_a, 'cagnotte.closed', jsonb_build_object('couple_id', cp.id)),
            app.notify_with_deliveries(cp.member_b, 'cagnotte.closed', jsonb_build_object('couple_id', cp.id))
       from app.couples cp where cp.id = v_row.couple_id;
    perform app.audit('cagnotte.closed', 'cagnottes', v_row.id, jsonb_build_object('reason', 'date'));
  end loop;
  -- Proposition restée sans réponse jusqu'à la date de fin : sans objet
  update app.cagnottes set status = 'cancelled' where status = 'proposed' and closes_at <= now();
  return v_count;
end $$;

-- Séparation ou départ : cagnotte fermée, reversements en attente annulés, contributions non
-- reversées à rembourser (question 3 f)
create function app.cagnotte_on_couple_end() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare v_cagnotte uuid;
begin
  if new.status in ('separated', 'left') and old.status is distinct from new.status then
    update app.cagnottes set status = 'cancelled' where couple_id = new.id and status = 'proposed';
    for v_cagnotte in select id from app.cagnottes where couple_id = new.id and status in ('open', 'closed') loop
      update app.cagnottes set status = 'closed', closed_at = coalesce(closed_at, now()), closed_reason = 'separation' where id = v_cagnotte;
      update app.contributions c set payout_id = null
        from app.cagnotte_payouts o where o.id = c.payout_id and o.cagnotte_id = v_cagnotte and o.status = 'requested';
      update app.cagnotte_payouts set status = 'cancelled' where cagnotte_id = v_cagnotte and status = 'requested';
      update app.payments p set refund_requested_at = now()
        from app.contributions c
       where c.payment_id = p.id and c.cagnotte_id = v_cagnotte and c.payout_id is null and p.status = 'succeeded' and p.refund_requested_at is null;
      delete from app.cagnotte_requests where cagnotte_id = v_cagnotte;
      perform app.audit('cagnotte.closed', 'cagnottes', v_cagnotte, jsonb_build_object('reason', 'separation'));
    end loop;
  end if;
  return new;
end $$;

create trigger couples_cagnotte_end after update of status on app.couples
  for each row execute function app.cagnotte_on_couple_end();

-- ---------------------------------------------------------------------
-- 8. Administration
-- ---------------------------------------------------------------------
-- Reversement fait par l'équipe : montant réellement envoyé (frais FeexPay déduits) et référence
create function app.admin_mark_payout_paid(p_payout uuid, p_sent_xof integer, p_reference text) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_payout app.cagnotte_payouts;
  v_couple app.couples;
  v_reference text := nullif(btrim(coalesce(p_reference, '')), '');
begin
  if not app.has_permission('cagnottes.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_payout from app.cagnotte_payouts where id = p_payout for update;
  if not found then raise exception 'not_found'; end if;
  if v_payout.status <> 'requested' then raise exception 'not_pending'; end if;
  if p_sent_xof is null or p_sent_xof <= 0 or p_sent_xof > v_payout.gross_xof - v_payout.commission_xof then raise exception 'invalid_amount'; end if;
  if v_reference is null or char_length(v_reference) > 100 then raise exception 'reference_required'; end if;
  update app.cagnotte_payouts set status = 'paid', sent_xof = p_sent_xof, reference = v_reference, paid_at = now(), paid_by = auth.uid()
   where id = p_payout;
  -- Cagnotte close sans autre contribution à reverser : entièrement reversée
  update app.cagnottes g set status = 'paid_out'
   where g.id = v_payout.cagnotte_id and g.status = 'closed' and coalesce(g.closed_reason, '') <> 'separation'
     and not exists (select 1 from app.contributions c join app.payments p on p.id = c.payment_id
                      where c.cagnotte_id = g.id and p.status = 'succeeded' and c.payout_id is null);
  select cp.* into v_couple from app.couples cp join app.cagnottes g on g.couple_id = cp.id where g.id = v_payout.cagnotte_id;
  perform app.notify_with_deliveries(v_couple.member_a, 'cagnotte.paid_out', jsonb_build_object('couple_id', v_couple.id, 'sent_xof', p_sent_xof));
  perform app.notify_with_deliveries(v_couple.member_b, 'cagnotte.paid_out', jsonb_build_object('couple_id', v_couple.id, 'sent_xof', p_sent_xof));
  perform app.audit('cagnotte.payout_paid', 'cagnotte_payouts', p_payout,
    jsonb_build_object('gross_xof', v_payout.gross_xof, 'commission_xof', v_payout.commission_xof, 'sent_xof', p_sent_xof, 'reference', v_reference));
end $$;

-- Fiche d'une cagnotte pour l'équipe : couple, contributions (avec les noms), reversements
create function app.admin_cagnotte(p_id uuid)
returns table (id uuid, couple_id uuid, status text, title text, goal_xof integer, closes_at timestamptz, opened_at timestamptz,
               closed_reason text, payout_phone text, commission_percent numeric, collected_xof integer,
               a_first_name text, a_number text, b_first_name text, b_number text, contributions jsonb, payouts jsonb)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('cagnottes.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select g.id, g.couple_id, g.status, g.title, g.goal_xof, g.closes_at, g.opened_at, g.closed_reason, g.payout_phone, g.commission_percent,
           app.cagnotte_collected(g.id), pa.first_name, ua.member_number, pb.first_name, ub.member_number,
           coalesce((select jsonb_agg(jsonb_build_object(
                       'payment_id', p.id, 'name', c.contributor_name, 'anonymous', c.is_anonymous, 'amount_xof', c.amount_xof,
                       'status', p.status, 'refund_requested', p.refund_requested_at is not null, 'paid_out', c.payout_id is not null,
                       'created_at', c.created_at) order by c.created_at desc)
                     from app.contributions c join app.payments p on p.id = c.payment_id
                     where c.cagnotte_id = g.id and p.status in ('succeeded', 'refunded')), '[]'::jsonb),
           coalesce((select jsonb_agg(jsonb_build_object(
                       'id', o.id, 'status', o.status, 'requested_at', o.requested_at, 'gross_xof', o.gross_xof,
                       'commission_xof', o.commission_xof, 'payout_phone', o.payout_phone, 'sent_xof', o.sent_xof,
                       'reference', o.reference, 'paid_at', o.paid_at) order by o.requested_at desc)
                     from app.cagnotte_payouts o where o.cagnotte_id = g.id), '[]'::jsonb)
    from app.cagnottes g
    join app.couples cp on cp.id = g.couple_id
    join app.users ua on ua.id = cp.member_a left join app.member_profiles pa on pa.user_id = cp.member_a
    join app.users ub on ub.id = cp.member_b left join app.member_profiles pb on pb.user_id = cp.member_b
    where g.id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- 9. Liste filtrable « cagnottes » (moteur des migrations 20261026000200, 000900, 20261028000100)
-- ---------------------------------------------------------------------
alter function app.list_field(text, text) rename to list_field_providers;
alter function app.list_sort_field(text, text) rename to list_sort_field_providers;
alter function app.list_columns(text) rename to list_columns_providers;
alter function app.list_sort_sql(text, jsonb) rename to list_sort_sql_providers;
alter function app.list_rows_sql(text, jsonb, jsonb) rename to list_rows_sql_providers;

create function app.list_field(p_list text, p_field text)
returns table (kind text, expr text, options text[])
language sql stable set search_path = app, public as $$
  select * from app.list_field_providers(p_list, p_field)
  union all
  select f.kind, f.expr, f.options
  from (values
    ('cagnottes', 'member', 'text', $e$concat_ws(' ', x.a_first_name, x.a_last_name, x.b_first_name, x.b_last_name)$e$, null::text[]),
    ('cagnottes', 'member_number', 'text', $e$concat_ws(' ', x.a_number, x.b_number)$e$, null),
    ('cagnottes', 'title', 'text', 'x.title', null),
    ('cagnottes', 'status', 'list', 'x.status', array['proposed', 'open', 'closed', 'paid_out', 'refused', 'cancelled']),
    ('cagnottes', 'collected', 'number', 'x.collected_xof', null),
    ('cagnottes', 'goal', 'number', 'x.goal_xof', null),
    ('cagnottes', 'payout_pending', 'boolean', 'x.payout_pending', null),
    ('cagnottes', 'to_refund', 'boolean', 'x.to_refund', null),
    ('cagnottes', 'closes_at', 'date', $e$(x.closes_at at time zone 'Africa/Porto-Novo')::date$e$, null),
    ('cagnottes', 'created_at', 'date', $e$(x.created_at at time zone 'Africa/Porto-Novo')::date$e$, null)
  ) f(list, field, kind, expr, options)
  where f.list = p_list and f.field = p_field
$$;

create function app.list_sort_field(p_list text, p_field text) returns text
language sql immutable set search_path = app, public as $$
  select coalesce(
    app.list_sort_field_providers(p_list, p_field),
    (select s.expr from (values
      ('cagnottes', 'created_at', 'x.created_at'),
      ('cagnottes', 'closes_at', 'x.closes_at'),
      ('cagnottes', 'collected', 'x.collected_xof')
    ) s(list, field, expr) where s.list = p_list and s.field = p_field)
  )
$$;

create function app.list_columns(p_list text) returns text[]
language sql immutable set search_path = app, public as $$
  select coalesce(app.list_columns_providers(p_list), case p_list
    when 'cagnottes' then array['status', 'collected', 'closes', 'payout']
  end)
$$;

create function app.list_sort_sql(p_list text, p_sort jsonb) returns text
language plpgsql stable set search_path = app, public as $$
begin
  if (p_sort is null or jsonb_typeof(p_sort) = 'null') and p_list = 'cagnottes' then
    return 'x.created_at desc, x.id';
  end if;
  return app.list_sort_sql_providers(p_list, p_sort);
end $$;

create function app.list_rows_sql(p_list text, p_filter jsonb, p_sort jsonb) returns text
language plpgsql stable set search_path = app, public as $$
declare
  v_where text := 'true';
  v_rows text;
begin
  if p_list <> 'cagnottes' then return app.list_rows_sql_providers(p_list, p_filter, p_sort); end if;
  v_rows := $q$
    select g.id, g.title, g.status, g.goal_xof, g.closes_at, g.created_at, g.closed_reason,
           app.cagnotte_collected(g.id) as collected_xof,
           exists (select 1 from app.cagnotte_payouts o where o.cagnotte_id = g.id and o.status = 'requested') as payout_pending,
           exists (select 1 from app.contributions c join app.payments p on p.id = c.payment_id
                    where c.cagnotte_id = g.id and p.status = 'succeeded' and p.refund_requested_at is not null) as to_refund,
           pa.first_name as a_first_name, pa.last_name as a_last_name, ua.member_number as a_number,
           pb.first_name as b_first_name, pb.last_name as b_last_name, ub.member_number as b_number
    from app.cagnottes g
    join app.couples cp on cp.id = g.couple_id
    join app.users ua on ua.id = cp.member_a left join app.member_profiles pa on pa.user_id = cp.member_a
    join app.users ub on ub.id = cp.member_b left join app.member_profiles pb on pb.user_id = cp.member_b
  $q$;
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
    when 'providers' then app.has_permission('providers.manage')
    when 'cagnottes' then app.has_permission('cagnottes.manage')
    else false
  end
$$;

alter table app.saved_filters
  drop constraint saved_filters_resource,
  add constraint saved_filters_resource
    check (resource in ('members', 'payments', 'verifications', 'events', 'venues', 'themes', 'moderation', 'discoveries', 'couples', 'providers', 'cagnottes'));

revoke execute on function app.create_contribution(text, text, boolean, text, integer, boolean, app.payment_provider), app.close_due_cagnottes(),
  app.contribution_payment_received(), app.cagnotte_on_couple_end() from public;
grant execute on function app.create_contribution(text, text, boolean, text, integer, boolean, app.payment_provider), app.close_due_cagnottes() to service_role;
grant execute on function
  app.list_field(text, text),
  app.list_sort_field(text, text),
  app.list_columns(text),
  app.list_sort_sql(text, jsonb),
  app.list_rows_sql(text, jsonb, jsonb),
  app.cagnotte_commission_percent(),
  app.cagnotte_settings(),
  app.admin_set_cagnotte_settings(integer, numeric),
  app.cagnotte_collected(uuid),
  app.valid_payout_phone(text),
  app.propose_cagnotte(uuid, text, integer, date, text),
  app.answer_cagnotte(uuid, boolean),
  app.cancel_cagnotte_proposal(uuid),
  app.cagnotte_decide(uuid, text),
  app.my_cagnotte(uuid),
  app.cagnotte_contributions(uuid),
  app.admin_mark_payout_paid(uuid, integer, text),
  app.admin_cagnotte(uuid)
to authenticated, service_role;
grant execute on function app.public_cagnotte(text) to anon, authenticated, service_role;
