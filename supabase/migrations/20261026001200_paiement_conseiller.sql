-- Phase 3 : accès au conseiller payant (réponses de l'utilisateur du 26 octobre 2026) :
--   - le prix est réglé dans l'administration (permission counselors.manage), librement,
--     0 compris ; valeur de départ 0 tant que l'administration ne l'a pas fixé ;
--   - le membre qui invite paie, après l'accord de l'autre ; le prix est celui du moment de
--     l'accord ; chaque accès se paie (un nouvel accès après un retrait se paie de nouveau) ;
--   - l'administration n'attribue le conseiller qu'une fois l'accès payé (ou gratuit) ;
--   - aucun remboursement si le conseiller est retiré ou le couple bloqué.
-- Le paiement lui-même est créé par l'API avec le prestataire configuré (FeexPay), comme celui
-- d'une soirée, puis réglé sur la page /paiement/<id> du site.

insert into app.settings (key, value) values ('counselor.access_price_xof', '0') on conflict (key) do nothing;

alter table app.counselor_access
  add column price_xof integer check (price_xof >= 0),
  add column payment_id uuid references app.payments (id);

-- Prix actuel de l'accès au conseiller (lisible par les membres, pour l'afficher avant d'inviter)
create function app.counselor_access_price() returns integer
language sql stable security definer set search_path = app, public as $$
  select app.setting_int('counselor.access_price_xof', 0)
$$;

-- Réglage du prix par l'administration : entier de 0 à 10 000 000 FCFA, journalisé
create function app.admin_set_counselor_price(p_price_xof integer) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.has_permission('counselors.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_price_xof is null or p_price_xof < 0 or p_price_xof > 10000000 then raise exception 'invalid_price'; end if;
  insert into app.settings (key, value, updated_by, updated_at) values ('counselor.access_price_xof', to_jsonb(p_price_xof), auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform app.audit('counselor.price_set', 'settings', null, jsonb_build_object('price_xof', p_price_xof));
end $$;

-- Accès réglé : gratuit au moment de l'accord, ou paiement reçu
create function app.counselor_access_paid(p_access uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select a.accepted_at is not null and (
    a.price_xof = 0
    or exists (select 1 from app.payments p where p.id = a.payment_id and p.status = 'succeeded')
  )
  from app.counselor_access a where a.id = p_access
$$;

-- ---------------------------------------------------------------------
-- 1. Accord de l'autre : prix figé, paiement demandé à celui qui invite (ou rien à payer)
-- ---------------------------------------------------------------------
create or replace function app.answer_counselor_access(p_access uuid, p_accept boolean, p_include_history boolean) returns app.access_status
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_access app.counselor_access;
  v_couple app.couples;
  v_history boolean;
  v_price integer := app.counselor_access_price();
begin
  select * into v_access from app.counselor_access where id = p_access for update;
  select * into v_couple from app.couples where id = v_access.couple_id;
  if not found or v_uid is null or v_uid not in (v_couple.member_a, v_couple.member_b) then raise exception 'not_member'; end if;
  if v_access.status <> 'requested' or v_access.accepted_at is not null then raise exception 'not_pending'; end if;
  if v_uid = v_access.requested_by then raise exception 'own_request'; end if;
  insert into app.counselor_access_consents (access_id, user_id, accepted, include_history)
    values (p_access, v_uid, coalesce(p_accept, false), coalesce(p_include_history, false));
  if not coalesce(p_accept, false) then
    update app.counselor_access set status = 'refused' where id = p_access;
    perform app.couple_system_message(v_couple.id, 'counselor_access.refused', v_uid);
    perform app.audit('counselor_access.refused', 'counselor_access', p_access, '{}'::jsonb);
    return 'refused';
  end if;
  select bool_and(include_history) into v_history from app.counselor_access_consents where access_id = p_access;
  update app.counselor_access set accepted_at = now(), include_history = coalesce(v_history, false), price_xof = v_price where id = p_access;
  perform app.couple_system_message(v_couple.id, 'counselor_access.accepted', v_uid);
  if v_price > 0 then
    perform app.couple_system_message(v_couple.id, 'counselor_access.payment_due', v_access.requested_by);
    perform app.notify_with_deliveries(v_access.requested_by, 'counselor_access.payment_due',
      jsonb_build_object('access_id', p_access, 'price_xof', v_price));
  else
    perform app.couple_system_message(v_couple.id, 'counselor_access.awaiting_assignment', null);
  end if;
  perform app.audit('counselor_access.accepted', 'counselor_access', p_access,
    jsonb_build_object('include_history', coalesce(v_history, false), 'price_xof', v_price));
  return 'requested';
end $$;

-- Paiement reçu : message dans le chat, la demande passe à l'administration
create function app.counselor_payment_received() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare v_access app.counselor_access;
begin
  if new.status = 'succeeded' and old.status is distinct from 'succeeded' and new.purpose = 'counselor_access' then
    select * into v_access from app.counselor_access where payment_id = new.id and status = 'requested';
    if found then
      perform app.couple_system_message(v_access.couple_id, 'counselor_access.awaiting_assignment', null);
      perform app.audit('counselor_access.paid', 'counselor_access', v_access.id, jsonb_build_object('payment_id', new.id));
    end if;
  end if;
  return new;
end $$;

create trigger payments_counselor_access after update of status on app.payments
  for each row execute function app.counselor_payment_received();

-- ---------------------------------------------------------------------
-- 2. Paiement : préparé pour l'API, au nom de celui qui invite seulement
-- ---------------------------------------------------------------------
-- Montant à payer pour cet accès (refus si rien à payer ou déjà payé). Appelé avec le jeton du membre.
create function app.counselor_access_to_pay(p_access uuid) returns integer
language plpgsql stable security definer set search_path = app, public as $$
declare v_access app.counselor_access;
begin
  select * into v_access from app.counselor_access where id = p_access;
  if not found or v_access.requested_by is distinct from auth.uid() then raise exception 'not_found'; end if;
  if v_access.status <> 'requested' or v_access.accepted_at is null then raise exception 'not_pending'; end if;
  if coalesce(v_access.price_xof, 0) = 0 or app.counselor_access_paid(p_access) then raise exception 'nothing_to_pay'; end if;
  if exists (select 1 from app.couples c where c.id = v_access.couple_id and c.blocked_at is not null) then raise exception 'couple_blocked'; end if;
  return v_access.price_xof;
end $$;

-- ---------------------------------------------------------------------
-- 3. Administration : seulement les accès réglés
-- ---------------------------------------------------------------------
create or replace function app.admin_counselor_requests()
returns table (access_id uuid, couple_id uuid, accepted_at timestamptz, include_history boolean,
               a_first_name text, a_number text, b_first_name text, b_number text)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('counselors.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select a.id, c.id, a.accepted_at, a.include_history, pa.first_name, ua.member_number, pb.first_name, ub.member_number
    from app.counselor_access a
    join app.couples c on c.id = a.couple_id
    join app.users ua on ua.id = c.member_a left join app.member_profiles pa on pa.user_id = c.member_a
    join app.users ub on ub.id = c.member_b left join app.member_profiles pb on pb.user_id = c.member_b
    where a.status = 'requested' and app.counselor_access_paid(a.id)
    order by a.accepted_at, a.id;
end $$;

create or replace function app.admin_assign_counselor(p_access uuid, p_counselor uuid) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_access app.counselor_access;
  v_couple app.couples;
  v_counselor app.counselors;
begin
  if not app.has_permission('counselors.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_access from app.counselor_access where id = p_access for update;
  if not found then raise exception 'not_found'; end if;
  if v_access.status <> 'requested' or v_access.accepted_at is null then raise exception 'not_pending'; end if;
  if not app.counselor_access_paid(p_access) then raise exception 'not_paid'; end if;
  select * into v_couple from app.couples where id = v_access.couple_id for update;
  if v_couple.blocked_at is not null then raise exception 'couple_blocked'; end if;
  select * into v_counselor from app.counselors where user_id = p_counselor;
  if not found then raise exception 'not_found'; end if;
  if not v_counselor.is_available then raise exception 'counselor_unavailable'; end if;
  if v_couple.counselor_id is distinct from p_counselor
     and (select count(*) from app.couples c where c.counselor_id = p_counselor and c.status in ('active', 'paused')) >= v_counselor.max_couples then
    raise exception 'counselor_full';
  end if;
  update app.counselor_access set counselor_id = p_counselor, status = 'granted', granted_at = now(), assigned_by = auth.uid() where id = p_access;
  update app.couples set counselor_id = p_counselor where id = v_couple.id;
  perform app.couple_system_message(v_couple.id, 'counselor_access.granted', null);
  perform app.notify_with_deliveries(p_counselor, 'counselor_access.granted', jsonb_build_object('couple_id', v_couple.id));
  perform app.notify_with_deliveries(v_couple.member_a, 'counselor.assigned', jsonb_build_object('couple_id', v_couple.id));
  perform app.notify_with_deliveries(v_couple.member_b, 'counselor.assigned', jsonb_build_object('couple_id', v_couple.id));
  perform app.audit('counselor_access.granted', 'counselor_access', p_access, jsonb_build_object('counselor', p_counselor));
end $$;

grant execute on function
  app.counselor_access_price(),
  app.admin_set_counselor_price(integer),
  app.counselor_access_paid(uuid),
  app.counselor_access_to_pay(uuid)
to authenticated, service_role;
