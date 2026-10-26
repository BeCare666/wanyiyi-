-- Phase 3, étape 4 (suite) : le motif d'une photo refusée est envoyé sous « reason », comme celui
-- d'un texte refusé (migration 20261022000300), pour que l'espace membre l'affiche de la même façon.

create or replace function app.review_photo(p_photo uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_photo app.photos;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not app.has_permission('profile_texts.review') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_photo from app.photos where id = p_photo for update;
  if not found then raise exception 'not_found'; end if;
  if v_photo.review_status <> 'pending' then raise exception 'already_reviewed'; end if;
  if not p_approve and v_note is null then raise exception 'note_required'; end if;
  if char_length(coalesce(v_note, '')) > 1000 then raise exception 'note_too_long'; end if;
  update app.photos
     set review_status = case when p_approve then 'approved' else 'rejected' end::app.review_status,
         review_note = case when p_approve then null else v_note end,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_photo;
  if not p_approve then
    perform app.notify_with_deliveries(v_photo.user_id, 'profile.photo_rejected', jsonb_build_object('reason', v_note));
  end if;
  perform app.audit(case when p_approve then 'photo.approved' else 'photo.rejected' end, 'photos', p_photo, '{}'::jsonb);
end $$;
