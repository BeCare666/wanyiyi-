-- =====================================================================
-- Phase 2 : inscription, vérification, profil, soirées, vote QR, matchs.
-- Droits des rôles de l'API, politiques RLS fines, fonctions métier atomiques.
-- Règles de référence : sections 8, 9.1 à 9.3 et 10.1 de la note.
-- Les mêmes règles existent en TypeScript pur dans packages/domain (tests croisés).
-- =====================================================================

-- Adaptateur de paiement simulé (développement et démonstration)
alter type app.payment_provider add value if not exists 'simulated';

-- ---------------------------------------------------------------------
-- 1. Droits des rôles de l'API Supabase
-- La RLS filtre les lignes ; ces droits ouvrent seulement l'accès aux tables.
-- Le rôle anon (visiteur) n'a aucun accès au schéma app.
-- ---------------------------------------------------------------------
grant usage on schema app to authenticated, service_role;
grant select, insert, update, delete on all tables in schema app to authenticated;
grant all on all tables in schema app to service_role;
grant usage, select on all sequences in schema app to authenticated, service_role;
alter default privileges in schema app grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema app grant all on tables to service_role;
-- PostgreSQL ouvre l'exécution des fonctions à tous par défaut : on la ferme,
-- puis on l'ouvre fonction par fonction.
alter default privileges in schema app revoke execute on functions from public;
revoke execute on all functions in schema app from public;
grant execute on function app.user_role(), app.has_role(app.role[]) to authenticated, service_role;

-- Colonnes ajoutées
alter table app.event_registrations add column seated_at timestamptz; -- attribution de la place
alter table app.event_registrations add column checked_in_at timestamptz;
alter table app.matches add column notified_at timestamptz;          -- notification envoyée à 8 h

create sequence app.member_number_seq;

-- ---------------------------------------------------------------------
-- 2. Fonctions d'aide
-- ---------------------------------------------------------------------
-- Appel d'un client de l'API (rôles authenticated ou anon). Les tâches système (service_role)
-- et les migrations ou données d'amorçage (accès direct) ne sont pas des clients.
create function app.is_client() returns boolean
language sql stable as $$
  select coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon')
$$;

create function app.is_team() returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.has_role(array['moderator', 'admin', 'super_admin']::app.role[])
$$;

create function app.has_permission(p_permission text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.role_permissions where role = app.user_role() and permission = p_permission
  )
$$;

-- Appel autorisé : tâche système (clé service role) ou personne ayant la permission
create function app.require_permission(p_permission text) returns void
language plpgsql stable security definer set search_path = app, public as $$
begin
  if app.is_client() and not app.has_permission(p_permission) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create function app.audit(p_action text, p_table text, p_id uuid, p_details jsonb default '{}') returns void
language sql security definer set search_path = app, public as $$
  insert into app.audit_log (actor_id, action, target_table, target_id, details)
  values (auth.uid(), p_action, p_table, p_id, p_details)
$$;

-- Lendemain à 8 h, heure de Cotonou (9.3)
create function app.match_announcement_at(p_starts_at timestamptz) returns timestamptz
language sql immutable as $$
  select (date_trunc('day', p_starts_at at time zone 'Africa/Porto-Novo') + interval '1 day 8 hours')
         at time zone 'Africa/Porto-Novo'
$$;

grant execute on function app.is_client(), app.is_team(), app.has_permission(text), app.match_announcement_at(timestamptz)
  to authenticated, service_role;

-- Permissions fines par rôle (9.1)
insert into app.role_permissions (role, permission) values
  ('admin', 'verifications.review'), ('super_admin', 'verifications.review'),
  ('moderator', 'profile_texts.review'), ('admin', 'profile_texts.review'), ('super_admin', 'profile_texts.review'),
  ('admin', 'events.manage'), ('super_admin', 'events.manage'),
  ('admin', 'payments.read'), ('super_admin', 'payments.read'),
  ('super_admin', 'roles.manage');

-- ---------------------------------------------------------------------
-- 3. Comptes : création automatique, colonnes protégées
-- ---------------------------------------------------------------------
create function app.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  insert into app.users (id, phone, member_number)
  values (new.id, new.phone, 'W' || lpad(nextval('app.member_number_seq')::text, 6, '0'));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- Rôle, téléphone et numéro de membre ne changent pas depuis le client,
-- sauf le rôle par la super administration (journalisé).
create function app.protect_user_columns() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.is_client() then return new; end if;
  if new.phone is distinct from old.phone or new.member_number is distinct from old.member_number then
    raise exception 'forbidden_column' using errcode = '42501';
  end if;
  if new.role is distinct from old.role then
    if not app.has_permission('roles.manage') then
      raise exception 'forbidden_column' using errcode = '42501';
    end if;
    perform app.audit('role.changed', 'users', new.id, jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  return new;
end $$;

create trigger users_protect before update on app.users
  for each row execute function app.protect_user_columns();

create policy users_select_team on app.users for select using (app.is_team());
create policy users_update_self on app.users for update using (id = auth.uid()) with check (id = auth.uid());
create policy users_update_roles on app.users for update
  using (app.has_permission('roles.manage')) with check (app.has_permission('roles.manage'));

-- ---------------------------------------------------------------------
-- 4. Profil (section 8)
-- ---------------------------------------------------------------------

-- État du membre, étape du parcours et blocage des soirées : équipe uniquement
create function app.protect_profile_columns() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.is_client() or app.is_team() then
    new.updated_at := now();
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'registering';
    new.journey_stage := 'registration';
    new.evenings_blocked_until := null;
  elsif new.status is distinct from old.status
     or new.journey_stage is distinct from old.journey_stage
     or new.evenings_blocked_until is distinct from old.evenings_blocked_until
     or new.sex is distinct from old.sex
     or new.birth_date is distinct from old.birth_date then
    -- Sexe et date de naissance sont vérifiés sur la pièce d'identité : modifiables par l'équipe seulement
    raise exception 'forbidden_column' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger member_profiles_protect before insert or update on app.member_profiles
  for each row execute function app.protect_profile_columns();

create policy member_profiles_select_team on app.member_profiles for select using (app.is_team());
create policy member_profiles_insert_self on app.member_profiles for insert with check (user_id = auth.uid());
create policy member_profiles_update_self on app.member_profiles for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy member_profiles_update_team on app.member_profiles for update using (app.is_team()) with check (app.is_team());

-- Textes libres : toute modification par le membre repasse en relecture
create function app.reset_text_review() returns trigger
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
  return new;
end $$;

create trigger profile_texts_review before insert or update on app.profile_texts
  for each row execute function app.reset_text_review();

create policy profile_texts_self on app.profile_texts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy profile_texts_select_team on app.profile_texts for select using (app.is_team());
create policy profile_texts_review on app.profile_texts for update
  using (app.has_permission('profile_texts.review')) with check (app.has_permission('profile_texts.review'));

create policy profile_answers_self on app.profile_answers for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy profile_answers_select_team on app.profile_answers for select using (app.is_team());

create policy dealbreakers_self on app.dealbreakers for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy dealbreakers_select_team on app.dealbreakers for select using (app.is_team());

-- Photos : aucune photo visible par les autres membres avant un match (10.2, phase 3)
create policy photos_self_select on app.photos for select using (user_id = auth.uid());
create policy photos_self_insert on app.photos for insert with check (user_id = auth.uid() and review_status = 'pending');
create policy photos_self_delete on app.photos for delete using (user_id = auth.uid());
create policy photos_team on app.photos for select using (app.is_team());
create policy photos_review on app.photos for update
  using (app.has_permission('profile_texts.review')) with check (app.has_permission('profile_texts.review'));

-- ---------------------------------------------------------------------
-- 5. Vérification (section 6.2-2 et 10.1)
-- ---------------------------------------------------------------------
create policy verifications_select_self on app.verifications for select using (user_id = auth.uid());
create policy verifications_insert_self on app.verifications for insert
  with check (user_id = auth.uid() and status = 'pending' and decided_by is null);
create policy verifications_review on app.verifications for all
  using (app.has_permission('verifications.review')) with check (app.has_permission('verifications.review'));

-- Décision : l'état du membre suit, et la décision est journalisée
create function app.on_verification_decided() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if new.status is distinct from old.status then
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
  end if;
  return new;
end $$;

create trigger verifications_decided before update on app.verifications
  for each row execute function app.on_verification_decided();

-- Pièces d'identité : le membre dépose, mais ne relit jamais ; aucune lecture directe.
-- L'équipe de vérification passe par app.open_id_document, qui journalise chaque consultation.
create policy id_documents_insert_self on app.id_documents for insert with check (
  exists (select 1 from app.verifications v where v.id = verification_id and v.user_id = auth.uid() and v.status in ('pending', 'to_correct'))
);

create function app.open_id_document(p_document uuid) returns text
language plpgsql security definer set search_path = app, public as $$
declare v_path text;
begin
  if not app.has_permission('verifications.review') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select storage_path into v_path from app.id_documents where id = p_document;
  if v_path is null then raise exception 'not_found'; end if;
  perform app.audit('id_document.viewed', 'id_documents', p_document);
  return v_path;
end $$;

-- Entretien : le membre voit sa date, jamais le compte rendu
create policy interviews_review on app.interviews for all
  using (app.has_permission('verifications.review')) with check (app.has_permission('verifications.review'));

create function app.my_interviews() returns table (id uuid, scheduled_at timestamptz, completed boolean)
language sql stable security definer set search_path = app, public as $$
  select i.id, i.scheduled_at, i.completed_at is not null
  from app.interviews i join app.verifications v on v.id = i.verification_id
  where v.user_id = auth.uid()
  order by i.scheduled_at
$$;

create policy honor_self_insert on app.honor_declarations for insert with check (user_id = auth.uid());
create policy honor_self_select on app.honor_declarations for select using (user_id = auth.uid());
create policy honor_review on app.honor_declarations for select using (app.has_permission('verifications.review'));

grant execute on function app.open_id_document(uuid), app.my_interviews() to authenticated;

-- ---------------------------------------------------------------------
-- 6. Soirées (section 9.2)
-- ---------------------------------------------------------------------
create policy themes_select on app.themes for select using (auth.uid() is not null);
create policy themes_manage on app.themes for all using (app.has_permission('events.manage')) with check (app.has_permission('events.manage'));

create policy events_select_published on app.events for select using (auth.uid() is not null and status <> 'draft');
create policy events_manage on app.events for all using (app.has_permission('events.manage')) with check (app.has_permission('events.manage'));

-- L'adresse du lieu n'est communiquée qu'aux participants confirmés
create policy venues_select_confirmed on app.venues for select using (
  exists (
    select 1 from app.events e join app.event_registrations r on r.event_id = e.id
    where e.venue_id = venues.id and r.user_id = auth.uid() and r.status in ('confirmed', 'checked_in')
  )
);
create policy venues_manage on app.venues for all using (app.has_permission('events.manage')) with check (app.has_permission('events.manage'));

-- Inscriptions : lecture de la sienne ; toute écriture passe par les fonctions ci-dessous
create policy registrations_select_self on app.event_registrations for select using (user_id = auth.uid());
create policy registrations_select_team on app.event_registrations for select using (app.has_permission('events.manage'));
create policy waitlist_select_self on app.waitlist_entries for select using (user_id = auth.uid());
create policy waitlist_select_team on app.waitlist_entries for select using (app.has_permission('events.manage'));

-- Valeur effective d'un paramètre (table settings), avec repli sur la valeur par défaut
create function app.setting_int(p_key text, p_default integer) returns integer
language sql stable security definer set search_path = app, public as $$
  select coalesce((select (value #>> '{}')::integer from app.settings where key = p_key), p_default)
$$;

create function app.confirmation_deadline(p_starts_at timestamptz) returns timestamptz
language sql stable security definer set search_path = app, public as $$
  select p_starts_at - make_interval(hours => app.setting_int('evenings.confirmation_hours_before', 48))
$$;

create function app.seats_taken(p_event uuid, p_sex app.sex) returns integer
language sql stable security definer set search_path = app, public as $$
  select count(*)::integer from app.event_registrations
  where event_id = p_event and sex = p_sex and status in ('booked', 'confirmed', 'checked_in')
$$;

-- Places restantes par sexe, pour l'affichage du calendrier
create function app.event_seats(p_event uuid) returns table (sex app.sex, capacity integer, taken integer, waiting integer)
language sql stable security definer set search_path = app, public as $$
  select s.sex,
         case s.sex when 'female' then e.capacity_women else e.capacity_men end::integer,
         app.seats_taken(e.id, s.sex),
         (select count(*)::integer from app.waitlist_entries w where w.event_id = e.id and w.sex = s.sex)
  from app.events e cross join (values ('female'::app.sex), ('male'::app.sex)) as s(sex)
  where e.id = p_event and e.status <> 'draft'
$$;

-- Places libres attribuées aux premiers de la liste d'attente, sexe par sexe
create function app.promote_waitlist(p_event uuid) returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_event app.events;
  v_entry app.waitlist_entries;
  v_sex app.sex;
  v_free integer;
  v_promoted integer := 0;
begin
  select * into v_event from app.events where id = p_event;
  foreach v_sex in array array['female', 'male']::app.sex[] loop
    v_free := case v_sex when 'female' then v_event.capacity_women else v_event.capacity_men end
              - app.seats_taken(p_event, v_sex);
    while v_free > 0 loop
      select * into v_entry from app.waitlist_entries
       where event_id = p_event and sex = v_sex order by position limit 1 for update skip locked;
      exit when not found;
      insert into app.event_registrations (event_id, user_id, sex, status, seated_at)
      values (p_event, v_entry.user_id, v_sex, 'booked', now())
      on conflict (event_id, user_id)
      do update set status = 'booked', seated_at = now(), confirmed_at = null, checked_in_at = null;
      delete from app.waitlist_entries where id = v_entry.id;
      insert into app.notifications (user_id, kind, payload)
      values (v_entry.user_id, 'evening.seat_offered', jsonb_build_object('event_id', p_event));
      v_free := v_free - 1;
      v_promoted := v_promoted + 1;
    end loop;
  end loop;
  return v_promoted;
end $$;

-- Réservation atomique : « seat » (place attribuée) ou « waitlist » (liste d'attente)
create function app.book_event(p_event uuid) returns text
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
  if exists (select 1 from app.couples c where v_uid in (c.member_a, c.member_b) and c.status in ('active', 'paused')) then
    raise exception 'couple_exclusivity';
  end if;
  if v_profile.evenings_blocked_until is not null and now() < v_profile.evenings_blocked_until then
    raise exception 'blocked_until';
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

-- Confirmation obligatoire jusqu'à 48 h avant le début
create function app.confirm_registration(p_event uuid) returns void
language plpgsql security definer set search_path = app, public as $$
declare v_starts timestamptz;
begin
  select starts_at into v_starts from app.events where id = p_event;
  if now() >= app.confirmation_deadline(v_starts) then raise exception 'confirmation_closed'; end if;
  update app.event_registrations set status = 'confirmed', confirmed_at = now()
   where event_id = p_event and user_id = auth.uid() and status = 'booked';
  if not found then raise exception 'not_booked'; end if;
end $$;

-- Annulation par le membre : la place va à la liste d'attente du même sexe
create function app.cancel_registration(p_event uuid) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  perform 1 from app.events where id = p_event for update;
  delete from app.waitlist_entries where event_id = p_event and user_id = auth.uid();
  if not found then
    update app.event_registrations set status = 'cancelled'
     where event_id = p_event and user_id = auth.uid() and status in ('booked', 'confirmed');
    if not found then raise exception 'not_registered'; end if;
    perform app.promote_waitlist(p_event);
  end if;
end $$;

-- Passage de la limite des 48 h (tâche planifiée de l'API) : les places attribuées
-- avant la limite et non confirmées passent à la liste d'attente.
-- Une place attribuée après la limite n'est pas libérée ici (question ouverte, PHASE2.txt, question 9).
create function app.release_unconfirmed(p_event uuid) returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_deadline timestamptz;
  v_released integer;
begin
  perform app.require_permission('events.manage');
  select app.confirmation_deadline(starts_at) into v_deadline from app.events where id = p_event for update;
  if now() < v_deadline then return 0; end if;
  update app.event_registrations set status = 'released'
   where event_id = p_event and status = 'booked' and coalesce(seated_at, created_at) < v_deadline;
  get diagnostics v_released = row_count;
  perform app.promote_waitlist(p_event);
  return v_released;
end $$;

-- Pointage à l'entrée
create function app.check_in(p_event uuid, p_user uuid) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  perform app.require_permission('events.manage');
  update app.event_registrations set status = 'checked_in', checked_in_at = now()
   where event_id = p_event and user_id = p_user and status = 'confirmed';
  if not found then raise exception 'not_confirmed'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. Rotation, codes QR, déroulé (section 9.2)
-- Femmes numérotées 1..F, hommes 1..H par ordre de pointage ; N = max(F, H) tables et tours.
-- Au tour r, l'homme m est à la table ((m - 1 + r - 1) mod N) + 1.
-- ---------------------------------------------------------------------
create policy event_tables_manage on app.event_tables for all
  using (app.has_permission('events.manage')) with check (app.has_permission('events.manage'));
create policy rounds_manage on app.rounds for all
  using (app.has_permission('events.manage')) with check (app.has_permission('events.manage'));
create policy pairings_manage on app.round_pairings for all
  using (app.has_permission('events.manage')) with check (app.has_permission('events.manage'));
create policy pairings_select_self on app.round_pairings for select using (auth.uid() in (woman_id, man_id));

create function app.prepare_evening(p_event uuid) returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_event app.events;
  v_women uuid[];
  v_men uuid[];
  v_n integer;
  v_round_id uuid;
  v_table_id uuid;
  v_man integer;
begin
  perform app.require_permission('events.manage');
  select * into v_event from app.events where id = p_event for update;
  if exists (select 1 from app.rounds where event_id = p_event) then raise exception 'already_prepared'; end if;

  select array_agg(user_id order by checked_in_at, user_id) into v_women
    from app.event_registrations where event_id = p_event and sex = 'female' and status = 'checked_in';
  select array_agg(user_id order by checked_in_at, user_id) into v_men
    from app.event_registrations where event_id = p_event and sex = 'male' and status = 'checked_in';
  if v_women is null or v_men is null then raise exception 'not_enough_participants'; end if;

  v_n := greatest(array_length(v_women, 1), array_length(v_men, 1));

  -- Numéro de départ : table de la femme, table de départ de l'homme
  update app.event_registrations r set seat_number = w.n
    from unnest(v_women) with ordinality as w(id, n) where r.event_id = p_event and r.user_id = w.id;
  update app.event_registrations r set seat_number = m.n
    from unnest(v_men) with ordinality as m(id, n) where r.event_id = p_event and r.user_id = m.id;

  -- Codes QR uniques, valables à partir du début ; app.finish_evening les ferme.
  -- Borne technique de 12 h au cas où la soirée ne serait jamais clôturée.
  for t in 1..v_n loop
    insert into app.event_tables (event_id, table_number, qr_token, qr_valid_from, qr_valid_until)
    values (p_event, t, encode(gen_random_bytes(18), 'hex'), v_event.starts_at, v_event.starts_at + interval '12 hours');
  end loop;

  for r in 1..v_n loop
    insert into app.rounds (event_id, round_number) values (p_event, r) returning id into v_round_id;
    for t in 1..v_n loop
      select id into v_table_id from app.event_tables where event_id = p_event and table_number = t;
      -- Homme assis à la table t au tour r
      v_man := null;
      for m in 1..coalesce(array_length(v_men, 1), 0) loop
        if ((m - 1 + r - 1) % v_n) + 1 = t then v_man := m; end if;
      end loop;
      insert into app.round_pairings (round_id, table_id, woman_id, man_id)
      values (v_round_id, v_table_id, v_women[t], case when v_man is null then null else v_men[v_man] end);
    end loop;
  end loop;
  return v_n;
end $$;

create function app.start_evening(p_event uuid) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  perform app.require_permission('events.manage');
  if not exists (select 1 from app.rounds where event_id = p_event) then raise exception 'not_prepared'; end if;
  update app.events set status = 'in_progress' where id = p_event and status in ('published', 'full');
  if not found then raise exception 'invalid_status'; end if;
end $$;

-- Fin de soirée : les codes QR ne sont plus valables, les votes sont figés
create function app.finish_evening(p_event uuid) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  perform app.require_permission('events.manage');
  update app.events set status = 'finished' where id = p_event and status = 'in_progress';
  if not found then raise exception 'invalid_status'; end if;
  update app.event_tables set qr_valid_until = least(qr_valid_until, now()) where event_id = p_event;
end $$;

-- ---------------------------------------------------------------------
-- 8. Vote par code QR (section 9.3)
-- Le code QR scanné prouve la présence à la soirée en cours ; la personne
-- rencontrée est déduite du tour et du votant. Vote modifiable jusqu'à la fin.
-- ---------------------------------------------------------------------
create policy votes_select_self on app.votes for select using (voter_id = auth.uid());
create policy votes_select_team on app.votes for select using (app.has_permission('events.manage'));
create policy vote_feedback_team on app.vote_feedback for select using (app.has_permission('events.manage'));

create function app.voting_pairing(p_qr_token text, p_round smallint)
returns table (pairing_id uuid, target_id uuid, event_id uuid)
language plpgsql stable security definer set search_path = app, public as $$
declare v_table app.event_tables;
begin
  select * into v_table from app.event_tables where qr_token = p_qr_token;
  if v_table is null
     or now() < v_table.qr_valid_from or now() > v_table.qr_valid_until
     or not exists (select 1 from app.events e where e.id = v_table.event_id and e.status = 'in_progress') then
    raise exception 'outside_evening';
  end if;
  return query
    select p.id, case when p.woman_id = auth.uid() then p.man_id else p.woman_id end, v_table.event_id
    from app.round_pairings p join app.rounds r on r.id = p.round_id
    where r.event_id = v_table.event_id and r.round_number = p_round and auth.uid() in (p.woman_id, p.man_id);
  if not found then raise exception 'not_in_round'; end if;
end $$;

-- Personne rencontrée à un tour : prénom seulement (jamais le nom de famille)
create function app.round_partner(p_qr_token text, p_round smallint) returns table (first_name text, table_number smallint, my_choice app.vote_choice)
language sql stable security definer set search_path = app, public as $$
  select mp.first_name, t.table_number, v.choice
  from app.voting_pairing(p_qr_token, p_round) vp
  join app.round_pairings p on p.id = vp.pairing_id
  join app.event_tables t on t.id = p.table_id
  left join app.member_profiles mp on mp.user_id = vp.target_id
  left join app.votes v on v.pairing_id = vp.pairing_id and v.voter_id = auth.uid()
$$;

create function app.cast_vote(
  p_qr_token text,
  p_round smallint,
  p_choice app.vote_choice,
  p_respect smallint default null,
  p_punctuality smallint default null,
  p_seriousness smallint default null
) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_pairing uuid;
  v_target uuid;
  v_vote uuid;
begin
  select vp.pairing_id, vp.target_id into v_pairing, v_target from app.voting_pairing(p_qr_token, p_round) vp;
  if v_target is null then raise exception 'pause_round'; end if;
  insert into app.votes (pairing_id, voter_id, target_id, choice)
  values (v_pairing, auth.uid(), v_target, p_choice)
  on conflict (pairing_id, voter_id) do update set choice = excluded.choice, updated_at = now()
  returning id into v_vote;
  if coalesce(p_respect, p_punctuality, p_seriousness) is not null then
    insert into app.vote_feedback (vote_id, respect, punctuality, seriousness)
    values (v_vote, p_respect, p_punctuality, p_seriousness)
    on conflict (vote_id) do update
      set respect = excluded.respect, punctuality = excluded.punctuality, seriousness = excluded.seriousness;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 9. Matchs (section 9.3) : double oui, annonce le lendemain à 8 h.
-- Un membre ne voit ses matchs qu'à partir de l'annonce, et jamais les votes des autres.
-- ---------------------------------------------------------------------
create policy matches_select_self on app.matches for select
  using (auth.uid() in (member_a, member_b) and announced_at <= now());
create policy matches_select_team on app.matches for select using (app.has_permission('events.manage'));

create function app.compute_matches(p_event uuid) returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_event app.events;
  v_count integer;
begin
  perform app.require_permission('events.manage');
  select * into v_event from app.events where id = p_event for update;
  if v_event.status <> 'finished' then raise exception 'evening_not_finished'; end if;
  insert into app.matches (event_id, member_a, member_b, announced_at)
  select distinct p_event, least(a.voter_id, a.target_id), greatest(a.voter_id, a.target_id),
         app.match_announcement_at(v_event.starts_at)
  from app.votes a
  join app.round_pairings pa on pa.id = a.pairing_id
  join app.rounds ra on ra.id = pa.round_id and ra.event_id = p_event
  join app.votes b on b.voter_id = a.target_id and b.target_id = a.voter_id and b.pairing_id = a.pairing_id
  where a.choice = 'yes' and b.choice = 'yes'
  on conflict (event_id, member_a, member_b) do nothing;
  get diagnostics v_count = row_count;
  update app.events set results_computed_at = now() where id = p_event;
  return v_count;
end $$;

-- À 8 h (tâche planifiée) : une notification par membre concerné, sans aucun détail sur les « non »
create function app.announce_matches() returns integer
language plpgsql security definer set search_path = app, public as $$
declare v_count integer;
begin
  perform app.require_permission('events.manage');
  with due as (
    update app.matches set notified_at = now()
     where announced_at <= now() and notified_at is null
     returning id, member_a, member_b
  )
  insert into app.notifications (user_id, kind, payload)
  select m.member, 'match.announced', jsonb_build_object('match_id', due.id)
  from due cross join lateral (values (due.member_a), (due.member_b)) as m(member);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Mes matchs : prénom de l'autre personne seulement
create function app.my_matches() returns table (match_id uuid, event_id uuid, partner_first_name text, announced_at timestamptz, status app.match_status)
language sql stable security definer set search_path = app, public as $$
  select m.id, m.event_id, mp.first_name, m.announced_at, m.status
  from app.matches m
  join app.member_profiles mp on mp.user_id = case when m.member_a = auth.uid() then m.member_b else m.member_a end
  where auth.uid() in (m.member_a, m.member_b) and m.announced_at <= now()
  order by m.announced_at desc
$$;

-- ---------------------------------------------------------------------
-- 10. Paiements : lecture par le membre et l'équipe ; écriture par l'API (service role)
-- ---------------------------------------------------------------------
create policy payments_select_self on app.payments for select using (user_id = auth.uid());
create policy payments_select_team on app.payments for select using (app.has_permission('payments.read'));

-- ---------------------------------------------------------------------
-- 11. Droits d'exécution
-- ---------------------------------------------------------------------
grant execute on function
  app.event_seats(uuid), app.book_event(uuid), app.confirm_registration(uuid), app.cancel_registration(uuid),
  app.round_partner(text, smallint), app.cast_vote(text, smallint, app.vote_choice, smallint, smallint, smallint),
  app.my_matches()
to authenticated;

-- Fonctions d'équipe : la permission est vérifiée à l'intérieur
grant execute on function
  app.release_unconfirmed(uuid), app.check_in(uuid, uuid), app.prepare_evening(uuid),
  app.start_evening(uuid), app.finish_evening(uuid), app.compute_matches(uuid), app.announce_matches()
to authenticated, service_role;

grant execute on all functions in schema app to service_role;
