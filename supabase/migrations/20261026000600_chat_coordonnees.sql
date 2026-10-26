-- Phase 3, étape 3 (suite) : questions 1 et 8, réponses du 26 octobre 2026.
--   - Messages texte seulement (aucun média).
--   - Liens, adresses e-mail et numéros de téléphone (y compris écrits en lettres ou avec des
--     espaces) bloqués dans toutes les conversations, par le même filtre que les textes du
--     profil (app.text_contact_issues) ; les pseudos de réseaux sociaux ne sont pas cités dans
--     la réponse et restent permis. Le numéro se partage par le bouton du couple (9.5).
--   Refus « contact_blocked », détail : codes trouvés (email, link, phone).

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
  if not found or v_uid is null or not app.conversation_member(p_conversation) then raise exception 'not_member'; end if;
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
