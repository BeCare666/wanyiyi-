-- Phase 4, étape 2 : espace souvenir (section 9.5 ; question 1 de
-- propositions/PROPOSITIONS-QUESTIONS-PHASE4.txt, validée le 27 octobre 2026).
--   a) En plus des étapes, des dates, des photos de profil déjà révélées et de la conversation
--      gardée : jusqu'à 6 photos de l'union, 3 par membre, relues par la modération comme les
--      autres photos, visibles des deux seulement, mêmes protections (lien de 5 minutes,
--      filigrane). Fichiers dans le dossier du membre du compartiment « member-photos » : ils sont
--      effacés avec son compte (purge de l'API, règle déjà en place).
--   b) Sans limite de durée.
--   c) Compte supprimé par l'un des deux : l'espace reste visible de l'autre, sans le prénom ni
--      les photos de la personne partie (« votre conjoint(e) »), dès la demande de suppression.
--   d) Suivi post-union : accès au conseiller demandé et accepté par les deux, même prix, séances
--      proposées et acceptées comme pendant le couple, arrêt par l'un ou l'autre. L'administration
--      voit l'ancien conseiller du couple pour le reprendre s'il est disponible.

-- ---------------------------------------------------------------------
-- 1. Personne partie (demande de suppression ou compte effacé)
-- ---------------------------------------------------------------------
create function app.member_gone(p_user uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select coalesce((select p.status = 'deleted' from app.member_profiles p where p.user_id = p_user), true)
$$;

-- Photos de profil : plus visibles des autres pendant la suppression du compte (question 1 c)
create or replace function app.can_view_photo(p_photo uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.photos ph
    where ph.id = p_photo
      and (
        ph.user_id = auth.uid()
        or app.has_permission('profile_texts.review')
        or (
          ph.review_status = 'approved'
          and not app.member_gone(ph.user_id)
          and (
            exists (
              select 1 from app.matches m
              left join app.discoveries d on d.match_id = m.id
              where m.notified_at is not null
                and (m.status = 'pending_choice' or (m.status = 'discovery_open' and d.status in ('active', 'extended')))
                and ((m.member_a = auth.uid() and m.member_b = ph.user_id) or (m.member_b = auth.uid() and m.member_a = ph.user_id))
            )
            or exists (
              select 1 from app.couples c
              where c.status in ('active', 'paused', 'union_celebrated')
                and ((c.member_a = auth.uid() and c.member_b = ph.user_id) or (c.member_b = auth.uid() and c.member_a = ph.user_id))
            )
          )
        )
      )
  )
$$;

-- État du couple : l'espace reste lisible quand le profil de l'autre est effacé ; prénom masqué
-- dès la demande de suppression (mêmes colonnes qu'avant)
create or replace function app.my_couple()
returns table (couple_id uuid, partner_first_name text, status app.couple_status, created_at timestamptz,
               paused_at timestamptz, blocked boolean, my_requests text[], counselor_name text)
language sql stable security definer set search_path = app, public as $$
  select c.id, case when app.member_gone(o.id) then null else p.first_name end, c.status, c.created_at, c.paused_at, c.blocked_at is not null,
         coalesce(array(select r.kind from app.couple_requests r where r.couple_id = c.id and r.user_id = auth.uid()), '{}'),
         (select co.display_name from app.counselor_access a join app.counselors co on co.user_id = a.counselor_id
           where a.couple_id = c.id and a.status = 'granted' order by a.granted_at desc limit 1)
  from app.couples c
  join app.users o on o.id = case when c.member_a = auth.uid() then c.member_b else c.member_a end
  left join app.member_profiles p on p.user_id = o.id
  where auth.uid() in (c.member_a, c.member_b)
  order by c.created_at desc
  limit 1
$$;

-- ---------------------------------------------------------------------
-- 2. Photos de l'union
-- ---------------------------------------------------------------------
create table app.union_photos (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references app.couples (id) on delete cascade,
  user_id uuid not null references app.users (id) on delete cascade,
  storage_path text not null unique,
  review_status app.review_status not null default 'pending',
  review_note text,
  reviewed_by uuid references app.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index union_photos_couple on app.union_photos (couple_id, created_at);
alter table app.union_photos enable row level security;
alter table app.union_photos force row level security;

-- Chacun voit les siennes ; l'autre voit les photos approuvées tant que l'union est célébrée et
-- que l'auteur n'est pas parti ; l'équipe de modération les relit
create function app.can_view_union_photo(p_photo uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.union_photos up
    join app.couples c on c.id = up.couple_id
    where up.id = p_photo
      and (
        up.user_id = auth.uid()
        or app.has_permission('profile_texts.review')
        or (up.review_status = 'approved' and c.status = 'union_celebrated'
            and auth.uid() in (c.member_a, c.member_b) and not app.member_gone(up.user_id))
      )
  )
$$;

create function app.can_view_union_photo_path(p_path text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (select 1 from app.union_photos up where up.storage_path = p_path and app.can_view_union_photo(up.id))
$$;

create policy union_photos_select on app.union_photos for select using (app.can_view_union_photo(id));
create policy member_photos_read_union on storage.objects for select to authenticated
  using (bucket_id = 'member-photos' and app.can_view_union_photo_path(name));

-- Dépôt (fichier déjà déposé par l'API dans le dossier du membre) : union célébrée, 3 par membre
-- au plus (refusées exclues)
create function app.add_union_photo(p_couple uuid, p_path text) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_couple app.couples;
  v_id uuid;
begin
  select * into v_couple from app.couples where id = p_couple for update;
  if not found or v_uid is null or v_uid not in (v_couple.member_a, v_couple.member_b) then raise exception 'not_member'; end if;
  if v_couple.status <> 'union_celebrated' or not v_couple.memory_space then raise exception 'not_union'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> v_uid::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'member-photos' and o.name = p_path) then
    raise exception 'invalid_photo';
  end if;
  if (select count(*) from app.union_photos where couple_id = p_couple and user_id = v_uid and review_status <> 'rejected') >= 3 then
    raise exception 'too_many_photos';
  end if;
  insert into app.union_photos (couple_id, user_id, storage_path) values (p_couple, v_uid, p_path) returning id into v_id;
  perform app.audit('union_photo.added', 'union_photos', v_id, '{}'::jsonb);
  return v_id;
end $$;

-- Retrait d'une de ses photos ; renvoie le chemin, que l'API supprime du stockage
create function app.remove_union_photo(p_photo uuid) returns text
language plpgsql security definer set search_path = app, public as $$
declare v_path text;
begin
  delete from app.union_photos where id = p_photo and user_id = auth.uid() returning storage_path into v_path;
  if v_path is null then raise exception 'not_found'; end if;
  perform app.audit('union_photo.removed', 'union_photos', p_photo, '{}'::jsonb);
  return v_path;
end $$;

-- Photos de l'espace souvenir pour l'un des deux : les siennes (avec l'état de relecture et le
-- motif d'un refus) et celles de l'autre déjà approuvées
create function app.memory_space_photos(p_couple uuid)
returns table (photo_id uuid, mine boolean, review_status app.review_status, review_note text, created_at timestamptz)
language sql stable security definer set search_path = app, public as $$
  select up.id, up.user_id = auth.uid(), up.review_status,
         case when up.user_id = auth.uid() then up.review_note end, up.created_at
  from app.union_photos up
  join app.couples c on c.id = up.couple_id
  where up.couple_id = p_couple and auth.uid() in (c.member_a, c.member_b)
    and (up.user_id = auth.uid() or app.can_view_union_photo(up.id))
  order by up.created_at, up.id
$$;

-- Affichage par l'API (mêmes colonnes que photo_for_view ; jamais floutée)
create function app.union_photo_for_view(p_photo uuid)
returns table (storage_path text, blurred boolean, viewer_first_name text, viewer_last_name text, viewer_number text)
language plpgsql security definer set search_path = app, public as $$
declare v_photo app.union_photos;
begin
  select * into v_photo from app.union_photos where id = p_photo;
  if not found or not app.can_view_union_photo(p_photo) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_photo.user_id <> auth.uid() and app.has_permission('profile_texts.review') then
    perform app.audit('union_photo.viewed', 'union_photos', p_photo, '{}'::jsonb);
  end if;
  return query
    select v_photo.storage_path, false, vp.first_name, vp.last_name, vu.member_number
    from app.users vu left join app.member_profiles vp on vp.user_id = vu.id
    where vu.id = auth.uid();
end $$;

-- Modération (mêmes règles que les photos de profil)
create function app.union_photo_moderation_queue()
returns table (photo_id uuid, user_id uuid, first_name text, member_number text, created_at timestamptz)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('profile_texts.review') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select up.id, up.user_id, p.first_name, u.member_number, up.created_at
    from app.union_photos up join app.users u on u.id = up.user_id
    left join app.member_profiles p on p.user_id = up.user_id
    where up.review_status = 'pending'
    order by up.created_at, up.id;
end $$;

create function app.review_union_photo(p_photo uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_photo app.union_photos;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not app.has_permission('profile_texts.review') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_photo from app.union_photos where id = p_photo for update;
  if not found then raise exception 'not_found'; end if;
  if v_photo.review_status <> 'pending' then raise exception 'already_reviewed'; end if;
  if not p_approve and v_note is null then raise exception 'note_required'; end if;
  if char_length(coalesce(v_note, '')) > 1000 then raise exception 'note_too_long'; end if;
  update app.union_photos
     set review_status = case when p_approve then 'approved' else 'rejected' end::app.review_status,
         review_note = case when p_approve then null else v_note end,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_photo;
  if not p_approve then
    perform app.notify_with_deliveries(v_photo.user_id, 'couple.union_photo_rejected', jsonb_build_object('note', v_note));
  end if;
  perform app.audit(case when p_approve then 'union_photo.approved' else 'union_photo.rejected' end, 'union_photos', p_photo, '{}'::jsonb);
end $$;

-- Effacement du compte : lignes des photos de l'union effacées avec le profil (les fichiers le
-- sont par l'API, dossier du membre)
create function app.union_photos_on_purge() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from app.union_photos where user_id = new.id;
  end if;
  return new;
end $$;

create trigger users_union_photos_purge after update of deleted_at on app.users
  for each row execute function app.union_photos_on_purge();

-- ---------------------------------------------------------------------
-- 3. Suivi post-union par le conseiller (question 1 d)
-- ---------------------------------------------------------------------
create or replace function app.request_counselor_access(p_couple uuid, p_include_history boolean) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_couple app.couples;
  v_id uuid;
begin
  select * into v_couple from app.couples where id = p_couple for update;
  if not found or v_uid is null or v_uid not in (v_couple.member_a, v_couple.member_b) then raise exception 'not_member'; end if;
  if v_couple.status not in ('active', 'paused', 'union_celebrated') then raise exception 'couple_closed'; end if;
  if v_couple.blocked_at is not null then raise exception 'couple_blocked'; end if;
  if exists (select 1 from app.counselor_access a where a.couple_id = p_couple and a.status in ('requested', 'granted')) then
    raise exception 'access_pending';
  end if;
  insert into app.counselor_access (couple_id, requested_by) values (p_couple, v_uid) returning id into v_id;
  insert into app.counselor_access_consents (access_id, user_id, accepted, include_history)
    values (v_id, v_uid, true, coalesce(p_include_history, false));
  perform app.couple_system_message(p_couple, 'counselor_access.requested', v_uid);
  perform app.notify_with_deliveries(
    case when v_uid = v_couple.member_a then v_couple.member_b else v_couple.member_a end,
    'counselor_access.requested', jsonb_build_object('couple_id', p_couple));
  perform app.audit('counselor_access.requested', 'counselor_access', v_id, '{}'::jsonb);
  return v_id;
end $$;

create or replace function app.propose_session(p_couple uuid, p_at timestamptz, p_mode text, p_location text) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_couple app.couples;
  v_location text := nullif(btrim(coalesce(p_location, '')), '');
  v_id uuid;
begin
  if app.my_counselor_access(p_couple) is null then raise exception 'not_counselor'; end if;
  select * into v_couple from app.couples where id = p_couple;
  if v_couple.status not in ('active', 'paused', 'union_celebrated') then raise exception 'invalid_status'; end if;
  if p_at is null or p_at <= now() then raise exception 'invalid_date'; end if;
  if p_mode not in ('online', 'place') then raise exception 'invalid_mode'; end if;
  if p_mode = 'place' and v_location is null then raise exception 'location_required'; end if;
  if char_length(coalesce(v_location, '')) > 200 then raise exception 'location_too_long'; end if;
  insert into app.sessions (counselor_id, couple_id, is_mediation, scheduled_at, location, mode)
  values (auth.uid(), p_couple, false, p_at, v_location, p_mode) returning id into v_id;
  perform app.couple_system_message(p_couple, 'session.proposed', auth.uid());
  perform app.notify_with_deliveries(v_couple.member_a, 'session.proposed', jsonb_build_object('couple_id', p_couple, 'session_id', v_id));
  perform app.notify_with_deliveries(v_couple.member_b, 'session.proposed', jsonb_build_object('couple_id', p_couple, 'session_id', v_id));
  perform app.audit('session.proposed', 'sessions', v_id, '{}'::jsonb);
  return v_id;
end $$;

-- Couples suivis par un conseiller : en cours, en pause, ou unis avec un suivi en cours
create function app.counselor_load(p_counselor uuid) returns integer
language sql stable security definer set search_path = app, public as $$
  select count(*)::integer from app.couples c
  where c.counselor_id = p_counselor
    and (c.status in ('active', 'paused')
         or (c.status = 'union_celebrated'
             and exists (select 1 from app.counselor_access a where a.couple_id = c.id and a.counselor_id = p_counselor and a.status = 'granted')))
$$;

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
  -- Le conseiller qui suivait déjà ce couple (en cours ou en suivi post-union) n'est pas compté deux fois
  if not (v_couple.counselor_id = p_counselor and (v_couple.status in ('active', 'paused')
          or exists (select 1 from app.counselor_access a where a.couple_id = v_couple.id and a.counselor_id = p_counselor and a.status = 'granted')))
     and app.counselor_load(p_counselor) >= v_counselor.max_couples then
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

-- Liste des conseillers : la charge compte aussi les suivis post-union en cours (mêmes colonnes)
create or replace function app.admin_counselors()
returns table (user_id uuid, display_name text, bio text, languages app.locale[], max_couples integer, is_available boolean,
               member_number text, active_couples integer)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('counselors.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select c.user_id, c.display_name, c.bio, c.languages, c.max_couples::integer, c.is_available, u.member_number,
           app.counselor_load(c.user_id)
    from app.counselors c join app.users u on u.id = c.user_id
    order by c.display_name;
end $$;

-- Demandes réglées à attribuer : on y ajoute l'état du couple (suivi post-union) et son ancien
-- conseiller, à reprendre s'il est disponible
drop function app.admin_counselor_requests();
create function app.admin_counselor_requests()
returns table (access_id uuid, couple_id uuid, accepted_at timestamptz, include_history boolean,
               a_first_name text, a_number text, b_first_name text, b_number text,
               couple_status app.couple_status, previous_counselor_id uuid, previous_counselor_name text)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('counselors.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select a.id, c.id, a.accepted_at, a.include_history, pa.first_name, ua.member_number, pb.first_name, ub.member_number,
           c.status, c.counselor_id, co.display_name
    from app.counselor_access a
    join app.couples c on c.id = a.couple_id
    join app.users ua on ua.id = c.member_a left join app.member_profiles pa on pa.user_id = c.member_a
    join app.users ub on ub.id = c.member_b left join app.member_profiles pb on pb.user_id = c.member_b
    left join app.counselors co on co.user_id = c.counselor_id
    where a.status = 'requested' and app.counselor_access_paid(a.id)
    order by a.accepted_at, a.id;
end $$;

revoke execute on function app.union_photos_on_purge() from public;
grant execute on function
  app.member_gone(uuid),
  app.can_view_union_photo(uuid),
  app.can_view_union_photo_path(text),
  app.add_union_photo(uuid, text),
  app.remove_union_photo(uuid),
  app.memory_space_photos(uuid),
  app.union_photo_for_view(uuid),
  app.union_photo_moderation_queue(),
  app.review_union_photo(uuid, boolean, text),
  app.counselor_load(uuid),
  app.admin_counselor_requests()
to authenticated, service_role;
