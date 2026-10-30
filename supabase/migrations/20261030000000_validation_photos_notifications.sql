-- Décisions du 30 octobre 2026 (un membre validé ne pouvait pas réserver : « photo en attente ») :
--   - valider un dossier approuve aussi les photos du profil encore en relecture : l'équipe les
--     voit sur la même fiche. Les photos ajoutées plus tard passent par la modération ;
--   - rattrapage : les photos en relecture des membres déjà validés sont approuvées (journalisé) ;
--   - chaque décision sur un dossier est notifiée au membre, dans son espace et par e-mail :
--     validé, correction demandée (avec le message de l'équipe), refusé (avec le motif s'il y en a un).
-- app.on_verification_decided reprend la version de 20261017000100_depot_verification.sql.

create or replace function app.on_verification_decided() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare
  v_photo uuid;
begin
  if new.status is distinct from old.status then
    if new.status = 'pending' then
      new.decided_by := null;
      new.decided_at := null;
      perform app.audit('verification.resubmitted', 'verifications', new.id);
      return new;
    end if;
    new.decided_by := auth.uid();
    new.decided_at := now();
    update app.member_profiles
       set status = case new.status
                      when 'approved' then 'verified'::app.member_status
                      when 'to_correct' then 'to_correct'::app.member_status
                      when 'rejected' then 'excluded'::app.member_status
                      else 'pending_verification'::app.member_status
                    end,
           journey_stage = case when new.status = 'approved' then 'evenings'::app.journey_stage else journey_stage end
     where user_id = new.user_id;
    perform app.audit('verification.decided', 'verifications', new.id, jsonb_build_object('status', new.status));

    -- Photos du profil vues sur la fiche : approuvées avec le dossier
    if new.status = 'approved' then
      for v_photo in
        update app.photos
           set review_status = 'approved', review_note = null, reviewed_by = auth.uid(), reviewed_at = now()
         where user_id = new.user_id and review_status = 'pending'
        returning id
      loop
        perform app.audit('photo.approved', 'photos', v_photo, jsonb_build_object('with_verification', new.id));
      end loop;
    end if;

    if new.status in ('approved', 'to_correct', 'rejected') then
      perform app.notify_with_deliveries(
        new.user_id,
        'verification.' || new.status::text,
        case when new.correction_note is null then '{}'::jsonb else jsonb_build_object('reason', new.correction_note) end
      );
    end if;
  end if;
  return new;
end $$;

-- Rattrapage : membres déjà validés dont les photos attendaient encore la modération
do $$
declare
  v_photo uuid;
begin
  for v_photo in
    update app.photos ph
       set review_status = 'approved', review_note = null, reviewed_at = now()
      from app.member_profiles p
     where p.user_id = ph.user_id and p.status = 'verified' and ph.review_status = 'pending'
    returning ph.id
  loop
    perform app.audit('photo.approved', 'photos', v_photo, jsonb_build_object('catch_up', '2026-10-30'));
  end loop;
end $$;
