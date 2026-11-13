-- Menu « Discussions » (demande du 13/11/2026) : une liste façon WhatsApp de toutes les discussions
-- du membre : matchs en cours (découvertes), discussion du couple, conseiller sollicité seul, et
-- découvertes terminées RELISIBLES en lecture seule jusqu'à leur effacement (90 jours).
-- Remplace la règle de la question 14 (découverte terminée invisible). Rien d'autre ne change :
-- l'écriture reste refusée sur une discussion fermée (send_message : conversation_closed), et
-- app.conversation_member (photos, signalements, rendez-vous…) n'est PAS élargie.
-- Nécessite la mise à jour du 10/11/2026 (colonne conversations.counsel_request_id).

-- ---------------------------------------------------------------------
-- 1. Lecture : membre de la discussion, ou découverte terminée pas encore effacée
-- ---------------------------------------------------------------------
create or replace function app.conversation_reader(p_conversation uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.conversation_member(p_conversation)
      or exists (
        select 1 from app.conversations c
        join app.discoveries d on d.id = c.discovery_id
        join app.matches m on m.id = d.match_id
        where c.id = p_conversation and c.kind = 'discovery'
          and auth.uid() in (m.member_a, m.member_b)
          and d.status in ('closed', 'expired')
          and c.delete_after is not null and c.delete_after > now()
      )
$$;
revoke execute on function app.conversation_reader(uuid) from public;
grant execute on function app.conversation_reader(uuid) to authenticated, service_role;

drop policy if exists conversations_select on app.conversations;
create policy conversations_select on app.conversations for select using (
  app.conversation_reader(id) or app.counselor_reads_since(id) is not null
);
drop policy if exists messages_select on app.messages;
create policy messages_select on app.messages for select using (
  app.conversation_reader(conversation_id)
  or created_at >= app.counselor_reads_since(conversation_id)
);

-- ---------------------------------------------------------------------
-- 2. Liste des discussions du membre, la plus récente en haut
-- ---------------------------------------------------------------------
-- kind : 'discovery' (match en cours), 'discovery_ended' (lecture seule), 'couple', 'counsel'.
-- target_id : la découverte, le couple ou la demande au conseiller (pour ouvrir la bonne page).
-- title : prénom de l'autre membre, ou nom du conseiller. Jamais de décision ni de coordonnées.
create or replace function app.my_conversations()
returns table (kind text, conversation_id uuid, target_id uuid, title text, last_body text, last_is_system boolean,
               last_from_me boolean, last_at timestamptz, unread integer, read_only boolean, ends_at timestamptz,
               delete_after timestamptz)
language sql stable security definer set search_path = app, public as $$
  with mine as (
    -- Matchs en cours et découvertes terminées pas encore effacées
    select case when d.status in ('active', 'extended') then 'discovery' else 'discovery_ended' end as kind,
           c.id as conversation_id, d.id as target_id, p.first_name as title,
           case when d.status in ('active', 'extended') then d.ends_at end as ends_at
      from app.discoveries d
      join app.matches mt on mt.id = d.match_id
      join app.conversations c on c.discovery_id = d.id and c.kind = 'discovery'
      left join app.member_profiles p on p.user_id = case when mt.member_a = auth.uid() then mt.member_b else mt.member_a end
     where auth.uid() in (mt.member_a, mt.member_b)
       and (d.status in ('active', 'extended')
            or (d.status in ('closed', 'expired') and c.delete_after is not null and c.delete_after > now()))
    union all
    -- Discussion du couple
    select 'couple', c.id, cp.id, p.first_name, null::timestamptz
      from app.couples cp
      join app.conversations c on c.couple_id = cp.id and c.kind = 'couple'
      left join app.member_profiles p on p.user_id = case when cp.member_a = auth.uid() then cp.member_b else cp.member_a end
     where auth.uid() in (cp.member_a, cp.member_b) and cp.status in ('active', 'paused', 'union_celebrated')
    union all
    -- Conseiller sollicité seul (10/11/2026), discussion ouverte
    select 'counsel', c.id, c.counsel_request_id, co.display_name, null::timestamptz
      from app.conversations c
      left join app.counselors co on co.user_id = c.counselor_id
     where c.counsel_request_id is not null and c.member_id = auth.uid() and c.closed_at is null
  )
  select x.kind, x.conversation_id, x.target_id, x.title, lm.body, lm.is_system,
         lm.sender_id is not distinct from auth.uid(), lm.created_at,
         case when x.kind = 'discovery_ended' then 0 else
           (select count(*)::integer from app.messages m
             where m.conversation_id = x.conversation_id and not m.is_system and m.sender_id is distinct from auth.uid()
               and m.created_at > coalesce(r.read_at, '-infinity'::timestamptz)) end,
         c.read_only or c.closed_at is not null, x.ends_at, c.delete_after
    from mine x
    join app.conversations c on c.id = x.conversation_id
    left join app.conversation_reads r on r.conversation_id = x.conversation_id and r.user_id = auth.uid()
    left join lateral (
      select m.body, m.is_system, m.sender_id, m.created_at from app.messages m
       where m.conversation_id = x.conversation_id order by m.created_at desc limit 1
    ) lm on true
   where auth.uid() is not null
   order by (x.kind = 'discovery_ended'), coalesce(lm.created_at, c.created_at) desc
$$;
revoke execute on function app.my_conversations() from public;
grant execute on function app.my_conversations() to authenticated, service_role;
