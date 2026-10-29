-- Question 10 c de PHASE3.txt (décision du 29 octobre 2026) : une photo approuvée par l'équipe
-- est exigée pour réserver une soirée (place ou liste d'attente).
--   - Les comptes de démonstration (adresses en @demo.ifedele.invalid, sans mot de passe) en
--     sont dispensés : la soirée de démonstration (supabase/demo/soiree-demo.sql) reste possible.
--   - Les inscriptions déjà enregistrées ne sont pas touchées : la règle vaut pour les nouvelles
--     réservations seulement.
-- app.book_event reprend la version de 20261026001300_couple.sql, avec ce seul contrôle en plus.

-- Vrai si le membre a au moins une photo approuvée, ou si c'est un compte de démonstration
create function app.has_booking_photo(p_user uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (select 1 from app.photos where user_id = p_user and review_status = 'approved')
      or exists (select 1 from auth.users where id = p_user and email like '%@demo.ifedele.invalid')
$$;
revoke all on function app.has_booking_photo(uuid) from public;

create or replace function app.book_event(p_event uuid) returns text
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_profile app.member_profiles;
  v_event app.events;
  v_theme app.themes;
  v_age integer;
  v_religion text;
  v_sector text;
  v_capacity integer;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into v_profile from app.member_profiles where user_id = v_uid;
  if v_profile is null or v_profile.status <> 'verified' then raise exception 'not_validated'; end if;
  -- Exclusivité (9.5) : couple en cours ; la pause la lève (question 6)
  if app.in_couple(v_uid) then
    raise exception 'couple_exclusivity';
  end if;
  if v_profile.evenings_blocked_until is not null and now() < v_profile.evenings_blocked_until then
    raise exception 'blocked_until';
  end if;
  -- Question 10 c : photo approuvée exigée (comptes de démonstration dispensés)
  if not app.has_booking_photo(v_uid) then
    raise exception 'photo_required';
  end if;

  -- Verrou sur la soirée : deux réservations simultanées ne dépassent jamais le quota
  select * into v_event from app.events where id = p_event for update;
  if v_event is null or v_event.status not in ('published', 'full') or now() >= v_event.starts_at then
    raise exception 'evening_closed';
  end if;
  if exists (select 1 from app.event_registrations where event_id = p_event and user_id = v_uid
             and status in ('booked', 'confirmed', 'checked_in'))
     or exists (select 1 from app.waitlist_entries where event_id = p_event and user_id = v_uid) then
    raise exception 'already_registered';
  end if;

  -- Soirée thématique : critères d'accès automatiques
  if v_event.theme_id is not null then
    select * into v_theme from app.themes where id = v_event.theme_id;
    v_age := extract(year from age((v_event.starts_at at time zone 'Africa/Porto-Novo')::date, v_profile.birth_date))::integer;
    if (v_theme.min_age is not null and v_age < v_theme.min_age) or (v_theme.max_age is not null and v_age > v_theme.max_age) then
      raise exception 'theme_age';
    end if;
    select pa."values"[1] into v_religion from app.profile_answers pa where pa.user_id = v_uid and pa.side = 'self' and pa.category = 'religion';
    if coalesce(array_length(v_theme.required_religions, 1), 0) > 0 and (v_religion is null or not v_religion = any (v_theme.required_religions)) then
      raise exception 'theme_religion';
    end if;
    select pa."values"[1] into v_sector from app.profile_answers pa where pa.user_id = v_uid and pa.side = 'self' and pa.category = 'sector';
    if coalesce(array_length(v_theme.sectors, 1), 0) > 0 and (v_sector is null or not v_sector = any (v_theme.sectors)) then
      raise exception 'theme_sector';
    end if;
  end if;

  v_capacity := case v_profile.sex when 'female' then v_event.capacity_women else v_event.capacity_men end;
  if app.seats_taken(p_event, v_profile.sex) < v_capacity then
    insert into app.event_registrations (event_id, user_id, sex, status, seated_at)
    values (p_event, v_uid, v_profile.sex, 'booked', now())
    on conflict (event_id, user_id)
    do update set status = 'booked', seated_at = now(), confirmed_at = null, checked_in_at = null, created_at = now();
    return 'seat';
  end if;

  insert into app.waitlist_entries (event_id, user_id, sex, position)
  values (p_event, v_uid, v_profile.sex,
          coalesce((select max(position) from app.waitlist_entries where event_id = p_event and sex = v_profile.sex), 0) + 1);
  return 'waitlist';
end $$;
