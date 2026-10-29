-- Participants d'une soirée visibles avant de réserver (décision du 29 octobre 2026) :
--   - un membre vérifié voit les inscrits de l'autre sexe d'une soirée publiée à venir ;
--   - affiché : prénom, âge à la date de la soirée, ville, secteur, religion, textes approuvés,
--     photo très floutée (visage illisible) ; la photo nette reste réservée au match ;
--   - réglage personnel pour ne pas apparaître (on voit quand même les autres).
-- Photo : une copie floutée est créée par l'API à côté de chaque photo (même dossier, nom
-- « apercu-… ») ; seules ces copies sont lisibles pour l'aperçu, jamais le fichier d'origine.

alter table app.member_profiles add column show_in_evening_previews boolean not null default true;
alter table app.photos add column preview_path text;

-- Copie floutée d'une de ses photos, déposée par l'API avec le jeton du membre
create function app.set_photo_preview(p_photo uuid, p_path text) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if p_path is null or split_part(p_path, '/', 1) <> auth.uid()::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'member-photos' and o.name = p_path) then
    raise exception 'invalid_photo';
  end if;
  update app.photos set preview_path = p_path where id = p_photo and user_id = auth.uid();
  if not found then raise exception 'not_found'; end if;
end $$;
revoke execute on function app.set_photo_preview(uuid, text) from public;
grant execute on function app.set_photo_preview(uuid, text) to authenticated;

-- Copies à créer pour les photos déposées avant cette mise à jour (tâche système de l'API)
create function app.photos_without_preview(p_limit integer) returns table (photo_id uuid, storage_path text)
language sql stable security definer set search_path = app, public as $$
  select id, storage_path from app.photos where preview_path is null order by created_at limit greatest(p_limit, 0)
$$;
create function app.mark_photo_preview(p_photo uuid, p_path text) returns void
language sql security definer set search_path = app, public as $$
  update app.photos set preview_path = p_path where id = p_photo
$$;
revoke execute on function app.photos_without_preview(integer), app.mark_photo_preview(uuid, text) from public, authenticated;
grant execute on function app.photos_without_preview(integer), app.mark_photo_preview(uuid, text) to service_role;

-- Vrai si la personne connectée peut voir l'aperçu de `p_user` pour la soirée `p_event`
create function app.can_preview_participant(p_event uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1
    from app.events e
    join app.event_registrations r on r.event_id = e.id and r.user_id = p_user and r.status in ('booked', 'confirmed', 'checked_in')
    join app.member_profiles target on target.user_id = p_user and target.status = 'verified' and target.show_in_evening_previews
    join app.member_profiles viewer on viewer.user_id = auth.uid() and viewer.status = 'verified'
    where e.id = p_event
      and e.status in ('published', 'full') and e.starts_at > now()
      and viewer.sex <> target.sex
      and p_user <> auth.uid()
  )
$$;

-- Inscrits de l'autre sexe d'une soirée, pour un membre vérifié
create function app.evening_participants(p_event uuid)
returns table (user_id uuid, first_name text, age integer, city text, sector text, religion text, texts jsonb, photo_id uuid)
language plpgsql stable security definer set search_path = app, public as $$
declare
  v_starts timestamptz;
begin
  if not exists (select 1 from app.member_profiles where member_profiles.user_id = auth.uid() and status = 'verified') then
    raise exception 'not_validated';
  end if;
  select starts_at into v_starts from app.events where id = p_event and status in ('published', 'full') and starts_at > now();
  if v_starts is null then raise exception 'evening_closed'; end if;
  return query
    select p.user_id, p.first_name,
           extract(year from age((v_starts at time zone 'Africa/Porto-Novo')::date, p.birth_date))::integer,
           p.city,
           (select a."values"[1] from app.profile_answers a where a.user_id = p.user_id and a.side = 'self' and a.category = 'sector'),
           (select a."values"[1] from app.profile_answers a where a.user_id = p.user_id and a.side = 'self' and a.category = 'religion'),
           coalesce((select jsonb_agg(jsonb_build_object('field', t.field, 'body', t.body) order by t.field)
                       from app.profile_texts t where t.user_id = p.user_id and t.review_status = 'approved'), '[]'::jsonb),
           (select ph.id from app.photos ph
             where ph.user_id = p.user_id and ph.review_status = 'approved' and ph.preview_path is not null
             order by ph.position, ph.created_at limit 1)
    from app.event_registrations r
    join app.member_profiles p on p.user_id = r.user_id
    where r.event_id = p_event and app.can_preview_participant(p_event, r.user_id)
    order by r.seated_at, p.first_name;
end $$;
revoke execute on function app.evening_participants(uuid) from public;
grant execute on function app.evening_participants(uuid) to authenticated;

-- Copie floutée d'un participant, avec le nom de la personne qui regarde (filigrane)
create function app.evening_preview_for_view(p_event uuid, p_photo uuid)
returns table (storage_path text, viewer_first_name text, viewer_last_name text, viewer_number text)
language sql stable security definer set search_path = app, public as $$
  select ph.preview_path, v.first_name, v.last_name, u.member_number
  from app.photos ph
  join app.member_profiles v on v.user_id = auth.uid()
  join app.users u on u.id = auth.uid()
  where ph.id = p_photo and ph.review_status = 'approved' and ph.preview_path is not null
    and app.can_preview_participant(p_event, ph.user_id)
$$;
revoke execute on function app.evening_preview_for_view(uuid, uuid) from public;
grant execute on function app.evening_preview_for_view(uuid, uuid) to authenticated;

-- Lecture du fichier : la copie floutée seulement, pour un aperçu permis
create function app.can_view_preview_path(p_path text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.photos ph
    join app.event_registrations r on r.user_id = ph.user_id and r.status in ('booked', 'confirmed', 'checked_in')
    where ph.preview_path = p_path and ph.review_status = 'approved'
      and app.can_preview_participant(r.event_id, ph.user_id)
  )
$$;
create policy member_photos_read_preview on storage.objects for select to authenticated
  using (bucket_id = 'member-photos' and app.can_view_preview_path(name));
