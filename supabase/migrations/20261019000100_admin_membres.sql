-- Phase 2, étape 5 : module « Membres » de l'administration (section 11.2-2).
-- Décisions du 19 octobre 2026 :
--   - module réservé à l'administration et à la super administration
--     (nouvelle permission members.manage ; pas les modérateurs) ;
--   - actions : suspendre et réactiver, exclure, bloquer les soirées jusqu'à une date,
--     changer le rôle (super administration, permission roles.manage) ;
--   - suspension et exclusion : motif obligatoire, notification au membre avec le motif ;
--   - un membre suspendu ou exclu ne peut plus réserver (déjà le cas : état « verified »
--     exigé) ni voter ; il n'est pas non plus pointé à l'entrée d'une soirée.
-- Chaque action est journalisée.

insert into app.role_permissions (role, permission) values
  ('admin', 'members.manage'), ('super_admin', 'members.manage');

-- Historique des sanctions : état du membre avant la suspension, pour la réactivation
alter table app.sanctions add column previous_status app.member_status;

-- Plus d'écriture directe de l'équipe sur les profils : l'état passe par les fonctions
-- ci-dessous ou par la décision de vérification (déclencheur verifications_decided).
drop policy member_profiles_update_team on app.member_profiles;

-- Sanctions : lecture par l'équipe des membres ; écriture uniquement par les fonctions
create policy sanctions_select_team on app.sanctions for select using (app.has_permission('members.manage'));

-- Membre actif : ni suspendu, ni exclu, ni supprimé
create function app.member_active(p_user uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select coalesce((select status not in ('suspended', 'excluded', 'deleted') from app.member_profiles where user_id = p_user), true)
$$;

-- ---------------------------------------------------------------------
-- 1. Vote et pointage refusés à un membre suspendu ou exclu
-- ---------------------------------------------------------------------
create or replace function app.voting_pairing(p_qr_token text, p_round smallint)
returns table (pairing_id uuid, target_id uuid, event_id uuid)
language plpgsql stable security definer set search_path = app, public as $$
declare v_table app.event_tables;
begin
  if not app.member_active(auth.uid()) then raise exception 'member_inactive' using errcode = '42501'; end if;
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

create or replace function app.check_in(p_event uuid, p_user uuid) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  perform app.require_permission('events.manage');
  if not app.member_active(p_user) then raise exception 'member_inactive'; end if;
  update app.event_registrations set status = 'checked_in', checked_in_at = now()
   where event_id = p_event and user_id = p_user and status = 'confirmed';
  if not found then raise exception 'not_confirmed'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Lecture pour l'équipe
-- ---------------------------------------------------------------------
-- Liste paginée côté serveur (11.3) : recherche (prénom, nom, numéro, téléphone),
-- filtres d'état, de rôle et de sexe. « total » : nombre de lignes du filtre.
create function app.admin_members(
  p_search text default null,
  p_status app.member_status default null,
  p_role app.role default null,
  p_sex app.sex default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  member_number text,
  phone text,
  role app.role,
  first_name text,
  last_name text,
  sex app.sex,
  birth_date date,
  city text,
  status app.member_status,
  created_at timestamptz,
  evenings_attended integer,
  matches integer,
  total integer
)
language plpgsql stable security definer set search_path = app, public as $$
declare v_search text := nullif(btrim(p_search), '');
begin
  if not app.has_permission('members.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select u.id, u.member_number, u.phone, u.role, p.first_name, p.last_name, p.sex, p.birth_date, p.city, p.status, u.created_at,
           (select count(*)::integer from app.event_registrations r where r.user_id = u.id and r.status = 'checked_in'),
           (select count(*)::integer from app.matches m where u.id in (m.member_a, m.member_b)),
           (count(*) over ())::integer
    from app.users u
    left join app.member_profiles p on p.user_id = u.id
    where (v_search is null
           or p.first_name ilike '%' || v_search || '%'
           or p.last_name ilike '%' || v_search || '%'
           or (p.first_name || ' ' || p.last_name) ilike '%' || v_search || '%'
           or u.member_number ilike '%' || v_search || '%'
           or (regexp_replace(v_search, '[^0-9]', '', 'g') <> '' and u.phone like '%' || regexp_replace(v_search, '[^0-9+]', '', 'g') || '%'))
      and (p_status is null or p.status = p_status)
      and (p_role is null or u.role = p_role)
      and (p_sex is null or p.sex = p_sex)
    order by u.created_at desc, u.id
    limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0));
end $$;

-- Fiche d'un membre
create function app.admin_member(p_user uuid)
returns table (
  user_id uuid,
  member_number text,
  phone text,
  role app.role,
  locale app.locale,
  consent_at timestamptz,
  created_at timestamptz,
  first_name text,
  last_name text,
  sex app.sex,
  birth_date date,
  city text,
  status app.member_status,
  journey_stage app.journey_stage,
  evenings_blocked_until timestamptz,
  verification_id uuid,
  verification_status app.verification_status
)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('members.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select u.id, u.member_number, u.phone, u.role, u.locale, u.consent_at, u.created_at,
           p.first_name, p.last_name, p.sex, p.birth_date, p.city, p.status, p.journey_stage, p.evenings_blocked_until,
           v.id, v.status
    from app.users u
    left join app.member_profiles p on p.user_id = u.id
    left join lateral (select vv.id, vv.status from app.verifications vv where vv.user_id = u.id order by vv.created_at desc limit 1) v on true
    where u.id = p_user;
end $$;

-- Historique d'un membre, du plus récent au plus ancien. Jamais le détail des votes (9.3).
create function app.member_history(p_user uuid)
returns table (at timestamptz, kind text, detail jsonb)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('members.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select h.at, h.kind, h.detail from (
      select u.created_at as at, 'account.created'::text as kind, '{}'::jsonb as detail from app.users u where u.id = p_user
      union all
      select coalesce(v.decided_at, v.created_at), 'verification.' || v.status::text,
             jsonb_build_object('note', v.correction_note)
        from app.verifications v where v.user_id = p_user
      union all
      select coalesce(r.checked_in_at, r.confirmed_at, r.seated_at, r.created_at), 'evening.' || r.status::text,
             jsonb_build_object('event_id', r.event_id, 'starts_at', e.starts_at)
        from app.event_registrations r join app.events e on e.id = r.event_id where r.user_id = p_user
      union all
      select w.created_at, 'evening.waitlisted', jsonb_build_object('event_id', w.event_id, 'starts_at', e.starts_at)
        from app.waitlist_entries w join app.events e on e.id = w.event_id where w.user_id = p_user
      union all
      select m.announced_at, 'match', jsonb_build_object('event_id', m.event_id)
        from app.matches m where p_user in (m.member_a, m.member_b)
      union all
      select s.starts_at, 'sanction.' || s.kind::text, jsonb_build_object('reason', s.reason, 'ends_at', s.ends_at)
        from app.sanctions s where s.user_id = p_user
      union all
      select pa.created_at, 'payment.' || pa.status::text, jsonb_build_object('purpose', pa.purpose, 'amount_xof', pa.amount_xof)
        from app.payments pa where pa.user_id = p_user
      union all
      select a.created_at, a.action, a.details
        from app.audit_log a
       where a.target_id = p_user and a.action in ('role.changed', 'member.reactivated', 'member.evenings_blocked')
    ) h
    order by h.at desc nulls last;
end $$;

-- ---------------------------------------------------------------------
-- 3. Actions
-- ---------------------------------------------------------------------
create function app.suspend_member(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_profile app.member_profiles;
  v_reason text := nullif(btrim(p_reason), '');
begin
  perform app.require_permission('members.manage');
  if v_reason is null then raise exception 'reason_required'; end if;
  if p_user = auth.uid() then raise exception 'self_action'; end if;
  select * into v_profile from app.member_profiles where user_id = p_user for update;
  if v_profile.user_id is null then raise exception 'profile_missing'; end if;
  if v_profile.status in ('suspended', 'excluded', 'deleted') then raise exception 'invalid_status'; end if;
  insert into app.sanctions (user_id, kind, reason, decided_by, previous_status)
  values (p_user, 'suspension', v_reason, auth.uid(), v_profile.status);
  update app.member_profiles set status = 'suspended' where user_id = p_user;
  insert into app.notifications (user_id, kind, payload) values (p_user, 'member.suspended', jsonb_build_object('reason', v_reason));
  perform app.audit('member.suspended', 'users', p_user, jsonb_build_object('reason', v_reason));
end $$;

-- Réactivation : retour à l'état d'avant la suspension
create function app.reactivate_member(p_user uuid) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_profile app.member_profiles;
  v_sanction app.sanctions;
begin
  perform app.require_permission('members.manage');
  select * into v_profile from app.member_profiles where user_id = p_user for update;
  if v_profile.user_id is null or v_profile.status <> 'suspended' then raise exception 'invalid_status'; end if;
  select * into v_sanction from app.sanctions
   where user_id = p_user and kind = 'suspension' and ends_at is null order by starts_at desc limit 1 for update;
  update app.sanctions set ends_at = now() where id = v_sanction.id;
  update app.member_profiles set status = coalesce(v_sanction.previous_status, 'verified') where user_id = p_user;
  insert into app.notifications (user_id, kind, payload) values (p_user, 'member.reactivated', '{}');
  perform app.audit('member.reactivated', 'users', p_user, jsonb_build_object('status', coalesce(v_sanction.previous_status, 'verified')));
end $$;

-- Exclusion : définitive
create function app.exclude_member(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_profile app.member_profiles;
  v_reason text := nullif(btrim(p_reason), '');
begin
  perform app.require_permission('members.manage');
  if v_reason is null then raise exception 'reason_required'; end if;
  if p_user = auth.uid() then raise exception 'self_action'; end if;
  select * into v_profile from app.member_profiles where user_id = p_user for update;
  if v_profile.user_id is null then raise exception 'profile_missing'; end if;
  if v_profile.status in ('excluded', 'deleted') then raise exception 'invalid_status'; end if;
  -- Une suspension en cours se termine avec l'exclusion
  update app.sanctions set ends_at = now() where user_id = p_user and kind = 'suspension' and ends_at is null;
  insert into app.sanctions (user_id, kind, reason, decided_by, previous_status)
  values (p_user, 'exclusion', v_reason, auth.uid(), v_profile.status);
  update app.member_profiles set status = 'excluded' where user_id = p_user;
  insert into app.notifications (user_id, kind, payload) values (p_user, 'member.excluded', jsonb_build_object('reason', v_reason));
  perform app.audit('member.excluded', 'users', p_user, jsonb_build_object('reason', v_reason));
end $$;

-- Blocage des soirées jusqu'à une date (null : levée du blocage)
create function app.block_member_evenings(p_user uuid, p_until timestamptz) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  perform app.require_permission('members.manage');
  if p_until is not null and p_until <= now() then raise exception 'date_in_past'; end if;
  update app.member_profiles set evenings_blocked_until = p_until where user_id = p_user;
  if not found then raise exception 'profile_missing'; end if;
  perform app.audit('member.evenings_blocked', 'users', p_user, jsonb_build_object('until', p_until));
end $$;

-- Changement de rôle : super administration seulement ; le déclencheur users_protect journalise.
-- Personne ne change son propre rôle (la super administration ne peut pas se retirer ses droits par erreur).
create function app.set_member_role(p_user uuid, p_role app.role) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.has_permission('roles.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'self_action'; end if;
  update app.users set role = p_role where id = p_user;
  if not found then raise exception 'not_found'; end if;
end $$;

grant execute on function
  app.admin_members(text, app.member_status, app.role, app.sex, integer, integer),
  app.admin_member(uuid),
  app.member_history(uuid),
  app.suspend_member(uuid, text),
  app.reactivate_member(uuid),
  app.exclude_member(uuid, text),
  app.block_member_evenings(uuid, timestamptz),
  app.set_member_role(uuid, app.role)
to authenticated, service_role;
