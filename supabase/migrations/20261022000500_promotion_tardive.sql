-- Confirmation et place donnée tard (question 9, réponses du 22 octobre 2026) :
--   - confirmation possible dès la réservation, jusqu'à la limite des 48 h (inchangé) ;
--   - une personne promue depuis la liste d'attente après cette limite a 2 heures, à partir de
--     l'attribution de sa place, pour confirmer et payer (si la soirée a un tarif) ; sinon la
--     place passe au suivant, qui a 2 heures à son tour.
-- Comme pour les places non payées, un paiement en cours de validation chez le prestataire
-- empêche la libération. Libération exécutée par la tâche planifiée de l'API.

insert into app.settings (key, value) values ('evenings.late_promotion_hours', '2')
on conflict (key) do nothing;

-- Fin du délai d'une place attribuée après la limite des 48 h ; null pour une place attribuée avant
create function app.late_hold_until(p_seated timestamptz, p_starts_at timestamptz) returns timestamptz
language sql stable security definer set search_path = app, public as $$
  select case when p_seated >= app.confirmation_deadline(p_starts_at)
              then p_seated + make_interval(hours => app.setting_int('evenings.late_promotion_hours', 2)) end
$$;

create or replace function app.confirm_registration(p_event uuid) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_starts timestamptz;
  v_reg app.event_registrations;
  v_late timestamptz;
begin
  select starts_at into v_starts from app.events where id = p_event;
  select * into v_reg from app.event_registrations where event_id = p_event and user_id = auth.uid() and status = 'booked';
  if v_reg.id is null then
    if now() >= app.confirmation_deadline(v_starts) then raise exception 'confirmation_closed'; end if;
    raise exception 'not_booked';
  end if;
  v_late := app.late_hold_until(coalesce(v_reg.seated_at, v_reg.created_at), v_starts);
  if v_late is not null then
    if now() >= v_late or now() >= v_starts then raise exception 'confirmation_closed'; end if;
  elsif now() >= app.confirmation_deadline(v_starts) then
    raise exception 'confirmation_closed';
  end if;
  update app.event_registrations set status = 'confirmed', confirmed_at = now() where id = v_reg.id;
end $$;

-- Tâche planifiée : places données tard, non confirmées ou non payées au bout de 2 heures
create function app.release_late_promotions() returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_released integer;
  v_events uuid[];
  v_event uuid;
begin
  perform app.require_permission('events.manage');
  with released as (
    update app.event_registrations r set status = 'released'
      from app.events e
     where e.id = r.event_id
       and e.status in ('published', 'full') and e.starts_at > now()
       and r.status in ('booked', 'confirmed')
       and app.late_hold_until(coalesce(r.seated_at, r.created_at), e.starts_at) <= now()
       and (
         r.status = 'booked'
         or (e.price_xof is not null and not exists (
               select 1 from app.payments p where p.id = r.payment_id and p.status = 'succeeded'))
       )
       and not exists (
         select 1 from app.payments p
          where p.id = r.payment_id and p.status = 'pending' and p.provider_transaction_id is not null
       )
    returning r.event_id
  )
  select count(*), coalesce(array_agg(distinct event_id), '{}') into v_released, v_events from released;
  foreach v_event in array v_events loop
    perform app.promote_waitlist(v_event);
  end loop;
  if v_released > 0 then
    perform app.audit('registrations.released_late', 'event_registrations', null, jsonb_build_object('count', v_released));
  end if;
  return v_released;
end $$;

revoke execute on function app.late_hold_until(timestamptz, timestamptz) from public;
revoke execute on function app.release_late_promotions() from public, authenticated;
grant execute on function app.release_late_promotions() to service_role;

-- « Mes soirées » : limites de confirmation et de paiement d'une place donnée tard (2 heures)
create or replace function app.my_bookings()
returns table (event_id uuid, status text, waitlist_rank integer, confirm_by timestamptz, paid boolean, pay_by timestamptz)
language sql stable security definer set search_path = app, public as $$
  select b.event_id, b.status, b.waitlist_rank,
         coalesce(b.late_until, b.confirm_by),
         b.paid,
         case when b.status in ('booked', 'confirmed') and not b.paid and b.price_xof is not null
              then least(b.seated + make_interval(hours => app.setting_int('evenings.unpaid_hold_hours', 24)), b.late_until) end
  from (
    select r.event_id,
           r.status::text as status,
           null::integer as waitlist_rank,
           app.confirmation_deadline(e.starts_at) as confirm_by,
           exists (select 1 from app.payments p where p.id = r.payment_id and p.status = 'succeeded') as paid,
           e.price_xof,
           coalesce(r.seated_at, r.created_at) as seated,
           app.late_hold_until(coalesce(r.seated_at, r.created_at), e.starts_at) as late_until
    from app.event_registrations r
    join app.events e on e.id = r.event_id
    where r.user_id = auth.uid()
      and r.status in ('booked', 'confirmed', 'checked_in', 'released')
      and e.status <> 'draft' and e.starts_at >= now()
      -- Place libérée puis retour en liste d'attente : seule la liste d'attente compte
      and not exists (select 1 from app.waitlist_entries w where w.event_id = r.event_id and w.user_id = r.user_id)
    union all
    select w.event_id,
           'waitlisted',
           (select count(*)::integer from app.waitlist_entries o
             where o.event_id = w.event_id and o.sex = w.sex and o.position <= w.position),
           app.confirmation_deadline(e.starts_at),
           false,
           e.price_xof,
           null::timestamptz,
           null::timestamptz
    from app.waitlist_entries w
    join app.events e on e.id = w.event_id
    where w.user_id = auth.uid()
      and e.status <> 'draft' and e.starts_at >= now()
  ) b
$$;
