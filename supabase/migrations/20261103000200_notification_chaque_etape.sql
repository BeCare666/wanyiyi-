-- Une notification à chaque étape du parcours (demande du 03/11/2026) : dans l'espace et par e-mail.
-- Jusqu'ici, seules les décisions de l'équipe étaient notifiées ; les actions du membre restaient muettes.
--
--   registration.completed       inscription terminée : étape suivante, la vérification
--   verification.submitted       dossier envoyé (ou corrigé) : en cours d'examen
--   profile.photo_approved       photo approuvée par la modération (hors validation du dossier,
--                                déjà annoncée par verification.approved)
--   evening.booked               place réservée par le membre
--   evening.confirmed            place confirmée (par le membre ou par le paiement)
--   evening.waitlisted           inscrit sur liste d'attente
--   evening.registration_cancelled  place annulée par le membre
--   evening.seat_released        place libérée faute de confirmation ou de paiement
--
-- Les actions du membre ne sont notifiées que lorsqu'il les fait lui-même (auth.uid()) : une place
-- donnée depuis la liste d'attente garde son message evening.seat_offered, et l'annulation d'une
-- soirée par l'équipe garde evening.cancelled.

create or replace function app.on_profile_created_notify() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if auth.uid() = new.user_id then
    perform app.notify_with_deliveries(new.user_id, 'registration.completed', '{}'::jsonb);
  end if;
  return new;
end $$;

drop trigger if exists member_profiles_created_notify on app.member_profiles;
create trigger member_profiles_created_notify after insert on app.member_profiles
  for each row execute function app.on_profile_created_notify();

create or replace function app.on_profile_status_notify() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if new.status = 'pending_verification' and old.status in ('registering', 'to_correct') then
    perform app.notify_with_deliveries(new.user_id, 'verification.submitted', '{}'::jsonb);
  end if;
  return new;
end $$;

drop trigger if exists member_profiles_status_notify on app.member_profiles;
create trigger member_profiles_status_notify after update of status on app.member_profiles
  for each row execute function app.on_profile_status_notify();

create or replace function app.on_photo_approved_notify() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if new.review_status = 'approved' and old.review_status is distinct from 'approved'
     -- Photo approuvée avec le dossier (même transaction, décision journalisée juste avant) :
     -- verification.approved suffit
     and not exists (select 1 from app.audit_log a join app.verifications v on v.id = a.target_id
                      where a.action = 'verification.decided' and v.user_id = new.user_id and a.created_at = now()) then
    perform app.notify_with_deliveries(new.user_id, 'profile.photo_approved', '{}'::jsonb);
  end if;
  return new;
end $$;

drop trigger if exists photos_approved_notify on app.photos;
create trigger photos_approved_notify after update of review_status on app.photos
  for each row execute function app.on_photo_approved_notify();

create or replace function app.on_registration_notify() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare
  v_event app.events;
  v_payload jsonb;
  v_kind text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  select * into v_event from app.events where id = new.event_id;
  v_payload := jsonb_build_object('event_id', new.event_id, 'starts_at', v_event.starts_at, 'priced', v_event.price_xof is not null);
  v_kind := case
    when new.status = 'booked' and auth.uid() = new.user_id then 'evening.booked'
    when new.status = 'confirmed' then 'evening.confirmed'
    when new.status = 'cancelled' and auth.uid() = new.user_id then 'evening.registration_cancelled'
    when new.status = 'released' then 'evening.seat_released'
  end;
  if v_kind = 'evening.confirmed' then
    v_payload := v_payload || jsonb_build_object('by_payment', exists (
      select 1 from app.payments p where p.id = new.payment_id and p.status = 'succeeded'));
  end if;
  if v_kind is not null then
    perform app.notify_with_deliveries(new.user_id, v_kind, v_payload);
  end if;
  return new;
end $$;

drop trigger if exists event_registrations_notify on app.event_registrations;
create trigger event_registrations_notify after insert or update of status on app.event_registrations
  for each row execute function app.on_registration_notify();

create or replace function app.on_waitlist_notify() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if auth.uid() = new.user_id then
    perform app.notify_with_deliveries(new.user_id, 'evening.waitlisted', jsonb_build_object(
      'event_id', new.event_id,
      'starts_at', (select starts_at from app.events where id = new.event_id),
      'position', (select count(*) from app.waitlist_entries w
                    where w.event_id = new.event_id and w.sex = new.sex and w.position <= new.position)));
  end if;
  return new;
end $$;

drop trigger if exists waitlist_entries_notify on app.waitlist_entries;
create trigger waitlist_entries_notify after insert on app.waitlist_entries
  for each row execute function app.on_waitlist_notify();
