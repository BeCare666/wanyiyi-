-- Phase 3 : conseiller du couple et blocage d'un couple (question 9, réponses de l'utilisateur
-- du 26 octobre 2026, qui remplacent l'accès direct au conseiller attribué de la migration
-- 20261026000500) :
--   - l'un OU l'autre des deux membres invite un conseiller ; un message dans le chat du couple
--     prévient l'autre, qui accepte ou refuse ; l'historique n'est visible que si les deux
--     l'acceptent ;
--   - l'administration attribue ensuite le conseiller (permission counselors.manage) ; il entre
--     alors dans le chat du couple, où il lit et écrit ;
--   - chacun des deux peut retirer le conseiller à tout moment, effet immédiat ;
--   - l'administration peut bloquer un couple (nouvelle permission couples.manage) : chat en
--     lecture seule, conseiller retiré, motif obligatoire notifié aux deux ; elle peut lever le
--     blocage.
-- Messages système du chat : is_system, body = code du message (traduit par le site),
-- sender_id = membre concerné (ou null pour l'administration).

insert into app.role_permissions (role, permission) values ('admin', 'couples.manage'), ('super_admin', 'couples.manage')
on conflict do nothing;

alter table app.counselor_access
  alter column counselor_id drop not null,
  add column accepted_at timestamptz,
  add column assigned_by uuid references app.users (id);

-- Message système dans le chat du couple. Interne.
create function app.couple_system_message(p_couple uuid, p_code text, p_sender uuid) returns void
language sql security definer set search_path = app, public as $$
  insert into app.messages (conversation_id, sender_id, body, is_system)
  select c.id, p_sender, p_code, true from app.conversations c where c.couple_id = p_couple and c.kind = 'couple'
$$;

-- ---------------------------------------------------------------------
-- 1. Invitation par l'un des deux, réponse de l'autre (dans le chat)
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
  if v_couple.status not in ('active', 'paused') then raise exception 'couple_closed'; end if;
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

-- Réponse de l'autre : acceptée, la demande attend l'attribution d'un conseiller par l'administration
create or replace function app.answer_counselor_access(p_access uuid, p_accept boolean, p_include_history boolean) returns app.access_status
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_access app.counselor_access;
  v_couple app.couples;
  v_history boolean;
begin
  select * into v_access from app.counselor_access where id = p_access for update;
  select * into v_couple from app.couples where id = v_access.couple_id;
  if not found or v_uid is null or v_uid not in (v_couple.member_a, v_couple.member_b) then raise exception 'not_member'; end if;
  if v_access.status <> 'requested' or v_access.accepted_at is not null then raise exception 'not_pending'; end if;
  if v_uid = v_access.requested_by then raise exception 'own_request'; end if;
  insert into app.counselor_access_consents (access_id, user_id, accepted, include_history)
    values (p_access, v_uid, coalesce(p_accept, false), coalesce(p_include_history, false));
  if not coalesce(p_accept, false) then
    update app.counselor_access set status = 'refused' where id = p_access;
    perform app.couple_system_message(v_couple.id, 'counselor_access.refused', v_uid);
    perform app.audit('counselor_access.refused', 'counselor_access', p_access, '{}'::jsonb);
    return 'refused';
  end if;
  -- Historique seulement si les deux l'ont accepté
  select bool_and(include_history) into v_history from app.counselor_access_consents where access_id = p_access;
  update app.counselor_access set accepted_at = now(), include_history = coalesce(v_history, false) where id = p_access;
  perform app.couple_system_message(v_couple.id, 'counselor_access.accepted', v_uid);
  perform app.audit('counselor_access.accepted', 'counselor_access', p_access, jsonb_build_object('include_history', coalesce(v_history, false)));
  return 'requested';
end $$;

-- Retrait par l'un ou l'autre, à tout moment (demande en cours comprise), effet immédiat
create or replace function app.revoke_counselor_access(p_access uuid) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_access app.counselor_access;
  v_couple app.couples;
begin
  select * into v_access from app.counselor_access where id = p_access for update;
  select * into v_couple from app.couples where id = v_access.couple_id;
  if not found or v_uid is null or v_uid not in (v_couple.member_a, v_couple.member_b) then raise exception 'not_member'; end if;
  if v_access.status not in ('requested', 'granted') then raise exception 'not_pending'; end if;
  update app.counselor_access set status = 'revoked', revoked_at = now(), revoked_by = v_uid where id = p_access;
  perform app.couple_system_message(v_couple.id, 'counselor_access.revoked', v_uid);
  perform app.audit('counselor_access.revoked', 'counselor_access', p_access, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 2. Attribution du conseiller par l'administration
-- ---------------------------------------------------------------------
-- Demandes acceptées par les deux, en attente d'un conseiller
create function app.admin_counselor_requests()
returns table (access_id uuid, couple_id uuid, accepted_at timestamptz, include_history boolean,
               a_first_name text, a_number text, b_first_name text, b_number text)
language plpgsql stable security definer set search_path = app, public as $$
begin
  if not app.has_permission('counselors.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select a.id, c.id, a.accepted_at, a.include_history, pa.first_name, ua.member_number, pb.first_name, ub.member_number
    from app.counselor_access a
    join app.couples c on c.id = a.couple_id
    join app.users ua on ua.id = c.member_a left join app.member_profiles pa on pa.user_id = c.member_a
    join app.users ub on ub.id = c.member_b left join app.member_profiles pb on pb.user_id = c.member_b
    where a.status = 'requested' and a.accepted_at is not null
    order by a.accepted_at, a.id;
end $$;

create function app.admin_assign_counselor(p_access uuid, p_counselor uuid) returns void
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
  select * into v_couple from app.couples where id = v_access.couple_id for update;
  if v_couple.blocked_at is not null then raise exception 'couple_blocked'; end if;
  select * into v_counselor from app.counselors where user_id = p_counselor;
  if not found then raise exception 'not_found'; end if;
  if not v_counselor.is_available then raise exception 'counselor_unavailable'; end if;
  if v_couple.counselor_id is distinct from p_counselor
     and (select count(*) from app.couples c where c.counselor_id = p_counselor and c.status in ('active', 'paused')) >= v_counselor.max_couples then
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

-- ---------------------------------------------------------------------
-- 3. Le conseiller écrit dans le chat du couple où il est accepté
-- ---------------------------------------------------------------------
create or replace function app.send_message(p_conversation uuid, p_body text) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_conversation app.conversations;
  v_body text := btrim(coalesce(p_body, ''));
  v_issues text[];
  v_id uuid;
begin
  select * into v_conversation from app.conversations where id = p_conversation;
  if not found or v_uid is null
     or not (app.conversation_member(p_conversation) or app.counselor_reads_since(p_conversation) is not null) then
    raise exception 'not_member';
  end if;
  if v_conversation.closed_at is not null or v_conversation.read_only then raise exception 'conversation_closed'; end if;
  if char_length(v_body) not between 1 and 2000 then raise exception 'invalid_body'; end if;
  v_issues := array(select i from unnest(app.text_contact_issues(v_body)) i where i in ('email', 'link', 'phone'));
  if cardinality(v_issues) > 0 then
    raise exception 'contact_blocked' using errcode = 'check_violation', detail = array_to_string(v_issues, ',');
  end if;
  insert into app.messages (conversation_id, sender_id, body) values (p_conversation, v_uid, v_body) returning id into v_id;
  if v_conversation.kind = 'couple' then
    update app.couples set last_activity_at = now() where id = v_conversation.couple_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 4. Blocage d'un couple par l'administration
-- ---------------------------------------------------------------------
create function app.admin_block_couple(p_couple uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public as $$
declare
  v_couple app.couples;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not app.has_permission('couples.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_reason is null then raise exception 'reason_required'; end if;
  if char_length(v_reason) > 1000 then raise exception 'reason_too_long'; end if;
  select * into v_couple from app.couples where id = p_couple for update;
  if not found then raise exception 'not_found'; end if;
  if v_couple.blocked_at is not null then raise exception 'already_blocked'; end if;
  update app.couples set blocked_at = now(), blocked_reason = v_reason, blocked_by = auth.uid() where id = p_couple;
  update app.conversations set read_only = true where couple_id = p_couple and kind = 'couple';
  update app.counselor_access set status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
   where couple_id = p_couple and status in ('requested', 'granted');
  perform app.couple_system_message(p_couple, 'couple.blocked', null);
  perform app.notify_with_deliveries(v_couple.member_a, 'couple.blocked', jsonb_build_object('reason', v_reason));
  perform app.notify_with_deliveries(v_couple.member_b, 'couple.blocked', jsonb_build_object('reason', v_reason));
  perform app.audit('couple.blocked', 'couples', p_couple, jsonb_build_object('reason', v_reason));
end $$;

create function app.admin_unblock_couple(p_couple uuid) returns void
language plpgsql security definer set search_path = app, public as $$
declare v_couple app.couples;
begin
  if not app.has_permission('couples.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_couple from app.couples where id = p_couple for update;
  if not found then raise exception 'not_found'; end if;
  if v_couple.blocked_at is null then raise exception 'not_blocked'; end if;
  update app.couples set blocked_at = null, blocked_reason = null, blocked_by = null where id = p_couple;
  update app.conversations set read_only = false where couple_id = p_couple and kind = 'couple' and closed_at is null;
  perform app.couple_system_message(p_couple, 'couple.unblocked', null);
  perform app.notify_with_deliveries(v_couple.member_a, 'couple.unblocked', '{}'::jsonb);
  perform app.notify_with_deliveries(v_couple.member_b, 'couple.unblocked', '{}'::jsonb);
  perform app.audit('couple.unblocked', 'couples', p_couple, '{}'::jsonb);
end $$;

revoke execute on function app.couple_system_message(uuid, text, uuid) from public;
grant execute on function
  app.admin_counselor_requests(),
  app.admin_assign_counselor(uuid, uuid),
  app.admin_block_couple(uuid, text),
  app.admin_unblock_couple(uuid)
to authenticated, service_role;
