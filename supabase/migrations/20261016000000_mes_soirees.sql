-- Phase 2, étape 4 : page « Soirées » de l'espace membre (section 6.2-4).
-- Pour chaque soirée à venir où le membre est inscrit : sa situation (place attribuée,
-- confirmée, pointée, libérée faute de confirmation, ou liste d'attente), son rang dans la
-- liste d'attente de son sexe, la limite de confirmation (paramètre
-- evenings.confirmation_hours_before) et l'état du paiement.
-- Lecture seule : toute écriture continue de passer par book_event, confirm_registration
-- et cancel_registration.

create function app.my_bookings()
returns table (event_id uuid, status text, waitlist_rank integer, confirm_by timestamptz, paid boolean)
language sql stable security definer set search_path = app, public as $$
  select r.event_id,
         r.status::text,
         null::integer,
         app.confirmation_deadline(e.starts_at),
         exists (select 1 from app.payments p where p.id = r.payment_id and p.status = 'succeeded')
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
         false
  from app.waitlist_entries w
  join app.events e on e.id = w.event_id
  where w.user_id = auth.uid()
    and e.status <> 'draft' and e.starts_at >= now()
$$;

grant execute on function app.my_bookings() to authenticated;
