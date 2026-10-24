-- Thèmes des soirées (questions 4 et 21 ; choix du 24 octobre 2026, à la demande de l'utilisateur).
-- Nom en trois langues ; critères : âge, confessions (valeurs « religion » du catalogue du profil),
-- secteurs (valeurs « sector »). Thèmes de départ repris de la vitrine : tranches d'âge 25-35,
-- 35-45, 45 et plus, foi chrétienne (catholique, protestante et évangélique), foi musulmane.
-- Les soirées « Univers professionnel » sont créées par l'équipe avec les secteurs de son choix.
-- Écriture par app.save_theme et app.delete_theme seulement (permission events.manage, journalisées).

alter table app.themes add column name jsonb not null default '{}'::jsonb;

drop policy themes_manage on app.themes;

insert into app.themes (key, name, min_age, max_age, required_religions, sectors) values
  ('age-25-35', '{"fr": "25 à 35 ans", "en": "25 to 35", "yo": "Ọdún 25 sí 35"}', 25, 35, null, null),
  ('age-35-45', '{"fr": "35 à 45 ans", "en": "35 to 45", "yo": "Ọdún 35 sí 45"}', 35, 45, null, null),
  ('age-45-plus', '{"fr": "45 ans et plus", "en": "45 and over", "yo": "Ọdún 45 sókè"}', 45, null, null, null),
  ('faith-christian', '{"fr": "Foi chrétienne", "en": "Christian faith", "yo": "Ìgbàgbọ́ Kìrìsìtẹ́nì"}', null, null,
   array['catholic', 'protestant_evangelical'], null),
  ('faith-muslim', '{"fr": "Foi musulmane", "en": "Muslim faith", "yo": "Ìgbàgbọ́ Mùsùlùmí"}', null, null, array['muslim'], null)
on conflict (key) do nothing;

-- Création (p_id null) ou modification d'un thème. Rend son identifiant.
create function app.save_theme(
  p_id uuid,
  p_name jsonb,
  p_min_age smallint,
  p_max_age smallint,
  p_religions text[],
  p_sectors text[]
) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_id uuid;
  v_name jsonb;
  v_religions text[] := nullif(array(select distinct unnest(coalesce(p_religions, '{}')) order by 1), '{}');
  v_sectors text[] := nullif(array(select distinct unnest(coalesce(p_sectors, '{}')) order by 1), '{}');
begin
  perform app.require_permission('events.manage');
  -- Nom obligatoire en français ; anglais et yoruba reprennent le français s'ils sont vides
  if coalesce(btrim(p_name ->> 'fr'), '') = '' then raise exception 'name_required'; end if;
  v_name := jsonb_build_object(
    'fr', btrim(p_name ->> 'fr'),
    'en', coalesce(nullif(btrim(p_name ->> 'en'), ''), btrim(p_name ->> 'fr')),
    'yo', coalesce(nullif(btrim(p_name ->> 'yo'), ''), btrim(p_name ->> 'fr')));
  if (p_min_age is not null and p_min_age < 18) or (p_max_age is not null and p_max_age < 18) then
    raise exception 'invalid_age';
  end if;
  if p_min_age is not null and p_max_age is not null and p_max_age < p_min_age then raise exception 'invalid_age'; end if;
  if p_min_age is null and p_max_age is null and v_religions is null and v_sectors is null then
    raise exception 'criteria_required';
  end if;

  if p_id is null then
    insert into app.themes (key, name, min_age, max_age, required_religions, sectors)
    values ('theme-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10), v_name, p_min_age, p_max_age, v_religions, v_sectors)
    returning id into v_id;
    perform app.audit('theme.created', 'themes', v_id, jsonb_build_object('name', v_name));
  else
    update app.themes
       set name = v_name, min_age = p_min_age, max_age = p_max_age, required_religions = v_religions, sectors = v_sectors
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
    perform app.audit('theme.updated', 'themes', v_id, jsonb_build_object('name', v_name));
  end if;
  return v_id;
end $$;

-- Suppression d'un thème jamais utilisé par une soirée (sinon, l'historique des soirées le garde)
create function app.delete_theme(p_id uuid) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  perform app.require_permission('events.manage');
  if exists (select 1 from app.events where theme_id = p_id) then raise exception 'theme_in_use'; end if;
  delete from app.themes where id = p_id;
  if not found then raise exception 'not_found'; end if;
  perform app.audit('theme.deleted', 'themes', p_id, '{}'::jsonb);
end $$;

revoke execute on function app.save_theme(uuid, jsonb, smallint, smallint, text[], text[]), app.delete_theme(uuid) from public;
grant execute on function app.save_theme(uuid, jsonb, smallint, smallint, text[], text[]), app.delete_theme(uuid) to authenticated;
