-- =====================================================================
-- Parcours de démonstration des phases 3 et 4, après la soirée de démonstration (soiree-demo.sql) :
-- deux membres de démonstration qui ont un match ouvrent leur découverte, échangent quelques
-- messages, forment un couple, franchissent les étapes jusqu'à « Dot ou mariage », ouvrent une
-- cagnotte (proposée par l'une, acceptée par l'autre), contactent un prestataire, puis déclarent
-- leur union : l'espace du couple devient l'espace souvenir.
--   - chaque étape passe par les fonctions de la plateforme, au nom du membre (jeton simulé) ;
--     l'action de l'équipe (relecture de la photo de l'union) est faite au nom du premier compte
--     super administrateur, comme dans soiree-demo.sql ;
--   - aucun paiement : la cagnotte reste à 0 FCFA (pas de contribution simulée en production) ;
--   - photo de l'union : seulement si le fichier <membre>/union-demo.jpg a été déposé avant dans
--     le compartiment « member-photos » (sinon l'étape est sautée) ;
--   - numéro de reversement fictif ; tout est supprimé par supprimer-membres-demo.sql.
-- À exécuter dans Supabase > SQL Editor, après membres-demo.sql et soiree-demo.sql, une fois les
-- matchs annoncés (le lendemain de la soirée à 8 h). Tout ou rien.
-- =====================================================================

begin;

do $$
declare
  v_admin uuid;
  v_match app.matches;
  v_woman uuid;
  v_man uuid;
  v_discovery uuid;
  v_conversation uuid;
  v_couple uuid;
  v_cagnotte uuid;
  v_kind app.milestone_kind;
  v_photo uuid;
  v_path text;
  v_provider uuid;
begin
  select id into v_admin from app.users where role = 'super_admin' order by created_at limit 1;
  if v_admin is null then raise exception 'Aucun compte super administrateur (étape 11 de GUIDE-SUPABASE.txt)'; end if;
  if exists (select 1 from app.couples c join auth.users a on a.id = c.member_a where a.email like '%@demo.ifedele.invalid') then
    raise exception 'Parcours de démonstration déjà joué : exécuter d''abord supprimer-membres-demo.sql';
  end if;

  -- Un match annoncé entre une femme et un homme de démonstration
  select m.* into v_match
    from app.matches m
    join auth.users a on a.id = m.member_a
    join auth.users b on b.id = m.member_b
   where m.status = 'pending_choice' and m.notified_at is not null
     and a.email like '%@demo.ifedele.invalid' and b.email like '%@demo.ifedele.invalid'
   order by m.announced_at, m.id
   limit 1;
  if v_match.id is null then
    raise exception 'Aucun match de démonstration annoncé : exécuter soiree-demo.sql et attendre l''annonce (lendemain, 8 h)';
  end if;
  select p.user_id into v_woman from app.member_profiles p where p.user_id in (v_match.member_a, v_match.member_b) and p.sex = 'female';
  v_man := case when v_woman = v_match.member_a then v_match.member_b else v_match.member_a end;

  -- 1. Découverte ouverte quand les deux ont choisi ce match (choix d'office pour qui a peu de
  --    matchs) ; quelques messages sans coordonnées
  perform set_config('request.jwt.claims', json_build_object('sub', v_woman, 'role', 'authenticated')::text, true);
  if not exists (select 1 from app.match_choices where match_id = v_match.id and user_id = v_woman) then
    perform app.choose_match(v_match.id);
  end if;
  if not exists (select 1 from app.discoveries where match_id = v_match.id)
     and not exists (select 1 from app.match_choices where match_id = v_match.id and user_id = v_man) then
    perform set_config('request.jwt.claims', json_build_object('sub', v_man, 'role', 'authenticated')::text, true);
    perform app.choose_match(v_match.id);
    perform set_config('request.jwt.claims', json_build_object('sub', v_woman, 'role', 'authenticated')::text, true);
  end if;
  if not exists (select 1 from app.discoveries where match_id = v_match.id) then
    raise exception 'La découverte ne s''est pas ouverte (places de découverte déjà prises)';
  end if;
  select id into v_discovery from app.discoveries where match_id = v_match.id;
  select id into v_conversation from app.conversations where discovery_id = v_discovery;
  perform app.send_message(v_conversation, 'Bonsoir, j''ai beaucoup aimé notre échange à la soirée.');
  perform set_config('request.jwt.claims', json_build_object('sub', v_man, 'role', 'authenticated')::text, true);
  perform app.send_message(v_conversation, 'Moi aussi. Un café ce week-end, dans un lieu public ?');

  -- 2. « Je veux continuer » des deux : le couple se forme
  perform app.decide_discovery(v_discovery, true, false);
  perform set_config('request.jwt.claims', json_build_object('sub', v_woman, 'role', 'authenticated')::text, true);
  perform app.decide_discovery(v_discovery, true, false);
  select id into v_couple from app.couples where discovery_id = v_discovery;

  -- 3. Étapes confirmées par les deux jusqu'à « Dot ou mariage »
  foreach v_kind in array array['first_dates', 'family_introduction', 'dowry_or_wedding']::app.milestone_kind[] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_woman, 'role', 'authenticated')::text, true);
    perform app.confirm_milestone(v_couple, v_kind, 'reach');
    perform set_config('request.jwt.claims', json_build_object('sub', v_man, 'role', 'authenticated')::text, true);
    perform app.confirm_milestone(v_couple, v_kind, 'reach');
  end loop;

  -- 4. Cagnotte proposée par elle (numéro fictif), acceptée par lui
  perform set_config('request.jwt.claims', json_build_object('sub', v_woman, 'role', 'authenticated')::text, true);
  v_cagnotte := app.propose_cagnotte(v_couple, 'Notre mariage (démo)', 500000, current_date + 60, '+2290100000099');
  perform set_config('request.jwt.claims', json_build_object('sub', v_man, 'role', 'authenticated')::text, true);
  perform app.answer_cagnotte(v_cagnotte, true);

  -- 5. Un prestataire de démonstration contacté
  select id into v_provider from app.providers where is_demo and is_active order by category, name limit 1;
  if v_provider is not null then perform app.mark_provider_contacted(v_provider); end if;

  -- 6. Union déclarée par les deux : espace souvenir
  perform app.couple_decide(v_couple, 'union');
  perform set_config('request.jwt.claims', json_build_object('sub', v_woman, 'role', 'authenticated')::text, true);
  perform app.couple_decide(v_couple, 'union');

  -- 7. Photo de l'union, si le fichier a été déposé, relue et approuvée par l'équipe
  v_path := v_woman::text || '/union-demo.jpg';
  if exists (select 1 from storage.objects where bucket_id = 'member-photos' and name = v_path) then
    v_photo := app.add_union_photo(v_couple, v_path);
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    perform app.review_union_photo(v_photo, true);
  else
    raise notice 'Photo de l''union sautée : fichier % absent', v_path;
  end if;

  perform set_config('request.jwt.claims', '', true);
end $$;

commit;

select a.email, p.first_name, c.status as couple, g.title as cagnotte, g.status as etat_cagnotte,
       (select count(*) from app.union_photos up where up.couple_id = c.id) as photos_union
from app.couples c
join app.member_profiles p on p.user_id in (c.member_a, c.member_b)
join auth.users a on a.id = p.user_id
left join app.cagnottes g on g.couple_id = c.id
where a.email like '%@demo.ifedele.invalid';
