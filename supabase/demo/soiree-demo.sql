-- =====================================================================
-- Soirée de démonstration (étape 6 de PHASE2.txt, question 31 du 22 octobre 2026) :
-- une soirée 10 × 10 jouée de bout en bout avec les 24 membres de démonstration
-- (membres-demo.sql) : réservation, liste d'attente, paiement simulé, confirmation,
-- pointage, 10 tours, votes, matchs.
--   - chaque étape passe par les fonctions de la plateforme, au nom du membre ou de
--     l'équipe, comme le site et l'API ;
--   - les actions de l'équipe sont faites au nom du premier compte super administrateur
--     (journalisées à son nom) ;
--   - lieu fictif « Lieu de démonstration (fictif) » ; paiements « de démonstration »
--     (aucun argent) ; aucun e-mail : les adresses de démonstration ne sont pas confirmées ;
--   - les matchs sont annoncés le lendemain à 8 h (heure de Cotonou) par la tâche
--     planifiée de l'API, comme pour une vraie soirée ;
--   - supprimée avec les membres par supprimer-membres-demo.sql.
-- Le temps ne pouvant pas avancer dans un script, la soirée est créée dans 3 jours,
-- réservée et confirmée, puis avancée à « il y a 10 minutes » pour être jouée.
-- À exécuter dans Supabase > SQL Editor, après membres-demo.sql. Tout ou rien.
-- =====================================================================

begin;

do $$
declare
  v_admin uuid;
  v_venue uuid;
  v_event uuid;
  v_qr text;
  v_women uuid[];
  v_men uuid[];
  v_user uuid;
  v_payment uuid;
  v_target uuid;
  v_i integer;
  v_yes boolean;
  v_matches integer;
begin
  select array_agg(u.id order by u.email) into v_women
    from auth.users u join app.member_profiles p on p.user_id = u.id
   where u.email like 'demo-f%@demo.ifedele.invalid';
  select array_agg(u.id order by u.email) into v_men
    from auth.users u join app.member_profiles p on p.user_id = u.id
   where u.email like 'demo-h%@demo.ifedele.invalid';
  if coalesce(array_length(v_women, 1), 0) <> 12 or coalesce(array_length(v_men, 1), 0) <> 12 then
    raise exception 'Il faut les 24 membres de démonstration : exécuter d''abord membres-demo.sql';
  end if;
  if exists (select 1 from app.venues where name = 'Lieu de démonstration (fictif)') then
    raise exception 'Soirée de démonstration déjà présente : exécuter d''abord supprimer-membres-demo.sql';
  end if;
  select id into v_admin from app.users where role = 'super_admin' order by created_at limit 1;
  if v_admin is null then
    raise exception 'Aucun compte super administrateur (étape 11 de GUIDE-SUPABASE.txt)';
  end if;

  -- Chaque appel est fait au nom d'une personne : jeton simulé (request.jwt.claims), lu par auth.uid()

  -- 1. L'équipe crée la soirée (10 000 FCFA, lieu fictif) et la publie
  insert into app.venues (name, address, city, is_partner)
  values ('Lieu de démonstration (fictif)', 'Adresse fictive, Cotonou', 'Cotonou', true)
  returning id into v_venue;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_event := app.save_event(null, v_venue, null, now() + interval '3 days', 10::smallint, 10::smallint, 7::smallint, 1::smallint, 10000);
  perform app.publish_event(v_event);

  -- 2. Réservations : 10 places par sexe, les 2 suivants en liste d'attente
  for v_i in 1..12 loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_women[v_i], 'role', 'authenticated')::text, true);
    perform app.book_event(v_event);
    perform set_config('request.jwt.claims', json_build_object('sub', v_men[v_i], 'role', 'authenticated')::text, true);
    perform app.book_event(v_event);
  end loop;

  -- 3. Deux annulations : la place va au premier en attente du même sexe
  perform set_config('request.jwt.claims', json_build_object('sub', v_women[4], 'role', 'authenticated')::text, true);
  perform app.cancel_registration(v_event);
  perform set_config('request.jwt.claims', json_build_object('sub', v_men[6], 'role', 'authenticated')::text, true);
  perform app.cancel_registration(v_event);

  -- 4. Paiement simulé (comme l'API) puis confirmation des 20 places
  for v_user in select user_id from app.event_registrations where event_id = v_event and status = 'booked' order by user_id loop
    insert into app.payments (user_id, purpose, amount_xof, provider, status)
    values (v_user, 'evening_booking', 10000, 'simulated', 'pending') returning id into v_payment;
    update app.payments set provider_transaction_id = 'sim_' || v_payment where id = v_payment;
    update app.event_registrations set payment_id = v_payment where event_id = v_event and user_id = v_user;
    update app.payments set status = 'succeeded' where id = v_payment;
    insert into app.audit_log (actor_id, action, target_table, target_id) values (v_user, 'payment.simulated_succeeded', 'payments', v_payment);
    perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    perform app.confirm_registration(v_event);
  end loop;

  -- 5. Le soir venu : la soirée commence (il y a 10 minutes), pointage, préparation, début
  update app.events set starts_at = now() - interval '10 minutes' where id = v_event;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  for v_user in select user_id from app.event_registrations where event_id = v_event and status = 'confirmed' order by user_id loop
    perform app.check_in(v_event, v_user);
  end loop;
  perform app.prepare_evening(v_event);
  perform app.start_evening(v_event);
  select qr_token into v_qr from app.event_tables where event_id = v_event and table_number = 1;

  -- 6. 10 tours de votes par code QR. Règle de la démonstration : la femme n° i dit oui à
  --    l'homme n° j si (i + j) est multiple de 4, l'homme si (i + j) est pair.
  for v_i in 1..10 loop
    for v_user in select user_id from app.event_registrations where event_id = v_event and status = 'checked_in' loop
      perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
      select target_id into v_target from app.voting_pairing(v_qr, v_i::smallint);
      if v_user = any (v_women) then
        v_yes := (array_position(v_women, v_user) + array_position(v_men, v_target)) % 4 = 0;
      else
        v_yes := (array_position(v_women, v_target) + array_position(v_men, v_user)) % 2 = 0;
      end if;
      perform app.cast_vote(v_qr, v_i::smallint, case when v_yes then 'yes' else 'no' end::app.vote_choice);
    end loop;
  end loop;

  -- 7. Fin de soirée et calcul des matchs (annoncés le lendemain à 8 h)
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform app.finish_evening(v_event);
  v_matches := app.compute_matches(v_event);
  perform set_config('request.jwt.claims', '', true);
  raise notice 'Soirée de démonstration % : % matchs, annoncés le %', v_event, v_matches,
    (select app.match_announcement_at(starts_at) from app.events where id = v_event);
end $$;

commit;

select e.id as soiree, e.status, e.price_xof,
       (select count(*) from app.event_registrations r where r.event_id = e.id and r.status = 'checked_in') as presents,
       (select count(*) from app.waitlist_entries w where w.event_id = e.id) as en_attente,
       (select count(*) from app.votes v join app.round_pairings p on p.id = v.pairing_id join app.rounds r on r.id = p.round_id where r.event_id = e.id) as votes,
       (select count(*) from app.matches m where m.event_id = e.id) as matchs
from app.events e join app.venues l on l.id = e.venue_id
where l.name = 'Lieu de démonstration (fictif)';
