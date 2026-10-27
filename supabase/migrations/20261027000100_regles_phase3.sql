-- Phase 3 : règles validées par l'utilisateur le 27 octobre 2026 (propositions de
-- propositions/PROPOSITIONS-QUESTIONS-PHASE3.txt, questions 3, 13, 14, 15, 17 et 18).
--   - 3 : la prolongation ne se demande que pendant les 4 derniers jours de la découverte.
--   - 13 : quand un couple se forme, les autres matchs encore en attente de ses deux membres
--     expirent aussitôt, avec le message neutre aux deux personnes de chaque match.
--   - 14 : une découverte terminée (fermée ou arrivée à échéance) n'est plus lisible par les deux ;
--     sa conversation est gardée 90 jours pour la modération, puis effacée. Une découverte devenue
--     couple reste lisible (dans l'espace du couple).
--   - 15 : photos visibles seulement pendant le match en attente, la découverte ouverte, le couple
--     en cours ou en pause, et après l'union ; plus après une fin.
--   - 17 : chacun peut retirer le partage de son numéro ; les numéros restent affichés après l'union.
--   - 18 : notes privées du conseiller effacées 90 jours après son retrait ou la fin du couple ;
--     lisibles par l'administration en cas de litige (couples.manage), chaque lecture journalisée.

-- ---------------------------------------------------------------------
-- 1. Question 3 : prolongation pendant les 4 derniers jours
-- ---------------------------------------------------------------------
create or replace function app.decide_discovery(p_discovery uuid, p_continue boolean, p_extension boolean) returns text
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_discovery app.discoveries;
  v_match app.matches;
  v_continue integer;
  v_extend integer;
  v_couple uuid;
  v_other uuid;
  v_asked boolean;
begin
  select * into v_discovery from app.discoveries where id = p_discovery for update;
  select * into v_match from app.matches where id = v_discovery.match_id;
  if not found or v_uid is null or v_uid not in (v_match.member_a, v_match.member_b) then raise exception 'not_member'; end if;
  if v_discovery.status not in ('active', 'extended') or now() >= v_discovery.ends_at then raise exception 'not_active'; end if;

  -- Nouvelle demande de prolongation : seulement les 4 derniers jours, et une seule fois
  select coalesce(wants_extension, false) into v_asked from app.discovery_decisions where discovery_id = p_discovery and user_id = v_uid;
  if coalesce(p_extension, false) and not coalesce(v_asked, false) then
    if v_discovery.extended then raise exception 'already_extended'; end if;
    if now() < v_discovery.ends_at - interval '4 days' then raise exception 'extension_too_early'; end if;
  end if;

  insert into app.discovery_decisions (discovery_id, user_id, wants_to_continue, wants_extension, updated_at)
  values (p_discovery, v_uid, coalesce(p_continue, false), coalesce(p_extension, false), now())
  on conflict (discovery_id, user_id) do update
    set wants_to_continue = excluded.wants_to_continue, wants_extension = excluded.wants_extension, updated_at = now();

  select count(*) filter (where wants_to_continue), count(*) filter (where wants_extension)
    into v_continue, v_extend
  from app.discovery_decisions where discovery_id = p_discovery;

  -- Les deux veulent continuer : espace du couple, exclusivité, autres découvertes fermées
  if v_continue = 2 then
    update app.discoveries set status = 'continued', closed_at = now() where id = p_discovery;
    update app.conversations set closed_at = now() where discovery_id = p_discovery and closed_at is null;
    insert into app.couples (discovery_id, member_a, member_b) values (p_discovery, v_match.member_a, v_match.member_b)
      returning id into v_couple;
    insert into app.conversations (kind, couple_id) values ('couple', v_couple);
    for v_other in
      select d.id from app.discoveries d join app.matches m on m.id = d.match_id
      where d.id <> p_discovery and d.status in ('active', 'extended')
        and (m.member_a in (v_match.member_a, v_match.member_b) or m.member_b in (v_match.member_a, v_match.member_b))
    loop
      perform app.close_discovery(v_other, 'closed');
    end loop;
    perform app.notify_with_deliveries(v_match.member_a, 'couple.opened', jsonb_build_object('couple_id', v_couple));
    perform app.notify_with_deliveries(v_match.member_b, 'couple.opened', jsonb_build_object('couple_id', v_couple));
    perform app.audit('couple.opened', 'couples', v_couple, jsonb_build_object('discovery_id', p_discovery));
    return 'couple';
  end if;

  if v_extend = 2 and not v_discovery.extended then
    update app.discoveries set extended = true, status = 'extended', ends_at = ends_at + interval '7 days' where id = p_discovery;
    update app.discovery_decisions set wants_extension = false where discovery_id = p_discovery;
    perform app.notify_with_deliveries(v_match.member_a, 'discovery.extended', jsonb_build_object('discovery_id', p_discovery));
    perform app.notify_with_deliveries(v_match.member_b, 'discovery.extended', jsonb_build_object('discovery_id', p_discovery));
    perform app.audit('discovery.extended', 'discoveries', p_discovery, '{}'::jsonb);
    return 'extended';
  end if;
  return 'recorded';
end $$;

-- ---------------------------------------------------------------------
-- 2. Question 13 : couple formé, matchs en attente des deux expirés aussitôt
-- ---------------------------------------------------------------------
create function app.expire_pending_matches_on_couple() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare v_match app.matches;
begin
  for v_match in
    select * from app.matches
    where status = 'pending_choice'
      and (member_a in (new.member_a, new.member_b) or member_b in (new.member_a, new.member_b))
    for update
  loop
    update app.matches set status = 'expired' where id = v_match.id;
    if v_match.notified_at is not null then
      perform app.notify_with_deliveries(v_match.member_a, 'match.expired', jsonb_build_object('match_id', v_match.id));
      perform app.notify_with_deliveries(v_match.member_b, 'match.expired', jsonb_build_object('match_id', v_match.id));
    end if;
    perform app.audit('match.expired_by_couple', 'matches', v_match.id, jsonb_build_object('couple_id', new.id));
  end loop;
  return new;
end $$;
create trigger couples_expire_pending_matches after insert on app.couples
  for each row execute function app.expire_pending_matches_on_couple();

-- ---------------------------------------------------------------------
-- 3. Question 14 : découverte terminée, conversation invisible, effacée après 90 jours
-- ---------------------------------------------------------------------
create function app.discovery_conversation_retention() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if new.status in ('closed', 'expired') and old.status is distinct from new.status then
    update app.conversations
       set closed_at = coalesce(closed_at, now()), read_only = true, delete_after = coalesce(delete_after, now() + interval '90 days')
     where discovery_id = new.id;
  end if;
  return new;
end $$;
create trigger discoveries_conversation_retention after update of status on app.discoveries
  for each row execute function app.discovery_conversation_retention();

-- Découvertes déjà terminées avant cette mise à jour : même règle
update app.conversations c
   set closed_at = coalesce(c.closed_at, now()), read_only = true, delete_after = coalesce(c.delete_after, now() + interval '90 days')
  from app.discoveries d
 where c.discovery_id = d.id and d.status in ('closed', 'expired');

create or replace function app.conversation_member(p_conversation uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.conversations c
    left join app.discoveries d on d.id = c.discovery_id
    left join app.matches m on m.id = d.match_id
    left join app.couples cp on cp.id = c.couple_id
    where c.id = p_conversation
      and (
        (c.kind = 'discovery' and auth.uid() in (m.member_a, m.member_b) and d.status in ('active', 'extended', 'continued'))
        or (c.kind = 'couple' and auth.uid() in (cp.member_a, cp.member_b) and cp.status in ('active', 'paused', 'union_celebrated'))
        or (c.kind = 'counselor_private' and auth.uid() in (c.member_id, c.counselor_id))
      )
  )
$$;

-- ---------------------------------------------------------------------
-- 4. Question 15 : photos (le match d'un couple ne les montre plus après la fin du couple)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 5. Question 17 : retrait du partage ; numéros affichés après l'union
-- ---------------------------------------------------------------------
create function app.unshare_my_phone(p_couple uuid) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if not exists (select 1 from app.couples c where c.id = p_couple and auth.uid() in (c.member_a, c.member_b)) then
    raise exception 'not_member';
  end if;
  delete from app.phone_shares where couple_id = p_couple and user_id = auth.uid();
  perform app.audit('couple.phone_unshared', 'couples', p_couple, '{}'::jsonb);
end $$;

create or replace function app.my_couple_phone(p_couple uuid)
returns table (i_shared boolean, can_share boolean, partner_phone text)
language sql stable security definer set search_path = app, public as $$
  select
    exists (select 1 from app.phone_shares s where s.couple_id = c.id and s.user_id = auth.uid()),
    coalesce(me.share_phone, false) and u.phone is not null,
    case when c.status in ('active', 'paused', 'union_celebrated') and c.blocked_at is null
          and (select count(*) from app.phone_shares s where s.couple_id = c.id and s.user_id in (c.member_a, c.member_b)) = 2
         then (select o.phone from app.users o where o.id = case when c.member_a = auth.uid() then c.member_b else c.member_a end)
    end
  from app.couples c
  join app.users u on u.id = auth.uid()
  left join app.member_profiles me on me.user_id = auth.uid()
  where c.id = p_couple and auth.uid() in (c.member_a, c.member_b)
$$;

-- ---------------------------------------------------------------------
-- 6. Question 18 : notes du conseiller effacées après 90 jours ; lecture par l'administration
-- ---------------------------------------------------------------------
-- Fin de l'accès d'un conseiller à un couple : dernier retrait, ou fin du couple
create function app.counselor_notes_expired(p_counselor uuid, p_couple uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select not exists (
           select 1 from app.counselor_access a
           where a.couple_id = p_couple and a.counselor_id = p_counselor and a.status = 'granted'
             and not exists (select 1 from app.couples c where c.id = p_couple and c.ended_at is not null)
         )
     and coalesce(
           greatest(
             (select max(a.revoked_at) from app.counselor_access a where a.couple_id = p_couple and a.counselor_id = p_counselor),
             (select c.ended_at from app.couples c where c.id = p_couple)
           ),
           'infinity'::timestamptz
         ) <= now() - interval '90 days'
$$;

create or replace function app.purge_conversations() returns integer
language plpgsql security definer set search_path = app, public as $$
declare
  v_count integer;
  v_notes integer;
begin
  perform app.require_permission('couples.manage');
  delete from app.messages m using app.conversations c
   where m.conversation_id = c.id and c.delete_after is not null and c.delete_after <= now();
  get diagnostics v_count = row_count;
  update app.conversations set delete_after = null where delete_after is not null and delete_after <= now();
  if v_count > 0 then perform app.audit('conversations.purged', 'messages', null, jsonb_build_object('messages', v_count)); end if;
  delete from app.counselor_notes n where n.couple_id is not null and app.counselor_notes_expired(n.counselor_id, n.couple_id);
  get diagnostics v_notes = row_count;
  if v_notes > 0 then perform app.audit('counselor_notes.purged', 'counselor_notes', null, jsonb_build_object('notes', v_notes)); end if;
  return v_count + v_notes;
end $$;

-- Lecture des notes d'un couple par l'administration (litige, signalement), journalisée
create function app.admin_counselor_notes(p_couple uuid)
returns table (id uuid, counselor_name text, body text, created_at timestamptz)
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.has_permission('couples.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app.audit('counselor_notes.read', 'couples', p_couple, '{}'::jsonb);
  return query
    select n.id, co.display_name, n.body, n.created_at
    from app.counselor_notes n left join app.counselors co on co.user_id = n.counselor_id
    where n.couple_id = p_couple
    order by n.created_at desc;
end $$;

revoke execute on function app.counselor_notes_expired(uuid, uuid) from public;
grant execute on function
  app.unshare_my_phone(uuid),
  app.admin_counselor_notes(uuid)
to authenticated, service_role;
