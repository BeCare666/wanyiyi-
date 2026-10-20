-- Phase 2, étape 4 : inscription d'un nouveau membre (section 6.2-2).
-- Décisions du 19 octobre 2026 : âge minimum 18 ans révolus, sans âge maximum (question 3) ;
-- adresse e-mail facultative, confirmée par lien (gérée par Supabase Auth, pas par cette fonction).
--   1. Le compte naît à la vérification du code SMS (Supabase Auth, déclencheur on_auth_user_created).
--   2. Le membre accepte le règlement et la politique de confidentialité, puis déclare son identité :
--      prénom, nom, sexe, date de naissance, ville. Le profil est créé à l'état « registering ».
--   3. La vérification (pièce, selfie, déclaration) suit sur /espace/verification.
-- Le profil ne se crée plus par écriture directe : seule cette fonction contrôle l'âge et le consentement.

insert into app.settings (key, value) values ('members.minimum_age', '18')
on conflict (key) do nothing;

drop policy member_profiles_insert_self on app.member_profiles;

create function app.complete_registration(
  p_first_name text,
  p_last_name text,
  p_sex app.sex,
  p_birth_date date,
  p_city text,
  p_consent boolean
) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_user uuid := auth.uid();
  v_first text := btrim(coalesce(p_first_name, ''));
  v_last text := btrim(coalesce(p_last_name, ''));
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_today date := (now() at time zone 'Africa/Porto-Novo')::date;
  v_minimum integer := app.setting_int('members.minimum_age', 18);
begin
  if v_user is null or not exists (select 1 from app.users where id = v_user) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from app.member_profiles where user_id = v_user) then raise exception 'already_registered'; end if;
  if p_consent is not true then raise exception 'consent_required'; end if;
  if char_length(v_first) not between 1 and 60 or char_length(v_last) not between 1 and 60 then raise exception 'invalid_name'; end if;
  if v_city is not null and char_length(v_city) > 80 then raise exception 'invalid_city'; end if;
  if p_sex is null then raise exception 'invalid_sex'; end if;
  if p_birth_date is null or p_birth_date > v_today or p_birth_date < date '1900-01-01' then raise exception 'invalid_birth_date'; end if;
  -- Âge révolu au jour de Cotonou
  if date_part('year', age(v_today, p_birth_date)) < v_minimum then raise exception 'too_young'; end if;

  update app.users set consent_at = now() where id = v_user;
  insert into app.member_profiles (user_id, first_name, last_name, sex, birth_date, city)
  values (v_user, v_first, v_last, p_sex, p_birth_date, v_city);
  perform app.audit('member.registered', 'users', v_user);
end $$;

grant execute on function app.complete_registration(text, text, app.sex, date, text, boolean) to authenticated;
