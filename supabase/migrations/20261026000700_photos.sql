-- Phase 3, étape 4 : photos des membres (section 10.2 ; question 10 de la phase 3, choix du
-- 26 octobre 2026 ; modération selon les règles des textes, question 22).
--   - 1 à 3 photos par membre, compartiment privé « member-photos » (jamais Cloudinary) ; l'API
--     réduit l'image à 1 600 pixels, retire les métadonnées et la dépose avec le jeton du membre,
--     dans son propre dossier.
--   - Chaque photo est relue par l'équipe (permission profile_texts.review) ; refus avec motif
--     écrit, notifié au membre.
--   - Aucune photo visible avant un match : une autre personne ne voit une photo approuvée que
--     si un match annoncé les lie (en attente de choix ou découverte ouverte) ou s'ils forment un
--     couple. Après une fin (match expiré, découverte close), plus rien (question 15).
--   - La photo est floutée pour les autres si le membre l'a choisi (10.2 : « garder sa photo
--     floutée même pendant la découverte ») : nouveau réglage keep_photo_blurred, faux par défaut.
--     (photo_blurred reste le réglage « photo cachée jusqu'au match » de la question 15.)
--   - L'API lit le fichier avec le jeton de la personne qui regarde (RLS du stockage), génère le
--     filigrane (nom et numéro de celle-ci, date et heure, position variable) et sert l'image par
--     un lien valable 5 minutes. Chaque consultation par l'équipe est journalisée.
-- Photo exigée pour réserver (question 10 c) : branchée avec l'écran de dépôt (étape 5), pour ne
-- pas bloquer les membres et la soirée de démonstration actuels.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-photos', 'member-photos', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

alter table app.member_profiles add column keep_photo_blurred boolean not null default false;

-- Plus d'écriture directe (phase 2) : dépôt, retrait et relecture par fonctions seulement
drop policy photos_self_select on app.photos;
drop policy photos_self_insert on app.photos;
drop policy photos_self_delete on app.photos;
drop policy photos_team on app.photos;
drop policy photos_review on app.photos;

alter table app.photos
  add column review_note text,
  add column reviewed_by uuid references app.users (id),
  add column reviewed_at timestamptz;

-- ---------------------------------------------------------------------
-- 1. Qui peut voir une photo
-- ---------------------------------------------------------------------
create function app.can_view_photo(p_photo uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.photos ph
    where ph.id = p_photo
      and (
        ph.user_id = auth.uid()
        or app.has_permission('profile_texts.review')
        or (
          ph.review_status = 'approved'
          and (
            exists (
              select 1 from app.matches m
              where m.notified_at is not null and m.status in ('pending_choice', 'discovery_open')
                and ((m.member_a = auth.uid() and m.member_b = ph.user_id) or (m.member_b = auth.uid() and m.member_a = ph.user_id))
            )
            or exists (
              select 1 from app.couples c
              where c.status in ('active', 'paused')
                and ((c.member_a = auth.uid() and c.member_b = ph.user_id) or (c.member_b = auth.uid() and c.member_a = ph.user_id))
            )
          )
        )
      )
  )
$$;

create function app.can_view_photo_path(p_path text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (select 1 from app.photos ph where ph.storage_path = p_path and app.can_view_photo(ph.id))
$$;

create policy photos_select on app.photos for select using (app.can_view_photo(id));

-- Stockage : dépôt et suppression dans son propre dossier ; lecture selon les règles ci-dessus
create policy member_photos_upload_self on storage.objects for insert to authenticated
  with check (bucket_id = 'member-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy member_photos_delete_self on storage.objects for delete to authenticated
  using (bucket_id = 'member-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy member_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'member-photos' and app.can_view_photo_path(name));

-- ---------------------------------------------------------------------
-- 2. Actions du membre
-- ---------------------------------------------------------------------
-- Enregistre une photo déposée par l'API dans le dossier du membre ; 3 au plus (refusées exclues)
create function app.add_photo(p_path text) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> v_uid::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'member-photos' and o.name = p_path) then
    raise exception 'invalid_photo';
  end if;
  perform 1 from app.users where id = v_uid for update;
  if (select count(*) from app.photos where user_id = v_uid and review_status <> 'rejected') >= 3 then
    raise exception 'too_many_photos';
  end if;
  insert into app.photos (user_id, storage_path, position)
  values (v_uid, p_path, coalesce((select max(position) + 1 from app.photos where user_id = v_uid), 0))
  returning id into v_id;
  perform app.audit('photo.added', 'photos', v_id, '{}'::jsonb);
  return v_id;
end $$;

-- Retire une de ses photos ; renvoie le chemin, que l'API supprime du stockage
create function app.remove_photo(p_photo uuid) returns text
language plpgsql security definer set search_path = app, public as $$
declare v_path text;
begin
  delete from app.photos where id = p_photo and user_id = auth.uid() returning storage_path into v_path;
  if v_path is null then raise exception 'not_found'; end if;
  perform app.audit('photo.removed', 'photos', p_photo, '{}'::jsonb);
  return v_path;
end $$;

-- Ses photos, avec l'état de relecture et le motif d'un refus
create function app.my_photos()
returns table (photo_id uuid, storage_path text, photo_position smallint, review_status app.review_status, review_note text, created_at timestamptz)
language sql stable security definer set search_path = app, public as $$
  select id, storage_path, position, review_status, review_note, created_at
  from app.photos where user_id = auth.uid() order by position, created_at
$$;

-- ---------------------------------------------------------------------
-- 3. Affichage : ce que l'API doit produire (journalisé pour l'équipe)
-- ---------------------------------------------------------------------
create function app.photo_for_view(p_photo uuid)
returns table (storage_path text, blurred boolean, viewer_first_name text, viewer_last_name text, viewer_number text)
language plpgsql security definer set search_path = app, public as $$
declare
  v_photo app.photos;
  v_owner boolean;
begin
  select * into v_photo from app.photos where id = p_photo;
  if not found or not app.can_view_photo(p_photo) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_owner := v_photo.user_id = auth.uid();
  if not v_owner and app.has_permission('profile_texts.review') then
    perform app.audit('photo.viewed', 'photos', p_photo, '{}'::jsonb);
  end if;
  return query
    select v_photo.storage_path,
           not v_owner and not app.has_permission('profile_texts.review')
             and coalesce((select p.keep_photo_blurred from app.member_profiles p where p.user_id = v_photo.user_id), false),
           vp.first_name, vp.last_name, vu.member_number
    from app.users vu left join app.member_profiles vp on vp.user_id = vu.id
    where vu.id = auth.uid();
end $$;

-- ---------------------------------------------------------------------
-- 4. Modération (règles des textes, question 22)
-- ---------------------------------------------------------------------
create function app.photo_moderation_queue()
returns table (photo_id uuid, user_id uuid, first_name text, member_number text, created_at timestamptz)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('profile_texts.review') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select ph.id, ph.user_id, p.first_name, u.member_number, ph.created_at
    from app.photos ph join app.users u on u.id = ph.user_id
    left join app.member_profiles p on p.user_id = ph.user_id
    where ph.review_status = 'pending'
    order by ph.created_at, ph.id;
end $$;

create function app.review_photo(p_photo uuid, p_approve boolean, p_note text default null) returns void
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
    perform app.notify_with_deliveries(v_photo.user_id, 'profile.photo_rejected', jsonb_build_object('note', v_note));
  end if;
  perform app.audit(case when p_approve then 'photo.approved' else 'photo.rejected' end, 'photos', p_photo, '{}'::jsonb);
end $$;

grant execute on function
  app.can_view_photo(uuid),
  app.can_view_photo_path(text),
  app.add_photo(text),
  app.remove_photo(uuid),
  app.my_photos(),
  app.photo_for_view(uuid),
  app.photo_moderation_queue(),
  app.review_photo(uuid, boolean, text)
to authenticated, service_role;
