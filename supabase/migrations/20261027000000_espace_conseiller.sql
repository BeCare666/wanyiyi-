-- Phase 3, étape 6 : espace conseiller (section 7), partie déjà décidée (question 9) :
--   - couples suivis : ceux où l'administration l'a désigné et où l'accès est en cours (accordé) ;
--     prénoms des deux membres seulement ;
--   - conversation du couple : lecture depuis son arrivée (ou tout l'historique si les deux l'ont
--     accepté) et écriture, déjà réglées par app.counselor_reads_since et app.send_message ;
--   - notes privées : écrites et lues par le conseiller seul, jamais par les membres, et seulement
--     tant que son accès au couple est en cours (retrait immédiat, 9.6).
-- Restent ouverts : séances (question 9 c), canal privé (avec quel conseiller), étapes (question 16).

-- ---------------------------------------------------------------------
-- 1. Couples suivis
-- ---------------------------------------------------------------------
-- Accès en cours du conseiller connecté à ce couple (sinon null)
create function app.my_counselor_access(p_couple uuid) returns uuid
language sql stable security definer set search_path = app, public as $$
  select a.id from app.counselor_access a
  where a.couple_id = p_couple and a.counselor_id = auth.uid() and a.status = 'granted'
  order by a.granted_at desc limit 1
$$;

create function app.counselor_couples()
returns table (couple_id uuid, conversation_id uuid, member_a uuid, a_first_name text, member_b uuid, b_first_name text, status app.couple_status,
               blocked boolean, granted_at timestamptz, include_history boolean, last_activity_at timestamptz, unread integer)
language sql stable security definer set search_path = app, public as $$
  select c.id, cv.id, c.member_a, pa.first_name, c.member_b, pb.first_name, c.status, c.blocked_at is not null, a.granted_at, a.include_history,
         c.last_activity_at,
         (select count(*)::integer from app.messages m
           where m.conversation_id = cv.id and not m.is_system and m.sender_id is distinct from auth.uid()
             and m.created_at >= case when a.include_history then '-infinity'::timestamptz else a.granted_at end
             and m.created_at > coalesce((select r.read_at from app.conversation_reads r
                                           where r.conversation_id = cv.id and r.user_id = auth.uid()), '-infinity'::timestamptz))
  from app.counselor_access a
  join app.couples c on c.id = a.couple_id
  left join app.conversations cv on cv.couple_id = c.id and cv.kind = 'couple'
  left join app.member_profiles pa on pa.user_id = c.member_a
  left join app.member_profiles pb on pb.user_id = c.member_b
  where a.counselor_id = auth.uid() and a.status = 'granted'
  order by a.granted_at desc
$$;

-- Lecture marquée aussi pour le conseiller qui a accès à la conversation du couple
create or replace function app.mark_conversation_read(p_conversation uuid) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if auth.uid() is null
     or not (app.conversation_member(p_conversation) or app.counselor_reads_since(p_conversation) is not null) then
    raise exception 'not_member';
  end if;
  insert into app.conversation_reads (conversation_id, user_id) values (p_conversation, auth.uid())
  on conflict (conversation_id, user_id) do update set read_at = now();
end $$;

-- ---------------------------------------------------------------------
-- 2. Notes privées du conseiller (jamais visibles par les membres)
-- ---------------------------------------------------------------------
-- Aucune politique : la table n'est lue et écrite que par les fonctions ci-dessous.
create function app.add_counselor_note(p_couple uuid, p_body text) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if app.my_counselor_access(p_couple) is null then raise exception 'not_counselor'; end if;
  if char_length(v_body) not between 1 and 4000 then raise exception 'invalid_body'; end if;
  insert into app.counselor_notes (counselor_id, couple_id, body) values (auth.uid(), p_couple, v_body) returning id into v_id;
  return v_id;
end $$;

create function app.counselor_couple_notes(p_couple uuid)
returns table (id uuid, body text, created_at timestamptz)
language sql stable security definer set search_path = app, public as $$
  select n.id, n.body, n.created_at from app.counselor_notes n
  where n.couple_id = p_couple and n.counselor_id = auth.uid() and app.my_counselor_access(p_couple) is not null
  order by n.created_at desc
$$;

grant execute on function
  app.my_counselor_access(uuid),
  app.counselor_couples(),
  app.add_counselor_note(uuid, text),
  app.counselor_couple_notes(uuid)
to authenticated, service_role;
