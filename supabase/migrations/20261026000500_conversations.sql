-- Phase 3, étape 3 : conversations et accès du conseiller (sections 9.4 à 9.6, question 1 :
-- Supabase Realtime). Règles de packages/domain/src/counselor.ts :
--   - découverte : les deux membres du match ; couple : les deux membres du couple ;
--     canal privé : le membre et son conseiller, qui ne voit que ce que le membre lui écrit ;
--   - le conseiller ne lit le chat du couple qu'avec l'accord des deux (vérifié ici, en RLS) :
--     demande de l'un (qui vaut accord), acceptation de l'autre ; lecture à partir de
--     l'acceptation, l'historique seulement si les deux l'ont coché ; retrait par l'un ou
--     l'autre à tout moment, effet immédiat ;
--   - envoi par fonction seulement : conversation ouverte et non en lecture seule, texte de
--     1 à 2 000 caractères ; un message du couple compte comme activité.
-- En attente : médias (question 1), coordonnées dans le chat (question 8), lecture d'une
-- découverte fermée (question 14), conservation après la fin du couple (question 7),
-- médiation à trois (question 9 d), messages signalés (étape 7).

-- ---------------------------------------------------------------------
-- 1. Qui participe à une conversation
-- ---------------------------------------------------------------------
-- Toujours pour la personne connectée : aucune question possible sur un autre membre
create function app.conversation_member(p_conversation uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.conversations c
    left join app.discoveries d on d.id = c.discovery_id
    left join app.matches m on m.id = d.match_id
    left join app.couples cp on cp.id = c.couple_id
    where c.id = p_conversation
      and (
        (c.kind = 'discovery' and auth.uid() in (m.member_a, m.member_b))
        or (c.kind = 'couple' and auth.uid() in (cp.member_a, cp.member_b))
        or (c.kind = 'counselor_private' and auth.uid() in (c.member_id, c.counselor_id))
      )
  )
$$;

-- Accès accordé au conseiller sur le chat d'un couple : date à partir de laquelle il lit
-- (-infinity : tout l'historique), ou null s'il n'a pas accès
create function app.counselor_reads_since(p_conversation uuid) returns timestamptz
language sql stable security definer set search_path = app, public as $$
  select case when a.include_history then '-infinity'::timestamptz else a.granted_at end
  from app.conversations c
  join app.counselor_access a on a.couple_id = c.couple_id and a.status = 'granted'
  where c.id = p_conversation and c.kind = 'couple' and a.counselor_id = auth.uid()
  order by a.granted_at desc
  limit 1
$$;

create policy conversations_select on app.conversations for select using (
  app.conversation_member(id) or app.counselor_reads_since(id) is not null
);
create policy messages_select on app.messages for select using (
  app.conversation_member(conversation_id)
  or created_at >= app.counselor_reads_since(conversation_id)
);
create policy counselor_access_select on app.counselor_access for select using (
  counselor_id = auth.uid()
  or exists (select 1 from app.couples c where c.id = couple_id and auth.uid() in (c.member_a, c.member_b))
);
create policy counselor_access_consents_select on app.counselor_access_consents for select using (
  exists (
    select 1 from app.counselor_access a join app.couples c on c.id = a.couple_id
    where a.id = access_id and (auth.uid() in (c.member_a, c.member_b) or a.counselor_id = auth.uid())
  )
);

-- ---------------------------------------------------------------------
-- 2. Envoi d'un message
-- ---------------------------------------------------------------------
create function app.send_message(p_conversation uuid, p_body text) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_conversation app.conversations;
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  select * into v_conversation from app.conversations where id = p_conversation;
  if not found or v_uid is null or not app.conversation_member(p_conversation) then raise exception 'not_member'; end if;
  if v_conversation.closed_at is not null or v_conversation.read_only then raise exception 'conversation_closed'; end if;
  if char_length(v_body) not between 1 and 2000 then raise exception 'invalid_body'; end if;
  insert into app.messages (conversation_id, sender_id, body) values (p_conversation, v_uid, v_body) returning id into v_id;
  if v_conversation.kind = 'couple' then
    update app.couples set last_activity_at = now() where id = v_conversation.couple_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 3. Accès du conseiller au chat du couple (9.6)
-- ---------------------------------------------------------------------
-- Demande par l'un des deux ; vaut son propre accord. Conseiller du couple seulement.
create function app.request_counselor_access(p_couple uuid, p_include_history boolean) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_uid uuid := auth.uid();
  v_couple app.couples;
  v_id uuid;
begin
  select * into v_couple from app.couples where id = p_couple for update;
  if not found or v_uid is null or v_uid not in (v_couple.member_a, v_couple.member_b) then raise exception 'not_member'; end if;
  if v_couple.status not in ('active', 'paused') then raise exception 'couple_closed'; end if;
  if v_couple.counselor_id is null then raise exception 'no_counselor'; end if;
  if exists (select 1 from app.counselor_access a where a.couple_id = p_couple and a.status in ('requested', 'granted')) then
    raise exception 'access_pending';
  end if;
  insert into app.counselor_access (couple_id, counselor_id, requested_by) values (p_couple, v_couple.counselor_id, v_uid)
    returning id into v_id;
  insert into app.counselor_access_consents (access_id, user_id, accepted, include_history)
    values (v_id, v_uid, true, coalesce(p_include_history, false));
  perform app.notify_with_deliveries(
    case when v_uid = v_couple.member_a then v_couple.member_b else v_couple.member_a end,
    'counselor_access.requested', jsonb_build_object('couple_id', p_couple));
  perform app.audit('counselor_access.requested', 'counselor_access', v_id, '{}'::jsonb);
  return v_id;
end $$;

-- Réponse de l'autre membre : l'accès n'est accordé qu'avec son accord
create function app.answer_counselor_access(p_access uuid, p_accept boolean, p_include_history boolean) returns app.access_status
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
  if v_access.status <> 'requested' then raise exception 'not_pending'; end if;
  if v_uid = v_access.requested_by then raise exception 'own_request'; end if;
  insert into app.counselor_access_consents (access_id, user_id, accepted, include_history)
    values (p_access, v_uid, coalesce(p_accept, false), coalesce(p_include_history, false));
  if not coalesce(p_accept, false) then
    update app.counselor_access set status = 'refused' where id = p_access;
    perform app.audit('counselor_access.refused', 'counselor_access', p_access, '{}'::jsonb);
    return 'refused';
  end if;
  -- Historique seulement si les deux l'ont coché
  select bool_and(include_history) into v_history from app.counselor_access_consents where access_id = p_access;
  update app.counselor_access set status = 'granted', granted_at = now(), include_history = coalesce(v_history, false) where id = p_access;
  perform app.notify_with_deliveries(v_access.counselor_id, 'counselor_access.granted', jsonb_build_object('couple_id', v_couple.id));
  perform app.audit('counselor_access.granted', 'counselor_access', p_access, jsonb_build_object('include_history', coalesce(v_history, false)));
  return 'granted';
end $$;

-- Retrait par l'un ou l'autre, à tout moment, effet immédiat (demande en cours comprise)
create function app.revoke_counselor_access(p_access uuid) returns void
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
  perform app.audit('counselor_access.revoked', 'counselor_access', p_access, '{}'::jsonb);
end $$;

-- Bannière permanente dans le chat tant que le conseiller y a accès
create function app.counselor_has_access(p_conversation uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.conversations c join app.counselor_access a on a.couple_id = c.couple_id
    where c.id = p_conversation and a.status = 'granted' and app.conversation_member(p_conversation)
  )
$$;

-- ---------------------------------------------------------------------
-- 4. Temps réel (question 1) : messages diffusés par Supabase Realtime, sous la RLS
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table app.messages;
  end if;
end $$;

revoke execute on function app.conversation_member(uuid), app.counselor_reads_since(uuid) from public;
grant execute on function
  app.conversation_member(uuid),
  app.counselor_reads_since(uuid),
  app.send_message(uuid, text),
  app.request_counselor_access(uuid, boolean),
  app.answer_counselor_access(uuid, boolean, boolean),
  app.revoke_counselor_access(uuid),
  app.counselor_has_access(uuid)
to authenticated, service_role;
