-- Place réservée mais pas encore payée (question 12, réponse du 22 octobre 2026) :
-- la place est gardée 24 h ; sans paiement, elle est libérée pour la liste d'attente.
-- Le délai part de l'attribution de la place (seated_at : réservation, ou passage depuis la
-- liste d'attente). Seules les soirées à venir avec un tarif sont concernées : sans tarif,
-- aucun paiement n'est possible. Une place dont un paiement est en cours de validation chez le
-- prestataire (référence déjà reçue) n'est pas libérée : l'argent pourrait arriver ensuite.
-- Exécutée par la tâche planifiée de l'API (clé service role).

insert into app.settings (key, value) values ('evenings.unpaid_hold_hours', '24')
on conflict (key) do nothing;

create function app.release_unpaid() returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_hold integer := app.setting_int('evenings.unpaid_hold_hours', 24);
  v_released integer;
  v_events uuid[];
  v_event uuid;
begin
  perform app.require_permission('events.manage');
  with released as (
    update app.event_registrations r set status = 'released'
      from app.events e
     where e.id = r.event_id
       and e.status in ('published', 'full') and e.starts_at > now() and e.price_xof is not null
       and r.status in ('booked', 'confirmed')
       and coalesce(r.seated_at, r.created_at) <= now() - make_interval(hours => v_hold)
       and not exists (
         select 1 from app.payments p
          where p.id = r.payment_id
            and (p.status = 'succeeded' or (p.status = 'pending' and p.provider_transaction_id is not null))
       )
    returning r.event_id, r.user_id
  )
  select count(*), coalesce(array_agg(distinct event_id), '{}') into v_released, v_events from released;
  foreach v_event in array v_events loop
    perform app.promote_waitlist(v_event);
  end loop;
  if v_released > 0 then
    perform app.audit('registrations.released_unpaid', 'event_registrations', null, jsonb_build_object('count', v_released));
  end if;
  return v_released;
end $$;

revoke execute on function app.release_unpaid() from public, authenticated;
grant execute on function app.release_unpaid() to service_role;

-- « Mes soirées » : date limite de paiement de la place (pay_by), affichée au membre pour
-- qu'il sache quand sa place serait libérée. Null s'il n'y a rien à payer (déjà payé, pas de
-- tarif, liste d'attente). Le type de retour change : la fonction est recréée.
drop function app.my_bookings();

create function app.my_bookings()
returns table (event_id uuid, status text, waitlist_rank integer, confirm_by timestamptz, paid boolean, pay_by timestamptz)
language sql stable security definer set search_path = app, public as $$
  select b.event_id, b.status, b.waitlist_rank, b.confirm_by, b.paid,
         case when b.status in ('booked', 'confirmed') and not b.paid and b.price_xof is not null
              then b.seated + make_interval(hours => app.setting_int('evenings.unpaid_hold_hours', 24)) end
  from (
    select r.event_id,
           r.status::text as status,
           null::integer as waitlist_rank,
           app.confirmation_deadline(e.starts_at) as confirm_by,
           exists (select 1 from app.payments p where p.id = r.payment_id and p.status = 'succeeded') as paid,
           e.price_xof,
           coalesce(r.seated_at, r.created_at) as seated
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
           null::timestamptz
    from app.waitlist_entries w
    join app.events e on e.id = w.event_id
    where w.user_id = auth.uid()
      and e.status <> 'draft' and e.starts_at >= now()
  ) b
$$;

revoke execute on function app.my_bookings() from public;
grant execute on function app.my_bookings() to authenticated;
