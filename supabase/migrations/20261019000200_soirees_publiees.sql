-- Phase 2, étape 5 : soirées publiées (décisions du 19 octobre 2026, questions 19 et 20).
--   - Une soirée publiée peut être modifiée ; les inscrits et la liste d'attente sont notifiés.
--     Seule limite de cohérence : le nombre de places ne descend pas sous les places déjà prises.
--   - Une soirée annulée : toutes les places sont annulées, la liste d'attente vidée, les
--     paiements en attente annulés, et les paiements reçus sont remboursés en entier.
--     Le remboursement passe par l'adaptateur de paiement de l'API (simulé tant que la
--     question 7 n'est pas tranchée) : la base marque la demande, l'API l'exécute.

-- Demande de remboursement (annulation d'une soirée), exécutée ensuite par l'API
alter table app.payments add column refund_requested_at timestamptz;

-- Notification d'une soirée à toutes les personnes concernées (places actives et liste d'attente)
create function app.notify_evening(p_event uuid, p_kind text) returns integer
language plpgsql security definer set search_path = app, public as $$
declare v_count integer;
begin
  insert into app.notifications (user_id, kind, payload)
  select distinct x.user_id, p_kind, jsonb_build_object('event_id', p_event)
  from (
    select r.user_id from app.event_registrations r
     where r.event_id = p_event and r.status in ('booked', 'confirmed', 'checked_in')
    union
    select w.user_id from app.waitlist_entries w where w.event_id = p_event
  ) x;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- 1. Modification : brouillon ou soirée publiée (pas une fois commencée)
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
  -- Capacité 9.2 : au plus 12 × 12
  if p_capacity_women is null or p_capacity_men is null
     or p_capacity_women not between 1 and 12 or p_capacity_men not between 1 and 12 then
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
    -- Soirée publiée : le lieu reste obligatoire, et aucune place déjà prise n'est retirée
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
    -- Places ajoutées : la liste d'attente avance (les personnes promues reçoivent leur propre notification)
    perform app.promote_waitlist(p_event);
    perform app.notify_evening(p_event, 'evening.updated');
  end if;
  perform app.audit('event.updated', 'events', p_event, jsonb_build_object('published', v_event.status <> 'draft'));
  return p_event;
end $$;

-- ---------------------------------------------------------------------
-- 2. Annulation d'une soirée publiée, avant son début
-- Renvoie le nombre de paiements à rembourser.
-- ---------------------------------------------------------------------
create function app.cancel_event(p_event uuid) returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_event app.events;
  v_refunds integer;
begin
  perform app.require_permission('events.manage');
  select * into v_event from app.events where id = p_event for update;
  if v_event.id is null then raise exception 'not_found'; end if;
  if v_event.status not in ('published', 'full') then raise exception 'invalid_status'; end if;

  -- Notification avant l'annulation des places : elle vise les personnes encore inscrites
  perform app.notify_evening(p_event, 'evening.cancelled');

  -- Paiements reçus : remboursement intégral demandé ; paiements en attente : annulés
  update app.payments p set refund_requested_at = now()
    from app.event_registrations r
   where r.event_id = p_event and r.payment_id = p.id
     and r.status in ('booked', 'confirmed', 'checked_in') and p.status = 'succeeded';
  get diagnostics v_refunds = row_count;
  update app.payments p set status = 'cancelled'
    from app.event_registrations r
   where r.event_id = p_event and r.payment_id = p.id
     and r.status in ('booked', 'confirmed', 'checked_in') and p.status = 'pending';

  update app.event_registrations set status = 'cancelled'
   where event_id = p_event and status in ('booked', 'confirmed', 'checked_in');
  delete from app.waitlist_entries where event_id = p_event;
  update app.events set status = 'cancelled' where id = p_event;
  perform app.audit('event.cancelled', 'events', p_event, jsonb_build_object('refunds', v_refunds));
  return v_refunds;
end $$;

-- ---------------------------------------------------------------------
-- 3. Remboursements (tâche système de l'API, clé service role)
-- ---------------------------------------------------------------------
create function app.pending_refunds()
returns table (payment_id uuid, user_id uuid, amount_xof integer, provider app.payment_provider, provider_transaction_id text)
language sql stable security definer set search_path = app, public as $$
  select p.id, p.user_id, p.amount_xof, p.provider, p.provider_transaction_id
  from app.payments p
  where p.status = 'succeeded' and p.refund_requested_at is not null
  order by p.refund_requested_at
$$;

-- Remboursement exécuté par le prestataire : montant intégral
create function app.mark_refunded(p_payment uuid) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  update app.payments set status = 'refunded', refunded_amount_xof = amount_xof
   where id = p_payment and status = 'succeeded' and refund_requested_at is not null;
  if not found then raise exception 'not_refundable'; end if;
  perform app.audit('payment.refunded', 'payments', p_payment);
end $$;

revoke execute on function app.notify_evening(uuid, text), app.pending_refunds(), app.mark_refunded(uuid) from public, authenticated;
grant execute on function app.cancel_event(uuid) to authenticated, service_role;
grant execute on function app.pending_refunds(), app.mark_refunded(uuid) to service_role;
