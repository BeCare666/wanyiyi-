-- Modération des textes de profil (question 22, réponses du 22 octobre 2026) :
--   a) un refus exige un motif écrit par l'équipe ;
--   b) le membre est notifié avec le motif ;
--   c) le texte refusé est masqué jusqu'à ce que le membre le réécrive (une réécriture repasse
--      en relecture : déclencheur reset_text_review) ;
--   d) un texte en attente n'est visible des autres membres qu'une fois approuvé.
-- Aujourd'hui, aucun membre ne lit les textes d'un autre (politiques de profile_texts) : la
-- règle d s'appliquera à la page qui les montrera (textes « approved » seulement).
-- Permission profile_texts.review (modération, administration, super administration).
-- Les photos suivent les mêmes règles ; leur relecture viendra avec leur dépôt.

alter table app.profile_texts add column review_note text;

-- Réécriture par le membre : retour en relecture, motif du refus précédent effacé
create or replace function app.reset_text_review() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.is_client() or app.has_permission('profile_texts.review') then
    if new.review_status is distinct from coalesce(old.review_status, 'pending') then
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    end if;
    return new;
  end if;
  new.review_status := 'pending';
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_note := null;
  return new;
end $$;

-- File de relecture : textes en attente, les plus anciens d'abord
create function app.moderation_queue()
returns table (text_id uuid, user_id uuid, first_name text, member_number text, field text, body text, created_at timestamptz)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('profile_texts.review') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select t.id, t.user_id, p.first_name, u.member_number, t.field, t.body, t.created_at
    from app.profile_texts t
    join app.users u on u.id = t.user_id
    left join app.member_profiles p on p.user_id = t.user_id
    where t.review_status = 'pending'
    order by t.created_at, t.id;
end $$;

-- Décision : approuvé, ou refusé avec motif (notifié au membre). Journalisée.
create function app.review_profile_text(p_text uuid, p_status app.review_status, p_note text default null) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_text app.profile_texts;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not app.has_permission('profile_texts.review') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status is null or p_status = 'pending' then raise exception 'invalid_status'; end if;
  if p_status = 'rejected' and v_note is null then raise exception 'note_required'; end if;
  if char_length(v_note) > 1000 then raise exception 'note_too_long'; end if;
  select * into v_text from app.profile_texts where id = p_text for update;
  if v_text.id is null then raise exception 'not_found'; end if;
  if v_text.review_status <> 'pending' then raise exception 'already_reviewed'; end if;

  update app.profile_texts
     set review_status = p_status,
         review_note = case when p_status = 'rejected' then v_note end
   where id = p_text;
  if p_status = 'rejected' then
    insert into app.notifications (user_id, kind, payload)
    values (v_text.user_id, 'profile.text_rejected', jsonb_build_object('reason', v_note, 'field', v_text.field));
  end if;
  perform app.audit('profile_text.' || p_status::text, 'profile_texts', p_text,
                    case when p_status = 'rejected' then jsonb_build_object('reason', v_note) else '{}'::jsonb end);
end $$;

revoke execute on function app.moderation_queue(), app.review_profile_text(uuid, app.review_status, text) from public;
grant execute on function app.moderation_queue(), app.review_profile_text(uuid, app.review_status, text) to authenticated;
