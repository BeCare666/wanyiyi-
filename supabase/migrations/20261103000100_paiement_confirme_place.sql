-- Paiement d'une soirée = place confirmée (audit UX validé le 03/11/2026).
-- Avant : un membre qui avait payé devait encore cliquer « Confirmer » avant une autre date limite.
-- Désormais, dès que le paiement aboutit, la place réservée passe à « confirmée ».
-- Rattrapage : les places déjà payées mais restées « réservées » sont confirmées (journalisé).

create or replace function app.evening_payment_received() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare v_reg uuid;
begin
  if new.status = 'succeeded' and old.status is distinct from 'succeeded' and new.purpose = 'evening_booking' then
    update app.event_registrations set status = 'confirmed', confirmed_at = now()
     where payment_id = new.id and status = 'booked'
    returning id into v_reg;
    if v_reg is not null then
      perform app.audit('registration.confirmed_by_payment', 'event_registrations', v_reg, jsonb_build_object('payment_id', new.id));
    end if;
  end if;
  return new;
end $$;

drop trigger if exists payments_evening_confirm on app.payments;
create trigger payments_evening_confirm after update of status on app.payments
  for each row execute function app.evening_payment_received();

-- Rattrapage : places payées mais pas encore confirmées
with fixed as (
  update app.event_registrations r set status = 'confirmed', confirmed_at = now()
    from app.payments p
   where p.id = r.payment_id and p.status = 'succeeded' and r.status = 'booked'
  returning r.id, p.id as payment_id
)
select app.audit('registration.confirmed_by_payment', 'event_registrations', id, jsonb_build_object('payment_id', payment_id, 'catch_up', true))
  from fixed;
